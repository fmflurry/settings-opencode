---
name: angular-clean-arch-ddd
description: Build and extend Angular 18+ standalone features using Clean Architecture with DDD layering (presentation/application/domain/infrastructure), custom signal-based stores, facade pattern, and ports/adapters dependency inversion.
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

## Architecture Overview

```text
src/app/<feature-area>/
├── <domain>/
│   ├── application/                    # Application layer (orchestration)
│   │   ├── facades/                    # Public API for components
│   │   │   ├── <domain>.facade.ts
│   │   │   ├── <domain>.facade.spec.ts
│   │   │   └── index.ts
│   │   ├── use-cases/                  # Single-responsibility business operations
│   │   │   ├── <verb>-<noun>.use-case.ts
│   │   │   └── index.ts
│   │   └── store/                      # Signal-based state management
│   │       ├── <domain>.store.ts
│   │       └── index.ts
│   │
│   ├── domain/                         # Domain layer (pure business logic, ZERO infra deps)
│   │   ├── models/                     # Immutable TypeScript types
│   │   │   ├── <entity>.model.ts
│   │   │   └── index.ts
│   │   ├── ports/                      # Abstract classes (dependency inversion)
│   │   │   ├── <verb>-<noun>.port.ts
│   │   │   └── index.ts
│   │   ├── rules/                      # Pure validation functions & constants
│   │   │   └── <domain>-fields.rule.ts
│   │   └── mappers/                    # Pure data transformation functions
│   │       └── <source>-mapper.ts
│   │
│   ├── infrastructure/                 # Infrastructure layer (external concerns)
│   │   ├── adapter/                    # Port implementations
│   │   │   ├── <verb>-<noun>.adapter.ts
│   │   │   └── index.ts
│   │   ├── api/
│   │   │   ├── endpoints/              # HTTP client wrappers
│   │   │   │   └── <domain>.endpoint.ts
│   │   │   ├── request/                # API request DTOs
│   │   │   └── response/               # API response DTOs
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

### ResourceState<T> — Universal State Shape

```typescript
// core/shared/store/resource-state.model.ts
interface ResourceState<T> {
  isLoading?: boolean;
  data?: T;
  status?: 'Success' | 'Error';
  errors?: Array<{ code: string; message: string }>;
}
```

Every store key wraps its data in `ResourceState<T>`. This provides consistent loading, error, and success tracking across the entire application.

### Defining a Store

```typescript
// application/store/<domain>.store.ts

export enum CustomersStoreEnum {
  CUSTOMERS = 'CUSTOMERS',
  CUSTOMER_DETAILS = 'CUSTOMER_DETAILS',
  CUSTOMER_CREATION = 'CUSTOMER_CREATION',
}

export type CustomersState = {
  [CustomersStoreEnum.CUSTOMERS]: ResourceState<Customer[]>;
  [CustomersStoreEnum.CUSTOMER_DETAILS]: ResourceState<Customer>;
  [CustomersStoreEnum.CUSTOMER_CREATION]: ResourceState<string>;
};

@Injectable({ providedIn: 'root' })
export class CustomersStore extends BaseStore<
  typeof CustomersStoreEnum,
  CustomersState
> {
  constructor() {
    super(CustomersStoreEnum);
  }
}
```

### BaseStore API

```typescript
// Reading state (returns WritableSignal)
store.get(StoreEnum.KEY)           // WritableSignal<ResourceState<T>>

// Updating state (immutable merge)
store.update(key, { data, isLoading: false, status: 'Success' })

// Loading lifecycle
store.startLoading(key)            // Sets isLoading: true, clears errors/status
store.stopLoading(key)             // Sets isLoading: false

// Clearing state
store.clear(key)                   // Resets to { data: undefined, isLoading: false, ... }
store.clearAll()                   // Clears all keys

