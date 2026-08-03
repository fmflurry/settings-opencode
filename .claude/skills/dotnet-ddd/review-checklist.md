# DDD Review Checklist

Terse, file:line-oriented checklist for the `code-reviewer` agent. One item per pattern/concept. Cite the offending `file:line` in findings.

Severity follows [[dotnet-cop]] conventions: 🟢 arch (fix before merge), 🟡 risk, 🔵 nit.

---

## Tactical Patterns

### Entity

- [ ] 🟢 Entity equality is identity-based (`Equals` compares ID only) — not structural.
- [ ] 🟢 No public setters on domain state; mutation goes through named methods.
- [ ] 🟡 Entity constructor validates required invariants (non-null ID, valid initial state).

### Value Object

- [ ] 🟢 Value object has no identity field (no `Id` property).
- [ ] 🟢 Value object is immutable: `readonly record struct`, or sealed class with `init`-only properties and no setters.
- [ ] 🟡 Equality is structural (all attributes compared) — default `record` equality is correct; custom `Equals` must compare all fields.

### Aggregate + Aggregate Root

- [ ] 🟢 Aggregate root is the only external entry point — no code outside the aggregate holds a mutable reference to an internal entity.
- [ ] 🟢 Internal entities are not exposed as mutable collections (`List<T>`); use `IReadOnlyList<T>` or method-based access.
- [ ] 🟢 Invariants spanning multiple members are enforced in root methods (not left to callers).
- [ ] 🟡 Aggregate is small — references to other aggregates are by ID, not by object reference.

### Repository

- [ ] 🟢 Repository interface is defined in Core (domain layer), not Infrastructure.
- [ ] 🟢 Repository returns aggregate roots — never EF entities, `IQueryable<T>`, or raw DTOs.
- [ ] 🟢 One repository per aggregate root (no repository for internal entities or value objects).
- [ ] 🟡 Repository implementation lives in Infrastructure/Adapter.

### Factory

- [ ] 🟡 Complex aggregate creation is encapsulated (factory method on root, dedicated factory class, or builder).
- [ ] 🟡 External callers do not assemble aggregates field-by-field with public setters.

### Specification

- [ ] 🔵 Repeated predicate/validation logic is extracted into a composable Specification (not duplicated across files).

### Domain Service vs Application Service

- [ ] 🟢 Domain services are stateless and contain only domain logic (no infrastructure calls).
- [ ] 🟢 Application services (use cases) orchestrate but contain no business rules — they call domain methods.
- [ ] 🟢 Behavior that naturally fits one entity lives on that entity, not extracted into a service.

### Rich vs Anemic Model

- [ ] 🟢 Entities have behavior methods that enforce invariants — not just getters/setters.
- [ ] 🟢 No "manager" or "service" class that mutates entity fields directly (anemic model anti-pattern).
- [ ] 🟡 Validation logic (non-null, range, state transitions) lives inside the entity, not in external validators that set fields.

### Invariants & Encapsulation

- [ ] 🟢 Domain state properties have `private set` or are `init`-only.
- [ ] 🟡 Mutation methods validate invariants before applying changes.
- [ ] 🟡 No public API allows an invalid intermediate state to exist.

---

## Strategic Design

### Bounded Context

- [ ] 🟢 Each module has its own model types — no shared "god entity" used across modules.
- [ ] 🟢 The same domain word may have different classes in different contexts (correct, not duplication).
- [ ] 🟡 Module namespaces reflect the bounded context name.

### Ubiquitous Language

- [ ] 🟡 Type and method names match domain-expert vocabulary (no abbreviations, no technical jargon in domain model).
- [ ] 🔵 A domain expert could read the class name and recognize the business concept.

### Anti-Corruption Layer

- [ ] 🟢 Domain/Core has zero `using` directives referencing external SDK types (Stripe, SendGrid, vendor namespaces).
- [ ] 🟢 An adapter in Infrastructure translates between external and internal models.
- [ ] 🟡 External field names (e.g., `stripe_charge_id`) never appear in domain types.

### Context Mapping / Shared Kernel

- [ ] 🟢 Shared kernel contains only a handful of stable value types (e.g., `Money`, correlation IDs).
- [ ] 🟢 No behavior-rich entities in shared code.
- [ ] 🟡 Cross-context references use IDs or domain events, not shared entity class references.

### Domain Events

- [ ] 🟢 Domain events are immutable records (no setters, no mutable state).
- [ ] 🟢 Event names are past tense (`OrderConfirmed`, not `ConfirmOrder`).
- [ ] 🟡 Events contain only the data consumers need — not the entire aggregate.
- [ ] 🟡 Events are raised inside the aggregate root, not by external code.
- [ ] 🔵 Events have no reference to handlers or consumers (no coupling).

### CQRS

- [ ] 🟡 Write side mutates through aggregates + repository; read side uses projections/DTOs.
- [ ] 🟡 Read queries do not load full aggregates (no over-fetching for display purposes).
- [ ] 🔵 Command and query handlers are separate types (not one "service" doing both).

> For deep CQRS/ES enforcement (handler patterns, event-sourced aggregates, append-only stores), see [[dotnet-cop-optional-cqrs]] and [[dotnet-cop-optional-event-sourcing]].
