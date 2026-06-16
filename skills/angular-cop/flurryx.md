# angular-cop / flurryx

State management correctness. Mirror authority: the [[flurryx]] skill. Do not invent APIs not documented there.

## Prereq

Load [[flurryx]] before flagging anything below. If unsure whether an API exists, mark `❓ q:` — do not invent the verdict.

## 🔴 Blockers

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

### `@SkipIfCached` on a method that has no cache value
Only use `@SkipIfCached` when cache hits are intended. If the method always re-fetches, remove the decorator.

### Store key not UPPER_SNAKE_CASE
```ts
// BAD
{ list: ..., detail: ... }

// GOOD
{ LIST: ..., DETAIL: ..., ITEMS: ... }
```

### Writing to store from a component
Components read signals only. All writes go through facade/service that owns the Store.

## 🟡 Risks

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

## 🔵 Nits

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
