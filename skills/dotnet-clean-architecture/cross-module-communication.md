# Cross-Module Communication: Events-Only Doctrine

Modules communicate **asynchronously via integration events only**. No synchronous in-process calls, no `<Module>.Contracts` assemblies. Events are the sole inter-module contract: immutable, serialized, published through a message bus. Consumers must be idempotent.

## Core Abstraction: IEventBus

All modules depend on a shared `IEventBus` interface in the shared kernel:

```csharp
// Core/Ports/IEventBus.cs
public interface IEventBus
{
    Task PublishAsync(BaseMessage message);
}

// Core/BaseMessage.cs
public abstract class BaseMessage
{
    public string CorrelationId { get; set; } = Guid.NewGuid().ToString();
    public DateTime OccurredAt { get; set; } = DateTime.UtcNow;
}

// Consumer handler
public interface IIntegrationEventHandler<TEvent> where TEvent : BaseMessage
{
    Task HandleAsync(TEvent @event);
}
```

## Pattern: In-Memory Event Bus (Default)

For a monolith, in-memory is fast and simple. Handlers run synchronously in the same process.

```csharp
// Core/Infrastructure/InMemoryEventBus.cs
public sealed class InMemoryEventBus(IServiceProvider serviceProvider) : IEventBus
{
    private readonly Dictionary<Type, List<Delegate>> _subscribers = new();

    public async Task PublishAsync(BaseMessage message)
    {
        var messageType = message.GetType();

        if (!_subscribers.TryGetValue(messageType, out var handlers))
            return;

        foreach (var handlerDelegate in handlers)
        {
            var handlerInstance = serviceProvider.GetService(handlerDelegate.Target?.GetType()!);
            if (handlerInstance is null)
                continue;

            var method = handlerDelegate.Method;
            if (method.ReturnType == typeof(Task))
            {
                var task = (Task?)method.Invoke(handlerInstance, new object[] { message });
                if (task is not null)
                    await task;
            }
        }
    }

    public void Subscribe<TEvent>(IIntegrationEventHandler<TEvent> handler) where TEvent : BaseMessage
    {
        var eventType = typeof(TEvent);

        if (!_subscribers.ContainsKey(eventType))
            _subscribers[eventType] = new List<Delegate>();

        var handleMethod = handler.GetType()
            .GetMethod(nameof(IIntegrationEventHandler<TEvent>.HandleAsync), new[] { typeof(TEvent) })!;

        _subscribers[eventType].Add(Delegate.CreateDelegate(
            typeof(Func<TEvent, Task>),
            handler,
            handleMethod));
    }
}
```

Register in `Program.cs`:

```csharp
builder.Services.AddSingleton<IEventBus, InMemoryEventBus>();
```

## Pattern: Transactional Outbox (Durability)

When a module must guarantee event delivery even if the process crashes, use the Outbox pattern: write events to the database in the same transaction as business state. A background job relays events from the outbox.

### Step 1: Add Outbox Table

```csharp
public class OutboxEvent
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string EventType { get; set; } = string.Empty;
    public string EventPayload { get; set; } = string.Empty;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? ProcessedAt { get; set; }
}
```

Configure in DbContext:

```csharp
modelBuilder.Entity<OutboxEvent>(b =>
{
    b.ToTable("outbox_events", schema: "invoice");
    b.HasKey(e => e.Id);
    b.Property(e => e.EventType).HasMaxLength(500).IsRequired();
    b.Property(e => e.EventPayload).IsRequired();
    b.Property(e => e.CreatedAt).IsRequired();
    b.Property(e => e.ProcessedAt).IsRequired(false);
});
```

### Step 2: Write Event to Outbox (Same Transaction as State)

```csharp
// Core/CreateInvoice.cs — publish event in same transaction as Save
public sealed class CreateInvoice(
    IInvoiceRepository repository,
    IOutboxWriter outboxWriter) : ICreateInvoice
{
    public async Task<Invoice> ExecuteAsync(CreateInvoiceCommand command, CancellationToken ct)
    {
        var invoice = new Invoice(/* ... */);
        await repository.AddAsync(invoice, ct);  // Database commit happens here

        // Write event to outbox in same transaction
        var @event = new InvoiceCreatedIntegrationEvent
        {
            InvoiceId = invoice.Id,
            Number = invoice.Number,
            CustomerId = invoice.CustomerId
        };

        await outboxWriter.WriteAsync(@event, ct);  // Committed with invoice

        return invoice;
    }
}
```

**Outbox writer adapter:**

