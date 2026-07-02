# Cross-Module Communication

Modules must never reference each other's internals. Communication happens via two contract forms: **synchronous in-process calls** (via anti-corruption layer) and **asynchronous published events** (eventual consistency).

## Enforcing Boundaries: Assemblies + the `internal` Keyword

Folder boundaries are convention. For **compile-time enforcement**, split each module into separate assemblies (`.csproj` files) — then `internal` types are unreachable from other assemblies, and direct references to another module's implementation become build errors.

### Why Assemblies

Within a single project, `internal` members remain visible to all code in the same assembly. A module's "internals" can still be accessed by a careless reference in another namespace. Assemblies enforce a hard boundary: types marked `internal` in assembly A are **invisible to assembly B**, even if B references A. This upgrades isolation from **convention** → **compile-time guarantee**.

### Public Surface = Contract Only

In each module assembly, mark `public` **only** the boundary types; everything else is `internal`:

| Artifact | Access Modifier | Reason |
|----------|-----------------|--------|
| Incoming port interface (`I<VerbNoun>`) | `public` | Other modules depend on it via DI |
| Outgoing port interface (`I<VerbNoun>Port`) | `internal` | Only this module's use case uses it |
| Use case class (`<VerbNoun>`) | `internal sealed` | Invoked only via incoming port |
| Adapter (`<VerbNoun>Adapter`) | `internal` | Only this module's DI binds it |
| Infrastructure adapter/repository | `internal` | Direct DB/HTTP access is module-private |
| EF Core `DbContext` | `internal` | Only module's adapters use it |
| Domain model, validator, mapper | `internal` | Implementation detail |
| Request/Response DTOs | `public` | Endpoint contract, clients depend on shape |
| Integration event (`<Noun><PastVerb>IntegrationEvent`) | `public` | Other modules subscribe to it |

**Before (single assembly):**
```csharp
// OrderModule/Core/CreateOrder.cs
public class CreateOrder : ICreateOrder { }

// In another namespace, another dev:
using OrderModule.Core;
var order = new CreateOrder(port);  // ⚠️ Violates isolation, but compiles!
```

**After (separate assembly):**
```csharp
// OrderModule.csproj: 
internal sealed class CreateOrder : ICreateOrder { }

// Another module tries:
using OrderModule.Core;
var order = new CreateOrder(port);  // ❌ Build error: inaccessible due to protection level
```

### Project Layout: Two Options

#### Option A: One assembly per module + contracts assembly (Recommended)

```
api.sln
├── api/
│   ├── User/
│   │   ├── User.csproj                          (module impl)
│   │   ├── User.Contracts.csproj                (public contracts only)
│   │   ├── <ModuleName>/
│   │   │   ├── <ModuleName>Module.cs            (public IModule impl)
│   │   │   ├── Core/
│   │   │   │   ├── Ports/
│   │   │   │   │   ├── Incoming/
│   │   │   │   │   │   └── IRegisterUser.cs     (public)
│   │   │   │   │   └── Outgoing/
│   │   │   │   │       └── IRegisterUserPort.cs (internal)
│   │   │   │   ├── RegisterUser.cs              (internal sealed)
│   │   │   │   └── Model/
│   │   │   │       ├── Endpoint/
│   │   │   │       │   ├── RegisterUserRequest.cs   (public)
│   │   │   │       │   └── RegisterUserResponse.cs  (public)
│   │   │   │       └── Events/
│   │   │   │           └── UserRegisteredIntegrationEvent.cs (public, in Contracts assembly)
│   │   │   ├── Infrastructure/
│   │   │   │   ├── Adapter/
│   │   │   │   │   └── RegisterUserAdapter.cs   (internal)
│   │   │   │   └── Mapping/
│   │   │   │       └── RegisterUserMapper.cs    (internal)
│   │   │   └── Application/
│   │   │       ├── Endpoint/
│   │   │       │   └── RegisterUserEndpoint.cs  (public)
│   │   │       └── Validator/
│   │   │           └── RegisterUserValidator.cs (internal)
│   │   └── User.Contracts/
│   │       ├── IRegisterUser.cs
│   │       ├── RegisterUserRequest.cs / RegisterUserResponse.cs
│   │       └── UserRegisteredIntegrationEvent.cs
│   │
│   ├── Order/
│   │   ├── Order.csproj
│   │   ├── Order.Contracts.csproj
│   │   └── ...
│   │
│   ├── Core/
│   │   ├── Core.csproj (shared kernel: BaseMessage, BaseRequest, etc.)
│   │   └── ...
│   │
│   └── Api.csproj (host; references User.Contracts, Order.Contracts, Core)
│
└── tests/
    ├── User.Tests.Narrow.csproj
    ├── User.Tests.Wide.csproj
    └── ...
```

