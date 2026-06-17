---
name: angular-clean-architecture
description: Scaffolds and extends Angular 18+ standalone features using Clean Architecture with DDD layering (presentation/application/domain/infrastructure), custom signal-based stores, facade pattern, and ports/adapters dependency inversion. Use when creating new Angular features/domains, adding use cases/facades/stores/ports/adapters, refactoring legacy NgModule/NgRx code toward clean architecture, or working with cross-domain communication via context registry.
---

# Angular Clean Architecture + DDD

## When To Activate

- Scaffolding a new Angular feature/domain following Clean Architecture
- Adding a use case, facade, store, port, or adapter to an existing domain
- Creating standalone components that consume store state via facades
- Refactoring a legacy/mixed module (NgModule/NgRx) toward Clean Architecture
- Moving business logic out of components into facades/use-cases
- Adding or updating cross-domain communication via the context registry
- Standardizing feature state management with BaseStore
- Working with the custom BaseStore, ResourceState, or store operators/decorators

## Architecture Anchors (Verify Before Coding)

Before writing code, verify these anchors exist in the active branch:

| Anchor | What to look for |
|--------|-----------------|
| Reference clean module | At least one domain following the full clean architecture structure (application/domain/infrastructure/presentation) |
| Base store | A `BaseStore` class with signal-based state management and `ResourceState<T>` |
| Store loading operator | An RxJS operator (e.g., `handleStoreLoading`) bridging Observables to store updates |
| Context registry | A registry mapping cross-domain providers (e.g., `contextProvidersFor()`) |

**If one or more anchors are missing:**
- Do NOT invent imports or APIs
- Continue with best-effort refactor using existing patterns
- Report the mismatch explicitly in your final message

## Hard Rules

- **Never** use `any` — use `unknown` if the type is truly unknown
- **Never** inject `UseCase` classes directly into components — always go through a Facade
- **Never** inject stores directly into components — facades expose store signals
- Components must depend on facades for ALL domain interactions
- Keep domain and application logic independent from Angular UI details
- Use typed models for state, DTOs, and context payloads — no untyped objects
- Domain layer has ZERO infrastructure or framework dependencies
- Use `inject()` for all dependencies, never constructor params

## Architecture Overview

```text
src/app/<feature-area>/
├── <domain>/
│   ├── application/                    # Application layer (orchestration)
│   │   ├── facades/                    # Public API for components
│   │   ├── use-cases/                  # Single-responsibility business operations
│   │   └── store/                      # Signal-based state management
│   │
│   ├── domain/                         # Domain layer (pure business logic, ZERO infra deps)
│   │   ├── models/                     # Immutable TypeScript types
│   │   ├── ports/                      # Abstract classes (dependency inversion)
│   │   ├── rules/                      # Pure validation functions & constants
│   │   └── mappers/                    # Pure data transformation functions
│   │
│   ├── infrastructure/                 # Infrastructure layer (external concerns)
│   │   ├── adapter/                    # Port implementations
│   │   ├── api/
│   │   │   ├── endpoints/              # HTTP client wrappers
│   │   │   ├── request/                # API request DTOs
│   │   │   └── response/              # API response DTOs
│   │   └── <domain>-infrastructure.providers.ts
│   │
│   ├── presentation/                   # Presentation layer (UI)
│   │   ├── list/                       # Feature pages
│   │   ├── details/
│   │   ├── create/
│   │   ├── edit/
│   │   └── forms/                      # Reusable form components
│   │
│   ├── routes.ts                       # Lazy-loaded route definitions
│   ├── routes.constants.ts             # Route path constants
│   ├── <domain>-service.providers.ts   # All DI bindings for this domain
│   └── public-api.ts                   # Barrel exports for cross-domain use
```

## Dependency Rules (CRITICAL)

```
Component --> Facade --> UseCase --> [Port] <-- Adapter --> Endpoint --> HttpClient
   |            |           |          ^           |
Presentation  Application  Application  Domain    Infrastructure
```

