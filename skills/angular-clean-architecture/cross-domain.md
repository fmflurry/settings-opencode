# Cross-Domain Communication (Context Registry)

## Registering a Context

```typescript
// src/app/core/context/context.registry.ts

export enum AppContext {
  LICENSE = 'license',
  CUSTOMERS = 'customers',
  ORDERS = 'orders',
  ARTICLES = 'articles',
}

export const CONTEXT_REGISTRY: Record<AppContext, Provider[]> = {
  license: LICENSE_CONTEXT_PROVIDERS,
  customers: CUSTOMERS_CONTEXT_PROVIDERS,
  orders: ORDERS_CONTEXT_PROVIDERS,
  articles: ARTICLES_CONTEXT_PROVIDERS,
};

export function contextProvidersFor(contexts: AppContext[]): Provider[] {
  return contexts.flatMap((ctx) => CONTEXT_REGISTRY[ctx] ?? []);
}
```

## Creating Context Providers

```typescript
// src/app/core/context/customers-context.providers.ts

export const CUSTOMERS_CONTEXT_PROVIDERS: Provider[] = [
  ...customersInfrastructureProviders(),    // From the domain's public-api
  GetCustomersProxy,                        // Optional proxy with caching
  { provide: GetCustomersPort, useClass: GetCustomersProxy },
];
```

## Using Context in Service Providers

```typescript
// In another domain's service providers:
export function ordersServicesProviders(): Provider[] {
  return [
    OrdersFacade,
    GetOrdersUseCase,
    ...ordersInfrastructureProviders(),
    ...contextProvidersFor([AppContext.CUSTOMERS]),
  ];
}
```

## Adding Cross-Domain Access for a New Feature

1. Create context providers in `src/app/core/context/<domain>-context.providers.ts`
2. Add entry to `AppContext` enum
3. Add entry to `CONTEXT_REGISTRY`
4. Consumer domains pull via `contextProvidersFor([AppContext.<DOMAIN>])`

**Rule:** Never import another domain's internals directly — always go through the context registry.
