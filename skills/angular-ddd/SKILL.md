---
name: angular-ddd
description: >
  Domain-Driven Design for Angular/TypeScript: functional patterns with `type` aliases, `readonly` fields,
  pure rule functions, immutable value types, branded IDs, and ports as abstract classes. Use when creating
  or reviewing domain models, aggregates, rule functions, ports, bounded contexts, or domain events. Use
  when enforcing aggregate invariants, applying DDD tactical patterns, mapping bounded contexts, or
  integrating with event sourcing. Provides tactical-pattern guidance, strategic-design rules, an
  event-sourcing→flurryx mapping, and a file:line review checklist. Complements angular-clean-architecture
  (folder layout/layering/DI) and flurryx (store/replay mechanics).
---

# angular-ddd

Domain-Driven Design guidance for Angular/TypeScript domain code. Makes DDD principles explicit and enforceable for the `coder` and `code-reviewer` agents.

## When to Activate

- Creating or modifying domain models (entities, value objects, aggregates)
- Adding repositories, factories, or domain services
- Defining or refactoring bounded contexts
- Reviewing domain code for DDD compliance
- Refactoring anemic models toward rich behavior
- Enforcing aggregate invariants or encapsulation rules

## Provenance

Content is synthesized from established DDD literature:

- Eric Evans, *Domain-Driven Design: Tackling Complexity in the Heart of Software* (2003) — "Blue Book"
- Vaughn Vernon, *Implementing Domain-Driven Design* (2013) — "Red Book"
- Martin Fowler, bliki articles on Anemic Domain Model, Domain Event, etc.
- TypeScript-specific idioms: branded types, discriminated unions, `readonly`, `Object.freeze`

This is a practitioner synthesis, not a verbatim reproduction. Where sources disagree, the Red Book's pragmatic guidance takes precedence for implementation details.

## Core Principles

1. **The domain model is the software.** Business logic lives in domain objects and pure functions, not in services or components. (Evans, ch. 1)
2. **Ubiquitous Language.** Code names match the domain expert's vocabulary. No translation layer between business and code. (Evans, ch. 2)
3. **Bounded Contexts define boundaries.** Each context owns its model. Shared types across contexts are a design smell. (Evans, ch. 14)
4. **Aggregates enforce invariants.** All mutations go through the aggregate root. External code never reaches inside. (Vernon, ch. 10)
5. **Value Objects are immutable and identity-free.** They describe characteristics, not things. (Evans, ch. 5)
6. **Repositories return aggregates, not tables.** Persistence is an infrastructure concern. (Vernon, ch. 12)

## TypeScript Idioms

The Angular-specific delta vs. the .NET DDD skill:

| Concept | .NET idiom | TypeScript idiom |
|---------|-----------|-----------------|
| Identity | `CustomerId` record struct | Branded type: `type CustomerId = string & { readonly __brand: 'CustomerId' }` |
| Immutability | `readonly record struct` | `readonly` props + `Object.freeze()` for VOs; `ReadonlyArray<T>` for collections |
| Domain events | `sealed record : IDomainEvent` | Discriminated union with `readonly kind` discriminant |
| Domain model | `sealed class` with private setters | `type` alias with `readonly` props (per [[angular-clean-architecture]] convention) |
| Domain rules | Static methods on entity | Pure exported functions in `core/rules/` |
| Ports | `interface` in Core | `abstract class` with `abstract` methods returning `Observable<T>` (per [[angular-clean-architecture]] convention) |
| Equality | `Equals`/`GetHashCode` override | Structural: compare all fields; identity: compare `id` field |

## Tactical Patterns (summary)

