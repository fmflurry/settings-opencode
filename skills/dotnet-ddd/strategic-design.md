# Strategic Design

Strategic DDD concepts for .NET. Each section: definition, when to use, GOOD/BAD C# examples, review-checklist line.

Sources: Evans *Domain-Driven Design* (Blue Book, Part IV), Vernon *Implementing Domain-Driven Design* (Red Book, ch. 2–3, 8, 13), Microsoft .NET microservices architecture guidance.

---

## Bounded Context

**Definition.** An explicit boundary within which a particular domain model applies. Inside the boundary, terms have precise meaning; outside, the same word may mean something different. Each bounded context owns its own ubiquitous language, its own aggregates, and its own persistence. (Evans, ch. 14; Vernon, ch. 2)

**When to use.** Whenever two parts of the system use the same word to mean different things, or when a model would become too large to reason about. In this project, each module (per [[dotnet-clean-architecture]]) is a bounded context.

### GOOD

```csharp
// Module/Sales/Core/Model/Product.cs — "Product" means a sellable SKU
namespace GcPlatform.Sales.Core.Model;

public sealed class Product
{
    public ProductId Id { get; }
    public string Sku { get; private set; }
    public Money ListPrice { get; private set; }
    // Sales-specific behavior
    public Money ApplyDiscount(Percentage discount) => ListPrice.ReduceBy(discount);
}

// Module/Inventory/Core/Model/Product.cs — "Product" means a stockable item
namespace GcPlatform.Inventory.Core.Model;

public sealed class Product
{
    public ProductId Id { get; }
    public string Sku { get; private set; }
    public int QuantityOnHand { get; private set; }
    // Inventory-specific behavior
    public void Reserve(int qty) { /* invariant: qty <= QuantityOnHand */ }
}
```

### BAD

```csharp
// One god-class shared across all modules
namespace GcPlatform.Shared.Models;

public class Product
{
    public Guid Id { get; set; }
    public string Sku { get; set; } = "";
    public decimal Price { get; set; }
    public int Stock { get; set; }
    public string Category { get; set; } = "";
    public bool IsActive { get; set; }
    // 40 more fields serving every module's needs
}
```

**Checklist:** Each module has its own model types; no shared "god entity" used across modules; the same domain word may have different classes in different contexts (this is correct, not duplication).

---

## Ubiquitous Language

**Definition.** A shared vocabulary between domain experts and developers, used consistently in code, conversations, and documentation within a bounded context. Class names, method names, and variable names should be terms the domain expert recognizes. (Evans, ch. 2)

**When to use.** Always, within every bounded context. If a developer cannot explain a class name to a domain expert without translating, the language is broken.

### GOOD

```csharp
// Domain expert says "the policy lapses after 30 days unpaid"
public sealed class Policy
{
    public void Lapse()
    {
        if (DaysUnpaid < 30) return;
        Status = PolicyStatus.Lapsed;
    }
}
```

### BAD

```csharp
// Developer-invented names that mean nothing to the domain expert
public sealed class Policy
{
    public void UpdateStatusFlag(int code)
    {
        if (this._cnt > 30) this._st = 4;
    }
}
```

**Checklist:** Type and method names match domain-expert vocabulary; no abbreviations or technical jargon in domain model names; a domain expert could read the class and recognize the concept.

---

## Anti-Corruption Layer

