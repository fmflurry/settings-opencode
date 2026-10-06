# dotnet-cop / event sourcing (optional, opt-in)

**Scope:** This rule applies only when a module explicitly opts into event-sourced aggregates. When event sourcing is not in use, standard CRUD/ORM patterns suffice. Do not enforce event sourcing across all modules.

Aggregates are created via private ctor + static factory and mutate state **only** by raising and applying domain events; events are immutable and past-tense; rehydration round-trips; the event store is append-only; queries read projections, never rehydrate.

## 🟢 / 🔴 Blockers (when module opts in to event sourcing)

### State mutated outside an event
Every state change must be expressed as a raised+applied domain event. Public setters or direct assignments outside a `When()` handler mean the aggregate cannot be rebuilt from its stream.

### Aggregate created with `new` instead of a factory
Invariants live in the static factory (`Order.Place`, etc.); bypassing it creates invalid aggregates without validation.

### Mutable domain event
Events are immutable, append-only history. An `IDomainEvent` implementation with public setters or as a mutable class corrupts replay and the audit log.

### Mutating/deleting committed events
The event store is append-only. Correct errors via compensating events, never by editing history.

### Query rehydrates the aggregate
A read path loading via the write-side repository or replaying events instead of reading a projection.

## 🟡 Risks

### Missing rehydration / round-trip coverage
A new aggregate with events but no developer test asserting `LoadFromHistory(events)` reconstructs the same state (`Id`, state, `Version`) as the factory path.

### `UncommittedEvents` not cleared after persistence
Repository `Save` appends events but never calls `MarkEventsAsCommitted()` → events re-appended on the next save.

### Missing optimistic concurrency on append
Event-store `Append` without an `expectedVersion` check → lost updates under concurrent writers.

### Snapshot drift
`ToSnapshot()`/restore exists but isn't covered by a test proving snapshot+tail replay equals full replay.

## 🔵 Nits

- Events named past tense (`OrderPlaced`, `OrderCancelled`), one per file.
- `IDomainEvent` carries `Id`, `StreamId`, `Version`, `OccurredOn`; `OccurredOn` sourced from `IDateTimeProvider`, not `DateTime.Now` inline.
- Value objects are `record`s with private ctor + static `Of()`.

## Reporting

Cite the setter/assignment line for state-mutation findings, the event type declaration for mutability findings, and the query handler line for rehydration-on-read findings. Name the aggregate and event. Note: only report event-sourcing findings when the module has explicitly adopted the event-sourcing pattern.
