---
name: flurryx
description: Signal-first reactive state management for Angular. Bridge RxJS streams into cache-aware stores, keyed resources, mirrored state, and replayable history. Use when generating or modifying Angular code that uses flurryx for state management, or when scaffolding new feature modules that follow the flurryx facade pattern.
---

# flurryx

Signal-first reactive state management for Angular. RxJS in, signals out.

## When to Activate

- Build/modify state with `Store`, `syncToStore`, `syncToKeyedStore`
- Add facades/services exposing flurryx-backed signals
- Scaffold feature modules using flurryx for async state, caching, keyed resources
- Per-entity caches via `KeyedResourceData<TKey, TValue>`
- Mirroring/derivation: `mirror`, `mirrorSelf`, `derive`, `deriveSelf`, `mirrorKeyed`, `mirrorKey`, `deriveKey`, `collectKeyed`
- Channel persistence, history, replay, dead-letter recovery
- Reviewing AI-generated Angular code for flurryx correctness

## Imports

```ts
// main API
import {
  Store, BaseStore, LazyStore,
  syncToStore, syncToKeyedStore,
  SkipIfCached, Loading,
  clearAllStores,
  mirrorKey, deriveKey, collectKeyed,
  cloneValue, createSnapshotRestorePatch,
  createInMemoryStoreMessageChannel,
  createStorageStoreMessageChannel,
  createLocalStorageStoreMessageChannel,
  createSessionStorageStoreMessageChannel,
  createCompositeStoreMessageChannel,
  isKeyedResourceData, createKeyedResourceData, isAnyKeyLoading,
  CACHE_NO_TIMEOUT, DEFAULT_CACHE_TTL_MS,
  defaultErrorNormalizer,
} from 'flurryx';

import type {
  ResourceState, StoreEnum, ResourceStatus, ResourceErrors,
  KeyedResourceData, KeyedResourceKey,
  StoreSignal, KeyedStoreSignal, KeyedResourceState, ValueOrSignal,
  StoreOptions, StoreCacheInvalidateEvent,
  MirrorOptions, DeriveOptions, CollectKeyedOptions,
  SyncToStoreOptions, SyncToKeyedStoreOptions, ErrorNormalizer,
  // history
  StoreHistory, StoreHistoryEntry,
  StoreDeadLetterEntry, StoreDeadLetterCommand, StoreDeadLetterMeta,
  DeadLetterCommandResolverResult,
  // messages
  StoreMessage, StoreSnapshot, StoreMessageStatus,
  UpdateStoreMessage, ClearStoreMessage, ClearAllStoreMessage,
  StartLoadingStoreMessage, StopLoadingStoreMessage,
  UpdateKeyedOneStoreMessage, ClearKeyedOneStoreMessage,
  StartKeyedLoadingStoreMessage, EnsureKeyedSlotStoreMessage,
  // channels
  StoreMessageRecord, StoreMessageChannel,
  StoreMessageChannelStorage, StoreMessageChannelOptions,
  CompositeStoreMessageChannelOptions,
  StorageStoreMessageChannelOptions,
  BrowserStorageStoreMessageChannelOptions,
} from 'flurryx';

// HTTP-only — pulls @angular/common/http
import { httpErrorNormalizer } from 'flurryx/http';
```

Prefer `flurryx`. Use `flurryx/http` only for `httpErrorNormalizer`. Avoid direct `@flurryx/core | @flurryx/store | @flurryx/rx` unless host already depends.

## Hard Rules

- Never `any`
- Components read signals only. Facade/service owns subscriptions + writes
- Prefer `Store.for<Config>().build()` interface builder
- `UPPER_SNAKE_CASE` keys: `LIST`, `DETAIL`, `ITEMS`
- `@SkipIfCached` outermost, `@Loading` directly beneath
- Use `@SkipIfCached` only if cache hits are intended; else omit
- Keyed resources -> `syncToKeyedStore`, not hand-rolled `Record` updates
- Don't subclass `BaseStore` directly
- Don't call component methods in templates -> use `computed`

