# Strategic Design

Strategic DDD concepts for TypeScript/Angular. Each section: definition, when to use, GOOD/BAD TS examples, review-checklist line.

Sources: Evans *Domain-Driven Design* (Blue Book, Part IV), Vernon *Implementing Domain-Driven Design* (Red Book, ch. 2–3, 8, 13).

---

## Bounded Context

**Definition.** An explicit boundary within which a particular domain model applies. Inside the boundary, terms have precise meaning; outside, the same word may mean something different. Each bounded context owns its own ubiquitous language, its own aggregates, and its own persistence. (Evans, ch. 14; Vernon, ch. 2)

**When to use.** Whenever two parts of the system use the same word to mean different things, or when a model would become too large to reason about. In this project, each Angular module (per [[angular-clean-architecture]]) is a bounded context.

### GOOD

```ts
// src/app/sales/core/models/product.model.ts — "Product" means a sellable SKU
export type Product = {
  readonly id: ProductId;
  readonly sku: string;
  readonly listPrice: Money;
};

export function applyDiscount(product: Product, discount: Percentage): Money {
  return reduceBy(product.listPrice, discount);
}

// src/app/inventory/core/models/product.model.ts — "Product" means a stockable item
export type Product = {
  readonly id: ProductId;
  readonly sku: string;
  readonly quantityOnHand: number;
};

export function reserve(product: Product, qty: number): Product {
  if (qty > product.quantityOnHand)
    throw new Error('Cannot reserve more than available stock.');
  return { ...product, quantityOnHand: product.quantityOnHand - qty };
}
```

### BAD

```ts
// One god-type shared across all modules
// src/app/shared/models/product.model.ts
export interface Product {
  id: string;
  sku: string;
  price: number;
  stock: number;
  category: string;
  isActive: boolean;
  // 40 more fields serving every module's needs
}
```

**Checklist:** Each module has its own model types; no shared "god entity" used across modules; the same domain word may have different types in different contexts (this is correct, not duplication).

---

## Ubiquitous Language

**Definition.** A shared vocabulary between domain experts and developers, used consistently in code, conversations, and documentation within a bounded context. Type names, function names, and variable names should be terms the domain expert recognizes. (Evans, ch. 2)

**When to use.** Always, within every bounded context. If a developer cannot explain a type name to a domain expert without translating, the language is broken.

### GOOD

```ts
// Domain expert says "the policy lapses after 30 days unpaid"
export function lapse(policy: Policy): Policy {
  if (policy.daysUnpaid < 30) return policy;
  return { ...policy, status: 'Lapsed' };
}
```

### BAD

```ts
// Developer-invented names that mean nothing to the domain expert
export function updateStatusFlag(p: Policy, code: number): Policy {
  if (p._cnt > 30) return { ...p, _st: 4 };
  return p;
}
```

**Checklist:** Type and function names match domain-expert vocabulary; no abbreviations or technical jargon in domain model names; a domain expert could read the type and recognize the concept.

---

## Anti-Corruption Layer

