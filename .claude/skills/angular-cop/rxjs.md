# angular-cop / RxJS hygiene

Subscription lifecycle, leak patterns, async pipe, signal interop.

## 🔴 Blockers

### Subscription without teardown
```ts
// BAD
ngOnInit() {
  this.svc.data$.subscribe(d => this.value = d);
}

// GOOD - takeUntilDestroyed (Angular 16+)
private readonly destroyRef = inject(DestroyRef);
ngOnInit() {
  this.svc.data$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(d => this.value = d);
}

// BETTER - signal interop
readonly value = toSignal(this.svc.data$);
```
Why: long-lived subscriptions on destroyed components leak memory and run duplicate work.

### Nested subscribe
```ts
// BAD
a$.subscribe(a => {
  b$.subscribe(b => { ... });  // 🔴 leak + ordering bugs
});

// GOOD
a$.pipe(switchMap(a => b$)).subscribe(...);
```

### `subscribe` in template via custom directive when async pipe fits
```html
<!-- BAD - manual sub in component -->
<!-- GOOD -->
<div *ngIf="data$ | async as data">{{ data.name }}</div>
```

## 🟡 Risks

### `Subject` used where `BehaviorSubject` / signal is correct
- Need current value on subscribe? -> `BehaviorSubject` or signal.
- Multicast event stream? -> `Subject` is fine, document why.

### `share()` without `shareReplay`
For HTTP-backed observables consumed by multiple subscribers:
```ts
// BAD - re-fires HTTP per subscriber
const users$ = http.get<User[]>('/users').pipe(share());

// GOOD
const users$ = http.get<User[]>('/users').pipe(shareReplay({ bufferSize: 1, refCount: true }));
```

### `fromEvent` / `interval` / `router.events` without teardown
Same teardown rules as observables. Often missed because the source is "framework-provided".

### Mutating emitted values
```ts
// BAD
data$.subscribe(d => d.processed = true);

// GOOD
data$.pipe(map(d => ({ ...d, processed: true }))).subscribe(...);
```

## 🟢 Architecture

### Components subscribing instead of facade
Per global rule and project AGENTS.md: components consume signals from facade. Facade owns the subscription lifecycle.

```ts
// BAD - component subscribes directly to a service
class FooComponent {
  constructor(private svc: BarService) {
    svc.things$.subscribe(...);
  }
}

// GOOD - facade exposes signal
class FooComponent {
  private readonly facade = inject(BarFacade);
  readonly things = this.facade.things;  // Signal<Thing[]>
}
```

If using flurryx, see [[angular-cop-flurryx]] — `syncToStore` handles teardown via DestroyRef-aware Store.

## 🔵 Nits

- Operator imports from `rxjs` (not deep paths like `rxjs/operators` post-v7).
- Prefer `toSignal` / `toObservable` for interop over manual bridges.
- `filter` before `map` when discarding nulls (cheaper + better types).

## Reporting

For leak findings (no teardown), cite the `.subscribe(` line. For nested-subscribe, cite the outer `.subscribe(`.
