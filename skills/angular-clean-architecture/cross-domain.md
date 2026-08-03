# Cross-Module Communication

Two mechanisms: **synchronous** (context registry → port binding) and **reactive** (integration-api store exports + flurryx mirroring).

## 1. Synchronous — Context Registry

A consuming module needs data from another module at call time (e.g., orders needs company names).

### Registering a Context

```typescript
// src/app/core/context/context.registry.ts

export enum AppContext {
  COMPANIES = 'companies',
  CURRENCIES = 'currencies',
  ORDERS = 'orders',
}

export const CONTEXT_REGISTRY: Record<AppContext, Provider[]> = {
  companies: COMPANIES_CONTEXT_PROVIDERS,
  currencies: CURRENCIES_CONTEXT_PROVIDERS,
  orders: ORDERS_CONTEXT_PROVIDERS,
};

export function contextProvidersFor(contexts: AppContext[]): Provider[] {
  return contexts.flatMap((ctx) => CONTEXT_REGISTRY[ctx] ?? []);
}
```

### Creating Context Providers

Context providers bind the module's **port** to its **adapter** — never a concrete class from another module.

```typescript
// src/app/core/context/companies-context.providers.ts
import { getCompaniesProviders } from '@gc/companies/public-api';

export const COMPANIES_CONTEXT_PROVIDERS: Provider[] = [
  ...getCompaniesProviders(),   // binds GetCompaniesPort → GetCompaniesAdapter
];
```

The module's `public-api.ts` exports the providers function that performs the port→adapter binding. Consumers never reference the adapter directly.

### Consuming in Service Providers

```typescript
// In orders module:
export function ordersServicesProviders(): Provider[] {
  return [
    OrdersFacade,
    GetOrdersUseCase,
    ...ordersInfrastructureProviders(),
    ...contextProvidersFor([AppContext.COMPANIES]),  // inject GetCompaniesPort
  ];
}
```

The orders use case injects `GetCompaniesPort` (abstract class). At runtime, DI resolves it to `GetCompaniesAdapter`. The orders module has zero compile-time dependency on companies internals.

### Adding Cross-Module Access for a New Feature

1. Ensure the source module exports a providers fn from `public-api.ts`
2. Create context providers in `src/app/core/context/<module>-context.providers.ts`
3. Add entry to `AppContext` enum + `CONTEXT_REGISTRY`
4. Consumer modules pull via `contextProvidersFor([AppContext.<MODULE>])`

**Rule:** Never import another module's internals — always go through the port.

## 2. Reactive — Store Mirroring via integration-api

When a consuming module needs **live reactive access** to another module's cached state (e.g., a dashboard mirroring company list updates).

### Source Module Exports Store

```typescript
// src/app/modules/companies/integration-api.ts
export { CompaniesStore } from './application/store';
```

### Consumer Mirrors at Builder Level

```typescript
// src/app/modules/dashboard/application/store/dashboard.store.ts
import { CompaniesStore } from '@gc/companies/integration-api';

type DashboardStoreConfig = {
  COMPANIES: Company[];
  WIDGETS: Widget[];
};

export const DashboardStore = Store.for<DashboardStoreConfig>()
  .mirror(CompaniesStore, 'COMPANIES')   // 1:1 mirror — updates flow both ways
  .build();
```

### Standalone Mirroring (imperative)

```typescript
import { mirrorKey, collectKeyed } from 'flurryx';

// One-way mirror
const cleanup = mirrorKey(CompaniesStore, 'COMPANIES', DashboardStore, 'COMPANIES', {
  direction: 'source-to-target',
});

// Aggregate single-entity fetches into keyed slot
const cleanup2 = collectKeyed(CompanyDetailsStore, 'DETAIL', DashboardStore, 'COMPANIES_KEYED', {
  extractId: (company) => company?.id,
});
```

### Keyed Mirroring at Builder Level

```typescript
export const DashboardStore = Store.for<DashboardStoreConfig>()
  .mirrorKeyed(CompanyDetailsStore, 'DETAIL', { extractId: (c) => c?.id }, 'COMPANIES_KEYED')
  .build();
```

## Decision Guide

| Need | Mechanism | Example |
|------|-----------|---------|
| Call-time data fetch (one-shot) | Context registry → port | Orders fetches company name |
| Live reactive state sharing | integration-api + `.mirror()` | Dashboard mirrors company list |
| Per-entity aggregation | `collectKeyed` / `.mirrorKeyed()` | Collecting company details into keyed slot |
| Derived/transformed view | `.derive()` / `deriveKey()` | Formatting totals from another store |

## Rules

- **Sync access**: always via port (context registry). Never inject a concrete adapter cross-module.
- **Reactive access**: always via `integration-api.ts` store export. Never import from `application/store/` directly.
- **No god-stores**: each module owns its own store. Cross-module state flows via mirroring, not a shared mega-store.
- **Caching is transparent**: `@SkipIfCached` in the source module's adapter/facade handles dedup. Consumers just call the port.
