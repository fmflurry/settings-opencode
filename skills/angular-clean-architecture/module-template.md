# Module Template — Canonical Layout

## Full Folder Structure

```text
src/app/modules/{moduleName}/
├── presentation/
│   ├── list/
│   │   ├── {moduleName}-list.component.ts
│   │   ├── {moduleName}-list.component.html
│   │   └── {moduleName}-list.component.scss
│   ├── details/
│   ├── create/
│   ├── edit/
│   ├── container/              # Optional: orchestrator pages with child routes
│   ├── forms/                  # Reusable form components
│   └── components/             # Shared presentational components
│
├── application/
│   ├── facades/
│   │   └── {moduleName}.facade.ts
│   ├── use-cases/
│   │   └── {verb-noun}.use-case.ts
│   └── store/
│       ├── {moduleName}.store.ts
│       └── index.ts
│
├── core/                       # ZERO infra/framework imports
│   ├── models/
│   │   ├── {entity}.model.ts
│   │   └── index.ts
│   ├── ports/
│   │   ├── {verb-noun}.port.ts
│   │   └── index.ts
│   ├── rules/                  # Optional: pure validation
│   │   └── {entity}-fields.rule.ts
│   ├── mappers/                # Optional: pure transforms
│   │   └── {source}-mapper.ts
│   └── events/                 # Optional: immutable domain event records
│       └── {noun}-{past-verb}.event.ts
│
├── infrastructure/
│   ├── adapters/
│   │   ├── {verb-noun}.adapter.ts
│   │   └── index.ts
│   ├── api/
│   │   ├── endpoints/
│   │   │   ├── {moduleName}.endpoint.ts
│   │   │   └── index.ts
│   │   ├── request/
│   │   │   └── {verb-noun}.request.ts
│   │   └── response/
│   │       └── {verb-noun}.response.ts
│   └── {moduleName}-infrastructure.providers.ts
│
├── routes.ts                   # Lazy loadComponent + route-level providers
├── routes.constants.ts         # Route path constants
├── {moduleName}-service.providers.ts   # SELF-REGISTRATION entrypoint
├── public-api.ts               # SYNC contract
└── integration-api.ts          # REACTIVE contract
```

## Self-Registration (IModule Equivalent)

Angular has no reflection-based DI discovery. The aggregator function + `loadChildren` IS the IModule equivalent.

```typescript
// {moduleName}-service.providers.ts
import { Provider } from '@angular/core';

export function companiesServicesProviders(): Provider[] {
  return [
    // Application layer
    CompaniesFacade,
    GetCompaniesUseCase,
    SearchCompaniesUseCase,
    // Infrastructure layer (binds ports → adapters)
    ...companiesInfrastructureProviders(),
    // Cross-module dependencies (ports only)
    ...contextProvidersFor([AppContext.ORDERS]),
  ];
}
```

**Key point:** The store is NOT listed here. It is `providedIn: 'root'` (flurryx default) and survives navigation. Only facades, use cases, and adapters are route-scoped.

## Lazy Loading + Caching

### app.routes.ts (discovery)

```typescript
// src/app/app.routes.ts
export const APP_ROUTES: Routes = [
  {
    path: 'companies',
    loadChildren: () =>
      import('./modules/companies/routes').then((m) => m.ROUTES),
  },
];
```

### Module routes.ts (route-level providers)

```typescript
// src/app/modules/companies/routes.ts
export const ROUTES: Routes = [
  { path: '', redirectTo: 'list', pathMatch: 'full' },
  {
    path: 'list',
    loadComponent: () =>
      import('./presentation/list/companies-list.component')
        .then((m) => m.CompaniesListComponent),
    providers: [companiesServicesProviders()],
  },
  {
    path: ':id/details',
    loadComponent: () =>
      import('./presentation/details/company-details.component')
        .then((m) => m.CompanyDetailsComponent),
    providers: [companiesServicesProviders()],
  },
];
```

### How Caching Works Across Navigations

```
User visits /companies/list
  → loadChildren fires → module code loaded (once, then cached by bundler)
  → route providers create Facade, UseCase, Adapter instances
  → Facade.loadAll() → @SkipIfCached checks store → cache miss → fetch → syncToStore
  → Store (root-provided) now holds data

User navigates to /orders, then back to /companies/list
  → route providers re-create Facade, UseCase, Adapter (fresh instances)
  → Facade.loadAll() → @SkipIfCached checks store → cache HIT → skip fetch
  → Component reads existing store data immediately

User logs out / switches tenant
  → clearAllStores() → all root stores reset → next visit re-fetches
```

### Reload/Tab Survival (Optional)

```typescript
// application/store/companies.store.ts
export const CompaniesStore = Store.for<CompaniesStoreConfig>().build({
  channel: createSessionStorageStoreMessageChannel({ storageKey: 'companies' }),
});
```

Use `createLocalStorageStoreMessageChannel` for cross-tab persistence.

## Eager App-Wide Modules (Reference Data)

For modules that must be available app-wide without navigation (e.g., license, currencies):

```typescript
// app.config.ts
export const appConfig: ApplicationConfig = {
  providers: [
    ...companiesServicesProviders(),   // eager — loaded at startup
    // ...
  ],
};
```

These modules still follow the same folder structure. The only difference: their providers fn is listed in `app.config.ts` instead of (or in addition to) route-level providers.

## Worked Example: companies

```text
src/app/modules/companies/
├── presentation/
│   └── list/
│       ├── companies-list.component.ts
│       ├── companies-list.component.html
│       └── companies-list.component.scss
├── application/
│   ├── facades/companies.facade.ts
│   ├── use-cases/get-companies.use-case.ts
│   └── store/
│       ├── companies.store.ts
│       └── index.ts
├── core/
│   ├── models/
│   │   ├── company.model.ts
│   │   └── index.ts
│   └── ports/
│       ├── get-companies.port.ts
│       └── index.ts
├── infrastructure/
│   ├── adapters/
│   │   ├── get-companies.adapter.ts
│   │   └── index.ts
│   ├── api/
│   │   ├── endpoints/
│   │   │   ├── companies.endpoint.ts
│   │   │   └── index.ts
│   │   └── response/
│   │       ├── company.response.ts
│   │       └── index.ts
│   └── companies-infrastructure.providers.ts
├── routes.ts
├── companies-service.providers.ts
├── public-api.ts
└── integration-api.ts
```

## Nested Sub-Modules

For large domains with sub-features (e.g., `sales/` containing `orders/`, `customers/`, `products/`):

```text
src/app/modules/sales/
├── routes.ts                   # Parent routes, delegates to sub-module routes
├── orders/
│   ├── presentation/
│   ├── application/
│   ├── core/
│   ├── infrastructure/
│   ├── orders-service.providers.ts
│   └── ...
├── customers/
│   └── ...
└── products/
    └── ...
```

Parent `routes.ts` imports sub-module routes and applies providers per sub-route. Each sub-module is self-contained with its own providers fn.
