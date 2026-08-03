# Event Sourcing & CQRS → Angular Mapping

Maps DDD event-sourcing and CQRS concepts to their flurryx equivalents in an Angular app. **Store API mechanics (signatures, options, builder methods) are owned by [[flurryx]]** — this file covers only the conceptual mapping and domain-event lifecycle.

---

## Concept Mapping

| .NET Event Sourcing | flurryx equivalent | Notes |
|---------------------|-------------------|-------|
| Append-only event log | `StoreMessageChannel` (in-memory / localStorage / sessionStorage / composite) | Every write is a persisted `StoreMessage`. Channel choice is an infrastructure decision. |
| Replay | `store.replay(ids)`, `replayDeadLetters()`, `undo()` / `redo()` | Re-executes persisted messages through the broker. |
| Snapshots / time travel | `restoreStoreAt(index)`, `restoreResource(key, index)`, `createSnapshotRestorePatch` | Snapshot navigation without re-publishing messages. |
| Dead-letter / retry | `getDeadLetters()`, `replayDeadLetter(id)`, `replayDeadLetterCommand(id, resolver)` | Failed messages are captured with metadata; async resolver can fix and replay. |
| Domain events (DDD) | Immutable TS records in `core/events/` | Application layer turns them into store updates/messages. Cross-module reactions via flurryx mirrors or context registry (see [[angular-clean-architecture]]). |
| CQRS read/write split | Write: use case → domain → port → adapter → `syncToStore`. Read: `store.get(KEY)` signal projections; `derive` / `mirror` for read-optimized slots. | Write path enforces invariants; read path is a projection. |

For full API signatures, builder methods, and channel configuration: see [[flurryx]].

---

## Domain-Event Lifecycle in TypeScript

Domain events flow through four stages. Each stage has a clear layer ownership.

### 1. Definition (domain layer)

Domain events are pure TS types — discriminated unions with a `kind` discriminant. They live in `core/events/`. No framework imports.

```ts
// core/events/order.events.ts
export type OrderConfirmed = {
  readonly kind: 'OrderConfirmed';
  readonly orderId: OrderId;
  readonly total: Money;
  readonly confirmedAt: string;
};

export type OrderDomainEvent = OrderConfirmed | OrderCancelled;
```

### 2. Raising (domain layer)

Rule functions return the new state alongside any raised events. The domain never publishes events itself — it only produces them.

```ts
// core/rules/order.rule.ts
export function confirm(order: Order): { order: Order; events: ReadonlyArray<OrderDomainEvent> } {
  if (order.lines.length === 0)
    throw new Error('Cannot confirm an empty order.');
  const event: OrderConfirmed = Object.freeze({
    kind: 'OrderConfirmed',
    orderId: order.id,
    total: orderTotal(order),
    confirmedAt: new Date().toISOString(),
  });
  return { order: { ...order, status: 'Confirmed' }, events: [event] };
}
```

### 3. Dispatching (application layer)

The use case or facade receives the events and decides what to do: persist the aggregate, push to the store via `syncToStore`, or forward to a cross-module channel. This is where flurryx enters — see [[flurryx]] for the store-write API.

```
use case → domain rule → { newState, events }
         → port.save(newState)
         → events.forEach(e => dispatch(e))   // application-layer concern
```

### 4. Reacting (application / infrastructure layer)

Cross-module reactions use flurryx mirrors (`mirror`, `derive`, `mirrorKeyed`) or the context registry (see [[angular-clean-architecture]]). The reacting module never imports the source module's domain types directly.

---

## Purity Rule: `core/` Has No flurryx Import

The domain layer (`core/`) is pure TypeScript. It defines events, models, rules, and ports. It does **not** import flurryx, Angular, `HttpClient`, or any framework package.

| Layer | May import flurryx? | Role |
|-------|-------------------|------|
| `core/` | **No** | Defines event types, models, rules, ports |
| `application/` | Yes | Wires domain events to store updates via `syncToStore` |
| `infrastructure/` | Yes | Implements ports; may use store channels for persistence |
| `presentation/` | Indirectly (via facade signals) | Reads `store.get(KEY)` signals exposed by facades |

The event store is an **application/infrastructure concern** realized by flurryx. The domain only knows that events exist as immutable records.

---

## CQRS Boundary Rules

| Concern | Write side | Read side |
|---------|-----------|-----------|
| Entry point | Use case (application layer) | Facade getter returning store signal |
| Domain involvement | Full: aggregate + rule functions + invariants | None: projections bypass domain model |
| Persistence | Port → adapter → API | Store signal (cached, derived, or mirrored) |
| flurryx role | `syncToStore` / `syncToKeyedStore` after domain mutation | `store.get(KEY)`, `derive`, `mirror` for read-optimized slots |

Deep enforcement of CQRS patterns (handler separation, projection consistency, eventual consistency guarantees) is handled by [[angular-cop]] during pre-merge review and by [[flurryx]] for store mechanics.