// Reactive hooks (returns unsubscribe function)
const unsub = store.onUpdate(key, (nextState, previousState) => { ... });
```

### KeyedResourceData — Managing Collections by ID

For cases where you need per-entity state (loading, errors) within a collection:

```typescript
import { KeyedResourceData, createKeyedResourceData } from '<path-to>/core/shared/store';

// Store definition
export type OrdersState = {
  [OrdersStoreEnum.ORDER_DETAILS]: ResourceState<
    KeyedResourceData<string, OrderDetails>
  >;
};

// Initialize in constructor
constructor() {
  super(OrdersStoreEnum);
  this.update(OrdersStoreEnum.ORDER_DETAILS, {
    data: createKeyedResourceData<string, OrderDetails>(),
    isLoading: false,
    status: undefined,
    errors: undefined,
  });
}

// Per-entity operations
store.updateKeyedOne(key, entityId, entityData)
store.clearKeyedOne(key, entityId)
store.startKeyedLoading(key, entityId)
```

### handleStoreLoading Operator

RxJS operator that bridges Observable emissions to store state updates:

```typescript
import { handleStoreLoading } from '<path-to>/core/shared/store/operators';

// In a facade method:
this.getCustomersUseCase
  .for(filters)
  .pipe(
    handleStoreLoading(this.store, CustomersStoreEnum.CUSTOMERS, {
      completeOnFirstEmission: true,     // Default: auto-complete after first value
      callbackAfterComplete: () => {},   // Optional finalize callback
    })
  )
  .subscribe();
```

**Behavior:**
- On `next`: updates store with `{ data, isLoading: false, status: 'Success' }`
- On `error`: updates store with `{ data: undefined, isLoading: false, status: 'Error', errors: [...] }`
- Normalizes HttpErrorResponse errors to `Array<{ code, message }>`

### handleKeyedStoreLoading Operator

Same pattern for keyed resources:

```typescript
import { handleKeyedStoreLoading } from '<path-to>/core/shared/store/operators';

this.getOrderDetailsUseCase
  .for(orderId)
  .pipe(
    handleKeyedStoreLoading(
      this.store,
      OrdersStoreEnum.ORDER_DETAILS,
      orderId,
      { mapResponse: (response) => response.details }  // Optional transform
    )
  )
  .subscribe();
```

### Store Decorators

#### @AutoStartLoading — Auto-set loading state before method execution

```typescript
import { AutoStartLoading } from '<path-to>/core/shared/store/decorators';

@AutoStartLoading(StoreEnum.KEY, (instance) => instance.store)
loadData(filters: Filters) {
  // store.startLoading(key) is called automatically before this executes
  // For keyed resources, detects if first arg is string/number and calls startKeyedLoading
}
```

#### @AppCache — Skip redundant API calls

```typescript
import { AppCache } from '<path-to>/core/shared/store/decorators';

@AppCache(StoreEnum.KEY, (instance) => instance.store)
@AutoStartLoading(StoreEnum.KEY, (instance) => instance.store)
loadData(filters: Filters) {
  // Skipped if store already has status='Success' and data is present
  // Also deduplicates inflight requests (skips if isLoading=true)
}

// With options:
@AppCache(
  StoreEnum.KEY,
  (instance) => instance.store,
  true,     // returnObservable: return cached data as Observable
  30000     // timeoutMs: cache expiration (default 5 min)
)
```

**Stack order matters:** `@AppCache` ABOVE `@AutoStartLoading`.

## Layer Implementation Templates

### 1. Domain Model

```typescript
// domain/models/customer.model.ts

export type Customer = {
  id: string;
  code: string;
  lastName?: string;
  firstName?: string;
  email?: string;
  // Use immutable type definitions, never classes
};

export type CustomerFilters = {
  searchTerm?: string;
  page?: number;
  pageSize?: number;
};
```

**Rules:**
- Use `type` (not `interface` or `class`) for domain models
- Properties optional with `?:` when appropriate
- Never use `any` — use `unknown` if truly unknown
- Group related types in the same file or split by entity

### 2. Domain Port

```typescript
// domain/ports/get-customers.port.ts