**ProjectReference rules:**
- Consuming module references **only** `<ModuleName>.Contracts.csproj`, never the implementation project.
- Implementation modules reference their own `Contracts` project for their public types.
- All modules reference `Core.csproj` (shared kernel: `BaseMessage`, exceptions, etc.).

**User.csproj:**
```xml
<ItemGroup>
  <ProjectReference Include="..\Core\Core.csproj" />
  <ProjectReference Include="User.Contracts\User.Contracts.csproj" />
</ItemGroup>
```

**Order.csproj (depends on User via contracts only):**
```xml
<ItemGroup>
  <ProjectReference Include="..\Core\Core.csproj" />
  <ProjectReference Include="..\User\User.Contracts\User.Contracts.csproj" />
</ItemGroup>
```

**Api.csproj (host):**
```xml
<ItemGroup>
  <ProjectReference Include="User\User.csproj" />
  <ProjectReference Include="Order\Order.csproj" />
</ItemGroup>
```

This is the lightest option and mirrors Grzybek's "depend only on the integration-events assembly" rule — binaries, not folders, enforce the boundary.

#### Option B: Three projects per module (Hexagon by assembly)

For teams wanting the hexagon enforced at the assembly level too:

```
User/
├── User.Core.csproj              (domain: ports, use cases, models — no infra deps)
├── User.Application.csproj       (driving side: endpoints — depends on User.Core)
├── User.Infrastructure.csproj    (driven side: adapters, DB — depends on User.Core)
└── User.Contracts.csproj         (public contracts only)
```

**Dependency graph:**
- `User.Core` references only `Core` (shared kernel).
- `User.Application` references `User.Core`.
- `User.Infrastructure` references `User.Core`.
- Consuming modules reference only `User.Contracts`.

This enforces Core ← isolated from Infrastructure at the compiler level, but costs 4 projects per module. Use when the team values explicit hexagon enforcement.

**Recommendation:** Start with **Option A** (one impl + one contracts per module). If the team grows or the domain grows complex, graduate to **Option B**.

### Reflection Discovery Adaptation

The skill's `ModuleExtensions.DiscoverModules()` assumes all `IModule` impls are in the host assembly. With modules in separate assemblies:

```csharp
// api/Module/ModuleExtensions.cs
public static IServiceCollection DiscoverModules(this IServiceCollection services)
{
    // Scan all referenced module assemblies
    var moduleAssemblies = new[]
    {
        typeof(UserModule).Assembly,    // User module assembly
        typeof(OrderModule).Assembly,   // Order module assembly
        // Add each module's implementation assembly here
    };

    var moduleType = typeof(IModule);
    var modules = moduleAssemblies
        .SelectMany(a => a.GetTypes())
        .Where(t => moduleType.IsAssignableFrom(t) && !t.IsInterface)
        .Select(t => (IModule)Activator.CreateInstance(t)!)
        .ToList();

    foreach (var module in modules)
    {
        module.RegisterModule(services);
    }

    return services;
}
```

Alternatively, use explicit registration in `Program.cs`:
```csharp
services.AddScoped<IModule, UserModule>();
services.AddScoped<IModule, OrderModule>();
// Then call:
services.DiscoverModules();
```

Or auto-scan via a marker interface in each assembly's `AssemblyInfo.cs`.

### Tests & InternalsVisibleTo

Unit tests need access to internal use cases and adapters (mocking). Use `InternalsVisibleTo` in the module assembly:

