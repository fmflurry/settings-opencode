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
