# DDD Review Checklist

Terse, file:line-oriented checklist for the `code-reviewer` agent. One item per pattern/concept. Cite the offending `file:line` in findings.

Severity taxonomy matches [[angular-cop]]: 🔴 bug (breaks invariants), 🟠 sec (security/access), 🟡 risk (architectural risk), 🟢 arch (pattern/design), 🔵 nit (style).

---

## 🔴 Bug — Hard Violations

### Rich Domain Models

- [ ] 🔴 Domain types have behavior — not just getters/setters. Logic that should be in domain rules or entity methods is not delegated to application services or components. Example: don't define a `payment: Payment` type and then write `validatePayment(payment)` as an app service; instead, define `isValidPayment(payment: Payment): payment is ValidPayment` in domain/rules.
- [ ] 🔴 No mutable public fields on domain types. Entity and value types use `readonly` fields: `type Customer = { readonly id: CustomerId; readonly email: Email }` (not `let email` or public setters).
- [ ] 🔴 Aggregates cannot be bypassed. Internal entities are not exposed as mutable references or arrays; external code does not mutate aggregate members directly. Root is the only mutation entry point via factory or methods.

**GOOD example:**
```typescript
// core/models/order.ts
type LineItem = {
  readonly productId: ProductId;
  readonly quantity: number;
};

type Order = {
  readonly id: OrderId;
  readonly customerId: CustomerId;
  readonly lineItems: readonly LineItem[];
  readonly status: 'pending' | 'confirmed' | 'shipped';
};

// core/rules/order.rule.ts
export function createOrder(cmd: CreateOrderCommand): Order {
  if (!cmd.customerId || !cmd.items?.length) {
    throw new Error('Order requires customer and items');
  }
  return {
    id: generateOrderId(),
    customerId: cmd.customerId,
    lineItems: cmd.items,
    status: 'pending',
  };
}

export function addLine(order: Order, line: LineItem): Order {
  if (order.status !== 'pending') {
    throw new Error('Cannot modify a confirmed order.');
  }
  return { ...order, lineItems: [...order.lineItems, line] };
}
```

**BAD example:**
```typescript
// Mutable array, external mutation allowed, no factory validation
type Order = {
  id: OrderId;
  lineItems: LineItem[];  // ← mutable array
  status: string;
};

export function addLineItem(order: Order, item: LineItem) {
  order.lineItems.push(item);  // ← mutation outside aggregate
}
```

### Invariant Enforcement

- [ ] 🔴 All invariants are validated before a domain object enters an invalid state. Factory functions or rules check preconditions and raise domain errors. No public constructors that bypass validation.

**GOOD example:**
```typescript
export function createMoney(amount: number, currency: string): Money {
  if (amount < 0) throw new Error('amount must be non-negative');
  if (!['USD', 'EUR'].includes(currency)) throw new Error('unsupported currency');
  return Object.freeze({ amount, currency });
}
```

**BAD example:**
```typescript
// Constructor allows invalid state
const money = { amount: -50, currency: 'USD' };  // no validation
```

### Value Types (Immutable, Identity-Free)

- [ ] 🔴 Value types have no identity field (`id`, `customerId`, etc.). They are described by attributes only. Equality is structural.

**GOOD example:**
```typescript
type Money = {
  readonly amount: number;
  readonly currency: string;
};
// Two Money objects with same amount/currency are equivalent

type CustomerId = string & { readonly __brand: 'CustomerId' };
// ← CustomerId IS an identity, so it's an entity type, not a value type
```

**BAD example:**
```typescript
type Money = {
  readonly id: string;  // ← Has identity, so it's really an entity
  readonly amount: number;
  readonly currency: string;
};
```

### Port Abstraction

- [ ] 🔴 Ports (abstract classes) return aggregates or domain types, never DTOs or raw API shapes. Transformation happens in adapters.
- [ ] 🔴 Ports are defined in domain layer. No adapter implementation types leak into domain imports.