- **Domain has ZERO infrastructure dependencies** — only defines ports (abstract classes), models (types), rules (pure functions), and mappers.
- **Application depends on Domain only** — facades orchestrate use cases and stores; use cases call ports.
- **Infrastructure depends on Domain only** — adapters implement ports using HTTP clients and API services.
- **Components NEVER inject use cases directly** — always inject facades.
- **Components NEVER inject stores directly** — facades expose store signals.
- **Cross-domain communication uses the Context Registry** — never import another domain's internals.

## Store System

The store uses a custom `BaseStore` with signal-based state and `ResourceState<T>` wrapping.

**For full store details**: See [store-system.md](store-system.md) — covers `ResourceState<T>`, `BaseStore` API, `KeyedResourceData`, `handleStoreLoading`/`handleKeyedStoreLoading` operators, `@AutoStartLoading` and `@AppCache` decorators.

## Layer Implementation Templates

Condensed patterns for each layer. **For full templates with code**: See [layer-templates.md](layer-templates.md).

| Layer | Key Conventions |
|-------|----------------|
| Domain Model | Use `type` (not interface/class), optional `?:` props, group by entity |
| Domain Port | `abstract class` with `abstract` methods returning `Observable<T>`, `Port` suffix, one per operation (ISP) |
| Domain Rules | Pure functions, `as const` constants, zero framework deps |
| Domain Mappers | Pure `mapXToY` functions, `Partial<T>` returns, null-safe |
| Use Case | `@Injectable()` (no `providedIn`), inject ports via `inject()`, single responsibility |
| Facade | `@Injectable()` (no `providedIn`), inject store + use cases, expose signals via getters, `@AppCache` + `@AutoStartLoading` + `handleStoreLoading` for actions |
| Adapter | `implements` port, inject endpoint, transform DTOs to domain models |
| Endpoint | `HttpClient` + `UrlBuilder` + `PaginatedRequestBuilder` |
| Infra Providers | Function returning `Provider[]`, bind ports to adapters |
| Service Providers | Aggregates facades + use cases + infra + `contextProvidersFor()` |
| Routes | `loadComponent` lazy loading, route-level providers, functional guards |
| Public API | Barrel exports: models, ports, adapters, store, provider functions |
| Component | Standalone, `OnPush`, `inject()` only, facade-only injection, `signal()`/`computed()`/`effect()`, `input()`/`output()` signals, SCSS, project selector prefix |

## Cross-Domain Communication

Uses a `ContextRegistry` with `contextProvidersFor()`. **For full patterns**: See [cross-domain.md](cross-domain.md).

## Testing Patterns

**For full testing patterns by layer**: See [testing-patterns.md](testing-patterns.md).

| Test Target | Mock | Verify |
|-------------|------|--------|
| Facade | Store + use cases | Orchestration logic |
| Component | Facade only | Rendering + event delegation |
| Use case | Ports | Delegation + business logic |
| Adapter | Endpoints | DTO-to-model mapping |

Target **80%+ coverage**.

## Naming Conventions

| Artifact | Pattern | Example |
|----------|---------|---------|
| Store class | `<Domain>Store` | `CustomersStore` |
| Store enum | `<Domain>StoreEnum` | `CustomersStoreEnum` |
| Store state type | `<Domain>State` | `CustomersState` |
| Facade | `<Domain>Facade` | `CustomersFacade` |
| Use case | `<VerbNoun>UseCase` | `GetCustomersUseCase` |
| Port (abstract) | `<VerbNoun>Port` | `GetCustomersPort` |
| Adapter | `<VerbNoun>Adapter` | `GetCustomersAdapter` |
| Endpoint | `<Domain>Endpoint` | `CustomersEndpoint` |
| Component | `<prefix>-<feature>-<name>` | `app-customers-list` |
| Service providers fn | `<domain>ServicesProviders()` | `customersServicesProviders()` |
| Infra providers fn | `<domain>InfrastructureProviders()` | `customersInfrastructureProviders()` |
| Context providers | `<DOMAIN>_CONTEXT_PROVIDERS` | `CUSTOMERS_CONTEXT_PROVIDERS` |
| Route constants | `routes.constants.ts` | N/A |
| Public API | `public-api.ts` | N/A |
| Spec files | `<name>.spec.ts` | `customers.facade.spec.ts` |
| Model types | `<Entity>` (PascalCase type) | `Customer`, `CustomerFilters` |
| Business rules | `<domain>-<concern>.rule.ts` | `customer-fields.rule.ts` |
| Mappers | `<source>-mapper.ts` | `enterprise-mapper.ts` |

