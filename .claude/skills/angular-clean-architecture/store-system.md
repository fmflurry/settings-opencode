# Store System — Wiring Cheat-Sheet

This file covers **how stores plug into modules**. It does NOT restate the flurryx API.

- **Full API reference** (builder, syncToStore, decorators, channels, history, replay): [[flurryx]]
- **Conceptual ES/CQRS → Angular mapping**: [[angular-ddd]] event-sourcing-mapping

## Store Definition (in `application/store/`)

```typescript
// src/app/modules/companies/application/store/companies.store.ts
import { Store } from 'flurryx';
import { Company } from '../../core/models';

type CompaniesStoreConfig = {
  COMPANIES: Company[];
};

export const CompaniesStore = Store.for<CompaniesStoreConfig>().build();
```

- `Store.for<Config>().build()` returns an `InjectionToken` registered `providedIn: 'root'`.
- Config keys are `UPPER_SNAKE_CASE`. Values are raw types; flurryx wraps in `ResourceState<T>`.
- Keyed slots: `ITEMS: KeyedResourceData<string, Item>`.

## Facade Wiring

```typescript
@Injectable()
export class CompaniesFacade {
  readonly store = inject(CompaniesStore);   // MUST be public + readonly (decorator access)
  private readonly getCompanies = inject(GetCompaniesUseCase);

  getAll() { return this.store.get('COMPANIES'); }

  @SkipIfCached('COMPANIES', (i: CompaniesFacade) => i.store)
  @Loading('COMPANIES', (i: CompaniesFacade) => i.store)
  loadAll() {
    this.getCompanies.execute().pipe(syncToStore(this.store, 'COMPANIES')).subscribe();
  }
}
```

## Adapter-Level Caching (session-proxy replacement)

When a module's data must survive across navigations without a facade:

```typescript
@Injectable()
export class GetCompaniesAdapter implements GetCompaniesPort {
  readonly store = inject(CompaniesStore);
  private readonly api = inject(CompaniesEndpoint);

  @SkipIfCached('COMPANIES', (i: GetCompaniesAdapter) => i.store, true, CACHE_NO_TIMEOUT)
  @Loading('COMPANIES', (i: GetCompaniesAdapter) => i.store)
  getAll(): Observable<Company[]> {
    return this.api.getAll().pipe(
      map(responses => responses.map(this.mapToDomain)),
      syncToStore(this.store, 'COMPANIES'),
    );
  }
}
```

## Session/Reload Survival (Channel)

```typescript
export const CompaniesStore = Store.for<CompaniesStoreConfig>().build({
  channel: createSessionStorageStoreMessageChannel({ storageKey: 'companies' }),
});
```

## Cross-Module Reactive Sharing

Export the store token from `integration-api.ts`. Consumers mirror it:

```typescript
// consumer module store
export const OrdersStore = Store.for<OrdersStoreConfig>()
  .mirror(CompaniesStore, 'COMPANIES')
  .build();
```

Or standalone: `mirrorKey(CompaniesStore, 'COMPANIES', OrdersStore, 'COMPANIES')`.

## Root vs Route Scope

| Artifact | Scope | Why |
|----------|-------|-----|
| Store (`Store.for().build()`) | `providedIn: 'root'` | Survives navigation = cache |
| Facade, UseCase, Adapter | Route-level `providers: [...]` | Disposed on leave; re-created on re-entry |
| `@SkipIfCached` | Prevents re-fetch | Store still holds data from previous visit |

## Reset

- Single slot: `store.clear('COMPANIES')`
- All stores (logout/tenant switch): `clearAllStores()`
