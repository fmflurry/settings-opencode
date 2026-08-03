---
name: dotnet-ddd
description: >
  Domain-Driven Design best practices for .NET 10 domain code. Use when creating or
  reviewing entities, value objects, aggregates, aggregate roots, repositories, domain
  services, bounded contexts, or domain events in C#. Use when refactoring anemic models
  toward rich domain logic, enforcing aggregate invariants, or checking bounded-context
  boundaries. Provides tactical-pattern guidance, strategic-design rules, and a
  file:line review checklist. Complements dotnet-clean-architecture (hexagonal layering)
  and dotnet-cop (pre-merge review enforcement).
---

# dotnet-ddd

Domain-Driven Design guidance for .NET domain code. Makes DDD principles explicit and enforceable for the `coder` and `code-reviewer` agents.

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
- Microsoft .NET Architecture guidance (eShop, microservices e-book, CQRS docs)
- Martin Fowler, bliki articles on Anemic Domain Model, Domain Event, etc.

This is a practitioner synthesis, not a verbatim reproduction. Where sources disagree, the Red Book's pragmatic guidance takes precedence for implementation details.

## Core Principles

1. **The domain model is the software.** Business logic lives in domain objects, not in services or controllers. (Evans, ch. 1)
2. **Ubiquitous Language.** Code names match the domain expert's vocabulary. No translation layer between business and code. (Evans, ch. 2)
3. **Bounded Contexts define boundaries.** Each context owns its model. Shared types across contexts are a design smell. (Evans, ch. 14)
4. **Aggregates enforce invariants.** All mutations go through the aggregate root. External code never reaches inside. (Vernon, ch. 10)
5. **Value Objects are immutable and identity-free.** They describe characteristics, not things. (Evans, ch. 5)
6. **Repositories return aggregates, not tables.** Persistence is an infrastructure concern. (Vernon, ch. 12)

## Tactical Patterns (summary)

| Pattern | One-liner | Reference |
|---------|-----------|-----------|
| Entity | Has identity; equality by ID, not attributes | [tactical-patterns.md § Entity](tactical-patterns.md#entity) |
| Value Object | No identity; immutable; equality by attributes | [tactical-patterns.md § Value Object](tactical-patterns.md#value-object) |
| Aggregate + Root | Consistency boundary; root is sole entry point | [tactical-patterns.md § Aggregate](tactical-patterns.md#aggregate--aggregate-root) |
| Repository | Collection-like abstraction over aggregates | [tactical-patterns.md § Repository](tactical-patterns.md#repository) |
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
| CQRS | Separate read/write models (deep enforcement defers to dotnet-cop) | [strategic-design.md § CQRS](strategic-design.md#cqrs) |

Full definitions, GOOD/BAD examples, and per-concept checklist lines: [strategic-design.md](strategic-design.md)

## Review Checklist

The `code-reviewer` agent applies [review-checklist.md](review-checklist.md) when reviewing domain code. It is a terse, file:line-oriented list — one item per pattern/concept. Load it on demand during review.

## Relationship to Other Skills

| Skill | Relationship |
|-------|-------------|
| [[dotnet-clean-architecture]] | Provides hexagonal layering (ports/adapters, module isolation). This skill provides the domain-modeling rules that live *inside* Core. |
| [[dotnet-cop]] | Pre-merge review enforcement. Its `optional-cqrs` and `optional-event-sourcing` sub-pages handle deep CQRS/ES review. This skill links to them rather than duplicating. |
| [[coding-standards]] | General TypeScript/JS standards. Not .NET-specific; no overlap. |

## Quick-Start Checklist (for `coder`)

When writing new domain code:

- [ ] Identify the bounded context this code belongs to
- [ ] Name types using the context's ubiquitous language
- [ ] Model entities with identity + behavior (not just data)
- [ ] Extract value objects for descriptive attributes (immutable, no ID)
- [ ] Group related entities into aggregates; designate one root
- [ ] Enforce invariants inside the aggregate root (constructor + methods)
- [ ] Expose mutations only through the aggregate root's public methods
- [ ] Define repository interfaces in Core (return aggregates, not EF entities)
- [ ] Use domain events for cross-aggregate or cross-context communication
- [ ] Keep domain services stateless; prefer entity methods when behavior fits one entity

## Hard Rules

1. **No anemic models.** If a class has only getters/setters and all logic lives in a separate service, that is a violation. Move behavior to the entity. (Fowler, "Anemic Domain Model")
2. **Aggregate root is the only external entry point.** No code outside the aggregate may hold a reference to an internal entity or mutate it directly. (Vernon, ch. 10)
3. **Value objects are immutable.** Use `readonly record struct` or sealed class with init-only properties. No setters. (Evans, ch. 5)
4. **Repositories return aggregates.** Never return EF Core entities, `IQueryable`, or raw DTOs from a domain repository interface. (Vernon, ch. 12)
5. **Bounded-context boundaries are hard.** No shared internal types across contexts. Use ACL or integration events. (Evans, ch. 14)
6. **Domain layer has zero infrastructure dependencies.** No `using Microsoft.EntityFrameworkCore`, no `HttpClient`, no framework attributes in domain types.
