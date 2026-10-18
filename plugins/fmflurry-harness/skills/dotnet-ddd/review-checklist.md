# DDD Review Checklist

Terse, file:line-oriented checklist for the `code-reviewer` agent. One item per pattern/concept. Cite the offending `file:line` in findings.

Badges follow [[dotnet-cop]]: 🟡 Nit [arch] (does not block unless the finding cites an AGENTS.md hard rule), 🟡 Nit [risk], 🟡 Nit [nit]. 🔴 Important blocks. ❓ never blocks. ⚪ Pre-existing does not block.

---

## Tactical Patterns

### Entity

- [ ] 🟡 Nit [arch] Entity equality is identity-based (`Equals` compares ID only) — not structural.
- [ ] 🟡 Nit [arch] No public setters on domain state; mutation goes through named methods.
- [ ] 🟡 Nit [risk] Entity constructor validates required invariants (non-null ID, valid initial state).

### Value Object

- [ ] 🟡 Nit [arch] Value object has no identity field (no `Id` property).
- [ ] 🟡 Nit [arch] Value object is immutable: `readonly record struct`, or sealed class with `init`-only properties and no setters.
- [ ] 🟡 Nit [risk] Equality is structural (all attributes compared) — default `record` equality is correct; custom `Equals` must compare all fields.

### Aggregate + Aggregate Root

- [ ] 🟡 Nit [arch] Aggregate root is the only external entry point — no code outside the aggregate holds a mutable reference to an internal entity.
- [ ] 🟡 Nit [arch] Internal entities are not exposed as mutable collections (`List<T>`); use `IReadOnlyList<T>` or method-based access.
- [ ] 🟡 Nit [arch] Invariants spanning multiple members are enforced in root methods (not left to callers).
- [ ] 🟡 Nit [risk] Aggregate is small — references to other aggregates are by ID, not by object reference.

### Repository

- [ ] 🟡 Nit [arch] Repository interface is defined in Core (domain layer), not Infrastructure.
- [ ] 🟡 Nit [arch] Repository returns aggregate roots — never EF entities, `IQueryable<T>`, or raw DTOs.
- [ ] 🟡 Nit [arch] One repository per aggregate root (no repository for internal entities or value objects).
- [ ] 🟡 Nit [risk] Repository implementation lives in Infrastructure/Adapter.

### Factory

- [ ] 🟡 Nit [risk] Complex aggregate creation is encapsulated (factory method on root, dedicated factory class, or builder).
- [ ] 🟡 Nit [risk] External callers do not assemble aggregates field-by-field with public setters.

### Specification

- [ ] 🟡 Nit [nit] Repeated predicate/validation logic is extracted into a composable Specification (not duplicated across files).

### Domain Service vs Application Service

- [ ] 🟡 Nit [arch] Domain services are stateless and contain only domain logic (no infrastructure calls).
- [ ] 🟡 Nit [arch] Application services (use cases) orchestrate but contain no business rules — they call domain methods.
- [ ] 🟡 Nit [arch] Behavior that naturally fits one entity lives on that entity, not extracted into a service.

### Rich vs Anemic Model

- [ ] 🟡 Nit [arch] Entities have behavior methods that enforce invariants — not just getters/setters.
- [ ] 🟡 Nit [arch] No "manager" or "service" class that mutates entity fields directly (anemic model anti-pattern).
- [ ] 🟡 Nit [risk] Validation logic (non-null, range, state transitions) lives inside the entity, not in external validators that set fields.

### Invariants & Encapsulation

- [ ] 🟡 Nit [arch] Domain state properties have `private set` or are `init`-only.
- [ ] 🟡 Nit [risk] Mutation methods validate invariants before applying changes.
- [ ] 🟡 Nit [risk] No public API allows an invalid intermediate state to exist.

---

## Strategic Design

### Bounded Context

- [ ] 🟡 Nit [arch] Each module has its own model types — no shared "god entity" used across modules.
- [ ] 🟡 Nit [arch] The same domain word may have different classes in different contexts (correct, not duplication).
- [ ] 🟡 Nit [risk] Module namespaces reflect the bounded context name.

### Ubiquitous Language

- [ ] 🟡 Nit [risk] Type and method names match domain-expert vocabulary (no abbreviations, no technical jargon in domain model).
- [ ] 🟡 Nit [nit] A domain expert could read the class name and recognize the business concept.

### Anti-Corruption Layer

- [ ] 🟡 Nit [arch] Domain/Core has zero `using` directives referencing external SDK types (Stripe, SendGrid, vendor namespaces).
- [ ] 🟡 Nit [arch] An adapter in Infrastructure translates between external and internal models.
- [ ] 🟡 Nit [risk] External field names (e.g., `stripe_charge_id`) never appear in domain types.

### Context Mapping / Shared Kernel

- [ ] 🟡 Nit [arch] Shared kernel contains only a handful of stable value types (e.g., `Money`, correlation IDs).
- [ ] 🟡 Nit [arch] No behavior-rich entities in shared code.
- [ ] 🟡 Nit [risk] Cross-context references use IDs or domain events, not shared entity class references.

### Domain Events

- [ ] 🟡 Nit [arch] Domain events are immutable records (no setters, no mutable state).
- [ ] 🟡 Nit [arch] Event names are past tense (`OrderConfirmed`, not `ConfirmOrder`).
- [ ] 🟡 Nit [risk] Events contain only the data consumers need — not the entire aggregate.
- [ ] 🟡 Nit [risk] Events are raised inside the aggregate root, not by external code.
- [ ] 🟡 Nit [nit] Events have no reference to handlers or consumers (no coupling).

### CQRS

- [ ] 🟡 Nit [risk] Write side mutates through aggregates + repository; read side uses projections/DTOs.
- [ ] 🟡 Nit [risk] Read queries do not load full aggregates (no over-fetching for display purposes).
- [ ] 🟡 Nit [nit] Command and query handlers are separate types (not one "service" doing both).

> For deep CQRS/ES enforcement (handler patterns, event-sourced aggregates, append-only stores), see [[dotnet-cop-optional-cqrs]] and [[dotnet-cop-optional-event-sourcing]].
