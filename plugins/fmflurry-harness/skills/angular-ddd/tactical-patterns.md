# Tactical Patterns

Detailed DDD tactical building blocks for TypeScript/Angular. Each section: definition, when to use, GOOD/BAD TS examples, review-checklist line.

Sources: Evans *Domain-Driven Design* (Blue Book), Vernon *Implementing Domain-Driven Design* (Red Book), Martin Fowler bliki.

---

## Entity

**Definition.** An object defined by its identity, not its attributes. Two entities with identical attribute values but different IDs are different objects. Identity persists through state changes. (Evans, ch. 5)

**When to use.** Model things that have a lifecycle, change over time, and must be distinguished from similar things — orders, customers, shipments.

### GOOD

```ts
// core/models/customer.model.ts
export type CustomerId = string & { readonly __brand: 'CustomerId' };

export type Customer = {
  readonly id: CustomerId;
  readonly name: string;
  readonly email: EmailAddress;
};

// core/rules/customer.rule.ts
export function changeName(customer: Customer, name: string): Customer {
  if (!name.trim()) throw new Error('Customer name cannot be empty.');
  return { ...customer, name: name.trim() };
}

export function changeEmail(customer: Customer, email: EmailAddress): Customer {
  return { ...customer, email };
}

// Identity-based equality
export function isSameCustomer(a: Customer, b: Customer): boolean {
  return a.id === b.id;
}
```

### BAD

```ts
// Anemic entity: mutable fields, no behavior, no branded ID
export interface Customer {
  id: string;
  name: string;
  email: string;
}

// External code mutates directly — no invariant enforcement
customer.name = '';  // no validation
customer.email = 'not-an-email';  // no validation
```

**Checklist:** Entity has a branded identity type; state changes go through pure rule functions that enforce invariants; equality is identity-based (compare `id` only).

---

## Value Object

**Definition.** An immutable object that describes a characteristic or attribute. No identity — two value objects with the same values are interchangeable. (Evans, ch. 5)

**When to use.** Model descriptive concepts: money, address, date range, email, coordinates. If you would never ask "which one?" but only "what value?", it is a value object.

### GOOD

```ts
// core/models/money.model.ts
export type Money = {
  readonly amount: number;
  readonly currency: string;
};

export function createMoney(amount: number, currency: string): Money {
  if (amount < 0) throw new Error('Money amount cannot be negative.');
  if (!currency.trim()) throw new Error('Currency is required.');
  return Object.freeze({ amount, currency: currency.toUpperCase() });
}

export function addMoney(a: Money, b: Money): Money {
  if (a.currency !== b.currency)
    throw new Error('Cannot add different currencies.');
  return createMoney(a.amount + b.amount, a.currency);
}

// Structural equality — all fields compared
export function isSameMoney(a: Money, b: Money): boolean {
  return a.amount === b.amount && a.currency === b.currency;
}
```

### BAD

```ts
// Mutable "value object" with identity — this is actually an entity
export interface Money {
  id: string;
  amount: number;
  currency: string;
}

// Mutation after creation breaks value semantics
const m = { id: '1', amount: 100, currency: 'EUR' };
m.amount = -50;  // no validation, no immutability
```

**Checklist:** Value object has no identity field; is immutable (`readonly` props + `Object.freeze()`); equality is structural (all attributes compared).

---

## Aggregate + Aggregate Root

**Definition.** A cluster of related objects treated as a unit for data changes. The aggregate root is the only member that external code may reference. The root enforces invariants across the entire cluster. (Vernon, ch. 10; Evans, ch. 6)

**When to use.** Group entities and value objects that must be consistent together. Examples: Order (root) + OrderLine (internal entity); Policy (root) + Coverage (internal).

### GOOD

```ts
// core/models/order.model.ts
export type OrderId = string & { readonly __brand: 'OrderId' };
export type OrderStatus = 'Draft' | 'Confirmed' | 'Cancelled';

export type OrderLine = {
  readonly productId: ProductId;
  readonly quantity: number;
  readonly unitPrice: Money;
};

export type Order = {
  readonly id: OrderId;
  readonly customerId: CustomerId;
  readonly status: OrderStatus;
  readonly lines: ReadonlyArray<OrderLine>;
};

// core/rules/order.rule.ts
export function addLine(order: Order, productId: ProductId, quantity: number, unitPrice: Money): Order {
  if (order.status !== 'Draft')
    throw new Error('Cannot modify a confirmed order.');
  if (quantity <= 0)
    throw new Error('Quantity must be positive.');
  return { ...order, lines: [...order.lines, Object.freeze({ productId, quantity, unitPrice })] };
}

export function confirm(order: Order): Order {
  if (order.lines.length === 0)
    throw new Error('Cannot confirm an empty order.');
  return { ...order, status: 'Confirmed' };
}
```