## Core Flow

```
Observable -> syncToStore / syncToKeyedStore -> Store signal -> Template
```

## ResourceState<T>

Every slot wraps `ResourceState<T>`:

```ts
interface ResourceState<T> {
  isLoading?: boolean;
  data?: T;
  status?: 'Success' | 'Error';
  errors?: Array<{ code: string; message: string }>;
}
```

Lifecycle: idle -> loading -> Success | Error.

## KeyedResourceData

Per-entity cache:

```ts
type KeyedResourceData<TKey extends string | number, TValue> =
  Partial<Record<TKey, ResourceState<TValue>>>;
```

Helpers:
- `createKeyedResourceData<TKey, TValue>()` -> `{}`
- `isKeyedResourceData(val)` -> type guard
- `isAnyKeyLoading(data)` -> bool

## Store Builder

### Interface form (preferred)

```ts
interface ProductStoreConfig {
  LIST: Product[];
  DETAIL: Product;
  ITEMS: KeyedResourceData<string, Item>;
}

export const ProductStore = Store.for<ProductStoreConfig>().build();
```

Naming: `<Feature>StoreConfig` + `<Feature>Store`. Slots are raw types; flurryx wraps in `ResourceState<T>`.

### Enum-constrained form

```ts
const Keys = { LIST: 'LIST', DETAIL: 'DETAIL' } as const;
export const ProductStore = Store.for(Keys)
  .resource('LIST').as<Product[]>()
  .resource('DETAIL').as<Product>()
  .build();
```

`.build()` only callable when all enum keys defined.

### Fluent form

```ts
export const ProductStore = Store
  .resource('LIST').as<Product[]>()
  .resource('DETAIL').as<Product>()
  .build();
```

### Builder methods (all forms)

- `.mirror(sourceToken, sourceKey, targetKey?)` -> 1:1 cross-store mirror
- `.mirrorSelf(sourceKey, targetKey)` -> alias inside same store; keys must differ
- `.derive(sourceToken, sourceKey, targetKey?, { mapData })` -> map source data into target slot
- `.deriveSelf(sourceKey, targetKey, { mapData })` -> derived alias inside same store
- `.mirrorKeyed(sourceToken, sourceKey, { extractId }, targetKey?)` -> aggregate single-entity fetches into keyed slot
- `.build(options?: StoreOptions)` -> `InjectionToken` registered `providedIn: 'root'`

`StoreOptions` extends `StoreMessageChannelOptions` -> supply `channel` to override default in-memory channel.

## IStore API

`store.get(key)` returns:
- non-keyed slot -> `Signal<ResourceState<T>>`
- keyed slot -> `KeyedStoreSignal<TData, K>` = signal + `.for(resourceKey | Signal<resourceKey>)` -> `Signal<ResourceState<TValue>>`

### Writes (publish broker messages)

- `update(key, partial, options?)` -> merge partial; `options.deadLetter?: StoreDeadLetterMeta`
- `clear(key)` -> reset slot to idle
- `clearAll()` -> reset every slot
- `startLoading(key)` / `stopLoading(key)`
- `updateKeyedOne(key, resourceKey, entity)` -> sets entity status `Success`, recomputes top-level isLoading
- `clearKeyedOne(key, resourceKey)` -> remove single keyed entry
- `startKeyedLoading(key, resourceKey)` -> mark single key loading

### Cache invalidation

- `invalidateCacheFor(key)` -> invalidate slot cache only (state untouched)
- `invalidateCacheFor(key, resourceKey)` -> invalidate one keyed entry's cache

### Hooks

- `onUpdate(key, (next, prev) => …)` -> `() => void` cleanup
- `onCacheInvalidate(key, ({ key, resourceKey }) => …)` -> cleanup
- Hook errors are caught + rethrown via `queueMicrotask`/`AggregateError`