**Definition.** A translation layer that sits between your bounded context and an external system (legacy app, third-party API, another team's service). It converts external models into your context's language so that external concepts never leak into your domain. (Evans, ch. 14; Vernon, ch. 13)

**When to use.** Whenever your context must interact with a system whose model differs from yours — especially legacy systems, vendor SDKs, or another bounded context with a different ubiquitous language.

### GOOD

```csharp
// Core/Ports/Outgoing/IPaymentGateway.cs — speaks our language
public interface IPaymentGateway
{
    Task<PaymentResult> ChargeAsync(Money amount, PaymentMethod method, CancellationToken ct);
}

// Infrastructure/Adapter/StripePaymentAdapter.cs — ACL translates
internal sealed class StripePaymentAdapter(IStripeClient client) : IPaymentGateway
{
    public async Task<PaymentResult> ChargeAsync(Money amount, PaymentMethod method, CancellationToken ct)
    {
        // Translate our model -> Stripe's model
        var stripeRequest = new StripeChargeRequest
        {
            AmountInCents = (long)(amount.Amount * 100),
            Currency = amount.Currency.ToLowerInvariant(),
            Source = method.ExternalToken,
        };

        var response = await client.Charges.CreateAsync(stripeRequest, ct);

        // Translate Stripe's model -> our model
        return new PaymentResult(
            IsSuccess: response.Status == "succeeded",
            ExternalReference: response.Id);
    }
}
```

### BAD

```csharp
// Domain code directly depends on Stripe types
public sealed class CheckoutService
{
    public async Task Process(Order order, IStripeClient stripe)
    {
        var charge = await stripe.Charges.CreateAsync(new StripeChargeRequest
        {
            AmountInCents = (long)(order.Total * 100),
            Currency = "eur",
        });
        order.StripeChargeId = charge.Id; // external concept leaks into domain
    }
}
```

**Checklist:** Domain/Core has zero references to external SDK types; an adapter (ACL) in Infrastructure translates between external and internal models; external field names never appear in domain types.

---

## Context Mapping / Shared Kernel

**Definition.** Context mapping describes the relationship between bounded contexts. Patterns include: **Shared Kernel** (small shared model both contexts agree to maintain together), **Customer/Supplier** (one context depends on the other's API), **Conformist** (downstream adopts upstream's model as-is), **Partnership**, **Separate Ways**. (Evans, ch. 14)

**When to use Shared Kernel.** Only for a very small set of types that genuinely must be identical across contexts (e.g., `Money`, `CustomerId` as a correlation ID). Keep it minimal — every shared type is a coupling cost.

### GOOD

```csharp
// Shared/Kernel/Money.cs — tiny, stable, both contexts agree on this
namespace GcPlatform.Shared.Kernel;

public readonly record struct Money(decimal Amount, string Currency);

// Each context has its own Customer type but references the shared CustomerId
// for cross-context correlation only.
```

### BAD

```csharp
// "Shared kernel" that is actually a god-model
namespace GcPlatform.Shared;

public class Customer { /* 30 fields */ }
public class Product { /* 25 fields */ }
public class Order { /* 40 fields */ }
// Every module depends on this — changes ripple everywhere
```

**Checklist:** Shared kernel contains only a handful of stable value types; no behavior-rich entities in shared code; each context owns its own aggregates; cross-context references use IDs or events, not shared entity classes.

---

## Domain Events

**Definition.** An immutable record capturing something meaningful that happened in the domain, expressed in past tense. Domain events enable decoupled communication within and across bounded contexts. (Vernon, ch. 8; Evans, ch. 8 in later editions)

**When to use.** When an action in one aggregate should trigger a reaction elsewhere, but the source aggregate should not know about or depend on the consumer. Also for audit trails and event-driven architectures.

### GOOD

```csharp
// Immutable, past-tense, no behavior
public sealed record OrderConfirmed(
    OrderId OrderId,
    CustomerId CustomerId,
    Money Total,
    Instant ConfirmedAt) : IDomainEvent;

// Raised inside the aggregate root
public sealed class Order
{
    private readonly List<IDomainEvent> _events = [];
    public IReadOnlyList<IDomainEvent> DomainEvents => _events.AsReadOnly();

    public void Confirm()
    {
        if (_lines.Count == 0)
            throw new DomainException("Cannot confirm an empty order.");
        Status = OrderStatus.Confirmed;
        _events.Add(new OrderConfirmed(Id, CustomerId, Total(), SystemClock.Instance.GetCurrentInstant()));
    }

    public void ClearEvents() => _events.Clear();
}
```

### BAD

```csharp
// Mutable, present-tense, contains behavior, coupled to consumers
public class ConfirmOrderEvent
{
    public Order Order { get; set; } = null!; // exposes entire aggregate
    public List<IOrderConfirmedHandler> Handlers { get; set; } = []; // coupling

    public void Notify()
    {
        foreach (var h in Handlers) h.Handle(this);
    }
}
```

**Checklist:** Domain events are immutable records; named in past tense; contain only the data consumers need (not the whole aggregate); raised inside the aggregate root; no reference to handlers/consumers.

---

## CQRS

**Definition.** Command Query Responsibility Segregation — separate the read model from the write model. Writes go through aggregates and enforce invariants; reads use optimized projections (views, denormalized tables) that bypass the domain model entirely. (Vernon, ch. 4; Microsoft CQRS docs)

**When to use.** When read and write workloads diverge significantly (complex queries vs. simple mutations), or when you need different scaling for reads vs. writes. Not every module needs CQRS — simple CRUD modules can use a single model.

> **Deep CQRS and Event Sourcing enforcement** (command/query handlers, event-sourced aggregates, append-only stores) is handled by [[dotnet-cop-optional-cqrs]] and [[dotnet-cop-optional-event-sourcing]]. This section covers only the strategic decision and boundary rules.

### GOOD

```csharp
// Write side: goes through aggregate + repository
internal sealed class ConfirmOrder(IOrderRepository repo, IUnitOfWork uow) : IConfirmOrder
{
    public async Task ExecuteAsync(ConfirmOrderCommand cmd, CancellationToken ct)
    {
        var order = await repo.FindByIdAsync(cmd.OrderId, ct)
            ?? throw new DomainException("Order not found.");
        order.Confirm();
        await uow.SaveChangesAsync(ct);
    }
}

// Read side: optimized projection, no domain model involved
internal sealed class GetOrderDetails(AppDbContext db) : IGetOrderDetails
{
    public async Task<OrderDetailsDto?> ExecuteAsync(OrderId id, CancellationToken ct)
        => await db.OrderProjections
                   .Where(p => p.Id == id)
                   .Select(p => new OrderDetailsDto(p.Id, p.CustomerName, p.Total, p.Status))
                   .FirstOrDefaultAsync(ct);
}
```

### BAD

```csharp
// "CQRS" that is just a repository with extra steps — read side loads full aggregate
public class OrderQueryService
{
    public OrderDto GetOrder(Guid id)
    {
        var order = _repo.GetById(id); // loads full aggregate with all invariants
        return new OrderDto(order.Id, order.Customer.Name, order.Lines.Sum(...));
        // N+1, over-fetching, domain model coupled to read concerns
    }
}
```

**Checklist:** Write side mutates through aggregates; read side uses projections/DTOs that bypass the domain model; read queries do not load full aggregates; command and query handlers are separate types.