**User/User.csproj or User/Properties/AssemblyInfo.cs:**
```xml
<ItemGroup>
  <InternalsVisibleTo Include="User.Tests.Narrow" />
</ItemGroup>
```

Or in code:
```csharp
// User/Properties/AssemblyInfo.cs
[assembly: InternalsVisibleTo("User.Tests.Narrow")]
```

**User.Tests.Narrow.csproj:**
```xml
<ItemGroup>
  <ProjectReference Include="..\User\User.csproj" />
</ItemGroup>
```

Now tests can instantiate and mock internal use cases:
```csharp
// User.Tests.Narrow/RegisterUserShould.cs
public class RegisterUserShould
{
    [Test]
    public async Task SaveUserAndPublishEvent()
    {
        // ✓ Can reference internal class
        var registerUserPort = Substitute.For<IRegisterUserPort>();
        var eventBus = Substitute.For<IEventBus>();
        var useCase = new RegisterUser(registerUserPort, eventBus);

        var result = await useCase.HandleAsync(/* ... */);
        // Assert...
    }
}
```

### Architecture Test Fallback (When Assemblies Aren't Feasible Yet)

If splitting into assemblies isn't immediately possible, enforce the boundary via **architecture tests** at test-time using [NetArchTest.Rules](https://github.com/BenMorris/NetArchTest.Rules) or [ArchUnitNET](https://github.com/TNG/ArchUnitNET):

```csharp
// tests/ArchitectureTests.cs
[TestFixture]
public class ModuleIsolationShould
{
    [Test]
    public void NotAllowCrossModuleInternalDependencies()
    {
        var result = Types.InAssembly(typeof(Program).Assembly)
            .That()
            .ResideInNamespace("OrderModule.Core")
            .Should()
            .NotDependOnAny("UserModule.Core", "UserModule.Infrastructure")
            .GetResult();

        Assert.That(result.IsSuccessful, Is.True);
    }

    [Test]
    public void OnlyExposePublicContracts()
    {
        var result = Types.InAssembly(typeof(Program).Assembly)
            .That()
            .ResideInNamespace("UserModule")
            .And()
            .AreNotPublic()
            .Should()
            .NotBeDependedOnByAny("OrderModule", "PaymentModule")
            .GetResult();

        Assert.That(result.IsSuccessful, Is.True);
    }
}
```

This catches violations at CI time, not compile time, but is a pragmatic bridge until you split into assemblies.

## Decision Table: Sync vs. Async

| Aspect | Synchronous (ACL) | Asynchronous (Event) |
|--------|-------------------|----------------------|
| **Latency** | Immediate result | Decoupled, delayed |
| **Consistency** | Immediate (same transaction) | Eventual (idempotent consumers) |
| **Coupling** | Tight (caller → callee) | Loose (publisher → subscriber via contract) |
| **Failure mode** | Caller sees error | Fire-and-forget; consumer retries |
| **Use case** | Query, immediate validation, thin orchestration | State changes, notifications, cross-domain events |
| **Example** | "Get user eligibility before order" | "User registered → send email + update read model" |

## Pattern 1: Synchronous Cross-Module Call (Anti-Corruption Layer)

Module A must invoke Module B without directly referencing B's types. A defines an **outgoing port** and an **adapter** that translates A's domain language into B's public interface.

### Structure

```
Module A:
  Core/Ports/Outgoing/IGetUserEligibilityPort.cs
  Infrastructure/Adapter/GetUserEligibilityAdapter.cs
       ↓ (adapter depends on B's public contract)
Module B:
  Core/Ports/Incoming/IGetUserEligibility.cs
  Core/GetUserEligibility.cs (use case)
```

### Step 1: Module A defines the outgoing port (A's domain language)

```csharp
// Module/OrderModule/Core/Ports/Outgoing/IGetUserEligibilityPort.cs
public interface IGetUserEligibilityPort
{
    /// <summary>
    /// Determines if the user is eligible for this order.
    /// </summary>
    Task<Result<UserEligibility>> CheckEligibilityAsync(Guid userId);
}

public class UserEligibility
{
    public bool IsEligible { get; set; }
    public string? Reason { get; set; }
}
```