**Definition.** A translation layer that sits between your bounded context and an external system (legacy app, third-party API, another team's service). It converts external models into your context's language so that external concepts never leak into your domain. (Evans, ch. 14; Vernon, ch. 13)

**When to use.** Whenever your context must interact with a system whose model differs from yours — especially legacy systems, vendor SDKs, or another bounded context with a different ubiquitous language. In this project, the ACL is the infrastructure adapter (see [[angular-clean-architecture]]).

### GOOD

```ts
// core/ports/payment-gateway.port.ts — speaks our language
import { Observable } from 'rxjs';
import { Money, PaymentMethod, PaymentResult } from '../models';

export abstract class PaymentGatewayPort {
  abstract charge(amount: Money, method: PaymentMethod): Observable<PaymentResult>;
}

// infrastructure/adapter/stripe-payment.adapter.ts — ACL translates
// (implementation lives in infrastructure — see [[angular-clean-architecture]])
// Translates: our Money -> Stripe's amountInCents
// Translates: Stripe's response -> our PaymentResult
```

### BAD

```ts
// Domain code directly depends on Stripe types
// core/rules/checkout.rule.ts
import { Stripe } from '@stripe/stripe-js';  // infrastructure leak into domain

export function process(order: Order, stripe: Stripe): void {
  const charge = stripe.charges.create({
    amount: order.total * 100,
    currency: 'eur',
  });
  order.stripeChargeId = charge.id;  // external concept leaks into domain
}
```

**Checklist:** Domain layer has zero imports from external SDK packages; an adapter in infrastructure translates between external and internal models; external field names never appear in domain types.

---

## Context Mapping / Shared Kernel

**Definition.** Context mapping describes the relationship between bounded contexts. Patterns include: **Shared Kernel** (small shared model both contexts agree to maintain together), **Customer/Supplier** (one context depends on the other's API), **Conformist** (downstream adopts upstream's model as-is), **Partnership**, **Separate Ways**. (Evans, ch. 14)

**When to use Shared Kernel.** Only for a very small set of types that genuinely must be identical across contexts (e.g., `Money`, `CustomerId` as a correlation ID). Keep it minimal — every shared type is a coupling cost.

### GOOD

```ts
// shared/kernel/money.model.ts — tiny, stable, both contexts agree on this
export type Money = {
  readonly amount: number;
  readonly currency: string;
};

// Each context has its own Customer type but references the shared CustomerId
// for cross-context correlation only.
```

### BAD

```ts
// "Shared kernel" that is actually a god-model
// shared/models.ts
export interface Customer { /* 30 fields */ }
export interface Product { /* 25 fields */ }
export interface Order { /* 40 fields */ }
// Every module depends on this — changes ripple everywhere
```

**Checklist:** Shared kernel contains only a handful of stable value types; no behavior-rich entities in shared code; each context owns its own aggregates; cross-context references use IDs or domain events, not shared entity types.

---

## Domain Events

**Definition.** An immutable record capturing something meaningful that happened in the domain, expressed in past tense. Domain events enable decoupled communication within and across bounded contexts. (Vernon, ch. 8; Evans, ch. 8 in later editions)

**When to use.** When an action in one aggregate should trigger a reaction elsewhere, but the source aggregate should not know about or depend on the consumer. Also for audit trails and event-driven architectures.

### GOOD

```ts
// core/events/order.events.ts — discriminated union, immutable, past tense
import { OrderId, CustomerId, Money } from '../models';

export type OrderConfirmed = {
  readonly kind: 'OrderConfirmed';
  readonly orderId: OrderId;
  readonly customerId: CustomerId;
  readonly total: Money;
  readonly confirmedAt: string;
};

export type OrderCancelled = {
  readonly kind: 'OrderCancelled';
  readonly orderId: OrderId;
  readonly reason: string;
  readonly cancelledAt: string;
};

export type OrderDomainEvent = OrderConfirmed | OrderCancelled;

// Raised inside a rule function — returns the event alongside the new state
export function confirm(order: Order): { order: Order; event: OrderConfirmed } {
  if (order.lines.length === 0)
    throw new Error('Cannot confirm an empty order.');
  const confirmed: Order = { ...order, status: 'Confirmed' };
  const event: OrderConfirmed = Object.freeze({
    kind: 'OrderConfirmed',
    orderId: order.id,
    customerId: order.customerId,
    total: orderTotal(order),
    confirmedAt: new Date().toISOString(),
  });
  return { order: confirmed, event };
}
```

### BAD

```ts
// Mutable, present-tense, contains behavior, coupled to consumers
export class ConfirmOrderEvent {
  order: Order;  // exposes entire aggregate, mutable
  handlers: Array<(e: ConfirmOrderEvent) => void> = [];  // coupling

  notify(): void {
    this.handlers.forEach((h) => h(this));
  }
}
```

**Checklist:** Domain events are immutable (`readonly` + `Object.freeze()`); named in past tense; use a `kind` discriminant for discriminated unions; contain only the data consumers need (not the whole aggregate); raised inside domain rule functions; no reference to handlers/consumers.

---

## CQRS

**Definition.** Command Query Responsibility Segregation — separate the read model from the write model. Writes go through aggregates and enforce invariants; reads use optimized projections (signals, derived state) that bypass the domain model entirely. (Vernon, ch. 4)

**When to use.** When read and write workloads diverge significantly (complex queries vs. simple mutations), or when you need different scaling for reads vs. writes. Not every module needs CQRS — simple CRUD modules can use a single model.

> **Deep CQRS and Event Sourcing enforcement** (store mechanics, replay, snapshots, dead letters) is handled by [[flurryx]] and [[angular-cop]]. This section covers only the strategic decision and boundary rules.

### GOOD

```ts
// Write side: goes through aggregate + rule functions + port
// application/use-cases/confirm-order.use-case.ts
// (orchestration only — see [[angular-clean-architecture]] for use case structure)

// Read side: optimized projection via store signal, no domain model involved
// application/facades/order.facade.ts
// readonly orderDetails = computed(() => this.store.get('DETAIL')().data);
// (store mechanics owned by [[flurryx]])
```

### BAD

```ts
// "CQRS" that is just a repository with extra steps — read side loads full aggregate
export class OrderQueryService {
  getOrder(id: string): OrderDto {
    const order = this.repo.getById(id);  // loads full aggregate with all invariants
    return {
      id: order.id,
      customerName: order.customer.name,  // reaches into aggregate internals
      total: order.lines.reduce((s, l) => s + l.unitPrice.amount * l.quantity, 0),
    };
    // Over-fetching, domain model coupled to read concerns
  }
}
```

**Checklist:** Write side mutates through aggregates + rule functions; read side uses store signal projections that bypass the domain model; read queries do not load full aggregates; command and query paths are separate.
