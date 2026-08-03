# Session-Proxy Migration

## The Anti-Pattern

Legacy code uses shared "session proxy" classes in `src/app/core/session/proxies/` that wrap module adapters with caching decorators, writing into a shared god-store (`ReferenceSessionStore`).

### Defects

| Defect | Explanation |
|--------|-------------|
| **God-store coupling** | `ReferenceSessionStore` accumulates keys from every module. Adding a module means editing a shared file. Violates single responsibility. |
| **DIP violation** | Consumers inject the concrete proxy class (`inject(GetCompaniesProxy)`) instead of the port. The proxy IS the implementation — no abstraction. |
| **Dual port bindings** | The module's own `public-api.ts` binds `GetCompaniesPort → GetCompaniesAdapter`. The session layer rebinds `GetCompaniesPort → GetCompaniesProxy`. Two competing bindings for the same token. |
| **Broken self-containment** | The module cannot function independently — its caching lives outside its boundary. Moving or deleting the module requires editing `core/session/`. |
| **Tight coupling to concrete adapter** | The proxy injects `GetCompaniesAdapter` directly (`inject(GetCompaniesAdapter)`), bypassing the port abstraction it claims to implement. |

## Before (Anti-Pattern)

```typescript
// src/app/core/session/proxies/get-companies.proxy.ts
import { inject, Injectable, Provider } from '@angular/core';
import { getCompaniesProviders, GetCompaniesPort } from 'src/app/companies/public-api';
import { GetCompaniesAdapter } from 'src/app/companies/infrastructure/adapters';
import { ReferenceSessionStore } from '../stores/reference-session.store';
import { CACHE_NO_TIMEOUT, Loading, SkipIfCached, syncToStore } from 'flurryx';

@Injectable()
export class GetCompaniesProxy implements GetCompaniesPort {
  private readonly adapter = inject(GetCompaniesAdapter);        // ← concrete class!
  private readonly sessionStore = inject(ReferenceSessionStore); // ← god-store!

  @SkipIfCached('COMPANIES', (i: GetCompaniesProxy) => i.sessionStore, true, CACHE_NO_TIMEOUT)
  @Loading('COMPANIES', (i: GetCompaniesProxy) => i.sessionStore)
  getAll() {
    return this.adapter.getAll().pipe(syncToStore(this.sessionStore, 'COMPANIES'));
  }
}

export function provideCompaniesSession(): Provider[] {
  return [
    ...getCompaniesProviders(),
    GetCompaniesProxy,
    { provide: GetCompaniesPort, useClass: GetCompaniesProxy },  // ← rebinds port!
  ];
}
```

```typescript
// src/app/core/session/stores/reference-session.store.ts
type ReferenceSessionStoreConfig = {
  COUNTRIES: Country[];
  COMPANIES: Company[];
  DEFAULT_CURRENCY: Currency;
  VAT_RATES: number[];
  // ... grows with every module
};

export const ReferenceSessionStore = Store.for<ReferenceSessionStoreConfig>()
  .mirror(CompaniesStore, 'COMPANIES')
  .mirror(ReferenceStore, 'COUNTRIES')
  .mirror(CurrenciesStore, 'DEFAULT', 'DEFAULT_CURRENCY')
  .build();
```

## After (Canonical)

Caching moves INTO the module's own adapter. The module store owns its state. Consumers inject the PORT.

```typescript
// src/app/modules/companies/application/store/companies.store.ts
import { Store, createSessionStorageStoreMessageChannel } from 'flurryx';
import { Company } from '../../core/models';

type CompaniesStoreConfig = {
  COMPANIES: Company[];
};

export const CompaniesStore = Store.for<CompaniesStoreConfig>().build({
  channel: createSessionStorageStoreMessageChannel({ storageKey: 'companies' }),
});
```

```typescript
// src/app/modules/companies/infrastructure/adapters/get-companies.adapter.ts
import { inject, Injectable } from '@angular/core';
import { map, Observable } from 'rxjs';
import { CACHE_NO_TIMEOUT, Loading, SkipIfCached, syncToStore } from 'flurryx';
import { GetCompaniesPort } from '../../core/ports';
import { Company } from '../../core/models';
import { CompaniesEndpoint } from '../api/endpoints';
import { CompaniesStore } from '../../application/store';

@Injectable()
export class GetCompaniesAdapter implements GetCompaniesPort {
  readonly store = inject(CompaniesStore);
  private readonly api = inject(CompaniesEndpoint);

  @SkipIfCached('COMPANIES', (i: GetCompaniesAdapter) => i.store, true, CACHE_NO_TIMEOUT)
  @Loading('COMPANIES', (i: GetCompaniesAdapter) => i.store)
  getAll(): Observable<Company[]> {
    return this.api.getAll().pipe(
      map((responses) => responses.map(this.mapToCompany)),
      syncToStore(this.store, 'COMPANIES'),
    );
  }

  private mapToCompany(response: CompanyResponse): Company {
    const { companyCode, ...rest } = response;
    return { ...rest, code: companyCode };
  }
}
```

```typescript
// src/app/modules/companies/public-api.ts
export { type Company } from './core/models';
export { GetCompaniesPort } from './core/ports';

export function getCompaniesProviders(): Provider[] {
  return [
    CompaniesEndpoint,
    GetCompaniesAdapter,
    { provide: GetCompaniesPort, useClass: GetCompaniesAdapter },  // ← single binding
  ];
}
```

```typescript
// src/app/modules/companies/integration-api.ts
export { CompaniesStore } from './application/store';
```

## Consumer Side (Unchanged)

Consumers inject the PORT. Caching is transparent — they don't know or care whether the adapter caches.

```typescript
// In another module's use case:
@Injectable()
export class GetOrdersUseCase {
  private readonly getCompanies = inject(GetCompaniesPort);  // ← port, not proxy

  execute(): Observable<Order[]> {
    return this.getCompanies.getAll().pipe(
      switchMap(companies => /* ... */)
    );
  }
}
```

Cross-module DI wiring via context registry:

```typescript
// src/app/core/context/companies-context.providers.ts
export const COMPANIES_CONTEXT_PROVIDERS: Provider[] = [
  ...getCompaniesProviders(),   // binds port → adapter (with caching built in)
];
```

## Cross-Module Reactive Sharing

If another module needs live access to the companies cache:

```typescript
// Consumer module store
import { CompaniesStore } from '@gc/companies/integration-api';

export const DashboardStore = Store.for<DashboardStoreConfig>()
  .mirror(CompaniesStore, 'COMPANIES')
  .build();
```

## Migration Checklist

- [ ] Move `@SkipIfCached(CACHE_NO_TIMEOUT)` + `@Loading` into the module adapter
- [ ] Add `syncToStore(this.store, KEY)` in the adapter method
- [ ] Add session-storage channel to module store (if reload survival needed)
- [ ] Update `public-api.ts` providers fn (single port→adapter binding)
- [ ] Update context providers to use `getCompaniesProviders()` directly
- [ ] Delete the `*Proxy` class from `src/app/core/session/proxies/`
- [ ] Remove the key from `ReferenceSessionStore` config
- [ ] Verify consumers inject the PORT (not the proxy class)
- [ ] Run tests + build

## Net Result

> "Session proxy" → "self-contained module adapter with `@SkipIfCached(CACHE_NO_TIMEOUT)` + optional session-storage channel, consumed by PORT via context registry."