### Step 2: Module B defines its incoming port (B's domain language)

```csharp
// Module/UserModule/Core/Ports/Incoming/ICheckUserEligibility.cs
public interface ICheckUserEligibility
{
    Task<Result<EligibilityCheckResult>> HandleAsync(EligibilityCheckRequest request);
}

public class EligibilityCheckRequest : BaseRequest
{
    public Guid UserId { get; set; }
}

public class EligibilityCheckResult
{
    public bool Eligible { get; set; }
    public string? ReasonIfNot { get; set; }
}
```

### Step 3: Module A's adapter translates A's port into B's port (anti-corruption layer)

```csharp
// Module/OrderModule/Infrastructure/Adapter/GetUserEligibilityAdapter.cs
public class GetUserEligibilityAdapter(
    ICheckUserEligibility userEligibilityUseCase) : IGetUserEligibilityPort
{
    public async Task<Result<UserEligibility>> CheckEligibilityAsync(Guid userId)
    {
        var request = new EligibilityCheckRequest { UserId = userId };
        var result = await userEligibilityUseCase.HandleAsync(request);

        if (!result.IsSuccess)
            return Result<UserEligibility>.Fail(result.Error!);

        return Result<UserEligibility>.Ok(new UserEligibility
        {
            IsEligible = result.Value!.Eligible,
            Reason = result.Value.ReasonIfNot
        });
    }
}
```

### Step 4: Module A's use case depends on the outgoing port, not B

```csharp
// Module/OrderModule/Core/CreateOrder.cs
public class CreateOrder(
    ICreateOrderPort orderPort,
    IGetUserEligibilityPort eligibilityPort) : ICreateOrder
{
    public async Task<Result<CreateOrderResponse>> HandleAsync(CreateOrderRequest request)
    {
        // Call B's contract via the adapter (port abstraction)
        var eligibility = await eligibilityPort.CheckEligibilityAsync(request.UserId);
        if (!eligibility.IsSuccess || !eligibility.Value!.IsEligible)
            return Result<CreateOrderResponse>.Fail(new Error(
                StatusCode: 403,
                Title: "UserIneligible",
                Detail: $"User not eligible: {eligibility.Value?.Reason}"));

        var id = await orderPort.CreateAsync(request);
        return Result<CreateOrderResponse>.Ok(new CreateOrderResponse { Id = id });
    }
}
```

### Step 5: Register the adapter in the calling module

```csharp
// Module/OrderModule/OrderModule.cs
public class OrderModule : IModule
{
    public IServiceCollection RegisterModule(IServiceCollection services)
    {
        services.AddScoped<ICreateOrder, CreateOrder>();
        services.AddScoped<ICreateOrderPort, CreateOrderAdapter>();

        // Cross-module: Register the adapter that depends on UserModule's incoming port
        services.AddScoped<IGetUserEligibilityPort, GetUserEligibilityAdapter>();

        services.AddSingleton<CreateOrderMapper>();
        return services;
    }
}
```

## Pattern 2: Asynchronous Cross-Module Events (Eventual Consistency)

Modules communicate via published **integration events** — immutable messages. A source module emits an event after a state change; downstream modules subscribe and update their read models or trigger side effects. No direct coupling.

### Core: In-Memory Event Bus

```csharp
// api/Core/Interface/IEventBus.cs
public interface IEventBus
{
    Task PublishAsync(BaseMessage message);
    void Subscribe<TEvent>(IIntegrationEventHandler<TEvent> handler) where TEvent : BaseMessage;
}

// api/Core/Interface/IIntegrationEventHandler.cs
public interface IIntegrationEventHandler<TEvent> where TEvent : BaseMessage
{
    Task HandleAsync(TEvent @event);
}
```

### Step 1: Source module publishes the event

Define the integration event (shared contract both modules understand):

```csharp
// Module/UserModule/Core/Model/UserRegisteredIntegrationEvent.cs
public class UserRegisteredIntegrationEvent : BaseMessage
{
    public Guid UserId { get; set; }
    public string Email { get; set; } = string.Empty;
}
```

Publish in the use case after state is committed:

```csharp
// Module/UserModule/Core/RegisterUser.cs
public class RegisterUser(
    IRegisterUserPort port,
    IEventBus eventBus) : IRegisterUser
{
    public async Task<Result<RegisterUserResponse>> HandleAsync(RegisterUserRequest request)
    {
        Guard.Against.NullOrEmpty(request.Email);

        var userId = await port.SaveAsync(request);

        // Publish event after successful save
        await eventBus.PublishAsync(new UserRegisteredIntegrationEvent
        {
            UserId = userId,
            Email = request.Email
        });

        return Result<RegisterUserResponse>.Ok(new RegisterUserResponse { UserId = userId });
    }
}
```

### Step 2: Downstream module subscribes to the event

```csharp
// Module/NotificationModule/Core/Handlers/UserRegisteredHandler.cs
public class UserRegisteredHandler(
    ISendWelcomeEmailPort emailPort) : IIntegrationEventHandler<UserRegisteredIntegrationEvent>
{
    public async Task HandleAsync(UserRegisteredIntegrationEvent @event)
    {
        await emailPort.SendWelcomeEmailAsync(
            userId: @event.UserId,
            email: @event.Email);
    }
}
```

### Step 3: Register the handler in the consuming module

```csharp
// Module/NotificationModule/NotificationModule.cs
public class NotificationModule : IModule
{
    public IServiceCollection RegisterModule(IServiceCollection services)
    {
        services.AddScoped<ISendWelcomeEmailPort, SendWelcomeEmailAdapter>();
        
        // Register the event handler
        services.AddScoped<UserRegisteredHandler>();
        services.AddScoped<IIntegrationEventHandler<UserRegisteredIntegrationEvent>>(
            sp => sp.GetRequiredService<UserRegisteredHandler>());

        return services;
    }
}
```

### Step 4: Wire the event bus in Program.cs

```csharp
// Program.cs
var services = builder.Services;

// In-memory event bus
services.AddSingleton<IEventBus, InMemoryEventBus>();

// Discover and register all handlers
var handlerType = typeof(IIntegrationEventHandler<>);
var handlers = typeof(Program).Assembly.GetTypes()
    .Where(t => t.GetInterfaces()
        .Any(i => i.IsGenericType && i.GetGenericTypeDefinition() == handlerType))
    .ToList();

foreach (var handler in handlers)
{
    var @interface = handler.GetInterfaces()
        .First(i => i.IsGenericType && i.GetGenericTypeDefinition() == handlerType);
    
    services.AddScoped(@interface, handler);
}

// Auto-discover and register modules
services.DiscoverModules();
```

### InMemoryEventBus Implementation

```csharp
// api/Infrastructure/Bus/InMemoryEventBus.cs
public class InMemoryEventBus : IEventBus
{
    private readonly Dictionary<Type, List<Delegate>> _subscribers = new();
    private readonly IServiceProvider _serviceProvider;

    public InMemoryEventBus(IServiceProvider serviceProvider)
    {
        _serviceProvider = serviceProvider;
    }

    public async Task PublishAsync(BaseMessage message)
    {
        var messageType = message.GetType();

        if (!_subscribers.TryGetValue(messageType, out var handlers))
            return;

        foreach (var handler in handlers)
        {
            var handlerInstance = _serviceProvider.GetService(handler.Target!.GetType());
            if (handlerInstance is null)
                continue;

            var method = handler.Method;
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
            .GetMethod(nameof(IIntegrationEventHandler<TEvent>.HandleAsync),
                new[] { typeof(TEvent) })!;

        _subscribers[eventType].Add(Delegate.CreateDelegate(
            typeof(Func<TEvent, Task>),
            handler,
            handleMethod));
    }
}
```

## Pattern 3: Transactional Outbox (Guaranteed Event Delivery)

Fire-and-forget events are not durable: a module saves state, publishes an event, then crashes before commit. The consumer never sees the event. **Transactional Outbox** ensures: event recorded iff state committed.

### Step 1: Add outbox table to DbContext