```csharp
// Infrastructure/Adapter/OutboxWriter.cs
public interface IOutboxWriter
{
    Task WriteAsync(BaseMessage @event, CancellationToken ct);
}

public sealed class OutboxWriter(InvoiceDbContext dbContext) : IOutboxWriter
{
    public async Task WriteAsync(BaseMessage @event, CancellationToken ct)
    {
        var outboxEvent = new OutboxEvent
        {
            EventType = @event.GetType().Name,
            EventPayload = System.Text.Json.JsonSerializer.Serialize(@event)
        };

        dbContext.OutboxEvents.Add(outboxEvent);
        await dbContext.SaveChangesAsync(ct);
    }
}
```

Register:

```csharp
// InvoiceModule.cs
services.AddScoped<IOutboxWriter, OutboxWriter>();
```

### Step 3: Relay Job (Background Worker)

A scheduled job polls the outbox and publishes events:

```csharp
// Infrastructure/Jobs/OutboxRelayJob.cs
public sealed class OutboxRelayJob(
    InvoiceDbContext dbContext,
    IEventBus eventBus,
    ILogger<OutboxRelayJob> logger) : IJob
{
    public async Task Execute(IJobExecutionContext context)
    {
        var unprocessed = await dbContext.OutboxEvents
            .Where(e => e.ProcessedAt == null)
            .ToListAsync();

        foreach (var outboxEvent in unprocessed)
        {
            try
            {
                var @event = System.Text.Json.JsonSerializer.Deserialize<BaseMessage>(
                    outboxEvent.EventPayload);

                if (@event is null)
                    continue;

                await eventBus.PublishAsync(@event);

                outboxEvent.ProcessedAt = DateTime.UtcNow;
                await dbContext.SaveChangesAsync();

                logger.LogInformation("Published event {EventType} {EventId}",
                    outboxEvent.EventType, outboxEvent.Id);
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Failed to relay event {EventId}", outboxEvent.Id);
            }
        }
    }
}
```

Register with Hangfire or similar scheduler in `Program.cs`.

## Publishing an Event (Simple Case)

When durability is not critical (e.g., read-side notifications), publish directly:

```csharp
// Core/CreateInvoice.cs — direct publish
public sealed class CreateInvoice(
    IInvoiceRepository repository,
    IEventBus eventBus) : ICreateInvoice
{
    public async Task<Invoice> ExecuteAsync(CreateInvoiceCommand command, CancellationToken ct)
    {
        var invoice = new Invoice(/* ... */);
        await repository.AddAsync(invoice, ct);

        // Fire-and-forget: event is lost if process crashes before publish completes
        await eventBus.PublishAsync(new InvoiceCreatedIntegrationEvent
        {
            InvoiceId = invoice.Id,
            Number = invoice.Number,
            CustomerId = invoice.CustomerId
        });

        return invoice;
    }
}
```

## Consuming an Event

Every module that cares about a domain event implements `IIntegrationEventHandler<TEvent>`:

```csharp
// PaymentModule/Core/Handlers/InvoiceCreatedHandler.cs
public sealed class InvoiceCreatedHandler(
    IPaymentRepository paymentRepo,
    IProcessedEventRepository processedEvents)
    : IIntegrationEventHandler<InvoiceCreatedIntegrationEvent>
{
    public async Task HandleAsync(InvoiceCreatedIntegrationEvent @event)
    {
        // Idempotency: check if we've already processed this event
        var alreadyProcessed = await processedEvents.ExistsAsync(@event.CorrelationId);
        if (alreadyProcessed)
            return;

        // Handle the event (read-side update, side effect, etc.)
        await paymentRepo.LinkToInvoiceAsync(@event.InvoiceId, @event.CustomerId);

        // Mark as processed
        await processedEvents.MarkAsync(@event.CorrelationId);
    }
}
```

Register in the module's `RegisterModule`:

```csharp
// PaymentModule.cs
public IServiceCollection RegisterModule(IServiceCollection services)
{
    services.AddScoped<InvoiceCreatedHandler>();
    services.AddScoped<IIntegrationEventHandler<InvoiceCreatedIntegrationEvent>>(
        sp => sp.GetRequiredService<InvoiceCreatedHandler>());

    return services;
}
```

## Idempotency: Guaranteed At-Least-Once

The Outbox pattern guarantees at-least-once delivery, not exactly-once. If a consumer crashes mid-handle, the event will be replayed. Handlers MUST be idempotent: applying the same event twice should yield the same result as applying it once.

### Pattern 1: Track Processed Event IDs

