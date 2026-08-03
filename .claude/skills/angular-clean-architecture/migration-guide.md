# Migration Guide

## Folder Rename Table

When normalizing an existing module to the canonical layout:

| Old Path | New Path | Notes |
|----------|----------|-------|
| `domain/` | `core/` | Domain hexagon; zero infra/framework imports |
| `domain/models/` | `core/models/` | |
| `domain/ports/` | `core/ports/` | |
| `domain/rules/` | `core/rules/` | |
| `domain/mappers/` | `core/mappers/` | |
| `infrastructure/adapter/` | `infrastructure/adapters/` | Plural |
| `application/store/<domain>.store.ts` | `application/store/<module>.store.ts` | flurryx `Store.for` |
| `src/app/<area>/` | `src/app/modules/{name}/` | Top-level move |
| `<domain>-service.providers.ts` | `{moduleName}-service.providers.ts` | |
| `<domain>-infrastructure.providers.ts` | `{moduleName}-infrastructure.providers.ts` | |

## Store Migration (BaseStore → flurryx)

| Old | New |
|-----|-----|
| `extends BaseStore<Enum, State>` | `Store.for<Config>().build()` |
| `enum XStoreEnum { KEY = 'KEY' }` | `type XStoreConfig = { KEY: T }` (keys are the config keys) |
| `handleStoreLoading(store, key)` | `syncToStore(store, key)` |
| `handleKeyedStoreLoading(store, key, id)` | `syncToKeyedStore(store, key, id)` |
| `@AppCache(key, fn)` | `@SkipIfCached(key, fn)` |
| `@AutoStartLoading(key, fn)` | `@Loading(key, fn)` |
| `@Injectable({ providedIn: 'root' }) class XStore` | `export const XStore = Store.for<Config>().build()` |

Steps:
1. Replace enum + state type with a single `type XStoreConfig = { ... }`
2. Replace class with `Store.for<XStoreConfig>().build()`
3. Replace `handleStoreLoading` → `syncToStore`, `handleKeyedStoreLoading` → `syncToKeyedStore`
4. Replace `@AppCache` → `@SkipIfCached`, `@AutoStartLoading` → `@Loading`
5. Update facade: `store` must be `public readonly` (decorator getter access)
6. Remove `BaseStore` import

## Session-Proxy → Cached Adapter Migration

Full before/after: [session-proxy-migration.md](session-proxy-migration.md).

Summary steps:
1. Move caching decorators (`@SkipIfCached(CACHE_NO_TIMEOUT)` + `@Loading`) INTO the module's own adapter
2. Add `syncToStore(this.store, KEY)` in the adapter method
3. Add a session-storage channel to the module store if reload survival is needed
4. Update context providers to bind port → adapter directly (remove the intermediate proxy class)
5. Delete the `*Proxy` class from `src/app/core/session/proxies/`
6. Remove the proxy's store key from `ReferenceSessionStore` (or delete the god-store if empty)
7. Consumers now inject the PORT — caching is transparent

## Top-Level Folder Move (src/app/<area> → src/app/modules/{name})

1. Move the folder: `src/app/<area>/` → `src/app/modules/{name}/`
2. Rename internal folders per the table above (`domain/` → `core/`, `adapter/` → `adapters/`)
3. Update all import paths (tsconfig path aliases like `@gc/<name>/` simplify this)
4. Update `app.routes.ts`: `loadChildren: () => import('./modules/{name}/routes').then(m => m.ROUTES)`
5. Update context registry imports if the module is referenced cross-module
6. Verify build + tests

## Mixed-to-Clean Refactor Workflow

When migrating a legacy/mixed module to Clean Architecture:

### 1. Analyze Current Module

- Locate domain rules buried in components or services
- Identify direct cross-module couplings (imports from other modules)
- Map out NgRx actions/effects/reducers if present
- List BehaviorSubject-based state in services
- Identify session-proxy dependencies

### 2. Introduce Facade Boundary

- Create a facade class for the module
- Move orchestration logic from components into the facade
- Components should now only call facade methods

### 3. Extract Use Cases and Ports

- Move business rules from services to `application/use-cases/`
- Define abstract port classes in `core/ports/` for external dependencies
- Keep use cases framework-agnostic

### 4. Isolate Infrastructure

- Create adapters in `infrastructure/adapters/` implementing the ports
- Move API calls from services to endpoint classes
- Create infrastructure providers binding ports to adapters

### 5. Align Store to flurryx

- Replace NgRx stores, BehaviorSubject state, or `BaseStore` with `Store.for<Config>().build()`
- Use `syncToStore` / `syncToKeyedStore` for async transitions
- Wire facades with `@SkipIfCached` + `@Loading`

### 6. Replace Session Proxies

- Move caching into the module's own adapter (see session-proxy-migration.md)
- Remove proxy classes and god-store references

### 7. Replace Direct Module Coupling

- Identify where one module imports another's internals
- Create context providers and register in `ContextRegistry`
- Route all cross-module interactions via `contextProvidersFor()` or integration-api mirroring

### 8. Validate

- Run tests and build
- Fix regressions
- Verify no legacy patterns remain in the migrated module
- Confirm `core/` has zero framework/infra imports