### BAD

```ts
// No encapsulation: internal entities exposed, no invariant enforcement
export interface Order {
  id: string;
  lines: OrderLine[];  // mutable array, externally reachable
  status: string;
}

// External code mutates internals directly:
order.lines.push({ productId: 'x', quantity: -1, unitPrice: null });
order.status = 'Confirmed';  // no validation
```

**Checklist:** Aggregate root is the only public entry point; internal entities are not exposed as mutable arrays (`ReadonlyArray<T>`); invariants are enforced in rule functions; external code cannot bypass the root.

---

## Repository

**Definition.** A collection-like abstraction for accessing aggregates (DDD Repository pattern). In this codebase, the Repository pattern is realised as one or more `<VerbNoun>Port` abstract classes in `core/ports/` — one port per operation (Interface Segregation Principle). Defined in the domain layer; implemented in infrastructure. Returns whole aggregates, never partial data or API response types. (Vernon, ch. 12; Evans, ch. 6)

**When to use.** Every aggregate root that needs persistence gets repository ports. Do not create repositories for internal entities or value objects.

### GOOD

```ts
// core/ports/get-order.port.ts
import { Observable } from 'rxjs';
import { Order, OrderId } from '../models';

export abstract class GetOrderPort {
  abstract execute(id: OrderId): Observable<Order | null>;
}

// core/ports/save-order.port.ts
export abstract class SaveOrderPort {
  abstract execute(order: Order): Observable<Order>;
}

// infrastructure/adapter/get-order.adapter.ts
// (implementation lives in infrastructure — see [[angular-clean-architecture]])
```

### BAD

```ts
// Single overloaded port (violates ISP) or returns API response DTO
export abstract class OrderRepositoryPort {
  abstract getAll(): Observable<OrderResponse[]>;  // infrastructure type leaks
  abstract getById(id: string): Observable<RawOrderDto>;  // DTO, not aggregate
}
```

**Checklist:** Repository functionality is split into separate `<VerbNoun>Port` classes in `core/ports/`; each port has a single operation (ISP); ports return aggregate roots (not API DTOs); implementations are in infrastructure (see [[angular-clean-architecture]]).

---

## Factory

**Definition.** Encapsulates complex object creation logic. Use when construction involves multiple steps, validation across fields, or assembly from external data. Can be a pure function or a dedicated factory module. (Evans, ch. 6)

**When to use.** When creation requires domain logic (e.g., generating sub-entities, computing derived fields), or when reconstituting from persistence/external sources.

### GOOD

```ts
// core/rules/order.factory.ts
export function createOrder(customerId: CustomerId, lines: ReadonlyArray<CreateOrderLineInput>): Order {
  const order: Order = Object.freeze({
    id: generateOrderId(),
    customerId,
    status: 'Draft' as const,
    lines: [],
  });
  return lines.reduce(
    (acc, line) => addLine(acc, line.productId, line.quantity, line.unitPrice),
    order,
  );
}
```

### BAD

```ts
// Construction logic scattered in a component or use case
const order = {
  id: crypto.randomUUID(),
  customerId: form.value.customerId,
  status: 'Draft',
  lines: form.value.lines,  // no validation, no invariant enforcement
};
```

**Checklist:** Complex creation is encapsulated in a factory function; creation logic enforces invariants; external callers do not assemble aggregates field-by-field.

---

## Specification

**Definition.** A reusable, composable predicate that tests whether an object satisfies certain criteria. Encapsulates query/validation logic that would otherwise be duplicated. (Evans, ch. 9; Fowler, "Specification")

**When to use.** When the same filtering/validation rule appears in multiple places, or when rules must be combined dynamically (AND/OR/NOT).

### GOOD

```ts
// core/rules/order.specification.ts
export type Specification<T> = {
  readonly isSatisfiedBy: (candidate: T) => boolean;
};

export function and<T>(a: Specification<T>, b: Specification<T>): Specification<T> {
  return { isSatisfiedBy: (c) => a.isSatisfiedBy(c) && b.isSatisfiedBy(c) };
}

export function or<T>(a: Specification<T>, b: Specification<T>): Specification<T> {
  return { isSatisfiedBy: (c) => a.isSatisfiedBy(c) || b.isSatisfiedBy(c) };
}

export function not<T>(spec: Specification<T>): Specification<T> {
  return { isSatisfiedBy: (c) => !spec.isSatisfiedBy(c) };
}

export const orderExceedsThreshold = (threshold: Money): Specification<Order> => ({
  isSatisfiedBy: (order) => orderTotal(order).amount > threshold.amount,
});
```