export abstract class GetCustomersPort {
  abstract for(filters?: CustomerFilters): Observable<Customer[]>;
}
```

**Rules:**
- Always `abstract class` with `abstract` methods
- Methods return `Observable<T>` for async operations
- Named with `Port` suffix
- One port per operation (ISP)
- Located in domain layer — no infrastructure imports

### 3. Domain Rules

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

**Rules:**
- Pure functions, no side effects
- Constants with `as const` for type narrowing
- No dependencies on any framework or service

### 4. Domain Mappers

```typescript
// domain/mappers/enterprise-mapper.ts

export function mapEnterpriseToCusomer(
  enterprise: Enterprise
): Partial<Customer> {
  return {
    lastName: enterprise.nom_raison_sociale,
    // Handle null/undefined safely
    email: enterprise.email || undefined,
  };
}
```

**Rules:**
- Pure functions: `mapXToY` naming
- Return `Partial<T>` for optional fields
- Handle null/undefined safely

### 5. Use Case

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

**Rules:**
- `@Injectable()` — no `providedIn`
- Inject ports via `inject()`, never constructor params
- Lightweight wrappers — delegate to ports
- May compose multiple ports or add domain logic
- Single responsibility per use case

### 6. Facade

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

**Rules:**
- `@Injectable()` — no `providedIn`
- Inject store + use cases via `inject()`
- Getter methods expose store signals (no transformation)
- Action methods orchestrate use cases + store updates
- Use `@AppCache` + `@AutoStartLoading` decorators for loading/caching
- Use `handleStoreLoading` operator to bridge Observable to store

### 7. Infrastructure Adapter

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

**Rules:**
- `implements` the abstract Port
- Inject API endpoint service
- Transform API response DTOs to domain models
- Handle pagination, mapping, error normalization

### 8. API Endpoint

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

**Utilities:**
- `UrlBuilder.create(base).withRouteParam(p).withQueryParam(k, v).build()` — fluent URL builder
- `PaginatedRequestBuilder.forResponse<T, F>(filters).with(fetchFn).getAll()` — parallel pagination

### 9. Infrastructure Providers

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

### 10. Service Providers (Domain Entry Point)

```typescript
// <domain>-service.providers.ts

export function customersServicesProviders(): Provider[] {
  return [
    // Facades
    CustomersFacade,
    CustomerDetailsFacade,

    // Use Cases
    GetCustomersUseCase,
    SearchCustomersUseCase,
    CreateCustomerUseCase,

    // Infrastructure (ports -> adapters)
    ...customersInfrastructureProviders(),

    // Cross-domain context (shared state from other domains)
    ...contextProvidersFor([
      AppContext.ORDERS,
      AppContext.MARKETING_URL_FOR_USER,
    ]),
  ];
}
```

### 11. Routes

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

**Rules:**
- Lazy load with `loadComponent`
- Providers scoped to route level (not global)
- Guards as functional factories: `canLoadFeature()`, `isDeviceAllowed()`
- Child routes for nested views

### 12. Public API (Barrel Export)

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

### 13. Standalone Component

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
  // Inject facade (NEVER use cases or stores)
  private readonly customersFacade = inject(CustomersFacade);
  private readonly router = inject(Router);

  // Reactive signals
  readonly searchTerm = signal<string>('');
  readonly filters = computed<CustomerFilters>(() => ({
    searchTerm: this.searchTerm(),
  }));

  // Store-backed signals via facade
  readonly allCustomers = this.customersFacade.getAllCustomers();
  readonly customers = computed(() => this.allCustomers().data ?? []);
  readonly isLoading = computed(() => this.allCustomers().isLoading ?? false);

  // Side effects trigger data loading
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

**Component Rules:**
- `standalone: true` (implicit in Angular 18)
- `ChangeDetectionStrategy.OnPush` always
- `inject()` for all dependencies, never constructor params
- Inject facades only, never use cases or stores
- Use `signal()`, `computed()`, `effect()` for reactivity
- Use `input()` / `input.required()` for inputs, `output()` for outputs
- Use a consistent project-specific selector prefix (e.g., `app-`, `my-`)
- SCSS for all styles

### Facade-First UI Pattern

For every feature page/component, apply this pattern strictly:

1. **Inject facade, not use case** — the facade is the only bridge to domain logic
2. **Expose view model signals from facade/store** — components read `computed()` signals derived from `facade.getX()`
3. **Keep event handlers thin** — delegate all logic to facade methods, never compute in the handler
4. **No business rules in components or templates** — no filtering, sorting, or validation logic in component classes

**Data flow:**
```
Component triggers facade action (e.g., loadCustomers)
  → Facade coordinates use case + store updates
    → Store handles state transitions + loading lifecycle
      → Component renders read-only signal streams
