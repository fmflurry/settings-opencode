# angular-cop / flurryx

State management correctness. Mirror authority: the [[flurryx]] skill. Do not invent APIs not documented there.

## Prereq

Load [[flurryx]] before flagging anything below. If unsure whether an API exists, mark `❓` — do not invent the verdict.

## 🔴 Important

### Manual `Record<K,V>` updates instead of keyed store
```ts
// BAD
private _byId = signal<Record<string, User>>({});
loadUser(id: string) {
  this.http.get<User>(`/users/${id}`).subscribe(u => {
    this._byId.update(r => ({ ...r, [id]: u }));  // 🔴 reinvents syncToKeyedStore
  });
}

// GOOD
class UserStore extends Store<{ USERS: KeyedResourceData<string, User> }> { ... }

@SkipIfCached
@Loading
loadUser(id: string) {
  return syncToKeyedStore(this.store, 'USERS', id, this.http.get<User>(`/users/${id}`));
}
```

### Decorator order wrong
`@SkipIfCached` outermost, `@Loading` directly beneath. Reversed = cache miss bypasses loading state.
```ts
// BAD
@Loading
@SkipIfCached
loadList() { ... }

// GOOD
@SkipIfCached
@Loading
loadList() { ... }
```

### `@SkipIfCached` only when a hit is intended
Add `@SkipIfCached` only when a cache hit is the intended behavior. Leave it off a method that must always reach the network. Do not remove, bypass, or shorten an existing decorator, `CACHE_NO_TIMEOUT`, or TTL to fix stale data.

### Stale cache
Keep the decorator. Invalidate from the write that changes the cached data, in the same change.

Same module: `store.invalidateCacheFor('LIST')` (keyed: `store.invalidateCacheFor('ITEMS', id)`). A mirror forwards `onCacheInvalidate`.

Cross-module: the writer emits a root-level change signal. The facade that owns the cache subscribes and calls `invalidateCacheFor`. Do not import the other module's store.

```ts
@Injectable({ providedIn: 'root' })
export class ListChanges {
  private readonly changed = new Subject<string>();
  readonly changed$ = this.changed.asObservable();
  notify(key: string): void { this.changed.next(key); }
}

// writer, after the successful write
this.changes.notify('LIST');

// caching facade
this.changes.changed$.subscribe((key) => {
  if (key === 'LIST') this.store.invalidateCacheFor('LIST');
});
```

Tests cover the cached hit and a refetch, or a fresh value, after that invalidation.

### Store key not UPPER_SNAKE_CASE
```ts
// BAD
{ list: ..., detail: ... }

// GOOD
{ LIST: ..., DETAIL: ..., ITEMS: ... }
```

### Writing to store from a component
Components read signals only. All writes go through facade/service that owns the Store.

## 🟡 Nit [risk]

### Hand-rolled `Subject` where Store would do
If the data is async + cached + keyed -> Store. If it's a one-shot event bus -> Subject is fine.

### Missing `ErrorNormalizer`
HTTP adapter throwing raw `HttpErrorResponse` into a store. Use `httpErrorNormalizer` (from `flurryx/http`) so consumers see `ResourceErrors`.

### Deriving with custom logic instead of `mirror` / `derive`
```ts
// BAD - manual computed bridge
readonly users = computed(() => Object.values(this.store.snapshot.USERS));

// GOOD
readonly users = collectKeyed(this.store, 'USERS');
```

### Direct `@flurryx/core` import
Prefer `flurryx` umbrella. `@flurryx/core | store | rx` only if host already depends.

## 🟡 Nit

- Use `Store.for<Config>().build()` builder over class extension when feasible.
- Cache TTL: rely on `DEFAULT_CACHE_TTL_MS` unless a value is justified.
- `CACHE_NO_TIMEOUT` only for truly static data.

## When AGENTS.md adds rules

Project AGENTS.md may mandate:
- Session vs feature store split
- Specific store naming
- DeadLetter handling expectations

Re-read on each run and surface deltas vs this skill.

## Reporting

Cite the `@SkipIfCached`/`@Loading` decorator line for decorator-order findings. Cite the method body for manual Record updates. Always reference the canonical flurryx API name in the fix.