### BAD

```ts
// Same logic duplicated in three places with slight variations
if (order.lines.reduce((s, l) => s + l.unitPrice.amount * l.quantity, 0) > 1000) { ... }
// ... elsewhere ...
if (order.lines.reduce((s, l) => s + l.unitPrice.amount * l.quantity, 0) >= 1000) { ... } // off-by-one drift
```

**Checklist:** Repeated query/validation logic is extracted into a composable Specification; specifications are pure functions; no duplicated predicate logic across files.

---

## Domain Service vs Application Service

**Definition.** A **domain service** is a stateless operation that belongs to the domain but does not naturally fit inside a single entity or value object. An **application service** (use case) orchestrates domain objects and infrastructure to fulfill a user intent — it contains no domain logic itself. (Evans, ch. 7; Vernon, ch. 4 & 14)

**When to use a domain service.** When an operation involves multiple aggregates, or the logic is a domain concept that does not belong to any single entity (e.g., "transfer funds between two accounts").

**When to use an application service.** Always, for orchestrating a use case: load aggregates, call domain functions, persist, publish events.

### GOOD

```ts
// core/rules/fund-transfer.rule.ts — pure domain logic, no infrastructure
export function transfer(source: Account, destination: Account, amount: Money): {
  source: Account;
  destination: Account;
} {
  return {
    source: debit(source, amount),
    destination: credit(destination, amount),
  };
}

// application/use-cases/transfer-funds.use-case.ts — orchestration only
// (see [[angular-clean-architecture]] for use case structure)
```

### BAD

```ts
// "Service" that contains all the logic — entities are anemic
export class OrderService {
  confirmOrder(order: Order): void {
    if (order.lines.length === 0) throw new Error('Empty');
    order.status = 'Confirmed';  // direct field mutation
  }
}
```

**Checklist:** Domain services are stateless pure functions containing only domain logic; application services (use cases) orchestrate but contain no business rules; behavior that fits one entity lives in a rule function for that entity, not in a service.

---

## Rich vs Anemic Model

**Definition.** A **rich domain model** places behavior (pure functions enforcing invariants) alongside data in the domain layer. An **anemic domain model** has types that are pure data bags with all logic in external services. (Fowler, "Anemic Domain Model" — an anti-pattern)

**When to use rich.** Always, unless the domain is genuinely CRUD-only with no business rules. Even simple validation (non-null, range) belongs in a domain rule function.

### GOOD

```ts
// core/models/policy.model.ts
export type PolicyStatus = 'Pending' | 'Active' | 'Lapsed';

export type Policy = {
  readonly id: PolicyId;
  readonly status: PolicyStatus;
  readonly effectiveDate: string | null;
};

// core/rules/policy.rule.ts
export function activate(policy: Policy, effectiveDate: string): Policy {
  if (policy.status !== 'Pending')
    throw new Error('Only pending policies can be activated.');
  if (new Date(effectiveDate) < new Date())
    throw new Error('Effective date cannot be in the past.');
  return { ...policy, status: 'Active', effectiveDate };
}
```

### BAD

```ts
// Anemic: pure data bag, all logic in a service
export interface Policy {
  id: string;
  status: string;
  effectiveDate: string | null;
}

export class PolicyService {
  activate(p: Policy, date: string): void {
    p.status = 'Active';       // direct mutation
    p.effectiveDate = date;    // no validation
  }
}
```

**Checklist:** Domain types have associated rule functions that enforce invariants; no "manager"/"service" class that mutates domain fields directly; invariants are enforced inside domain rule functions, not externally.

---

## Invariants & Encapsulation

**Definition.** An invariant is a business rule that must always hold true for an aggregate. Encapsulation protects invariants by restricting how state is mutated — `readonly` props, pure functions that return new objects, factory validation. (Vernon, ch. 5 & 10)

**When to enforce.** Every aggregate must protect its invariants at all times. A partially-valid aggregate should never exist.

### GOOD

```ts
// core/models/inventory-item.model.ts
export type InventoryItem = {
  readonly sku: string;
  readonly quantity: number;
};

// core/rules/inventory.rule.ts
export function adjust(item: InventoryItem, delta: number): InventoryItem {
  const next = item.quantity + delta;
  if (next < 0)
    throw new Error('Quantity cannot go negative.');
  return { ...item, quantity: next };
}
```

### BAD

```ts
export interface InventoryItem {
  sku: string;
  quantity: number;  // anyone can set -5
}

item.quantity = -5;  // no validation, invalid state exists
```

**Checklist:** Domain state uses `readonly` props; mutation functions validate invariants before returning new objects; no public API allows an invalid state to exist.