```csharp
// PaymentModule/Infrastructure/Persistence/ProcessedEventRepository.cs
public interface IProcessedEventRepository
{
    Task<bool> ExistsAsync(string correlationId);
    Task MarkAsync(string correlationId);
}

public sealed class ProcessedEventRepository(PaymentDbContext dbContext)
    : IProcessedEventRepository
{
    public async Task<bool> ExistsAsync(string correlationId)
    {
        return await dbContext.ProcessedEvents
            .AnyAsync(e => e.CorrelationId == correlationId);
    }

    public async Task MarkAsync(string correlationId)
    {
        var processed = new ProcessedEvent { CorrelationId = correlationId };
        dbContext.ProcessedEvents.Add(processed);
        await dbContext.SaveChangesAsync();
    }
}

// Table
public class ProcessedEvent
{
    public Guid Id { get; set; }
    public string CorrelationId { get; set; } = string.Empty;
    public DateTime ProcessedAt { get; set; } = DateTime.UtcNow;
}
```

**Handler uses it:**

```csharp
public sealed class InvoiceCreatedHandler(
    IPaymentRepository paymentRepo,
    IProcessedEventRepository processedEvents)
    : IIntegrationEventHandler<InvoiceCreatedIntegrationEvent>
{
    public async Task HandleAsync(InvoiceCreatedIntegrationEvent @event)
    {
        // Check: have we already processed this event?
        if (await processedEvents.ExistsAsync(@event.CorrelationId))
            return;

        // Process idempotently
        await paymentRepo.LinkToInvoiceAsync(@event.InvoiceId, @event.CustomerId);

        // Mark as processed
        await processedEvents.MarkAsync(@event.CorrelationId);
    }
}
```

### Pattern 2: Idempotent Operations

If your operation is naturally idempotent (e.g., update-or-create), deduplication is automatic:

```csharp
public sealed class InvoiceCreatedHandler(
    IPaymentRepository paymentRepo)
    : IIntegrationEventHandler<InvoiceCreatedIntegrationEvent>
{
    public async Task HandleAsync(InvoiceCreatedIntegrationEvent @event)
    {
        // Upsert: idempotent by design
        await paymentRepo.EnsureInvoiceLinkAsync(@event.InvoiceId, @event.CustomerId);
    }
}
```

## Event Design Best Practices

1. **Immutable:** Events are records, not classes. No setters.
   ```csharp
   public record InvoiceCreatedIntegrationEvent : BaseMessage
   {
       public required string InvoiceId { get; init; }
       public required string Number { get; init; }
       public required string CustomerId { get; init; }
   }
   ```

2. **Versioning:** Add a Version field if you need to evolve the event shape.
   ```csharp
   public record InvoiceCreatedIntegrationEvent : BaseMessage
   {
       public int Version { get; init; } = 1;
       public required string InvoiceId { get; init; }
       // v2: added Discount, but old consumers still work (default 0)
   }
   ```

3. **Backwards compatible:** New consumers must tolerate old event shapes (use defaults).
   ```csharp
   var discount = @event.GetType().GetProperty("Discount")?.GetValue(@event) as decimal? ?? 0m;
   ```

4. **No request/response:** Events are one-way. If you need a reply, publish a new event.

5. **Publish after commit:** Always publish after database commit. Use Outbox for durability.

## Integration Event vs. Domain Event

- **Domain event:** internal to a module, raised during business logic, part of the aggregate.
- **Integration event:** crosses module boundaries, published to the event bus, consumed by other modules.

Same base (`BaseMessage`), but only domain events raised as `*IntegrationEvent` are published. Purely internal domain events never leave the module.

## Naming Convention

| Artifact | Pattern |
|----------|---------|
| Integration event | `<Noun><PastVerb>IntegrationEvent` |
| Event handler | `<Noun><PastVerb>Handler` |
| Outbox writer | `IOutboxWriter` |
| Processed events repo | `IProcessedEventRepository` |

## Checklist: Cross-Module Event Communication

- [ ] Define integration event as `record : BaseMessage` in source module
- [ ] Publish after business state committed (direct or via Outbox)
- [ ] Source module's `RegisterModule` does NOT register the event handler
- [ ] Consuming module implements `IIntegrationEventHandler<TEvent>`
- [ ] Handler is idempotent (check CorrelationId or naturally idempotent operation)
- [ ] Handler registered in consuming module's `RegisterModule`
- [ ] If durability critical: use Outbox + relay job
- [ ] If fire-and-forget: publish directly (acceptable for read-side projections)
- [ ] Integration test: WebApplicationFactory, verify event published