```csharp
// api/Infrastructure/Context/AppDbContext.cs
public DbSet<OutboxEvent> OutboxEvents { get; set; }

protected override void OnModelCreating(ModelBuilder modelBuilder)
{
    modelBuilder.Entity<OutboxEvent>(b =>
    {
        b.HasKey(e => e.Id);
        b.Property(e => e.EventPayload).HasMaxLength(4000);
        b.Property(e => e.EventType).HasMaxLength(500);
        b.Property(e => e.ProcessedAt).IsRequired(false);
    });
}
```

### Step 2: Define the outbox entity

```csharp
// api/Core/Data/Entities/OutboxEvent.cs
public class OutboxEvent
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string EventType { get; set; } = string.Empty;
    public string EventPayload { get; set; } = string.Empty;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? ProcessedAt { get; set; }
}
```

### Step 3: Write to outbox in the same transaction as business state

```csharp
// Module/UserModule/Core/RegisterUser.cs
public class RegisterUser(
    IRegisterUserPort port,
    IOutboxWriter outboxWriter) : IRegisterUser
{
    public async Task<Result<RegisterUserResponse>> HandleAsync(RegisterUserRequest request)
    {
        Guard.Against.NullOrEmpty(request.Email);

        var userId = await port.SaveAsync(request);

        // Write event to outbox in same transaction
        var @event = new UserRegisteredIntegrationEvent
        {
            UserId = userId,
            Email = request.Email
        };

        await outboxWriter.AddAsync(@event);

        return Result<RegisterUserResponse>.Ok(new RegisterUserResponse { UserId = userId });
    }
}
```

### Step 4: Outbox writer (adapter)

```csharp
// Module/UserModule/Infrastructure/Adapter/OutboxWriter.cs
public interface IOutboxWriter
{
    Task AddAsync(BaseMessage @event);
}

public class OutboxWriter(AppDbContext context) : IOutboxWriter
{
    public async Task AddAsync(BaseMessage @event)
    {
        var outboxEvent = new OutboxEvent
        {
            EventType = @event.GetType().Name,
            EventPayload = JsonSerializer.Serialize(@event)
        };

        context.OutboxEvents.Add(outboxEvent);
        await context.SaveChangesAsync();
    }
}
```

### Step 5: Background job (relay) polls and publishes

```csharp
// api/Infrastructure/Jobs/OutboxRelayJob.cs
[DisallowConcurrentExecution]
public class OutboxRelayJob(
    AppDbContext context,
    IEventBus eventBus,
    ILogger<OutboxRelayJob> logger) : IJob
{
    public async Task Execute(IJobExecutionContext context)
    {
        var unprocessed = await this.context.OutboxEvents
            .Where(e => e.ProcessedAt == null)
            .ToListAsync();

        foreach (var outbox in unprocessed)
        {
            try
            {
                var @event = JsonSerializer.Deserialize<BaseMessage>(outbox.EventPayload);
                if (@event is null)
                    continue;

                await eventBus.PublishAsync(@event);

                outbox.ProcessedAt = DateTime.UtcNow;
                await this.context.SaveChangesAsync();
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Failed to relay event {EventId}", outbox.Id);
            }
        }
    }
}
```

## Idempotent Consumers

Outbox guarantees **at-least-once** delivery, not exactly-once. Consumers must be idempotent — applying the same event twice yields the same result as once.

### Pattern: Track processed event IDs

```csharp
// Module/NotificationModule/Core/Handlers/UserRegisteredHandler.cs
public class UserRegisteredHandler(
    ISendWelcomeEmailPort emailPort,
    IProcessedEventRepository processedEventRepo) : IIntegrationEventHandler<UserRegisteredIntegrationEvent>
{
    public async Task HandleAsync(UserRegisteredIntegrationEvent @event)
    {
        // Check: have we already processed this event?
        var alreadyProcessed = await processedEventRepo.ExistsAsync(@event.CorrelationId);
        if (alreadyProcessed)
            return;

        // Process
        await emailPort.SendWelcomeEmailAsync(
            userId: @event.UserId,
            email: @event.Email);

        // Mark as processed (CorrelationId ensures idempotency)
        await processedEventRepo.MarkProcessedAsync(@event.CorrelationId);
    }
}
```

## Naming Conventions

