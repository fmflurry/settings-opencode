# Store System

## ResourceState<T> — Universal State Shape

```typescript
// core/shared/store/resource-state.model.ts
interface ResourceState<T> {
  isLoading?: boolean;
  data?: T;
  status?: 'Success' | 'Error';
  errors?: Array<{ code: string; message: string }>;
}
```

Every store key wraps its data in `ResourceState<T>` for consistent loading, error, and success tracking.

## Defining a Store

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

## BaseStore API

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

## KeyedResourceData — Managing Collections by ID

For per-entity state (loading, errors) within a collection:

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

## handleStoreLoading Operator

Bridges Observable emissions to store state updates:

```typescript
import { handleStoreLoading } from '<path-to>/core/shared/store/operators';

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

## handleKeyedStoreLoading Operator

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

## Store Decorators

### @AutoStartLoading — Auto-set loading state before method execution

```typescript
import { AutoStartLoading } from '<path-to>/core/shared/store/decorators';

@AutoStartLoading(StoreEnum.KEY, (instance) => instance.store)
loadData(filters: Filters) {
  // store.startLoading(key) is called automatically before this executes
  // For keyed resources, detects if first arg is string/number and calls startKeyedLoading
}
```

### @AppCache — Skip redundant API calls

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
