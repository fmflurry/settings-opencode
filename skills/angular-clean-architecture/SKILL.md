---
name: angular-clean-architecture
description: Scaffolds and extends Angular standalone feature MODULES under src/app/modules/{name} using Clean Architecture layering (presentation/application/core/infrastructure), a self-registering module providers function, route-level lazy loading, cross-navigation state caching, the facade pattern, and ports/adapters dependency inversion. Use when creating a new Angular module, adding use cases/facades/stores/ports/adapters, wiring lazy routes + cached state, replacing session proxies, refactoring legacy NgModule/NgRx code, or cross-module communication via the context registry. Domain-modeling rules: see angular-ddd. State/replay mechanics: see flurryx.
---

# Angular Clean Architecture — Module System

## When To Activate

- Creating a module under `src/app/modules/`
- Adding a use case, facade, store, port, or adapter to an existing module
- Wiring lazy routes + cached state
- Replacing session proxies with self-contained module adapters
- Creating standalone components that consume store state via facades
- Refactoring a legacy/mixed module (NgModule/NgRx) toward Clean Architecture
- Moving business logic out of components into facades/use-cases
- Adding or updating cross-module communication via the context registry

## Relationship to Other Skills

| Concern | Owner |
|---------|-------|
| Domain modeling (entity, VO, aggregate, invariants) | [[angular-ddd]] |
| State/replay mechanics (Store API, channels, history) | [[flurryx]] |
| Pre-merge enforcement / review checklist | [[angular-cop]] |
| Module layout, DI, ports/adapters, lazy loading, caching wiring, facade, context registry, session-proxy replacement, naming | **this skill** |

## Architecture Anchors (Verify Before Coding)

| Anchor | What to look for |
|--------|-----------------|
| Reference module | At least one module under `src/app/modules/` with full layer structure |
| flurryx store | `Store.for<Config>().build()` in `application/store/` |
| syncToStore usage | `syncToStore(this.store, KEY)` or `syncToKeyedStore(...)` in adapters/facades |
| Context registry | `contextProvidersFor()` mapping cross-module providers |

**If anchors are missing:** do NOT invent imports. Continue best-effort, report mismatch.

## Architecture Overview

```text
src/app/modules/{moduleName}/
├── presentation/            # list/ details/ create/ edit/ container pages, forms/, components/
├── application/
│   ├── facades/{moduleName}.facade.ts
│   ├── use-cases/{verb-noun}.use-case.ts
│   └── store/{moduleName}.store.ts      # flurryx Store.for<Config>().build()
├── core/                    # domain hexagon — ZERO infra/framework imports
│   ├── models/  ports/  rules/  mappers/  events/
├── infrastructure/
│   ├── adapters/{verb-noun}.adapter.ts
│   └── api/{endpoints/, request/, response/}
├── routes.ts                # lazy loadComponent + route-level providers
├── routes.constants.ts
├── {moduleName}-service.providers.ts    # SELF-REGISTRATION entrypoint
├── public-api.ts            # SYNC contract: models, ports, providers fn
└── integration-api.ts       # REACTIVE contract: exports store for cross-module mirroring
```

Full layout with worked example: [module-template.md](module-template.md).

## Dependency Rules (CRITICAL)

```
Component --> Facade --> UseCase --> [Port] <-- Adapter --> Endpoint --> HttpClient
    |            |           |          ^           |
Presentation  Application  Application   Core     Infrastructure
```

- **Core has ZERO infrastructure or framework dependencies** — no Angular, no HttpClient, no flurryx. Only models (types), ports (abstract classes), rules (pure functions), mappers.
- **Application depends on Core only** — facades orchestrate use cases + store; use cases call ports.
- **Infrastructure depends on Core only** — adapters implement ports using HTTP clients.
- **Components NEVER inject use cases or stores directly** — always inject facades.
- **Cross-module communication uses the Context Registry or integration-api store exports** — never import another module's internals.

### Root Store vs Route Providers (Caching Mechanism)

- Store is `providedIn: 'root'` (flurryx default) → survives navigation = the cache.
- Facades, use cases, adapters are route-scoped → disposed on leave.
- `@SkipIfCached` prevents re-fetch when returning to a cached route.
- Optional `sessionStorage`/`localStorage` channels for reload/tab survival.
- `clearAllStores()` on logout/tenant switch.

## Store System

flurryx provides event-sourced, replayable signal state. This skill does NOT restate its API.

