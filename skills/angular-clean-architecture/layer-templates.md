# Layer Implementation Templates

Worked example: `companies` module (normalized to canonical layout).

## Import Conventions (Path Aliases)

Prefer the project's tsconfig path aliases over relative paths. Deep relative climbing is forbidden.

```typescript
// BAD — deep relative climbing, hard to read and breaks on file moves
import { Company } from '../../../core/models';

// GOOD — path alias, stable and readable
import { Company } from '@/modules/companies/core/models';
```

Rules:
- **Cross-module**: FORBIDDEN. From inside a module, `@/modules/<B>/...` is forbidden in ANY alias form — including `public-api`/`integration-api`. Aliasing does not legalize cross-module imports. Module contracts may be imported only by the composition root (`src/app/core/**`, `app.config.ts`, `app.routes.ts`); cross-module needs go through `core/` contracts or local ACL copies (see [cross-domain.md](cross-domain.md)).
- **Intra-module across layers**: alias form preferred — `import { Company } from '@/modules/companies/core/models'`.
- **Same-directory** `./sibling` remains acceptable — `import { x } from './company.model'`.
- **Deep `../..` climbing is forbidden.**
- If the repo mirrors tsconfig aliases in its test-runner config (e.g. gc.platform mirrors `frontend/tsconfig.json` in `frontend/vitest.config.ts`), adding any NEW alias requires updating BOTH files.

## 1. Core Model

```typescript
// core/models/company.model.ts

export type Company = {
  id: string;
  code: string | null;
  companyName: string | null;
  sirenNumber: string | null;
  email: string | null;
};

export type CompanyFilters = {
  searchTerm?: string;
  page?: number;
  pageSize?: number;
};
```

Rules: `type` or `interface`, optional `?:` props, group by entity, never `any`.

## 2. Core Port

```typescript
// core/ports/get-companies.port.ts
import { Observable } from 'rxjs';
import { Company } from '../models';

export abstract class GetCompaniesPort {
  abstract getAll(): Observable<Company[]>;
}
```

Rules: `abstract class`, `Observable<T>` returns, `Port` suffix, one per operation (ISP), ZERO infrastructure imports.

## 3. Core Rules

```typescript
// core/rules/company-fields.rule.ts

export const COMPANY_FIELD_MAX_LENGTHS = {
  companyName: 100,
  email: 100,
} as const;

export function isValidCompanyCode(code: string): boolean {
  return /^[A-Z0-9]{3,10}$/.test(code);
}
```

Rules: pure functions, `as const` for constants, zero framework deps.

## 4. Core Mappers

```typescript
// core/mappers/enterprise-mapper.ts

export function mapEnterpriseToCompany(enterprise: Enterprise): Partial<Company> {
  return {
    companyName: enterprise.nom_raison_sociale,
    email: enterprise.email || undefined,
  };
}
```

Rules: pure `mapXToY` naming, `Partial<T>` for optional fields, null-safe.

## 5. Use Case

```typescript
// application/use-cases/get-companies.use-case.ts

@Injectable()
export class GetCompaniesUseCase {
  private readonly getCompanies = inject(GetCompaniesPort);

  execute(): Observable<Company[]> {
    return this.getCompanies.getAll();
  }
}
```

Rules: `@Injectable()` (no `providedIn`), inject ports via `inject()`, single responsibility.

## 6. Store

```typescript
// application/store/companies.store.ts
import { Store } from 'flurryx';
import { Company } from '../../core/models';

type CompaniesStoreConfig = {
  COMPANIES: Company[];
};

export const CompaniesStore = Store.for<CompaniesStoreConfig>().build();
```

Rules: `Store.for<Config>().build()`, `UPPER_SNAKE_CASE` keys, `providedIn: 'root'` by default. Full API: [[flurryx]].

## 7. Facade

```typescript
// application/facades/companies.facade.ts
import { inject, Injectable } from '@angular/core';
import { SkipIfCached, Loading, syncToStore } from 'flurryx';

@Injectable()
export class CompaniesFacade {
  readonly store = inject(CompaniesStore);
  private readonly getCompaniesUseCase = inject(GetCompaniesUseCase);

  getAll() {
    return this.store.get('COMPANIES');
  }

  @SkipIfCached('COMPANIES', (i: CompaniesFacade) => i.store)
  @Loading('COMPANIES', (i: CompaniesFacade) => i.store)
  loadAll(): void {
    this.getCompaniesUseCase
      .execute()
      .pipe(syncToStore(this.store, 'COMPANIES'))
      .subscribe();
  }

  clear(): void {
    this.store.clear('COMPANIES');
  }
}
```