| Artifact | Pattern | Example |
|----------|---------|---------|
| Integration event | `<Noun><PastVerb>IntegrationEvent` | `UserRegisteredIntegrationEvent` |
| Event handler | `<Noun><PastVerb>Handler` | `UserRegisteredHandler` |
| Cross-module outgoing port | `I<VerbNoun>Port` | `IGetUserEligibilityPort` |
| Cross-module async contract | Share via `Core/Model/` or `Core/Model/Contracts/` | Both modules depend on the event class |

## Known Tradeoffs & Open Questions

### In-Memory Event Bus vs. External Broker

**In-memory (`IEventBus`):**
- ✓ No external dependencies, fast, great for monolith
- ✗ Handlers run in the same process; slow handlers block others
- ✗ If host crashes between publish and handler, event is lost (mitigate with Outbox)
- ✗ Does not scale to distributed systems (no cross-service pub/sub)

**External broker** (RabbitMQ, Azure Service Bus, MassTransit over broker):
- ✓ Resilient; handlers can fail and retry independently
- ✓ Scales to microservices
- ✗ Adds infrastructure complexity, operational burden, network latency
- ✗ Requires dead-letter queue handling, monitoring

**When to migrate from in-memory to external broker:** When you split the monolith into services. Until then, in-memory + Outbox is simpler and sufficient.

### Sagas & Process Managers

When order-submit orchestrates user eligibility, payment, and fulfillment across 3 modules, coordinate via:

**Choreography** (event-chain): Order publishes `OrderCreated` → Payment subscribes & publishes `PaymentProcessed` → Fulfillment subscribes. Decoupled but hard to trace flow.

**Orchestration** (process manager / saga): A dedicated `OrderSagaOrchestrator` listens to events and calls sync APIs to other modules in sequence. Explicit flow, easier to debug.

For 2–3 module flows, direct sync calls (Pattern 1, ACL) are often cleaner than saga machinery.

### Eventual Consistency Guarantees

- **Consistency within a module:** ACID (one DB, Outbox in same transaction).
- **Consistency across modules:** Eventual (subscriber may lag minutes or fail).
- **Conflict resolution:** Module-specific. E.g., if User service marks user inactive while Order service is placing order, order may succeed with inactive user; reconcile via read-model projections or compensation flows.
- **Backwards compatibility:** If `UserRegisteredIntegrationEvent` gains a field, old consumers must tolerate missing data (use defaults).

### Shared Kernel Events vs. Module Isolation

Sharing integration events means modules depend on a shared contract class. This is **intentional coupling at the boundary**, not a violation of isolation — the event is the published API, like a REST contract. Keep event shapes minimal and backwards-compatible.

## Checklist: Adding Cross-Module Communication

**Synchronous (ACL):**
- [ ] Module A defines outgoing port `I<VerbNoun>Port` in `Core/Ports/Outgoing/`
- [ ] Module B has incoming port `I<VerbNoun>` in `Core/Ports/Incoming/`
- [ ] Module A's adapter in `Infrastructure/Adapter/` translates A's domain → B's domain
- [ ] Adapter is registered in A's `<ModuleName>Module.cs`
- [ ] Use case depends on outgoing port, not B's types directly
- [ ] Return `Result<T>` on both sides; adapter maps error if needed

**Asynchronous (Event):**
- [ ] Integration event class `<Noun><PastVerb>IntegrationEvent : BaseMessage`
- [ ] Event in shared location both modules can reference (e.g., `Core/Model/Events/`)
- [ ] Source module publishes via `IEventBus` after state committed
- [ ] Consuming module implements `IIntegrationEventHandler<TEvent>`
- [ ] Handler registered in module's `RegisterModule()`
- [ ] If using Outbox: write event to outbox table in same transaction, configure relay job
- [ ] If Outbox: consuming handlers are idempotent (check CorrelationId or dedup)

**Both:**
- [ ] Module Core has **zero direct references** to other modules' internal types
- [ ] Integration events reuse `BaseMessage` & `CorrelationId` for traceability
- [ ] Explicit error handling: sync returns `Result<T>`, async uses dead-letter / retry
- [ ] Add wide tests exercising cross-module call/event via WebApplicationFactory
