---
name: flurryx
description: Signal-first reactive state management for Angular. Bridge RxJS streams into cache-aware stores, keyed resources, mirrored state, and replayable history. Use when generating or modifying Angular code that uses flurryx for state management, or when scaffolding new feature modules that follow the flurryx facade pattern.
---

# flurryx

Signal-first reactive state management for Angular.

## When to Activate

- Creating or updating Angular state using `Store`, `syncToStore`, or `syncToKeyedStore`
- Adding or refactoring facades, services, or other state orchestration layers that expose flurryx-backed signals
- Generating feature modules that use flurryx for async state, caching, or keyed resources
- Modeling per-entity caches with `KeyedResourceData<TKey, TValue>`
- Wiring mirrored state with `mirror`, `mirrorSelf`, `mirrorKeyed`, `mirrorKey`, or `collectKeyed`
- Adding message-channel persistence, time travel, replay, or dead-letter recovery
- Reviewing AI-generated Angular code for flurryx correctness

## Library Anchors (Verify Before Coding)

Before writing code, verify these anchors exist in the active branch:

| Anchor            | What to look for                                                     |
| ----------------- | -------------------------------------------------------------------- |
| Store builder     | `Store.for<Config>().build()` or fluent `Store.resource(...).as<>()` |
| Resource wrappers | `ResourceState<T>` and `KeyedResourceData<TKey, TValue>`             |
| Rx bridge         | `syncToStore` and `syncToKeyedStore`                                 |
| Decorators        | `@SkipIfCached` and `@Loading`                                       |

If one or more anchors are missing:

- Do not invent new flurryx APIs
- Prefer confirmed imports from `flurryx` and `flurryx/http`
- Call out the mismatch clearly in the final message

## Hard Rules

- Never use `any`
- Never let components subscribe to flurryx loading flows; components read signals, facades own writes and subscriptions
- Prefer the interface-based builder: `Store.for<Config>().build()`
- Use `UPPER_SNAKE_CASE` store keys such as `TASKS`, `TASK_DETAIL`, `TASK_CREATION`
- Use `@SkipIfCached` only when the resource is intentionally cacheable; if the flow must always refetch, do not use it
- Keep `@SkipIfCached` outermost and `@Loading` directly beneath it
- Use `syncToKeyedStore` for keyed resources instead of hand-rolled `Record` updates
- Prefer importing application-facing APIs from `flurryx`; use `flurryx/http` only for `httpErrorNormalizer`
- Never subclass `BaseStore` directly unless the codebase already has an established custom-store pattern

## Architecture Overview

```text
UI layer --> flurryx orchestration layer --> async/data layer
```

- flurryx is architecture-agnostic and does not require Clean Architecture, hexagonal layering, or a specific folder structure
- The only requirement is a clear boundary where async work produces `Observable` values and flurryx syncs them into signal-backed store state
- In many apps that boundary is a facade; in others it may be a service, feature store wrapper, or controller-like class

## Recommended Architecture

- If the codebase already uses facades, keep flurryx orchestration in facades
- If the codebase uses plain Angular services, keep flurryx orchestration in services
- If the codebase uses Clean Architecture or ports/adapters, flurryx fits naturally in that structure
- Prefer matching the host application's existing architecture instead of forcing Clean Architecture or ports/adapters if they are not already present

## Core Flow

```text
Observable response -> syncToStore / syncToKeyedStore -> Store signal -> Template
```

flurryx keeps async work in RxJS and state consumption in Angular signals.

## Import Conventions

Prefer these imports in application code:

```typescript
import {
  Store,
  syncToStore,
  syncToKeyedStore,
  SkipIfCached,
  Loading,
} from "flurryx";
import type { KeyedResourceData, ResourceState } from "flurryx";
import { httpErrorNormalizer } from "flurryx/http";
```

- Use `flurryx` for the main public API
- Use `flurryx/http` only when handling Angular `HttpErrorResponse`
- Avoid direct `@flurryx/core`, `@flurryx/store`, or `@flurryx/rx` imports unless the codebase already depends on those subpackages explicitly

## Primary Patterns

### Store Definition

Prefer the interface-based builder for new code:

```typescript
import { Store } from "flurryx";

interface ProductStoreConfig {
  LIST: Product[];
  DETAIL: Product;
}

export const ProductStore = Store.for<ProductStoreConfig>().build();
```

- Name config interfaces as `<Feature>StoreConfig`
- Name store tokens as `<Feature>Store`
- Model each slot as the raw data type; flurryx wraps it in `ResourceState<T>`

Use the fluent builder only when keys are defined inline at runtime:

```typescript
export const ProductStore = Store.resource("LIST")
  .as<Product[]>()
  .resource("DETAIL")
  .as<Product>()
  .build();
```

### Facade Pattern

When the application uses facades, facades are the public API for components:

```typescript
import { Injectable, inject } from "@angular/core";
import { syncToStore, SkipIfCached, Loading } from "flurryx";

@Injectable()
export class ProductFacade {
  private readonly getProductsUseCase = inject(GetProductsUseCase);
  readonly store = inject(ProductStore);

  getProducts() {
    return this.store.get("LIST");
  }

  @SkipIfCached("LIST", (i: ProductFacade) => i.store)
  @Loading("LIST", (i: ProductFacade) => i.store)
  loadProducts() {
    this.getProductsUseCase
      .execute()
      .pipe(syncToStore(this.store, "LIST"))
      .subscribe();
  }
}
```

- Expose read access through facade methods returning store signals
- Keep `store` public and readonly so decorators can access it safely
- Subscribe inside the facade, not in the component

### Service-Led Pattern

When the application does not use facades, the same orchestration can live in a service:

```typescript
import { Injectable, inject } from "@angular/core";
import { syncToStore, SkipIfCached, Loading } from "flurryx";

@Injectable({ providedIn: "root" })
export class ProductStateService {
  private readonly api = inject(ProductApi);
  readonly store = inject(ProductStore);

  getProducts() {
    return this.store.get("LIST");
  }

  @SkipIfCached("LIST", (i: ProductStateService) => i.store)
  @Loading("LIST", (i: ProductStateService) => i.store)
  loadProducts() {
    this.api.getProducts().pipe(syncToStore(this.store, "LIST")).subscribe();
  }
}
```

- flurryx does not require a use-case layer
- Keep the same separation of concerns: components read signals, orchestration owns writes, async code stays out of templates

### Component Pattern

```typescript
import { Component, computed, inject } from "@angular/core";

@Component({
  template: `
    @if (productsState().isLoading) {
    <app-spinner />
    }
  `,
})
export class ProductListComponent {
  private readonly facade = inject(ProductFacade);
  readonly productsState = this.facade.getProducts();
  readonly products = computed(() => this.productsState().data ?? []);

  constructor() {
    this.facade.loadProducts();
  }
}
```

- Components inject the app's orchestration boundary, typically a facade or service, not raw async dependencies or stores for writes
- Read `state().data`, `state().isLoading`, `state().status`, and `state().errors`
- Prefer `computed()` for derived UI state

### Use Case Pattern

If the application uses Clean Architecture or similar layering, a use-case layer works well with flurryx:

```typescript
import { Injectable, inject } from "@angular/core";

@Injectable()
export class GetProductsUseCase {
  private readonly getProductsPort = inject(GetProductsPort);

  execute() {
    return this.getProductsPort.execute();
  }
}
```

- Keep each use case narrowly scoped
- Return `Observable<T>` from use cases
- Put orchestration in facades or services, not components

### Keyed Resource Pattern

Use keyed resources for per-entity caching:

```typescript
import { Store } from "flurryx";
import type { KeyedResourceData } from "flurryx";

interface InvoiceStoreConfig {
  ITEMS: KeyedResourceData<string, Invoice>;
}

export const InvoiceStore = Store.for<InvoiceStoreConfig>().build();
```

```typescript
@SkipIfCached('ITEMS', (i: InvoiceFacade) => i.store)
@Loading('ITEMS', (i: InvoiceFacade) => i.store)
loadInvoice(id: string) {
  this.getInvoiceUseCase.execute(id).pipe(syncToKeyedStore(this.store, 'ITEMS', id)).subscribe();
}
```

- When the first method argument is a `string` or `number`, decorators auto-detect it as the keyed resource id
- Read keyed values from `state().data?.entities[id]`, `isLoading[id]`, `status[id]`, and `errors[id]`