**GOOD example:**
```typescript
// core/ports/get-customer.port.ts
import { Observable } from 'rxjs';
import { Customer, CustomerId } from '../models';

export abstract class GetCustomerPort {
  abstract execute(id: CustomerId): Observable<Customer>;
}

// infrastructure/adapter/get-customers.adapter.ts
import { map } from 'rxjs/operators';

@Injectable()
export class GetCustomersAdapter extends GetCustomersPort {
  constructor(private endpoint: CustomersEndpoint) {}
  
  get(id: CustomerId): Observable<Customer> {
    return this.endpoint.fetch(id).pipe(
      map((dto: CustomerDTO) => this.mapDTOToCustomer(dto))
    );
  }
  
  private mapDTOToCustomer(dto: CustomerDTO): Customer {
    return { id: dto.id, name: dto.name, email: dto.email };
  }
}
```

**BAD example:**
```typescript
// Port exposes DTO type, adapter mapping is implicit
export abstract class GetCustomersPort {
  abstract get(id: string): Observable<CustomerDTO>;
}
```

### Bounded Contexts (No Shared Internal Types)

- [ ] 🔴 Each domain module defines its own types — no shared "god entity" across modules. Same domain word has different type names in different contexts (correct, not duplication).

**GOOD example:**
```typescript
// src/app/modules/sales/core/models/product.model.ts
type Product = {
  readonly id: ProductId;
  readonly sku: string;
  readonly listPrice: Money;
};

// src/app/modules/inventory/core/models/product.model.ts (different Product!)
type Product = {
  readonly id: ProductId;
  readonly sku: string;
  readonly quantityOnHand: number;
};

// src/app/modules/fulfillment/core/models/shipment.model.ts
type Shipment = {
  readonly id: ShipmentId;
  readonly orderId: OrderId;  // ← Uses ID, not Order object
};
```

**BAD example:**
```typescript
// One god-type shared across all modules
// shared/models.ts
export interface Product {
  id: string;
  sku: string;
  price: number;
  stock: number;
  category: string;
  // 40+ fields serving every module
}
```

### Framework Hygiene

- [ ] 🔴 No `import { … } from '@angular/*'` or `inject()` in domain models, rules, or services. Domain layer is framework-agnostic.
- [ ] 🔴 No domain-layer imports of external SDK types (`Stripe.*`, `SendGrid.*`, vendor namespaces). Anti-corruption layer in adapters translates them.

**GOOD example:**
```typescript
// core/models/payment.ts (pure, no framework)
export type Payment = {
  readonly id: PaymentId;
  readonly amount: Money;
  readonly status: 'pending' | 'completed' | 'failed';
};

export function isPaid(payment: Payment): boolean {
  return payment.status === 'completed';
}

// infrastructure/adapter/stripe-payment.adapter.ts (knows Stripe)
import Stripe from 'stripe';

@Injectable()
export class StripePaymentAdapter extends PaymentGatewayPort {
  charge(amount: Money, method: PaymentMethod): Observable<PaymentResult> {
    // Translate domain Money to Stripe's amountInCents
    // Translate Stripe response back to domain PaymentResult
  }
}
```

**BAD example:**
```typescript
// Framework import in domain
import { Injectable } from '@angular/core';

// External SDK in domain
import Stripe from 'stripe';

export class Payment {
  stripe: Stripe;  // ← infrastructure leak
}
```

---

## 🟠 Security — Access & Isolation

### Anti-Corruption Layer (ACL)

- [ ] 🟠 Domain layer has zero direct references to external API response types or vendor SDK types. Adapters in infrastructure translate them.
- [ ] 🟠 External field names (e.g., `stripe_charge_id`, `aws_region`) never appear in domain types. Adapters map them to domain-native names.