### History / Replay

- `replay(id | ids[])` -> re-execute persisted channel messages -> int (acked count)
- `restoreStoreAt(index)` -> snapshot navigation (no message)
- `restoreResource(key, index?)` -> restore single key from snapshot
- `undo()` / `redo()` -> bool
- `getHistory()` / `getHistory(key)` -> readonly entries
- `getMessages()` / `getMessages(key)` -> channel records
- `getDeadLetters()` -> dead-letter entries
- `replayDeadLetter(id)` -> bool
- `replayDeadLetters()` -> int (acked)
- `replayDeadLetterCommand(id, async resolver -> { resolved, clear })` -> Promise<bool>
- `getCurrentIndex()` -> int

### Reactive signals on store

- `history: Signal<readonly StoreHistoryEntry[]>`
- `messages: Signal<readonly StoreMessageRecord[]>`
- `currentIndex: Signal<number>`
- `keys: Signal<readonly StoreKey[]>` (LazyStore: grows on first access)

### Global

- `clearAllStores()` -> calls `clearAll()` on every tracked store. Use for logout/tenant switch.

## Rx Operators

### syncToStore

```ts
this.api.getProducts().pipe(
  syncToStore(this.store, 'LIST', {
    completeOnFirstEmission: true,           // default true (take(1))
    callbackAfterComplete: () => {},
    errorNormalizer: defaultErrorNormalizer, // default
    deadLetterCommand: { type: '...', payload: {} },
  })
).subscribe();
```

Success -> `{ data, isLoading: false, status: 'Success', errors: undefined }`.
Error -> `{ data: undefined, isLoading: false, status: 'Error', errors: normalized }` + DLQ meta from HTTP-like errors.

### syncToKeyedStore

```ts
this.api.getInvoice(id).pipe(
  syncToKeyedStore(this.store, 'ITEMS', id, {
    mapResponse: (r) => r.data,    // optional response unwrap
    completeOnFirstEmission: true,
    callbackAfterComplete: () => {},
    errorNormalizer,
    deadLetterCommand,
  })
).subscribe();
```

Bootstraps `isLoading: true` for that key on subscribe (via `defer`). Per-key Success/Error; recomputes top-level `isLoading` from remaining keys.

## Decorators

### @SkipIfCached

```ts
@SkipIfCached(
  storeKey,
  (i) => i.store,
  returnObservable = false,
  timeoutMs = DEFAULT_CACHE_TTL_MS,  // CACHE_NO_TIMEOUT for infinite
)
```

Cache hit (skip) when: `status === 'Success'` OR `isLoading === true`, args match (`JSON.stringify`), TTL not expired.
Cache miss when: idle, `status === 'Error'`, expired, or args changed.
Keyed: if first arg is `string|number` AND slot is `KeyedResourceData`, tracks cache per `resourceKey` automatically.
`returnObservable: true` -> uses `shareReplay({ bufferSize: 1, refCount: true })` for in-flight dedup; method must return `Observable`.

### @Loading

```ts
@Loading(storeKey, (i) => i.store)
```

Calls `startLoading(key)` before method. If first arg is `string|number` and store has `startKeyedLoading`, calls `startKeyedLoading(key, resourceKey)` instead.

### Composition

`@SkipIfCached` MUST be outermost (short-circuits before loading). `@Loading` above `@SkipIfCached` -> potential infinite loading loops.

## Standalone Functions

### mirrorKey

```ts
mirrorKey(sourceStore, sourceKey, targetStore, targetKey?, options?: MirrorOptions)
// MirrorOptions: { destroyRef?, direction?: 'bidirectional' | 'source-to-target' }
// Default direction: 'bidirectional' — updates flow both ways with loop guard.
// Set direction: 'source-to-target' for one-way mirroring.
// returns cleanup () => void
```

### deriveKey