Rules: `store` MUST be `public readonly` (decorator access). `@SkipIfCached` outermost, `@Loading` beneath. `syncToStore` bridges Observable → store.

## 8. Infrastructure Adapter

```typescript
// infrastructure/adapters/get-companies.adapter.ts

@Injectable()
export class GetCompaniesAdapter implements GetCompaniesPort {
  private readonly api = inject(CompaniesEndpoint);

  getAll(): Observable<Company[]> {
    return this.api
      .getAll()
      .pipe(map((responses) => responses.map(this.mapToCompany)));
  }

  private mapToCompany(response: CompanyResponse): Company {
    const { companyCode, ...rest } = response;
    return { ...rest, code: companyCode };
  }
}
```

Rules: `implements` port, inject endpoint, transform DTOs to domain models (ACL boundary).

## 9. API Endpoint

```typescript
// infrastructure/api/endpoints/companies.endpoint.ts

@Injectable()
export class CompaniesEndpoint {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = 'companies/v1';

  getAll(): Observable<CompanyResponse[]> {
    return this.http.get<CompanyResponse[]>(this.baseUrl);
  }

  getById(id: string): Observable<CompanyResponse> {
    const url = UrlBuilder.create(this.baseUrl).withRouteParam(id).build();
    return this.http.get<CompanyResponse>(url);
  }
}
```

Utilities: `UrlBuilder.create(base).withRouteParam(p).withQueryParam(k, v).build()` and `PaginatedRequestBuilder.forResponse<T, F>(filters).with(fetchFn).getAll()`.

## 10. Infrastructure Providers

```typescript
// infrastructure/companies-infrastructure.providers.ts

export function companiesInfrastructureProviders(): Provider[] {
  return [
    CompaniesEndpoint,
    GetCompaniesAdapter,
    { provide: GetCompaniesPort, useClass: GetCompaniesAdapter },
  ];
}
```

## 11. Service Providers (Module Self-Registration)

```typescript
// companies-service.providers.ts

export function companiesServicesProviders(): Provider[] {
  return [
    CompaniesFacade,
    GetCompaniesUseCase,
    ...companiesInfrastructureProviders(),
    ...contextProvidersFor([AppContext.ORDERS]),
  ];
}
```

This is the IModule equivalent — Angular has no reflection DI discovery; the aggregator fn + `loadChildren` IS the self-registration mechanism.

## 12. Routes

```typescript
// routes.ts

export const ROUTES: Routes = [
  { path: '', redirectTo: 'list', pathMatch: 'full' },
  {
    path: 'list',
    loadComponent: () =>
      import('./presentation/list/companies-list.component').then(
        (m) => m.CompaniesListComponent
      ),
    providers: [companiesServicesProviders()],
  },
  {
    path: ':id/details',
    loadComponent: () =>
      import('./presentation/details/company-details.component').then(
        (m) => m.CompanyDetailsComponent
      ),
    providers: [companiesServicesProviders()],
  },
];
```

Rules: lazy `loadComponent`, providers at route level (route-scoped → disposed on leave).

## 13. Public API (Sync Contract)

```typescript
// public-api.ts

export { type Company } from './core/models';
export { GetCompaniesPort } from './core/ports';
export { companiesServicesProviders } from './companies-service.providers';
export { companiesInfrastructureProviders } from './infrastructure/companies-infrastructure.providers';
```

## 14. Integration API (Reactive Contract)

```typescript
// integration-api.ts

export { CompaniesStore } from './application/store';
```

## 15. Standalone Component

```typescript
// presentation/list/companies-list.component.ts

@Component({
  selector: 'app-companies-list',
  templateUrl: './companies-list.component.html',
  styleUrls: ['./companies-list.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
})
export class CompaniesListComponent {
  private readonly facade = inject(CompaniesFacade);

  readonly state = this.facade.getAll();
  readonly companies = computed(() => this.state().data ?? []);
  readonly isLoading = computed(() => this.state().isLoading ?? false);

  constructor() {
    this.facade.loadAll();
  }
}
```

Rules: `OnPush`, `inject()` only, facade-only injection, `computed()` for derived UI, external `templateUrl` (never inline `template:`).

### Facade-First UI Pattern

1. Inject facade, not use case
2. Read `computed()` signals from `facade.getX()`
3. Keep event handlers thin — delegate to facade
4. No business rules in components or templates

Data flow:
```
Component triggers facade.loadAll()
  → Facade: @SkipIfCached → @Loading → useCase.execute().pipe(syncToStore)
    → Store updates ResourceState<T> signal
      → Component re-renders via computed()
```
