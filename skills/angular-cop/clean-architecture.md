# merge-cop / Angular clean architecture

DDD layering: presentation → application → domain → infrastructure. Facade + use-case + port + adapter + store. Mirror the [[angular-clean-architecture]] skill.

## 🟢 Architecture blockers

### Component depends on UseCase directly
Per global rule: components NEVER inject use-cases. They inject the facade.
```ts
// BAD
class CustomerListComponent {
  constructor(private listCustomers: ListCustomersUseCase) {}
}

// GOOD
class CustomerListComponent {
  private readonly facade = inject(CustomerFacade);
  readonly customers = this.facade.customers;
}
```

### Component depends on Adapter or Store directly
- Components → Facade
- Facade → UseCase
- UseCase → Port (interface)
- Adapter implements Port (infrastructure)
- Store: owned by Facade (or proxy in session-scope), never injected into components

### Domain layer imports from infrastructure / Angular
```ts
// BAD (in domain/)
import { HttpClient } from '@angular/common/http';

// GOOD
// domain/ contains pure TS: entities, value objects, port interfaces. No Angular, no HTTP.
```

### Port lives outside `domain/ports/`
```
✅ domain/ports/get-customers.port.ts        -> interface
✅ infrastructure/adapters/get-customers.adapter.ts -> implements
❌ application/ports/...                       -> wrong layer
```

### Cross-domain leakage
Feature A imports concrete classes from feature B's `infrastructure/` or `application/`. Allowed only via:
- B's `public-api.ts` re-exports
- A context registry pattern (see angular-clean-architecture / cross-domain.md)

### Use-case calls another use-case directly
```ts
// BAD - use-case orchestration belongs in facade
class CreateOrderUseCase {
  execute() {
    new ValidateCustomerUseCase().execute(...);  // 🟢
  }
}

// GOOD - facade composes use-cases
class OrderFacade {
  createOrder() {
    this.validateCustomer.execute(...);
    this.createOrder.execute(...);
  }
}
```

## 🟡 Risks

### Ad-hoc display formatting in components/templates
Flag local presentation formatting/parsing when reusable Angular pipes or app helpers can do it.

- Bad in components/templates unless justified + centralized:
  - `new Intl.*Format(...)`
  - `toLocaleString`, `toLocaleDateString`, `toLocaleTimeString`
  - regex/string formatting helpers for numbers, dates, currencies, percentages, text transforms
  - manual separators, padding, rounding-for-display, date/number formatting helpers
- Prefer built-in Angular pipes first: `number`, `currency`, `percent`, `date`, text pipes when suitable.
- Prefer existing app pipes/utilities next. Search nearby/shared code before approving trivial formatting logic.
- If no reusable pipe/helper exists, request one in shared/presentation layer; do not accept local component helper.
- Component may choose data and pass args; pipe/helper owns display transformation.

Report as 🟡 risk, or 🟢 arch when repeated/local formatting creates clear duplication or violates AGENTS.md presentation rules.

Example:

```ts
// BAD - local one-off formatting in component
const FRENCH_NUMBER_FORMAT = new Intl.NumberFormat('fr-FR', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

formatValue(value: unknown): string {
  return typeof value === 'number' ? FRENCH_NUMBER_FORMAT.format(value) : '';
}
```

```html
<!-- GOOD - display formatting delegated to pipe -->
{{ value | number: '1.0-2' }}
```

Review action: grep for existing `*.pipe.ts`, shared formatting helpers, and similar formatting call sites before accepting new local impl.

### Trivial repetitive logic duplicates existing app behavior
For small repeated actions (format, parse, normalize, map labels, build display strings), search existing nearby/shared code before approving new local implementation. If equivalent exists, request reuse. If not, request extraction when likely repeated.

### Facade exposes mutable state
Facade should expose `Signal<T>` (read-only), not `WritableSignal<T>`.
```ts
// BAD
readonly customers: WritableSignal<Customer[]> = signal([]);

// GOOD
private readonly _customers = signal<Customer[]>([]);
readonly customers = this._customers.asReadonly();
```

### Adapter throws raw HTTP errors
Adapter should translate HTTP errors to domain errors before they cross the port boundary.

### Provider scope wrong
- Feature-level providers via `provideX()` function returning `Provider[]`.
- Session/app-scope only in root or session context registry.

## 🔵 Nits

- File naming: `*.facade.ts`, `*.usecase.ts` (or `*.use-case.ts` — match project), `*.port.ts`, `*.adapter.ts`, `*.store.ts`.
- One use-case per file. One adapter per port.
- `public-api.ts` re-exports only what cross-domain consumers need.

## AGENTS.md alignment

Re-read project AGENTS.md "Architecture" / "Layering" sections each run. The project may pin specific folder names, naming, or boundary rules that override the defaults above.

## Reporting

Cite the import line that violates the layer rule. Include the from→to layer in the message: `presentation → infrastructure (skipped application)`.
