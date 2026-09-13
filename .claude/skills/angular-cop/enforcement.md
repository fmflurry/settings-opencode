# angular-cop / enforcement — BLOCK vs warn severity checklist

Canonical severity list for `angular-cop` and the coder self-check.

**BLOCK findings fail review.** The ESLint template (see [[angular-cop-enforcement-tooling]]) makes the deterministic subset fail the build/CI. Rules that cannot be expressed as lint rules are enforced by angular-cop's static review pass only.

---

## MUST — BLOCK

> Any single finding here is enough to reject the PR. Fix before merging.

| Rule | How to detect | Why |
|---|---|---|
| `any` type introduced | `grep -n ': any\|as any\|<any>' <changed-files>` · tsc `TS7006`/`TS7034` · ESLint `@typescript-eslint/no-explicit-any` | `any` dissolves TypeScript's type safety net. Use `unknown` + a type guard at system boundaries instead. |
| UseCase injected directly in a component | `grep -n 'UseCase' <component.ts>` in the `inject()` call list or constructor params · ESLint `no-restricted-syntax` selector on `*.component.ts` | Global rule: components depend on Facade, never on UseCase. Facade is the only public API for presentation. See [[angular-cop-clean-architecture]]. |
| RxJS subscription leak — manual `subscribe()` without `takeUntilDestroyed` / not using `async` pipe | Grep `\.subscribe(` in component/directive files; confirm no `takeUntilDestroyed(this.destroyRef)` or `toSignal()` in scope · ESLint `rxjs-x/no-ignored-subscription` | Subscriptions on destroyed components leak memory and run duplicate side-effects on re-navigation. |
| State mutation — in-place object/array modification | Look for `object.prop =`, `array.push(`, `array.splice(`, `Object.assign(target, …)` on caller-owned data · ESLint `functional/no-let` + `@typescript-eslint/prefer-readonly` (partial) | Immutable patterns are mandatory. Mutating state hides side-effects, breaks OnPush change detection, and makes debugging painful. |
| Clean Architecture boundary violation — presentation importing infrastructure | `import` from `infrastructure/` inside `presentation/` files · ESLint `eslint-plugin-boundaries` or `@nx/enforce-module-boundaries` | Presentation layer MUST depend only on the Facade (application layer). Skipping layers hides the domain behind infrastructure details. |
| Clean Architecture boundary violation — domain importing framework or infrastructure | `import { … } from '@angular/…'` or `'rxjs'` inside `domain/` · same plugin | Domain is pure TypeScript. Zero Angular or HTTP dependencies. See [[angular-cop-clean-architecture]]. |
| Non-null assertion `!` on uncertain values | Grep `\b!\b` on property access/function results · ESLint `@typescript-eslint/no-non-null-assertion` | `!` suppresses compiler checks silently. Prefer explicit narrowing or throwing with a clear message. |
| Unjustified `as` cast bypassing narrowing | `as SomeType` without a preceding type guard · Code review only (ESLint `@typescript-eslint/consistent-type-assertions` at `warn` level) | Casts hide type errors; the bug surfaces at runtime. |
| Missing `ChangeDetectionStrategy.OnPush` on stateful components | Check `@Component({ changeDetection: … })` absence on components that read facade signals or have `input()` bindings | Without OnPush, Angular runs full tree checks on every browser event. With signals, OnPush is both correct and mandatory for performance. |
| Inline component template via `template:` property | Grep for `template: \`\|'` inside `@Component({…})` blocks in `*.component.ts` files | External `templateUrl` required. Inline templates prevent HTML tooling, bloat the component class, and obscure git diffs. Always use `templateUrl: './x.component.html'`. |

---

## SHOULD — warn

> Advisory. Fix when practical; do not block the PR on these alone.

| Rule | How to detect | Why |
|---|---|---|
| Signal name ends in `$` | Grep `\$ =.*signal(` | `$` is the RxJS stream convention. Signals should not carry it. |
| `WritableSignal<T>` exposed on facade public API | Look for `readonly x: WritableSignal<T>` or `x = signal<T>(…)` (non-private) | Facades expose read-only signals. Use `.asReadonly()`. |
| `input()` / `output()` not used in new Angular 16+ code | `@Input()` / `@Output()` decorators in new components | Prefer signal inputs/outputs. Flag only on newly added code, not legacy. |
| Facade exposes mutable store state | `WritableSignal<T>` getter on a facade | Facade API is read-only. |
| Adapter throws raw `HttpErrorResponse` | No error mapping in adapter; raw error crosses port boundary | Adapters must translate HTTP errors to domain errors before returning. |
| Method call in template (`{{ method() }}`) | Grep `{{ \w\+()` in templates | Runs every CD cycle; convert to `computed(() => …)` signal. |
| Effect writing signals without `allowSignalWrites` | `effect(() => { … .set(…) })` without option | Runtime throw. Prefer `computed` derivation. |
| File name deviates from conventions | `*.facade.ts`, `*.usecase.ts` / `*.use-case.ts`, `*.port.ts`, `*.adapter.ts`, `*.store.ts` — match project | Grep-ability and routing clarity. |
| Public methods on use cases without explicit return types | Missing return type annotation on exported/public class methods | Inferred types on public API drift silently. |
| Store key not `UPPER_SNAKE_CASE` | Keys of the store state type definition | Convention established by flurryx / BaseStore. See [[angular-cop-flurryx]]. |
| `share()` without `shareReplay` on HTTP observables | `.pipe(share())` on HTTP-backed observable with multiple subscribers | Re-fires HTTP per subscriber. |
| Missing `readonly` on DTO / value-object interface fields | `interface` or `type` without `readonly` modifiers | Immutability. Prefer `readonly` everywhere in domain models. |
| Naming: component selector missing project prefix | `selector: 'foo-bar'` without the configured app prefix | Project convention. Cf. AGENTS.md `§Selectors`. |