### Mirroring and Aggregation

Use mirroring when one store should reflect another store's state:

```typescript
export const SessionStore = Store.for<SessionStoreConfig>()
  .mirror(CustomerStore, "CUSTOMERS")
  .mirrorSelf("CUSTOMER_DETAILS", "CUSTOMER_SNAPSHOT")
  .build();
```

- Use `mirror` for direct slot-to-slot mirroring across stores
- Use `mirrorSelf` for aliasing a slot within the same store
- Use `mirrorKeyed`, `mirrorKey`, or `collectKeyed` when aggregating individual resources into keyed caches

### Message Channels, History, and Recovery

flurryx supports persistence and recovery through message channels and store history.

```typescript
store.undo();
store.redo();
store.restoreStoreAt(0);
store.replay(12);
store.replayDeadLetters();
```

- Default channel is in-memory
- Use `createLocalStorageStoreMessageChannel()` or `createSessionStorageStoreMessageChannel()` when persistence matters
- Use `createCompositeStoreMessageChannel()` when you need fan-out writes

## Decorator Rules

`@SkipIfCached` must be outermost so it can short-circuit the call before loading state changes:

```typescript
@SkipIfCached('LIST', (i: ProductFacade) => i.store)
@Loading('LIST', (i: ProductFacade) => i.store)
loadProducts() {
  this.getProductsUseCase.execute().pipe(syncToStore(this.store, 'LIST')).subscribe();
}
```

Use `@SkipIfCached` only for resources where cache hits are part of the intended behavior.

- If the user action or screen must always fetch fresh data, do not add `@SkipIfCached`
- If caching is optional or unclear, default to not using `@SkipIfCached`
- Applying `@SkipIfCached` to non-cacheable flows can suppress required requests and create confusing stale-state behavior
- Putting `@Loading` above `@SkipIfCached` can trigger incorrect loading transitions and may lead to endless loading loops

Decorator arguments:

```typescript
@SkipIfCached(
  'LIST',
  (i) => i.store,
  false,
  CACHE_NO_TIMEOUT,
)
```

- Third argument: set to `true` only when the decorated method returns an `Observable`
- Fourth argument: cache TTL in milliseconds; defaults to `DEFAULT_CACHE_TTL_MS`

## Error Handling and Cache Invalidation

- Use `defaultErrorNormalizer` for general errors
- Use `httpErrorNormalizer` for Angular HTTP errors
- Use `store.clear('KEY')` to invalidate a slot
- Use `store.clearKeyedOne('KEY', id)` to invalidate one keyed entity
- Use `store.clearAll()` for one store
- Use `clearAllStores()` for global reset flows such as logout or tenant switch

## Anti-Patterns

- Do not subscribe in components for flurryx-backed fetches
- Do not mutate store state directly from components
- Do not inject `HttpClient` into components when the flow belongs in a facade or adapter
- Do not place backend DTOs directly into presentation models when a mapper already exists
- Do not add `@SkipIfCached` unless the resource is intentionally cacheable
- Do not put `@Loading` above `@SkipIfCached`
- Do not use `BehaviorSubject` where a flurryx store slot should own the state
- Do not bypass `syncToStore` or `syncToKeyedStore` with custom loading/error plumbing unless the codebase already has a justified exception

## Quick Reference

| Task                  | Preferred API                                                      |
| --------------------- | ------------------------------------------------------------------ |
| Define a store        | `Store.for<Config>().build()`                                      |
| Read a slot           | `store.get('LIST')`                                                |
| Sync one resource     | `syncToStore(this.store, 'LIST')`                                  |
| Sync a keyed resource | `syncToKeyedStore(this.store, 'ITEMS', id)`                        |
| Skip cache hits       | `@SkipIfCached('LIST', (i) => i.store)`                            |
| Set loading           | `@Loading('LIST', (i) => i.store)`                                 |
| Mirror state          | `mirror`, `mirrorSelf`, `mirrorKeyed`, `mirrorKey`, `collectKeyed` |
| Clear one slot        | `store.clear('LIST')`                                              |
| Clear all stores      | `clearAllStores()`                                                 |
| Recover history       | `undo`, `redo`, `restoreStoreAt`, `replay`, `replayDeadLetters`    |
