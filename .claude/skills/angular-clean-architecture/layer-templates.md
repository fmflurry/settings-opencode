# Layer Implementation Templates

## 1. Domain Model

```typescript
// domain/models/customer.model.ts

export type Customer = {
  id: string;
  code: string;
  lastName?: string;
  firstName?: string;
  email?: string;
};

export type CustomerFilters = {
  searchTerm?: string;
  page?: number;
  pageSize?: number;
};
```

Rules: optional `?:` props, group by entity, never use `any`.

## 2. Domain Port

```typescript
// domain/ports/get-customers.port.ts

export abstract class GetCustomersPort {
  abstract for(filters?: CustomerFilters): Observable<Customer[]>;
}
```

Rules: `abstract class` with `abstract` methods, `Observable<T>` returns, `Port` suffix, one per operation (ISP), zero infrastructure imports.

## 3. Domain Rules

```typescript
// domain/rules/customer-fields.rule.ts

export const CUSTOMER_FIELD_MAX_LENGTHS = {
  firstName: 30,
  lastName: 40,
  email: 100,
} as const;

export function isValidCustomerCode(code: string): boolean {
  return /^[A-Z0-9]{3,10}$/.test(code);
}
```

Rules: pure functions, `as const` for constants, zero framework deps.

## 4. Domain Mappers

```typescript
// domain/mappers/enterprise-mapper.ts

export function mapEnterpriseToCustomer(
  enterprise: Enterprise
): Partial<Customer> {
  return {
    lastName: enterprise.nom_raison_sociale,
    email: enterprise.email || undefined,
  };
}
```

Rules: pure `mapXToY` naming, `Partial<T>` for optional fields, null-safe.

## 5. Use Case

```typescript
// application/use-cases/get-customers.use-case.ts

@Injectable()
export class GetCustomersUseCase {
  private readonly getCustomers = inject(GetCustomersPort);

  for(filters?: CustomerFilters): Observable<Customer[]> {
    return this.getCustomers.for(filters);
  }
}
```

Rules: `@Injectable()` (no `providedIn`), inject ports via `inject()`, single responsibility.

## 6. Facade

```typescript
// application/facades/customers.facade.ts

@Injectable()
export class CustomersFacade {
  private readonly store = inject(CustomersStore);
  private readonly getCustomersUseCase = inject(GetCustomersUseCase);
  private readonly searchCustomersUseCase = inject(SearchCustomersUseCase);

  // Expose store signals to components
  getAllCustomers() {
    return this.store.get(CustomersStoreEnum.CUSTOMERS);
  }

  getCustomerDetails() {
    return this.store.get(CustomersStoreEnum.CUSTOMER_DETAILS);
  }

  // Orchestrate loading with decorators + operators
  @AppCache(CustomersStoreEnum.CUSTOMERS, (instance) => instance.store)
  @AutoStartLoading(CustomersStoreEnum.CUSTOMERS, (instance) => instance.store)
  loadAllCustomers(filters?: CustomerFilters): void {
    this.searchCustomersUseCase
      .by(filters)
      .pipe(handleStoreLoading(this.store, CustomersStoreEnum.CUSTOMERS))
      .subscribe();
  }

  clearCustomers(): void {
    this.store.clear(CustomersStoreEnum.CUSTOMERS);
  }
}
```

Rules: `@Injectable()` (no `providedIn`), getters expose store signals, actions use `@AppCache` + `@AutoStartLoading` + `handleStoreLoading`.

## 7. Infrastructure Adapter

```typescript
// infrastructure/adapter/get-customers.adapter.ts

@Injectable()
export class GetCustomersAdapter implements GetCustomersPort {
  private readonly api = inject(CustomersEndpoint);

  for(filters?: CustomerFilters): Observable<Customer[]> {
    return this.api
      .getAll(filters)
      .pipe(map((response) => response.items));
  }
}
```

Rules: `implements` port, inject endpoint, transform DTOs to domain models.

## 8. API Endpoint

```typescript
// infrastructure/api/endpoints/customers.endpoint.ts

@Injectable()
export class CustomersEndpoint {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = 'third-parties/v1';

  getAll(filters?: CustomerFilters): Observable<AllCustomersResponse> {
    return PaginatedRequestBuilder.forResponse<AllCustomersResponse, CustomerFilters>(filters)
      .with(this.getPage)
      .getAll();
  }

  getById(id: string): Observable<CustomerResponse> {
    const url = UrlBuilder.create(this.baseUrl).withRouteParam(id).build();
    return this.http.get<CustomerResponse>(url);
  }

  create(request: CustomerRequest): Observable<string> {
    return this.http.post<string>(this.baseUrl, request);
  }

  private getPage = (page: number, pageSize: number, filters?: CustomerFilters): Observable<AllCustomersResponse> => {
    const url = UrlBuilder.create(this.baseUrl)
      .withQueryParam('page', page)
      .withQueryParam('pageSize', pageSize)
      .withQueryParam('search', filters?.searchTerm)
      .build();
    return this.http.get<AllCustomersResponse>(url);
  };
}
```