**GOOD example:**
```typescript
// core/models/payment.ts (no Stripe knowledge)
type Payment = {
  readonly id: PaymentId;
  readonly amount: Money;
  readonly status: PaymentStatus;
};

type PaymentStatus = 'pending' | 'completed' | 'failed';

// infrastructure/adapter/stripe-payment.adapter.ts (knows Stripe)
function mapStripeChargeToPayment(charge: Stripe.Charge): Payment {
  const stripeToPaymentStatus: Record<string, PaymentStatus> = {
    'succeeded': 'completed',
    'failed': 'failed',
    'pending': 'pending',
  };
  return {
    id: charge.id as PaymentId,
    amount: {
      amount: charge.amount / 100,
      currency: charge.currency.toUpperCase(),
    },
    status: stripeToPaymentStatus[charge.status] ?? 'pending',
  };
}
```

---

## 🟡 Risk — Architectural Concerns

### Mutation & State Transitions

- [ ] 🟡 Aggregate mutations happen only through pure functions (factories, rules) that validate invariants first. State transitions are atomic at language level.
- [ ] 🟡 No intermediate invalid states exist. All mutations preserve invariants or fail with a domain error.

**GOOD example:**
```typescript
export function changeStatus(order: Order, newStatus: OrderStatus): Order {
  const validTransitions: Record<OrderStatus, OrderStatus[]> = {
    'pending': ['confirmed', 'cancelled'],
    'confirmed': ['shipped', 'cancelled'],
    'shipped': [],
  };
  if (!validTransitions[order.status]?.includes(newStatus)) {
    throw new Error(`Cannot transition from ${order.status} to ${newStatus}`);
  }
  return { ...order, status: newStatus };
}
```

### Stateless Domain Services

- [ ] 🟡 Domain services contain no mutable state. They are pure functions or injectable services with zero side effects or framework calls.

**GOOD example:**
```typescript
// core/rules/order-pricing.rule.ts (pure function)
export function calculateOrderTotal(order: Order, discountRule?: DiscountRule): Money {
  let total = sumLineItems(order.lineItems);
  if (discountRule) total = applyDiscount(total, discountRule);
  return total;
}

// No mutable state, no external calls, pure domain logic
```

### Port Design

- [ ] 🟡 Ports use `Observable<T>` return types; parameter types are domain models, not DTOs.
- [ ] 🟡 One port per operation (Interface Segregation Principle). Don't overload a single port with multiple unrelated operations.

**GOOD example:**
```typescript
// One port per operation
export abstract class CreateOrderPort {
  abstract execute(order: Order): Observable<OrderId>;
}

export abstract class GetOrderPort {
  abstract execute(id: OrderId): Observable<Order>;
}
```

**BAD example:**
```typescript
// Overloaded port — violates ISP
export abstract class OrderPort {
  abstract get(id: string): Observable<any>;
  abstract create(data: any): Observable<any>;
  abstract update(id: string, data: any): Observable<any>;
  abstract delete(id: string): Observable<void>;
}
```

---

## 🟢 Architecture — Pattern Enforcement

### Aggregate Structure

- [ ] 🟢 Aggregate is modeled as a `type` with `readonly` fields. Aggregate root exposes `readonly` collections (not direct access to internal entities).
- [ ] 🟢 Aggregate references other aggregates by ID, not by object reference.
- [ ] 🟢 Aggregate size is small (avoids fetching too much data). Complex creation is handled by factory functions.

**GOOD example:**
```typescript
type Order = {
  readonly id: OrderId;
  readonly customerId: CustomerId;  // ← Reference by ID, not object
  readonly lineItems: readonly LineItem[];  // ← ReadonlyArray
};

type Shipment = {
  readonly id: ShipmentId;
  readonly orderId: OrderId;  // ← Not `readonly order: Order`
};
```

### Specification & Rules

- [ ] 🟢 Repeated predicate/validation logic is extracted into composable pure functions or rule objects — not duplicated across domain.