| Pattern | One-liner | Reference |
|---------|-----------|-----------|
| Entity | Has identity; equality by ID, not attributes | [tactical-patterns.md § Entity](tactical-patterns.md#entity) |
| Value Object | No identity; immutable; equality by attributes | [tactical-patterns.md § Value Object](tactical-patterns.md#value-object) |
| Aggregate + Root | Consistency boundary; root is sole entry point | [tactical-patterns.md § Aggregate](tactical-patterns.md#aggregate--aggregate-root) |
| Repository | DDD pattern realised as `<VerbNoun>Port` classes (e.g. `GetOrderPort`, `SaveOrderPort`) in `core/ports/` | [tactical-patterns.md § Repository](tactical-patterns.md#repository) |
| Factory | Encapsulates complex creation logic | [tactical-patterns.md § Factory](tactical-patterns.md#factory) |
| Specification | Reusable, composable query/predicate logic | [tactical-patterns.md § Specification](tactical-patterns.md#specification) |
| Domain Service | Stateless logic that doesn't belong to an entity | [tactical-patterns.md § Domain Service](tactical-patterns.md#domain-service-vs-application-service) |
| Rich vs Anemic | Behavior lives with data, not in external services | [tactical-patterns.md § Rich vs Anemic](tactical-patterns.md#rich-vs-anemic-model) |

Full definitions, GOOD/BAD examples, and per-pattern checklist lines: [tactical-patterns.md](tactical-patterns.md)

## Strategic Design (summary)

| Concept | One-liner | Reference |
|---------|-----------|-----------|
| Bounded Context | Explicit boundary around a model + language | [strategic-design.md § Bounded Context](strategic-design.md#bounded-context) |
| Ubiquitous Language | Shared vocabulary within a context | [strategic-design.md § Ubiquitous Language](strategic-design.md#ubiquitous-language) |
| Anti-Corruption Layer | Translation boundary shielding your model from external models | [strategic-design.md § ACL](strategic-design.md#anti-corruption-layer) |
| Context Mapping | Relationships between contexts (Shared Kernel, Customer/Supplier, etc.) | [strategic-design.md § Context Mapping](strategic-design.md#context-mapping--shared-kernel) |
| Domain Events | Immutable record of something that happened in the domain | [strategic-design.md § Domain Events](strategic-design.md#domain-events) |
| CQRS | Separate read/write models (deep enforcement defers to [[angular-cop]]/[[flurryx]]) | [strategic-design.md § CQRS](strategic-design.md#cqrs) |

Full definitions, GOOD/BAD examples, and per-concept checklist lines: [strategic-design.md](strategic-design.md)

## Event Sourcing & CQRS Mapping

flurryx provides event-sourced store mechanics (append-only message channels, replay, snapshots, dead letters). This skill maps DDD event-sourcing concepts to flurryx equivalents. **Store API mechanics are owned by [[flurryx]]** — this skill covers only the conceptual mapping.

| .NET Event Sourcing | flurryx equivalent |
|---------------------|-------------------|
| Append-only event log | `StoreMessageChannel` — every write is a persisted `StoreMessage` |
| Replay | `store.replay(ids)`, `replayDeadLetters()`, `undo()`/`redo()` |
| Snapshots / time travel | `restoreStoreAt(index)`, `restoreResource(key, index)` |
| Dead-letter / retry | `getDeadLetters()`, `replayDeadLetterCommand(id, resolver)` |
| Domain events (DDD) | Immutable TS records in `core/events/`; application layer turns them into store updates |
| CQRS read/write split | Write: use case → domain → port → adapter → `syncToStore`. Read: `store.get(KEY)` signal projections |

Full mapping with domain-event lifecycle and purity rules: [event-sourcing-mapping.md](event-sourcing-mapping.md)

## Review Checklist

The `code-reviewer` agent applies [review-checklist.md](review-checklist.md) when reviewing domain code. It uses a 5-level severity taxonomy aligned with [[angular-cop]]: 🔴 bug (hard violations), 🟠 sec (security/access), 🟡 risk (architectural risk), 🟢 arch (pattern enforcement), 🔵 nit (style/naming). Load on demand during review.

## Relationship to Other Skills

| Skill | Relationship |
|-------|-------------|
| [[angular-clean-architecture]] | Provides folder layout, layering, DI wiring, lazy loading, and caching decorators. This skill provides the domain-modeling rules that live *inside* `core/`. |
| [[flurryx]] | Provides store/replay mechanics (StoreMessageChannel, replay, snapshots, dead letters). This skill maps DDD event-sourcing concepts to flurryx but does not restate its API. |
| [[angular-cop]] | Pre-merge review enforcement. Applies this skill's checklist during Angular PR review. |

## Quick-Start Checklist (for `coder`)

When writing new domain code:

- [ ] Identify the bounded context this code belongs to
- [ ] Name types using the context's ubiquitous language
- [ ] Model entities with identity + behavior (not just data)
- [ ] Extract value objects for descriptive attributes (immutable, no ID)
- [ ] Group related entities into aggregates; designate one root
- [ ] Enforce invariants inside the aggregate root (factory + rule functions)
- [ ] Expose mutations only through the aggregate root's public methods
- [ ] Define repository ports in `core/ports/` (return aggregates, not DTOs)
- [ ] Use domain events for cross-aggregate or cross-context communication
- [ ] Keep domain services stateless; prefer rule functions when behavior fits one entity

## Hard Rules

1. **No anemic models.** If a type has only data fields and all logic lives in a separate service, that is a violation. Move behavior to the entity or a pure rule function. (Fowler, "Anemic Domain Model")
2. **Aggregate root is the only external entry point.** No code outside the aggregate may hold a reference to an internal entity or mutate it directly. (Vernon, ch. 10)
3. **Value objects are immutable.** Use `readonly` props + `Object.freeze()`. No mutation after creation. (Evans, ch. 5)
4. **Repositories return aggregates.** Never return raw DTOs, API response types, or partial data from a domain port. (Vernon, ch. 12)
5. **Bounded-context boundaries are hard.** No shared internal types across contexts. Use ACL adapters or domain events. (Evans, ch. 14)
6. **`core/` (domain layer) has ZERO infra/framework imports.** No flurryx, no `HttpClient`, no Angular imports. Domain events are pure TS records; the event store is an application/infrastructure concern realized by [[flurryx]]. RxJS is allowed at port boundaries only.
7. **Never use `any`.** Use `unknown` if the type is truly unknown.
