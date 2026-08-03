# Tactical Patterns

Detailed DDD tactical building blocks for .NET. Each section: definition, when to use, GOOD/BAD C# examples, review-checklist line.

Sources: Evans *Domain-Driven Design* (Blue Book), Vernon *Implementing Domain-Driven Design* (Red Book), Microsoft .NET Architecture guidance.

---

## Entity

**Definition.** An object defined by its identity, not its attributes. Two entities with identical attribute values but different IDs are different objects. Identity persists through state changes. (Evans, ch. 5)

**When to use.** Model things that have a lifecycle, change over time, and must be distinguished from similar things — orders, customers, shipments.

### GOOD

```csharp
public sealed class Customer
{
    public CustomerId Id { get; }
    public string Name { get; private set; }
    public EmailAddress Email { get; private set; }

    private Customer() { } // EF Core

    public Customer(CustomerId id, string name, EmailAddress email)
    {
        Id = id ?? throw new ArgumentNullException(nameof(id));
        ChangeName(name);
        ChangeEmail(email);
    }

    public void ChangeName(string name)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(name);
        Name = name;
    }

    public void ChangeEmail(EmailAddress email)
    {
        Email = email ?? throw new ArgumentNullException(nameof(email));
    }

    public override bool Equals(object? obj)
        => obj is Customer other && Id == other.Id;

    public override int GetHashCode() => Id.GetHashCode();
}
```

### BAD

```csharp
// Anemic entity: public setters, no behavior, equality by all fields
public class Customer
{
    public Guid Id { get; set; }
    public string Name { get; set; } = "";
    public string Email { get; set; } = "";
}
```

**Checklist:** Entity has identity-based equality; state changes go through methods that enforce invariants; no public setters on domain state.

---

## Value Object

**Definition.** An immutable object that describes a characteristic or attribute. No identity — two value objects with the same values are interchangeable. (Evans, ch. 5)

**When to use.** Model descriptive concepts: money, address, date range, email, coordinates. If you would never ask "which one?" but only "what value?", it is a value object.

### GOOD

```csharp
public readonly record struct Money(decimal Amount, string Currency)
{
    public Money
    {
        if (Amount < 0) throw new ArgumentOutOfRangeException(nameof(Amount));
        ArgumentException.ThrowIfNullOrWhiteSpace(Currency);
    }

    public Money Add(Money other)
    {
        if (Currency != other.Currency)
            throw new InvalidOperationException("Cannot add different currencies.");
        return new Money(Amount + other.Amount, Currency);
    }
}
```

### BAD

```csharp
// Mutable "value object" with identity — this is actually an entity
public class Money
{
    public Guid Id { get; set; }
    public decimal Amount { get; set; }
    public string Currency { get; set; } = "";
}
```

**Checklist:** Value object has no identity field; is immutable (`readonly record struct` or sealed class with init-only); equality is structural (all attributes).

---

## Aggregate + Aggregate Root

**Definition.** A cluster of related objects treated as a unit for data changes. The aggregate root is the only member that external code may reference. The root enforces invariants across the entire cluster. (Vernon, ch. 10; Evans, ch. 6)

**When to use.** Group entities and value objects that must be consistent together. Examples: Order (root) + OrderLine (internal entity); Policy (root) + Coverage (internal).

### GOOD

```csharp
public sealed class Order
{
    public OrderId Id { get; }
    public CustomerId CustomerId { get; }
    public OrderStatus Status { get; private set; }
    private readonly List<OrderLine> _lines = [];

    private Order() { } // EF Core

    public Order(OrderId id, CustomerId customerId)
    {
        Id = id;
        CustomerId = customerId;
        Status = OrderStatus.Draft;
    }

    public IReadOnlyList<OrderLine> Lines => _lines.AsReadOnly();

    public void AddLine(ProductId productId, int quantity, Money unitPrice)
    {
        if (Status != OrderStatus.Draft)
            throw new DomainException("Cannot modify a confirmed order.");
        if (quantity <= 0)
            throw new ArgumentOutOfRangeException(nameof(quantity));

        _lines.Add(new OrderLine(productId, quantity, unitPrice));
    }

    public void Confirm()
    {
        if (_lines.Count == 0)
            throw new DomainException("Cannot confirm an empty order.");
        Status = OrderStatus.Confirmed;
    }
}
```

### BAD

```csharp
// No encapsulation: internal entities exposed, no invariant enforcement
public class Order
{
    public Guid Id { get; set; }
    public List<OrderLine> Lines { get; set; } = [];
    public string Status { get; set; } = "";
}

// External code mutates internals directly:
order.Lines.Add(new OrderLine { ... });
order.Status = "Confirmed"; // no validation
```