**GOOD example:**
```typescript
export type Specification<T> = {
  readonly isSatisfiedBy: (candidate: T) => boolean;
};

export function and<T>(a: Specification<T>, b: Specification<T>): Specification<T> {
  return { isSatisfiedBy: (c) => a.isSatisfiedBy(c) && b.isSatisfiedBy(c) };
}

export const orderExceedsThreshold = (threshold: Money): Specification<Order> => ({
  isSatisfiedBy: (order) => calculateOrderTotal(order).amount > threshold.amount,
});
```

### Entity Identity

- [ ] 🟢 Entity equality is identity-based: two entities with the same ID but different attributes are still equal (in the domain sense). Comparison is by ID field.
- [ ] 🟢 Value object equality is structural: all attributes must match.

**GOOD example:**
```typescript
type CustomerId = string & { readonly __brand: 'CustomerId' };

type Customer = {
  readonly id: CustomerId;
  readonly name: string;
  readonly email: string;
};

// Identity-based equality
export function isSameCustomer(a: Customer, b: Customer): boolean {
  return a.id === b.id;  // ID only, not attributes
}

// Value object — structural equality
type Money = {
  readonly amount: number;
  readonly currency: string;
};

export function isSameMoney(a: Money, b: Money): boolean {
  return a.amount === b.amount && a.currency === b.currency;
}
```

### Ubiquitous Language

- [ ] 🟢 Type and method names match domain-expert vocabulary (no abbreviations like `cust`, `acct`, `msg`; no jargon like `Entity`, `DTO` in public types).
- [ ] 🟢 A domain expert, reading the code, could recognize the business concept by type name alone.

**GOOD example:**
```typescript
export type Policy = {
  readonly id: PolicyId;
  readonly status: PolicyStatus;
};

export function lapse(policy: Policy): Policy {
  if (policy.daysUnpaid < 30) return policy;
  return { ...policy, status: 'Lapsed' };
}
// Domain expert says "the policy lapses" — names match
```

**BAD example:**
```typescript
export type P { id: string; st: string; }
export function updateStatusFlag(p: P, code: number): P {
  if (p._cnt > 30) return { ...p, _st: 4 };
  return p;
}
// No ubiquitous language — abbreviations, technical jargon
```

### Domain Events

- [ ] 🟢 Domain events are immutable records: `readonly` props + `Object.freeze()`. Never mutable classes or mutated after creation.
- [ ] 🟢 Event names use past tense (`OrderCreated`, `PaymentProcessed`, not `CreateOrder`).
- [ ] 🟢 Events contain only the data consumers need — not the entire aggregate. No coupling to handlers.
- [ ] 🟢 Events include context for sequencing (timestamp, aggregate ID, version if needed).

**GOOD example:**
```typescript
type OrderCreatedEvent = {
  readonly kind: 'OrderCreated';
  readonly orderId: OrderId;
  readonly customerId: CustomerId;
  readonly totalAmount: Money;
  readonly createdAt: string;
};

// Raised inside domain rule, returns event alongside new state
export function createOrder(cmd: CreateOrderCommand): {
  order: Order;
  event: OrderCreatedEvent;
} {
  const order = { id: generateOrderId(), customerId: cmd.customerId, /* ... */ };
  const event = Object.freeze({
    kind: 'OrderCreated',
    orderId: order.id,
    customerId: order.customerId,
    totalAmount: calculateOrderTotal(order),
    createdAt: new Date().toISOString(),
  } as const);
  return { order, event };
}
```

**BAD example:**
```typescript
// Mutable, present-tense, couples to handlers
export class ConfirmOrderEvent {
  order: Order;  // exposes entire aggregate, mutable
  handlers: Array<(e: ConfirmOrderEvent) => void> = [];
  notify(): void { this.handlers.forEach((h) => h(this)); }
}
```

### Context Mapping & Cross-Context Communication

- [ ] 🟢 Cross-context references use IDs or domain events, not shared entity class references.
- [ ] 🟢 Shared kernel (if used) contains only immutable value types (e.g., `CorrelationId`, `Money`, common enums). No entities, repositories, or behavior-rich objects.