- **API reference** (Store builder, syncToStore, decorators, channels, history): [[flurryx]]
- **Wiring cheat-sheet** (how stores plug into modules): [store-system.md](store-system.md)
- **Conceptual ES/CQRS → Angular mapping**: [[angular-ddd]] event-sourcing-mapping

## Session-Proxy Replacement

Legacy `*Proxy` classes + shared god-stores are replaced by self-contained module adapters with `@SkipIfCached(CACHE_NO_TIMEOUT)` + optional session-storage channel, consumed by PORT via context registry.

Full before/after migration: [session-proxy-migration.md](session-proxy-migration.md).

## Hard Rules

- **Never** use `any` — use `unknown` if the type is truly unknown
- **Never** inject `UseCase` classes directly into components — always go through a Facade
- **Never** inject stores directly into components — facades expose store signals
- **Never** import flurryx, Angular, or HttpClient in `core/`
- **Never** re-fetch reference data without `@SkipIfCached`
- **Never** inject a concrete adapter/proxy across modules — inject the port
- Components must depend on facades for ALL domain interactions
- Use `inject()` for all dependencies, never constructor params
- Domain modeling patterns (entity, VO, aggregate) → [[angular-ddd]], not here

## Layer Implementation Templates

**For full templates with code**: See [layer-templates.md](layer-templates.md).

| Layer | Key Conventions |
|-------|----------------|
| Core Model | `type` or `interface`, optional `?:` props, group by entity |
| Core Port | `abstract class`, `Observable<T>` returns, `Port` suffix, one per operation (ISP) |
| Core Rules | Pure functions, `as const` constants, zero framework deps |
| Core Mappers | Pure `mapXToY` functions, `Partial<T>` returns, null-safe |
| Use Case | `@Injectable()` (no `providedIn`), inject ports via `inject()`, single responsibility |
| Facade | `@Injectable()` (no `providedIn`), inject store + use cases, `@SkipIfCached` + `@Loading` + `syncToStore` |
| Store | `Store.for<Config>().build()` — `providedIn: 'root'` by default |
| Adapter | `implements` port, inject endpoint, DTO↔domain mapping (ACL) |
| Endpoint | `HttpClient` + `UrlBuilder` + `PaginatedRequestBuilder` |
| Infra Providers | Function returning `Provider[]`, bind ports to adapters |
| Service Providers | Aggregates facades + use cases + infra + `contextProvidersFor()` |
| Routes | `loadComponent` lazy loading, route-level providers |
| Public API | SYNC contract: models, ports, providers fn |
| Integration API | REACTIVE contract: store export for cross-module mirroring |
| Component | Standalone, `OnPush`, `inject()` only, facade-only, signals |

## Cross-Module Communication

Two mechanisms: **sync** (context registry binding to ports) and **reactive** (integration-api store exports + flurryx mirroring). **For full patterns**: See [cross-domain.md](cross-domain.md).

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
| Store | `<Module>Store` (const from `Store.for`) | `CompaniesStore` |
| Store config | `<Module>StoreConfig` | `CompaniesStoreConfig` |
| Facade | `<Module>Facade` | `CompaniesFacade` |
| Use case | `<VerbNoun>UseCase` | `GetCompaniesUseCase` |
| Port (abstract) | `<VerbNoun>Port` | `GetCompaniesPort` |
| Adapter | `<VerbNoun>Adapter` | `GetCompaniesAdapter` |
| Endpoint | `<Module>Endpoint` | `CompaniesEndpoint` |
| Component | `<prefix>-<module>-<name>` | `app-companies-list` |
| Service providers fn | `<module>ServicesProviders()` | `companiesServicesProviders()` |
| Infra providers fn | `<module>InfrastructureProviders()` | `companiesInfrastructureProviders()` |
| Context providers | `<MODULE>_CONTEXT_PROVIDERS` | `COMPANIES_CONTEXT_PROVIDERS` |
| Public API | `public-api.ts` | N/A |
| Integration API | `integration-api.ts` | N/A |
| Model types | `<Entity>` (PascalCase) | `Company`, `CompanyFilters` |
| Business rules | `<module>-<concern>.rule.ts` | `company-fields.rule.ts` |
| Mappers | `<source>-mapper.ts` | `enterprise-mapper.ts` |

**Legacy folder mapping:** `domain/` → `core/`; `adapter/` → `adapters/`; `src/app/<area>/` → `src/app/modules/{name}/`.

## Implementation Playbook (Add a New Module)

