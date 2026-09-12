# Event Sourcing (Per Bounded Context)

**Event sourcing is a first-class persistence choice, selected per bounded context** — not an
optional add-on and not a global default. Alongside it, plain EF Core CRUD is equally first-class
(see [SKILL.md](SKILL.md) and ADR-0037). Choose per bounded context: lean event-sourced when the
domain needs an immutable audit trail, temporal queries, or event-driven projections; lean CRUD
when a single read-write relational model is enough.

**The real implementation is Marten, one ancillary store per bounded context (not host-global
`AddMarten`)** — see ADR-0048 and the
working stores in `backend/src/Companies/` and `backend/src/ThirdParties/`.

> **Deprecation note (verified 2026-09):** the hand-rolled `events` table, `IEventStore`, and
> snapshot code below are an illustrative template. They **contradict** the current repo, which
> uses Marten event stores. Prefer the Marten implementation and treat this document's mechanics
> as conceptual only. Replacing this template with Marten-backed examples is a follow-up.

## When To Opt In

- **Audit trail:** System must record every state change for compliance or debugging.
- **Temporal queries:** "Show me the order state on date X" or "replay events from date Y."
- **Complex sagas:** Multi-step processes need to recover from failure mid-operation.
- **Event-driven projections:** Multiple read models derived from a single event stream.

**When NOT to opt in:** Simple CRUD (e.g., Invoice or Customer listings) works fine with standard EF Core. Event sourcing adds complexity.

## Architecture

All state changes are represented as **events**. The aggregate is rehydrated from the event stream on each load.

```text
Write Side (Command):
  Aggregate.Place(...) → Raise(event) → When(event) → UncommittedEvents
  Repository.Save() → EventStore.Append(stream, events)

Read Side (Query):
  EventStore.Load(stream) → LoadFromHistory(events) → rehydrated aggregate
  Projections updated by event handlers
```

## Event Store Schema

PostgreSQL table to store domain events:

```sql
CREATE TABLE invoice.events (
    id SERIAL PRIMARY KEY,
    stream_id UUID NOT NULL,
    event_type VARCHAR(500) NOT NULL,
    event_data JSONB NOT NULL,
    metadata JSONB,
    version BIGINT NOT NULL,
    occurred_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(stream_id, version)
);

CREATE INDEX idx_events_stream ON invoice.events(stream_id, version);
CREATE INDEX idx_events_type ON invoice.events(event_type);
```

## Event Store Implementation

```csharp
// Core/Ports/Outgoing/IEventStore.cs
public interface IEventStore
{
    Task AppendAsync(Guid streamId, IReadOnlyList<DomainEvent> events, CancellationToken ct);
    Task<IReadOnlyList<DomainEvent>> LoadAsync(Guid streamId, CancellationToken ct);
    Task<IReadOnlyList<DomainEvent>> LoadSinceVersionAsync(
        Guid streamId, long sinceVersion, CancellationToken ct);
}

// Infrastructure/Adapter/PostgreSqlEventStore.cs
public sealed class PostgreSqlEventStore(EventStoreDbContext dbContext) : IEventStore
{
    public async Task AppendAsync(
        Guid streamId,
        IReadOnlyList<DomainEvent> events,
        CancellationToken ct)
    {
        var maxVersion = await dbContext.Events
            .Where(e => e.StreamId == streamId)
            .MaxAsync(e => (long?)e.Version) ?? 0;

        var eventRecords = events
            .Select((e, index) => new EventRecord
            {
                StreamId = streamId,
                EventType = e.GetType().Name,
                EventData = System.Text.Json.JsonSerializer.Serialize(e),
                Version = maxVersion + index + 1,
                OccurredAt = e.OccurredAt
            })
            .ToList();

        dbContext.Events.AddRange(eventRecords);
        await dbContext.SaveChangesAsync(ct);
    }

    public async Task<IReadOnlyList<DomainEvent>> LoadAsync(Guid streamId, CancellationToken ct)
    {
        var records = await dbContext.Events
            .Where(e => e.StreamId == streamId)
            .OrderBy(e => e.Version)
            .ToListAsync(ct);

        return records
            .Select(Deserialize)
            .Where(e => e != null)
            .ToList()!;
    }

    public async Task<IReadOnlyList<DomainEvent>> LoadSinceVersionAsync(
        Guid streamId,
        long sinceVersion,
        CancellationToken ct)
    {
        var records = await dbContext.Events
            .Where(e => e.StreamId == streamId && e.Version > sinceVersion)
            .OrderBy(e => e.Version)
            .ToListAsync(ct);

        return records
            .Select(Deserialize)
            .Where(e => e != null)
            .ToList()!;
    }

    private static DomainEvent? Deserialize(EventRecord record)
    {
        var type = Type.GetType($"GcPlatform.Api.Module.Invoice.Core.DomainEvents.{record.EventType}");
        if (type == null)
            return null;

        return (DomainEvent?)System.Text.Json.JsonSerializer.Deserialize(
            record.EventData,
            type);
    }
}

// Infrastructure/Persistence/EventRecord.cs
public class EventRecord
{
    public long Id { get; set; }
    public Guid StreamId { get; set; }
    public string EventType { get; set; } = string.Empty;
    public string EventData { get; set; } = string.Empty;
    public long Version { get; set; }
    public DateTime OccurredAt { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
```