```ts
deriveKey(source, sourceKey, target, targetKey, {
  mapData: (data, state) => mappedData,
  destroyRef?,
})
// returns cleanup. Mirrors isLoading/status/errors, maps data.
```

### collectKeyed

```ts
collectKeyed(source, sourceKey, target, targetKey?, {
  extractId: (entity | undefined) => key | undefined,
  destroyRef?,
})
// CollectKeyedOptions. Aggregates single-entity emissions into keyed cache.
```

## Message Channels

Default = in-memory.

```ts
Store.for<Config>().build({
  channel: createLocalStorageStoreMessageChannel({
    storageKey: 'app.store',
    serialize?,    // optional
    deserialize?,
  }),
});
```

Factories:
- `createInMemoryStoreMessageChannel<TData>()`
- `createStorageStoreMessageChannel({ storage, storageKey, serialize?, deserialize? })` -- custom adapter; auto-evicts oldest on quota exceeded
- `createLocalStorageStoreMessageChannel({ storageKey, ... })` -- defaults storage to `localStorage`
- `createSessionStorageStoreMessageChannel({ storageKey, ... })` -- session-scoped
- `createCompositeStoreMessageChannel({ channels: [primary, ...replicas] })` -- fan-out writes; primary handles reads + id allocation

`StoreMessageChannelStorage`: `getItem | setItem | removeItem`. Serializer handles `undefined`, `Date`, `Map`, `Set`, `Array`, plain objects.

## Error Normalizers

`defaultErrorNormalizer(err)` checks in order:
1. `{ error: { errors: [...] } }` -> returns inner array
2. `{ status, message }` -> `[{ code: String(status), message }]`
3. `Error` -> `[{ code: 'UNKNOWN', message: err.message }]`
4. else -> `[{ code: 'UNKNOWN', message: String(err) }]`

`httpErrorNormalizer` (from `flurryx/http`):
- `HttpErrorResponse` with `error.errors` array -> as-is
- else -> `[{ code: status, message }]`
- non-HTTP -> fallback `UNKNOWN`

## Patterns

### Facade (preferred when codebase uses facades)

```ts
@Injectable()
export class ProductFacade {
  private readonly api = inject(GetProductsUseCase);
  readonly store = inject(ProductStore);

  getProducts() { return this.store.get('LIST'); }
  getProduct(id: string) { return this.store.get('ITEMS').for(id); }

  @SkipIfCached('LIST', (i: ProductFacade) => i.store)
  @Loading('LIST', (i: ProductFacade) => i.store)
  loadProducts() {
    this.api.execute().pipe(syncToStore(this.store, 'LIST')).subscribe();
  }

  @SkipIfCached('ITEMS', (i: ProductFacade) => i.store)
  @Loading('ITEMS', (i: ProductFacade) => i.store)
  loadProduct(id: string) {
    this.api.byId(id).pipe(syncToKeyedStore(this.store, 'ITEMS', id)).subscribe();
  }
}
```

`store` MUST be public + readonly so decorator getters can reach it.

### Service-led (when no facade layer)

Same shape, `@Injectable({ providedIn: 'root' })` service holds `store`.

### Component

```ts
@Component({
  template: `
    @if (state().isLoading) { <app-spinner/> }
    @for (p of products(); track p.id) { ... }
  `,
})
export class ProductListComponent {
  private readonly facade = inject(ProductFacade);
  readonly state = this.facade.getProducts();
  readonly products = computed(() => this.state().data ?? []);

  constructor() { this.facade.loadProducts(); }
}
```

Read `state().data | isLoading | status | errors`. Use `computed()` for derived UI.

### Keyed reads in component

```ts
readonly id = input.required<string>();
readonly invoiceState = computed(() => this.facade.store.get('ITEMS').for(this.id())());
```

`.for(idOrSignal)` is `computed`-safe and supports raw or signal keys. Snapshot reads `state().data?.[id]` still work.

### Mirroring at builder level