Follow these steps **in order**. Full templates in [layer-templates.md](layer-templates.md) and [module-template.md](module-template.md).

1. Create module folder `src/app/modules/{moduleName}/`
2. Define core models in `core/models/`
3. Define core ports in `core/ports/` — `abstract class`, `Observable<T>` returns
4. Add business rules in `core/rules/` (if needed)
5. Create API endpoint in `infrastructure/api/endpoints/`
6. Implement adapter in `infrastructure/adapters/` — implements port, maps DTOs
7. Register infrastructure providers — bind ports to adapters
8. Define store in `application/store/` — `Store.for<Config>().build()`
9. Create use case in `application/use-cases/`
10. Create facade in `application/facades/` — wire store + use cases + `@SkipIfCached`/`@Loading`/`syncToStore`
11. Create service providers — aggregate all DI bindings + `contextProvidersFor()`
12. Create routes with lazy-loaded components and route-level providers
13. Create standalone components — facade-only injection, signals, OnPush
14. Create `public-api.ts` (sync contract) and `integration-api.ts` (reactive contract)
15. Register in `app.routes.ts` via `loadChildren`
16. Write tests (see [testing-patterns.md](testing-patterns.md))
17. Register context if cross-module access needed (see [cross-domain.md](cross-domain.md))

## Legacy Patterns (What NOT to Replicate)

| Legacy Pattern | New Pattern |
|---------------|-------------|
| NgRx actions/effects/reducers | flurryx `Store.for().build()` + `syncToStore` |
| `extends BaseStore` | `Store.for<Config>().build()` |
| `handleStoreLoading(store, key)` | `syncToStore(store, key)` |
| `handleKeyedStoreLoading(store, key, id)` | `syncToKeyedStore(store, key, id)` |
| `@AppCache(key, fn)` | `@SkipIfCached(key, fn)` |
| `@AutoStartLoading(key, fn)` | `@Loading(key, fn)` |
| `GetXProxy` class | Module adapter + `@SkipIfCached(CACHE_NO_TIMEOUT)` |
| Shared `ReferenceSessionStore` | Per-module store + optional session-storage channel |
| `src/app/<area>/` top-level feature | `src/app/modules/{name}/` |
| `StoreModule.forFeature()` | `Store.for<Config>().build()` (root-provided) |
| Direct `Store.dispatch()` in components | Facade methods |
| Direct `Store.select()` in components | Facade getter returning store signal |
| Services with BehaviorSubject state | flurryx store with `ResourceState<T>` |
| Constructor injection | `inject()` function |
| NgModules | Standalone components + route providers |
| `@Input()` / `@Output()` decorators | `input()` / `output()` signal functions |

## Checklist: Adding a New Module

- [ ] Module folder created under `src/app/modules/{name}/`
- [ ] Core models defined (`type` or `interface`, no `any`)
- [ ] Ports defined as `abstract class` with `Observable` returns in `core/ports/`
- [ ] Core has ZERO imports from Angular, HttpClient, or flurryx
- [ ] Adapters implement ports, inject endpoints, map DTOs
- [ ] Infrastructure providers bind ports to adapters
- [ ] Store defined via `Store.for<Config>().build()` in `application/store/`
- [ ] Use cases inject ports, single responsibility
- [ ] Facade injects store + use cases, exposes signals
- [ ] Facade uses `@SkipIfCached` + `@Loading` + `syncToStore`
- [ ] Service providers aggregate all DI bindings
- [ ] Routes lazy-load components with route-level providers
- [ ] Components inject facades only, use signals + OnPush
- [ ] `public-api.ts` exports models, ports, providers fn
- [ ] `integration-api.ts` exports store for cross-module mirroring
- [ ] Registered in `app.routes.ts` via `loadChildren`
- [ ] Tests written (80%+ coverage)
- [ ] No `any` type used anywhere
- [ ] No constructor injection — `inject()` only
- [ ] Context registry updated if cross-module access needed

## Review Checklist (Before Finalizing)

- [ ] Components use facade only — no use case or store references in presentation
- [ ] No `any` introduced anywhere
- [ ] Core layer has zero framework/infra imports
- [ ] Store is root-provided (not in route providers)
- [ ] `@SkipIfCached` outermost, `@Loading` beneath
- [ ] Cross-module access via port (context registry) or store mirror (integration-api)
- [ ] All event handlers are thin — logic delegated to facade
- [ ] Immutable updates throughout — no object mutation
