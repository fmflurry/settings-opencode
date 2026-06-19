# angular-cop / signals + change detection

Angular signals, computed, effects, OnPush. Applies to `*.component.ts`, `*.component.html`, `*.directive.ts`.

## 🔴 Blockers

### Method calls in templates
```html
<!-- BAD -->
<div>{{ getDisplayName() }}</div>
<div *ngFor="let item of buildItems()">...</div>

<!-- GOOD -->
<div>{{ displayName() }}</div>           <!-- computed signal -->
<div *ngFor="let item of items()">...</div>
```
Why: change detection re-invokes every CD cycle. Burns CPU. Breaks OnPush guarantees.
Fix: convert to `computed(() => ...)`. Helper stays as private method on the class for use in the computed body.

### `effect()` writing to signals without `allowSignalWrites`
```ts
// BAD - silent throw
effect(() => this.count.set(this.count() + 1));

// GOOD - explicit opt-in
effect(() => this.count.set(this.count() + 1), { allowSignalWrites: true });
```
But: writing in effects is a smell. Prefer `computed` derivation.

### Signal mutation inside computed
```ts
// BAD - computed must be pure
readonly total = computed(() => {
  this.cache.set('x');  // 🔴 side effect
  return this.items().length;
});
```

## 🟡 Risks

### Missing OnPush
Standalone components default to `Default` CD. With signals you almost always want OnPush:
```ts
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  // ...
})
```

### `input()` / `output()` not used in new code
New Angular (16+) components should prefer signal inputs:
```ts
// PREFER
readonly userId = input.required<string>();
readonly save = output<User>();

// LEGACY (flag if added in this PR)
@Input() userId!: string;
@Output() save = new EventEmitter<User>();
```

### Untracked reads where reactivity is intended
```ts
// BAD - won't react
const value = untracked(() => this.signal());
return computed(() => value);

// GOOD
return computed(() => this.signal());
```

## 🔵 Nits

- Signal name should not end in `$` (that's RxJS convention).
- `Signal<T>` over `WritableSignal<T>` in public APIs (read-only exposure).
- `as const` on signal default arrays/objects to keep identity stable.

## Helpers vs. standalone functions

Convention: pure helpers used by computed signals stay as **private methods on the class**, not standalone module functions. Use functional style (pure, no side effects) inside the class.

```ts
class FooComponent {
  readonly items = input.required<Item[]>();
  readonly filter = signal('');

  // private method, pure
  private matches(item: Item, q: string): boolean {
    return item.name.toLowerCase().includes(q.toLowerCase());
  }

  readonly visible = computed(() => this.items().filter(i => this.matches(i, this.filter())));
}
```

## Reporting

Cite the template line for `{{ method() }}` findings. Cite the class line for `computed` / `effect` findings. If both template + class are in the diff, prefer the template citation (closer to user impact).