**GOOD example:**
```typescript
// src/app/modules/sales/core/models/order.ts
type Order = {
  readonly id: OrderId;
  readonly customerId: CustomerId;  // ← shared ID type
  readonly total: Money;  // ← shared value type
};

// src/app/modules/fulfillment/core/models/shipment.ts
type Shipment = {
  readonly id: ShipmentId;
  readonly orderId: OrderId;  // ← reference by ID, not by Order object
};

// Shared kernel (minimal)
// shared/kernel/money.model.ts
type Money = {
  readonly amount: number;
  readonly currency: string;
};
```

### Command Query Responsibility Segregation (CQRS)

- [ ] 🟢 Write operations (commands) mutate only through aggregates + ports. Read operations (queries) use projections/DTOs for display.
- [ ] 🟢 Read queries do not load full aggregates for display purposes; use read models or specialized projections.

**GOOD example:**
```typescript
// Write side: goes through aggregate + rule functions
// application/use-cases/confirm-order.use-case.ts
// order = confirmOrder(order)  ← domain rule
// port.save(order)

// Read side: optimized projection via store signal
// application/facades/order.facade.ts
// readonly orderDetails = computed(() => this.store.get('ORDER_DETAIL')().data);
// No domain model involved, just read projection
```

---

## 🔵 Nit — Style & Naming

### Type Naming Conventions

- [ ] 🔵 Entity type name is singular and descriptive: `Customer`, `Order` (not `Customers`, `CustomerData`).
- [ ] 🔵 Value type name describes a characteristic or amount: `Money`, `EmailAddress`, `DateRange`.
- [ ] 🔵 Bounded context name reflects the module structure: e.g., `src/app/modules/customers/core/` for Customers context.
- [ ] 🔵 Port name follows `<VerbNoun>Port` pattern: `GetCustomersPort`, `CreateOrderPort` (not `CustomerRepository`).

**GOOD examples:**
```typescript
type Customer = { /* entity */ };
type Money = { /* value object */ };
type OrderId = string & { readonly __brand: 'OrderId' };  // branded identity

// ports
abstract class GetCustomersPort { /* ... */ }
abstract class CreateOrderPort { /* ... */ }
```

### Method & Function Naming

- [ ] 🔵 Domain service/function names read as verb-noun describing actions: `calculateOrderTotal()`, `isValidEmail()` (not `Calc`, `Valid`).
- [ ] 🔵 Mutation functions read naturally as domain language: `changeCustomerName(customer, name)`, `addLineItem(order, item)`.
- [ ] 🔵 Factory functions use verb-noun or descriptive names: `createOrder()`, `buildCustomer()`.

**GOOD examples:**
```typescript
export function calculateOrderTotal(order: Order): Money { /* ... */ }
export function isValidEmail(email: string): boolean { /* ... */ }
export function addLineItem(order: Order, item: LineItem): Order { /* ... */ }
export function createOrder(cmd: CreateOrderCommand): Order { /* ... */ }
```

### Immutability Patterns

- [ ] 🔵 TypeScript immutability uses `readonly` fields, `readonly T[]` (ReadonlyArray) for collections, and `Object.freeze()` for value objects (not sealed classes or init-only properties from C#).

**GOOD examples:**
```typescript
type Customer = {
  readonly id: CustomerId;
  readonly name: string;
  readonly emails: readonly string[];
};

type Money = {
  readonly amount: number;
  readonly currency: string;
};

export function createMoney(amount: number, currency: string): Money {
  return Object.freeze({ amount, currency });
}
```

---

## Summary

**Total checklist items: 41**

- 🔴 Bug: 10 items
- 🟠 Security: 2 items
- 🟡 Risk: 5 items
- 🟢 Architecture: 16 items
- 🔵 Nit: 8 items

> For deep CQRS/ES enforcement (store mechanics, replay, snapshots, dead letters), see [[flurryx]]. For pre-merge Angular review enforcement, see [[angular-cop]].