**Checklist:** Aggregate root is the only public entry point; internal entities are not exposed as mutable collections; invariants are enforced in root methods; external code cannot bypass the root.

---

## Repository

**Definition.** A collection-like abstraction for accessing aggregates. Defined as an interface in the domain layer; implemented in infrastructure. Returns whole aggregates, never partial data or EF entities. (Vernon, ch. 12; Evans, ch. 6)

**When to use.** Every aggregate root that needs persistence gets exactly one repository. Do not create repositories for internal entities or value objects.

### GOOD

```csharp
// Core/Ports/Outgoing/IOrderRepository.cs
public interface IOrderRepository
{
    Task<Order?> FindByIdAsync(OrderId id, CancellationToken ct = default);
    Task AddAsync(Order order, CancellationToken ct = default);
    Task SaveAsync(Order order, CancellationToken ct = default);
}

// Infrastructure/Adapter/OrderRepository.cs
internal sealed class OrderRepository(AppDbContext db) : IOrderRepository
{
    public async Task<Order?> FindByIdAsync(OrderId id, CancellationToken ct = default)
        => await db.Orders.Include(o => o.Lines)
                          .FirstOrDefaultAsync(o => o.Id == id, ct);

    public async Task AddAsync(Order order, CancellationToken ct = default)
        => await db.Orders.AddAsync(order, ct);

    public async Task SaveAsync(Order order, CancellationToken ct = default)
        => await db.SaveChangesAsync(ct);
}
```

### BAD

```csharp
// Returns EF entity, exposes IQueryable, lives in domain layer
public interface IOrderRepository
{
    IQueryable<OrderEntity> GetAll();
    Task<OrderEntity?> GetByIdAsync(Guid id);
    Task<int> SaveChangesAsync();
}
```

**Checklist:** Repository interface lives in Core; returns aggregate roots (not EF entities, not IQueryable, not DTOs); one repository per aggregate root; implementation is in Infrastructure.

---

## Factory

**Definition.** Encapsulates complex object creation logic. Use when construction involves multiple steps, validation across fields, or assembly from external data. Can be a static method on the aggregate root, a dedicated factory class, or a builder. (Evans, ch. 6)

**When to use.** When the constructor would have too many parameters, when creation requires domain logic (e.g., generating sub-entities), or when reconstituting from persistence/external sources.

### GOOD

```csharp
public sealed class Order
{
    // Factory method on the aggregate root
    public static Order Create(CustomerId customerId, IReadOnlyList<CreateOrderLineCommand> lines)
    {
        var order = new Order(OrderId.New(), customerId);
        foreach (var line in lines)
            order.AddLine(line.ProductId, line.Quantity, line.UnitPrice);
        return order;
    }
}
```

### BAD

```csharp
// Construction logic scattered in a controller / use case
var order = new Order();
order.Id = Guid.NewGuid();
order.CustomerId = request.CustomerId;
order.Status = "Draft";
foreach (var l in request.Lines)
{
    order.Lines.Add(new OrderLine { ProductId = l.ProductId, Qty = l.Qty });
}
// No validation, no invariant enforcement
```

**Checklist:** Complex creation is encapsulated (factory method, factory class, or builder); creation logic enforces invariants; external callers do not assemble aggregates field-by-field.

---

## Specification

**Definition.** A reusable, composable predicate that tests whether an object satisfies certain criteria. Encapsulates query/validation logic that would otherwise be duplicated. (Evans, ch. 9; Fowler, "Specification")

**When to use.** When the same filtering/validation rule appears in multiple places, or when rules must be combined dynamically (AND/OR/NOT).

### GOOD

```csharp
public abstract class Specification<T>
{
    public abstract bool IsSatisfiedBy(T candidate);
    public Specification<T> And(Specification<T> other) => new AndSpecification<T>(this, other);
    public Specification<T> Or(Specification<T> other) => new OrSpecification<T>(this, other);
    public Specification<T> Not() => new NotSpecification<T>(this);
}

public sealed class OrderExceedsThreshold(Money threshold) : Specification<Order>
{
    public override bool IsSatisfiedBy(Order candidate)
        => candidate.Total().Amount > threshold.Amount;
}
```

### BAD

```csharp
// Same logic duplicated in three places with slight variations
if (order.Lines.Sum(l => l.UnitPrice.Amount * l.Quantity) > 1000m) { ... }
// ... elsewhere ...
if (order.Lines.Sum(l => l.UnitPrice.Amount * l.Quantity) >= 1000m) { ... } // off-by-one drift
```