## Implementation Playbook (Add a New Feature)

Follow these steps **in order**. Full templates for each step in [layer-templates.md](layer-templates.md).

1. Define domain models in `domain/models/`
2. Define domain ports in `domain/ports/` — `abstract class`, `Observable<T>` returns
3. Add business rules in `domain/rules/` (if needed)
4. Implement infrastructure adapter in `infrastructure/adapter/`
5. Create API endpoint in `infrastructure/api/endpoints/`
6. Register infrastructure providers — bind ports to adapters
7. Create use case in `application/use-cases/`
8. Define store in `application/store/` — extend `BaseStore`
9. Create facade in `application/facades/` — wire store + use cases
10. Create service providers — aggregate all DI bindings
11. Create routes with lazy-loaded components and route-level providers
12. Create standalone components — facade-only injection, signals, OnPush
13. Create public API barrel exports
14. Write tests (see [testing-patterns.md](testing-patterns.md))
15. Register context if cross-domain access needed (see [cross-domain.md](cross-domain.md))

## Mixed-to-Clean Refactor Workflow

**For full migration guide**: See [migration-guide.md](migration-guide.md).

Summary: Analyze current module → Introduce facade boundary → Extract use cases/ports → Isolate infrastructure → Align store to BaseStore → Replace direct domain coupling with context registry → Validate.

## Legacy Patterns (What NOT to Replicate)

| Legacy Pattern | New Pattern |
|---------------|-------------|
| NgRx actions/effects/reducers | Custom BaseStore + handleStoreLoading |
| `StoreModule.forFeature()` | `BaseStore` with `providedIn: 'root'` |
| Direct `Store.dispatch()` in components | Facade methods |
| Direct `Store.select()` in components | Facade getter returning store signal |
| Services with BehaviorSubject state | BaseStore with ResourceState |
| Constructor injection | `inject()` function |
| NgModules | Standalone components + route providers |
| `@Input()` / `@Output()` decorators | `input()` / `output()` signal functions |

## Checklist: Adding a New Feature

- [ ] Domain models defined as `type` (not interface/class)
- [ ] Ports defined as `abstract class` with `Observable` returns
- [ ] Adapters implement ports, inject endpoints
- [ ] Endpoints use `HttpClient` + `UrlBuilder`
- [ ] Infrastructure providers bind ports to adapters
- [ ] Use cases inject ports, single responsibility
- [ ] Store extends `BaseStore` with enum + state type
- [ ] Facade injects store + use cases, exposes signals
- [ ] Facade uses `@AppCache` + `@AutoStartLoading` + `handleStoreLoading`
- [ ] Service providers include all DI bindings
- [ ] Routes lazy-load components with route-level providers
- [ ] Components inject facades only, use signals + OnPush
- [ ] Components use the project's selector prefix
- [ ] Public API exports cross-domain essentials
- [ ] Tests written (80%+ coverage)
- [ ] No `any` type used anywhere
- [ ] No constructor injection — `inject()` only
- [ ] No if-else chains — guard clauses and early returns
- [ ] Immutable updates throughout (spread operator, no mutation)
- [ ] Context registry updated if cross-domain access needed

## Review Checklist (Before Finalizing)

- [ ] Components use facade only — no use case or store references in presentation layer
- [ ] No `any` introduced anywhere
- [ ] Use cases are not referenced from presentation layer
- [ ] Store transitions are typed and consistent (ResourceState<T>)
- [ ] Loading behavior uses shared operator patterns
- [ ] Cross-domain communication uses registry contracts
- [ ] All event handlers are thin — logic delegated to facade
- [ ] Immutable updates throughout — no object mutation

## Expected Output Style for Agent Responses

When completing work on this codebase, include in your final message:

1. **What changed and why** — brief summary of modifications
2. **Which layer boundaries were enforced** — e.g., "presentation depends only on facade, domain has zero infra deps"
3. **Which files show facade/store/context integration** — key file paths demonstrating the patterns
4. **Any unresolved architecture mismatches** — if anchor files were missing or legacy patterns couldn't be fully migrated, report explicitly