```ts
export const SessionStore = Store.for<SessionStoreConfig>()
  .mirror(CustomerStore, 'CUSTOMERS')
  .mirrorSelf('CUSTOMER_DETAILS', 'CUSTOMER_SNAPSHOT')
  .derive(OrdersStore, 'TOTAL', { mapData: (data) => formatTotal(data) })
  .mirrorKeyed(InvoiceStore, 'DETAIL', { extractId: (inv) => inv?.id }, 'INVOICES')
  .build();
```

Mirrors propagate `update` + `onCacheInvalidate`. Self-mirror with same source/target throws.

## Lifecycle / Resets

- `store.clear('LIST')` -> single slot
- `store.clearKeyedOne('ITEMS', id)` -> one entry; also evicts that key's `@SkipIfCached` entries
- `store.invalidateCacheFor('ITEMS', id)` -> invalidate cache only, keep state
- `store.clearAll()` -> all slots in this store
- `clearAllStores()` -> every flurryx store (logout/tenant switch)
- `cloneValue(v)` -> deep clone (Date/Map/Set/Array/plain). Class instances with constructor side-effects don't survive
- `createSnapshotRestorePatch(current, snapshot)` -> partial patch to restore

## Replay & Dead Letters

```ts
store.undo();  store.redo();
store.restoreStoreAt(0);          // snapshot nav, no broker
store.restoreResource('LIST', 5); // single-key restore
store.replay(12);                 // re-publish via broker
store.replay([12, 13, 14]);
store.replayDeadLetters();        // bool/int per id
store.replayDeadLetterCommand(id, async (entry) => ({ resolved: true, clear: true }));
```

Dead letter entry: `{ id, message, attempts, error, httpStatus, httpMessage, command, failedAt }`.
DLQ command meta on `update` -> `update(key, state, { deadLetter: { error, httpStatus?, httpMessage?, command? } })`. `syncToStore`/`syncToKeyedStore` populate this from HTTP-like errors automatically.

## Anti-Patterns

- Component subscribes to flurryx fetches
- Component mutates store directly
- Component injects `HttpClient` when belongs in facade/adapter
- DTOs into presentation models when mapper exists
- `@SkipIfCached` on always-fresh flows
- `@Loading` outside (above) `@SkipIfCached`
- `BehaviorSubject` where store slot would own state
- Subclassing `BaseStore`
- Bypassing `syncToStore` / `syncToKeyedStore` for ad-hoc loading/error plumbing
- Calling component methods in templates (use `computed`)

## Quick Reference

| Task | API |
| --- | --- |
| Define store | `Store.for<Config>().build()` |
| Read slot | `store.get('LIST')` |
| Read keyed entry | `store.get('ITEMS').for(id)` |
| Write slot | `store.update('LIST', { data })` |
| Write keyed entry | `store.updateKeyedOne('ITEMS', id, entity)` |
| Sync resource | `syncToStore(store, 'LIST', opts?)` |
| Sync keyed | `syncToKeyedStore(store, 'ITEMS', id, opts?)` |
| Skip cache | `@SkipIfCached(key, (i)=>i.store, retObs?, ttl?)` |
| Mark loading | `@Loading(key, (i)=>i.store)` |
| Mirror state | `.mirror | .mirrorSelf | .mirrorKeyed | .derive | .deriveSelf` (builder) |
| Standalone mirror | `mirrorKey | deriveKey | collectKeyed` |
| Clear slot | `store.clear('LIST')` |
| Clear keyed entry | `store.clearKeyedOne('ITEMS', id)` |
| Invalidate cache | `store.invalidateCacheFor('ITEMS', id?)` |
| Reset all stores | `clearAllStores()` |
| History | `undo | redo | restoreStoreAt | restoreResource | replay | replayDeadLetters` |
| Channel | `createInMemory | LocalStorage | SessionStorage | Storage | Composite ...MessageChannel` |
| Error norm | `defaultErrorNormalizer` / `httpErrorNormalizer` (from `flurryx/http`) |