**Checklist:** Repeated query/validation logic is extracted into a Specification; specifications are composable; no duplicated predicate logic across files.

---

## Domain Service vs Application Service

**Definition.** A **domain service** is a stateless operation that belongs to the domain but does not naturally fit inside a single entity or value object. An **application service** (use case) orchestrates domain objects and infrastructure to fulfill a user intent — it contains no domain logic itself. (Evans, ch. 7; Vernon, ch. 4 & 14)

**When to use a domain service.** When an operation involves multiple aggregates, or the logic is a domain concept that does not belong to any single entity (e.g., "transfer funds between two accounts").

**When to use an application service.** Always, for orchestrating a use case: load aggregates, call domain methods, persist, publish events.

### GOOD

```csharp
// Domain service — pure domain logic, no infrastructure
public sealed class FundTransferService
{
    public void Transfer(Account source, Account destination, Money amount)
    {
        source.Debit(amount);
        destination.Credit(amount);
    }
}

// Application service (use case) — orchestration only
internal sealed class TransferFunds(
    IAccountRepository accounts,
    FundTransferService transferService,
    IUnitOfWork uow) : ITransferFunds
{
    public async Task ExecuteAsync(TransferFundsCommand cmd, CancellationToken ct)
    {
        var source = await accounts.FindByIdAsync(cmd.SourceId, ct)
            ?? throw new DomainException("Source account not found.");
        var dest = await accounts.FindByIdAsync(cmd.DestinationId, ct)
            ?? throw new DomainException("Destination account not found.");

        transferService.Transfer(source, dest, cmd.Amount);
        await uow.SaveChangesAsync(ct);
    }
}
```

### BAD

```csharp
// "Service" that contains all the logic — entities are anemic
public class OrderService
{
    public void ConfirmOrder(Order order)
    {
        if (order.Lines.Count == 0) throw new Exception("Empty");
        order.Status = "Confirmed"; // direct field mutation
        order.ConfirmedAt = DateTime.UtcNow;
    }
}
```

**Checklist:** Domain services are stateless and contain only domain logic; application services orchestrate but contain no business rules; behavior that fits one entity lives on that entity, not in a service.

---

## Rich vs Anemic Model

**Definition.** A **rich domain model** places behavior (methods enforcing invariants) alongside data in entities/value objects. An **anemic domain model** has entities that are pure data bags (getters/setters only) with all logic in external services. (Fowler, "Anemic Domain Model" — an anti-pattern)

**When to use rich.** Always, unless the domain is genuinely CRUD-only with no business rules. Even simple validation (non-null, range) belongs on the entity.

### GOOD

```csharp
public sealed class Policy
{
    public PolicyId Id { get; }
    public PolicyStatus Status { get; private set; }
    public DateOnly EffectiveDate { get; private set; }

    public void Activate(DateOnly effectiveDate)
    {
        if (Status != PolicyStatus.Pending)
            throw new DomainException("Only pending policies can be activated.");
        if (effectiveDate < DateOnly.FromDateTime(DateTime.UtcNow))
            throw new DomainException("Effective date cannot be in the past.");
        Status = PolicyStatus.Active;
        EffectiveDate = effectiveDate;
    }
}
```

### BAD

```csharp
public class Policy
{
    public Guid Id { get; set; }
    public string Status { get; set; } = "";
    public DateTime EffectiveDate { get; set; }
}

public class PolicyService
{
    public void Activate(Policy p, DateTime date)
    {
        p.Status = "Active";
        p.EffectiveDate = date;
    }
}
```

**Checklist:** Entities have behavior methods (not just properties); no "manager"/"service" class that mutates entity fields directly; invariants are enforced inside the entity, not externally.

---

## Invariants & Encapsulation

**Definition.** An invariant is a business rule that must always hold true for an aggregate. Encapsulation protects invariants by restricting how state is mutated — private setters, method-only mutation, constructor validation. (Vernon, ch. 5 & 10)

**When to enforce.** Every aggregate must protect its invariants at all times. A partially-valid aggregate should never exist.

### GOOD

```csharp
public sealed class InventoryItem
{
    public int Quantity { get; private set; }

    public void Adjust(int delta)
    {
        var next = Quantity + delta;
        if (next < 0)
            throw new DomainException("Quantity cannot go negative.");
        Quantity = next;
    }
}
```

### BAD

```csharp
public class InventoryItem
{
    public int Quantity { get; set; } // anyone can set -5
}
```

**Checklist:** Domain state has private setters; mutation methods validate invariants before applying; no public setter allows an invalid state to exist.