Utilities: `UrlBuilder.create(base).withRouteParam(p).withQueryParam(k, v).build()` and `PaginatedRequestBuilder.forResponse<T, F>(filters).with(fetchFn).getAll()`.

## 9. Infrastructure Providers

```typescript
// infrastructure/<domain>-infrastructure.providers.ts

export function customersInfrastructureProviders(): Provider[] {
  return [
    CustomersEndpoint,
    FamiliesEndpoint,
    { provide: GetCustomersPort, useClass: GetCustomersAdapter },
    { provide: SearchCustomersPort, useClass: SearchCustomersAdapter },
    { provide: CreateCustomerPort, useClass: CreateCustomerAdapter },
  ];
}
```

## 10. Service Providers (Domain Entry Point)

```typescript
// <domain>-service.providers.ts

export function customersServicesProviders(): Provider[] {
  return [
    CustomersFacade,
    CustomerDetailsFacade,
    GetCustomersUseCase,
    SearchCustomersUseCase,
    CreateCustomerUseCase,
    ...customersInfrastructureProviders(),
    ...contextProvidersFor([
      AppContext.ORDERS,
      AppContext.MARKETING_URL_FOR_USER,
    ]),
  ];
}
```

## 11. Routes

```typescript
// routes.ts

export const ROUTES: Routes = [
  {
    path: '',
    redirectTo: 'list',
    pathMatch: 'full',
  },
  {
    path: 'list',
    canMatch: [canLoadFeature(), isDeviceAllowed()],
    title: TitleKeyTab.CUSTOMERS,
    canActivate: [setHeaderTitleGuard(TitleKeyHeader.CUSTOMERS)],
    loadComponent: () =>
      import('./presentation/list/customers-list.component').then(
        (m) => m.CustomersListComponent
      ),
    providers: [customersServicesProviders()],
  },
  {
    path: ':id',
    providers: [customersServicesProviders()],
    children: [
      {
        path: 'details',
        title: TitleKeyTab.CUSTOMER_DETAILS,
        loadComponent: () =>
          import('./presentation/details/customer-details.component').then(
            (m) => m.CustomerDetailsComponent
          ),
      },
    ],
  },
];
```

Rules: lazy load with `loadComponent`, providers scoped to route level, functional guards, child routes for nested views.

## 12. Public API (Barrel Export)

```typescript
// public-api.ts

// Models
export { Customer, CustomerFilters } from './domain/models';

// Ports (for cross-domain adapter binding)
export { GetCustomersPort } from './domain/ports';

// Adapters (for context providers)
export { GetCustomersAdapter } from './infrastructure/adapter';

// Store
export { CustomersStore, CustomersStoreEnum } from './application/store';

// Providers
export { customersServicesProviders } from './<domain>-service.providers';
export { customersInfrastructureProviders } from './infrastructure/<domain>-infrastructure.providers';
```

## 13. Standalone Component

```typescript
// presentation/list/customers-list.component.ts

@Component({
  selector: '<prefix>-customers-list',
  templateUrl: './customers-list.component.html',
  styleUrls: ['./customers-list.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, /* your UI imports */],
})
export class CustomersListComponent {
  private readonly customersFacade = inject(CustomersFacade);
  private readonly router = inject(Router);

  readonly searchTerm = signal<string>('');
  readonly filters = computed<CustomerFilters>(() => ({
    searchTerm: this.searchTerm(),
  }));

  readonly allCustomers = this.customersFacade.getAllCustomers();
  readonly customers = computed(() => this.allCustomers().data ?? []);
  readonly isLoading = computed(() => this.allCustomers().isLoading ?? false);

  constructor() {
    effect(() => {
      this.customersFacade.loadAllCustomers(this.filters());
    });
  }

  onSearchChange(term: string): void {
    this.searchTerm.set(term);
  }
}
```

Rules: `OnPush` always, `inject()` for all deps, facade-only injection, `signal()`/`computed()`/`effect()` for reactivity, `input()`/`output()` for I/O, project-specific selector prefix, SCSS.

### Facade-First UI Pattern

1. **Inject facade, not use case** — the facade is the only bridge to domain logic
2. **Expose view model signals from facade/store** — components read `computed()` signals from `facade.getX()`
3. **Keep event handlers thin** — delegate all logic to facade methods
4. **No business rules in components or templates**

Data flow:
```
Component triggers facade action (e.g., loadCustomers)
  → Facade coordinates use case + store updates
    → Store handles state transitions + loading lifecycle
      → Component renders read-only signal streams
```