```

## Cross-Domain Communication (Context Registry)

### Registering a Context

```typescript
// src/app/core/context/context.registry.ts

export enum AppContext {
  LICENSE = 'license',
  CUSTOMERS = 'customers',
  ORDERS = 'orders',
  ARTICLES = 'articles',
  // Add new contexts here
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

### Creating Context Providers

```typescript
// src/app/core/context/customers-context.providers.ts

export const CUSTOMERS_CONTEXT_PROVIDERS: Provider[] = [
  ...customersInfrastructureProviders(),    // From the domain's public-api
  GetCustomersProxy,                        // Optional proxy with caching
  { provide: GetCustomersPort, useClass: GetCustomersProxy },
];
```

### Using Context in Service Providers

```typescript
// In another domain's service providers:
export function ordersServicesProviders(): Provider[] {
  return [
    OrdersFacade,
    GetOrdersUseCase,
    ...ordersInfrastructureProviders(),
    // Pull in customer data for this domain
    ...contextProvidersFor([AppContext.CUSTOMERS]),
  ];
}
```

## Testing Patterns

Use the project's chosen test framework and testing utilities. The examples below show the **what to test**, not the specific framework API.

### Facade Test — Mock Store + Use Cases

```typescript
describe('CustomersFacade', () => {
  // Set up the facade with mocked store and use cases
  // Mock store.get() to return a signal with ResourceState
  // Mock use case methods

  it('should return customers signal from store', () => {
    const result = facade.getAllCustomers();
    expect(store.get).toHaveBeenCalledWith(CustomersStoreEnum.CUSTOMERS);
    expect(result().data).toHaveLength(1);
  });

  it('should delegate loading to use case + store operator', () => {
    facade.loadAllCustomers({ searchTerm: 'test' });
    expect(searchUseCase.by).toHaveBeenCalledWith({ searchTerm: 'test' });
  });
});
```

### Component Test — Mock Facade Only

```typescript
describe('CustomersListComponent', () => {
  // Provide a mocked facade returning signals with ResourceState
  // Components should ONLY depend on facade — no store or use case mocking needed

  it('should call facade to load customers', () => {
    expect(mockFacade.loadAllCustomers).toHaveBeenCalled();
  });

  it('should render data from facade signals', () => {
    // Verify the component reads facade signals correctly
  });
});
```

### Use Case Test — Mock Ports

```typescript
describe('GetCustomersUseCase', () => {
  // Mock the port, inject into the use case

  it('should delegate to port', () => {
    const filters: CustomerFilters = { searchTerm: 'test' };
    mockPort.for.mockReturnValue(of([]));

    useCase.for(filters).subscribe((result) => {
      expect(result).toEqual([]);
    });

    expect(mockPort.for).toHaveBeenCalledWith(filters);
  });
});
```

### Testing Principles

- **Facade tests**: mock store + use cases, verify orchestration
- **Component tests**: mock facade only, verify rendering + event delegation
- **Use case tests**: mock ports, verify delegation + business logic composition
- **Adapter tests**: mock endpoints, verify DTO-to-model mapping
- Target **80%+ coverage**

## Naming Conventions

| Artifact                | Pattern                           | Example                              |
|-------------------------|-----------------------------------|--------------------------------------|
| Store class             | `<Domain>Store`                   | `CustomersStore`                     |
| Store enum              | `<Domain>StoreEnum`               | `CustomersStoreEnum`                 |
| Store state type        | `<Domain>State`                   | `CustomersState`                     |
| Facade                  | `<Domain>Facade`                  | `CustomersFacade`                    |
| Use case                | `<VerbNoun>UseCase`               | `GetCustomersUseCase`                |
| Port (abstract)         | `<VerbNoun>Port`                  | `GetCustomersPort`                   |
| Adapter                 | `<VerbNoun>Adapter`               | `GetCustomersAdapter`                |
| Endpoint                | `<Domain>Endpoint`                | `CustomersEndpoint`                  |
| Component               | `<prefix>-<feature>-<name>`       | `app-customers-list`                 |
| Service providers fn    | `<domain>ServicesProviders()`     | `customersServicesProviders()`       |
| Infra providers fn      | `<domain>InfrastructureProviders()` | `customersInfrastructureProviders()` |
| Context providers       | `<DOMAIN>_CONTEXT_PROVIDERS`      | `CUSTOMERS_CONTEXT_PROVIDERS`        |
| Route constants         | `routes.constants.ts`             | N/A                                  |
| Public API              | `public-api.ts`                   | N/A                                  |
| Spec files              | `<name>.spec.ts`                  | `customers.facade.spec.ts`           |
| Model types             | `<Entity>` (PascalCase type)      | `Customer`, `CustomerFilters`        |
| Business rules          | `<domain>-<concern>.rule.ts`      | `customer-fields.rule.ts`            |
| Mappers                 | `<source>-mapper.ts`              | `enterprise-mapper.ts`               |

## Implementation Playbook (Add a New Feature)

Follow these steps **in order**.

### 1. Define Domain Models

Create types in `domain/models/<entity>.model.ts`. Use `type`, not `interface` or `class`. Export from `domain/models/index.ts`.

### 2. Define Domain Ports

Create abstract classes in `domain/ports/<verb>-<noun>.port.ts`. Methods return `Observable<T>`. Export from `domain/ports/index.ts`.

### 3. Add Business Rules (If Needed)

Create pure functions in `domain/rules/`. Constants for validation, lookup tables for type-based logic.

### 4. Implement Infrastructure Adapter

Create `infrastructure/adapter/<verb>-<noun>.adapter.ts` implementing the port. Inject the API endpoint. Transform API responses to domain models.

### 5. Create API Endpoint

Create `infrastructure/api/endpoints/<domain>.endpoint.ts`. Use `HttpClient`, `UrlBuilder`, `PaginatedRequestBuilder`. Define request/response DTOs in `infrastructure/api/request/` and `infrastructure/api/response/`.

### 6. Register Infrastructure Providers

Create or update `infrastructure/<domain>-infrastructure.providers.ts`. Bind ports to adapters.

### 7. Create Use Case

Create `application/use-cases/<verb>-<noun>.use-case.ts`. Inject port via `inject()`. Delegate or compose business logic.

### 8. Define Store

Create `application/store/<domain>.store.ts`. Define enum, state type, and store class extending `BaseStore`. Initialize keyed resources in constructor if needed.

### 9. Create Facade

Create `application/facades/<domain>.facade.ts`. Inject store + use cases. Expose store signals via getter methods. Create action methods with `@AppCache`, `@AutoStartLoading`, and `handleStoreLoading`.

### 10. Create Service Providers

Create `<domain>-service.providers.ts`. Include all facades, use cases, infrastructure providers, and context providers.

### 11. Create Routes

Create `routes.ts` with lazy-loaded components and route-level providers.

### 12. Create Components

Standalone components in `presentation/`. Inject facades only. Use signals for reactivity. OnPush change detection.

### 13. Create Public API

Create `public-api.ts` exporting models, ports, adapters, store, and provider functions for cross-domain use.

### 14. Write Tests

- Facade tests: mock store + use cases
- Component tests: mock facade only
- Use case tests: mock ports
- Adapter tests: mock endpoints, verify DTO-to-model mapping
- Target 80%+ coverage

### 15. Register Context (If Cross-Domain)

If other domains need this domain's data:
1. Create context providers in `src/app/core/context/<domain>-context.providers.ts`
2. Add entry to `AppContext` enum
3. Add entry to `CONTEXT_REGISTRY`

## Mixed-to-Clean Refactor Workflow

When migrating a legacy/mixed module to Clean Architecture, follow these steps:

### 1. Analyze Current Module
- Locate domain rules buried in components or services
- Identify direct cross-domain couplings (imports from other domains)
- Map out NgRx actions/effects/reducers if present
- List BehaviorSubject-based state in services

### 2. Introduce Facade Boundary
- Create a facade class for the module
- Move orchestration logic from components into the facade
- Components should now only call facade methods

### 3. Extract Use Cases and Ports
- Move business rules from services to `application/use-cases/`
- Define abstract port classes in `domain/ports/` for external dependencies
- Keep use cases framework-agnostic

### 4. Isolate Infrastructure
- Create adapters in `infrastructure/` implementing the ports
- Move API calls from services to endpoint classes
- Create infrastructure providers binding ports to adapters

### 5. Align Store Patterns
- Replace NgRx stores or BehaviorSubject state with `BaseStore`
- Define typed enum + state type
- Use `handleStoreLoading` operator for async transitions
- Wire facades to use the new store

### 6. Replace Direct Domain Coupling
- Identify where one domain imports another's internals
- Create context providers and register in `ContextRegistry`
- Route all cross-domain interactions via `contextProvidersFor()`

### 7. Validate
- Run tests and build: `npm test && npm run build`
- Fix regressions
- Verify no legacy patterns remain in the migrated module

## Legacy Architecture (What NOT to Do)

The codebase has legacy modules using these patterns — do NOT replicate them:

| Legacy Pattern                        | New Pattern                                  |
|---------------------------------------|----------------------------------------------|
| NgRx actions/effects/reducers         | Custom BaseStore + handleStoreLoading        |
| `StoreModule.forFeature()`            | `BaseStore` with `providedIn: 'root'`        |
| Direct `Store.dispatch()` in components | Facade methods                             |
| Direct `Store.select()` in components | Facade getter returning store signal         |
| Services with BehaviorSubject state   | BaseStore with ResourceState                 |
| Constructor injection                 | `inject()` function                          |
| NgModules                             | Standalone components + route providers      |
| `@Input()` / `@Output()` decorators  | `input()` / `output()` signal functions      |

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

Run through this before marking any work complete:

- [ ] Components use facade only — no use case or store references in presentation layer
- [ ] No `any` introduced anywhere
- [ ] Use cases are not referenced from presentation layer
- [ ] Store transitions are typed and consistent (ResourceState<T>)
- [ ] Loading behavior uses shared operator patterns (handleStoreLoading / handleKeyedStoreLoading)
- [ ] Cross-domain communication uses registry contracts (contextProvidersFor)
- [ ] All event handlers are thin — logic delegated to facade
- [ ] Immutable updates throughout — no object mutation

## Expected Output Style for Agent Responses

When completing work on this codebase, include in your final message:

1. **What changed and why** — brief summary of modifications
2. **Which layer boundaries were enforced** — e.g., "presentation depends only on facade, domain has zero infra deps"
3. **Which files show facade/store/context integration** — key file paths demonstrating the patterns
4. **Any unresolved architecture mismatches** — if anchor files were missing or legacy patterns couldn't be fully migrated, report explicitly