## Aggregate Rehydration

Load an aggregate from its event stream:

```csharp
// Core/Ports/Outgoing/IInvoiceRepository.cs (Event Sourcing Version)
public interface IInvoiceRepository
{
    Task SaveAsync(Invoice invoice, CancellationToken ct);
    Task<Invoice?> GetByIdAsync(Guid id, CancellationToken ct);
}

// Infrastructure/Adapter/EventSourcedInvoiceRepository.cs
public sealed class EventSourcedInvoiceRepository(IEventStore eventStore) : IInvoiceRepository
{
    public async Task SaveAsync(Invoice invoice, CancellationToken ct)
    {
        var events = invoice.UncommittedEvents;
        if (events.Count == 0)
            return;

        await eventStore.AppendAsync(invoice.Id, events, ct);
        invoice.MarkEventsAsCommitted();
    }

    public async Task<Invoice?> GetByIdAsync(Guid id, CancellationToken ct)
    {
        var events = await eventStore.LoadAsync(id, ct);
        if (events.Count == 0)
            return null;

        var invoice = new Invoice();
        invoice.LoadFromHistory(events);
        return invoice;
    }
}
```

## Snapshots (Performance Optimization)

For long event streams, snapshots short-circuit rehydration:

```csharp
// Core/Snapshot.cs
public sealed record InvoiceSnapshot
{
    public Guid Id { get; init; }
    public long Version { get; init; }
    public string Number { get; init; } = string.Empty;
    public Guid OrgId { get; init; }
    public DateTime InvoiceDate { get; init; }
    // ... snapshot of full invoice state
}

// Core/Aggregates/Invoice.cs
public sealed class Invoice : AggregateRoot
{
    public long Version { get; private set; }

    // Snapshot support
    public InvoiceSnapshot ToSnapshot()
    {
        return new InvoiceSnapshot
        {
            Id = Id,
            Version = Version,
            Number = Number,
            OrgId = OrgId,
            InvoiceDate = InvoiceDate
        };
    }

    public static Invoice FromSnapshot(InvoiceSnapshot snapshot)
    {
        var invoice = new Invoice
        {
            Id = snapshot.Id,
            Version = snapshot.Version,
            Number = snapshot.Number,
            OrgId = snapshot.OrgId,
            InvoiceDate = snapshot.InvoiceDate
        };
        return invoice;
    }
}

// Infrastructure/Adapter/SnapshotEventSourcedRepository.cs
public sealed class SnapshotEventSourcedRepository(
    IEventStore eventStore,
    ISnapshotStore snapshotStore) : IInvoiceRepository
{
    private const int SnapshotInterval = 100;  // every 100 events

    public async Task SaveAsync(Invoice invoice, CancellationToken ct)
    {
        var events = invoice.UncommittedEvents;
        if (events.Count == 0)
            return;

        await eventStore.AppendAsync(invoice.Id, events, ct);
        invoice.MarkEventsAsCommitted();

        // Create snapshot if version is a multiple of SnapshotInterval
        if (invoice.Version % SnapshotInterval == 0)
            await snapshotStore.SaveAsync(invoice.ToSnapshot(), ct);
    }

    public async Task<Invoice?> GetByIdAsync(Guid id, CancellationToken ct)
    {
        // Load latest snapshot
        var snapshot = await snapshotStore.GetLatestAsync(id, ct);

        Invoice invoice;
        long startVersion = 0;

        if (snapshot != null)
        {
            invoice = Invoice.FromSnapshot(snapshot);
            startVersion = snapshot.Version;
        }
        else
        {
            invoice = new Invoice();
        }

        // Load events since snapshot
        var events = startVersion > 0
            ? await eventStore.LoadSinceVersionAsync(id, startVersion, ct)
            : await eventStore.LoadAsync(id, ct);

        if (events.Count == 0 && snapshot == null)
            return null;

        invoice.LoadFromHistory(events);
        return invoice;
    }
}
```

## Event Projections (Read Models)

Event handlers keep read models in sync:

```csharp
// Infrastructure/EventHandlers/InvoiceProjector.cs
public sealed class InvoiceProjector(InvoiceReadDbContext readDbContext)
{
    public async Task Handle(InvoiceCreated @event)
    {
        var readModel = new InvoiceReadModel
        {
            Id = @event.Id,
            Number = @event.Number,
            CustomerId = @event.CustomerId,
            OrgId = @event.OrgId,
            InvoiceDate = @event.InvoiceDate,
            CreatedAt = DateTime.UtcNow
        };

        readDbContext.InvoiceReadModels.Add(readModel);
        await readDbContext.SaveChangesAsync();
    }

    public async Task Handle(InvoiceUpdated @event)
    {
        var readModel = await readDbContext.InvoiceReadModels.FindAsync(@event.Id);
        if (readModel == null)
            return;

        readModel.Number = @event.Number;
        readModel.InvoiceDate = @event.InvoiceDate;
        readModel.UpdatedAt = DateTime.UtcNow;

        await readDbContext.SaveChangesAsync();
    }

    public async Task Handle(InvoiceDeleted @event)
    {
        var readModel = await readDbContext.InvoiceReadModels.FindAsync(@event.Id);
        if (readModel != null)
        {
            readDbContext.InvoiceReadModels.Remove(readModel);
            await readDbContext.SaveChangesAsync();
        }
    }
}
```

Register:

```csharp
// InvoiceModule.cs
services.AddScoped<InvoiceProjector>();
```

## Integration Events from Domain Events

Promote domain events to integration events for cross-module communication:

```csharp
// Core/Model/Events/InvoiceCreatedIntegrationEvent.cs
public sealed record InvoiceCreatedIntegrationEvent : BaseMessage
{
    public Guid InvoiceId { get; init; }
    public string Number { get; init; } = string.Empty;
    public Guid CustomerId { get; init; }
}

// Core/CreateInvoice.cs
public async Task<Invoice> ExecuteAsync(CreateInvoiceCommand command, CancellationToken ct)
{
    var invoice = Invoice.Create(/* ... */);
    await repository.SaveAsync(invoice, ct);

    // Promote to integration event
    var integrationEvent = new InvoiceCreatedIntegrationEvent
    {
        InvoiceId = invoice.Id,
        Number = invoice.Number,
        CustomerId = invoice.CustomerId
    };

    await eventBus.PublishAsync(integrationEvent);

    return invoice;
}
```

## Backfill / Data Migrations

When evolving event schemas, use a migration to replay and rebuild projections:

```csharp
// Migrations/MigrateInvoiceV2.cs
public class MigrateInvoiceV2
{
    public static async Task Run(IServiceProvider services)
    {
        var eventStore = services.GetRequiredService<IEventStore>();
        var projector = services.GetRequiredService<InvoiceProjector>();

        // Fetch all Invoice events
        var allEvents = await eventStore.LoadAsync(/* all streams */);

        foreach (var @event in allEvents)
        {
            // Apply new projector logic
            await projector.Handle(@event);
        }
    }
}
```

## Testing Event Sourced Aggregates

```csharp
public sealed class InvoiceEventSourcingShould
{
    [Fact]
    public void RehydrateFromEventHistory()
    {
        // Arrange: create aggregate, raise events
        var invoice = Invoice.Create("F-001", "T-001", Guid.NewGuid(), DateTime.UtcNow);
        var events = invoice.UncommittedEvents;

        // Act: rehydrate from history
        var rehydrated = new Invoice();
        rehydrated.LoadFromHistory(events);

        // Assert: state matches
        Assert.Equal("F-001", rehydrated.Number);
        Assert.Equal("T-001", rehydrated.CustomerId);
    }

    [Fact]
    public void SnapshotReducesRehydrationCost()
    {
        // Arrange
        var invoice = Invoice.Create(/* ... */);
        var snapshot = invoice.ToSnapshot();

        // Act
        var fromSnapshot = Invoice.FromSnapshot(snapshot);

        // Assert
        Assert.Equal(invoice.Id, fromSnapshot.Id);
        Assert.Equal(invoice.Number, fromSnapshot.Number);
    }
}
```

## Checklist: Event Sourcing

- [ ] Define event store: PostgreSQL table with StreamId, Version, EventData
- [ ] Implement IEventStore: append, load, load-since-version
- [ ] Aggregate: persist events not state
- [ ] Repository: AppendAsync (save events), GetById (load and rehydrate)
- [ ] Domain events: past-tense records (InvoiceCreated, InvoiceUpdated)
- [ ] Event projectors: handle domain events, update read models
- [ ] Snapshots (optional): every N events, short-circuit rehydration
- [ ] Integration events: promote relevant domain events for cross-module communication
- [ ] Tests: event history rehydration, snapshot consistency, projector idempotency
- [ ] Data migrations: replay logic, rebuild projections on schema evolution
