# DDD + CQRS (Opt-In Per Bounded Context)

**DDD tactical patterns and CQRS are optional, chosen per bounded context.** Activate them only
when the domain logic is complex enough to justify the extra structure. They are orthogonal to the
persistence choice: a bounded context may use DDD/CQRS over **either** an EF Core CRUD model **or**
a Marten event store — both persistence styles are first-class (ADR-0037). For event-sourced
contexts, the store is Marten, one ancillary store per bounded context (ADR-0048); see
`backend/src/Companies/`.

## When To Opt In

- Domain has rich business rules and invariants (e.g., order validation, eligibility checks).
- Read and write models differ significantly (e.g., write: order state machine; read: customer invoice list).
- Need to decouple command processing from query optimization.
- Team is comfortable with CQRS complexity.

**When NOT to opt in:** Simple CRUD modules (e.g., Invoice listing) don't need DDD layering or CQRS. Use basic EF Core CRUD.

## Architecture

Within the hexagon, add two responsibilities:

1. **Domain layer:** Aggregates, value objects, domain events, repository interfaces.
2. **CQRS split:** Separate `*Command` handlers (writes) from `*Query` handlers (reads).

```text
Core/
├── Aggregates/              # Business entities, invariants
│   └── Order.cs
├── ValueObjects/            # Immutable domain values
│   └── OrderItem.cs
├── DomainEvents/            # Events raised by aggregates (internal to module)
│   └── OrderCreated.cs
├── Ports/
│   ├── Incoming/
│   │   ├── ICreateOrder.cs
│   │   └── IGetOrderDetails.cs
│   └── Outgoing/
│       └── IOrderRepository.cs
├── Commands/                # Write commands
│   └── CreateOrderCommand.cs
├── Queries/                 # Read queries
│   └── GetOrderDetailsQuery.cs
└── Handlers/
    ├── CreateOrderHandler.cs
    └── GetOrderDetailsHandler.cs
```

## Aggregate Design

Aggregates enforce invariants. Create via **factory method**, mutate via **domain events**.

```csharp
// Core/Aggregates/Order.cs
public sealed class Order : AggregateRoot
{
    public IReadOnlyList<OrderItem> Items { get; private set; } = [];
    public decimal Total { get; private set; }
    public OrderStatus Status { get; private set; } = OrderStatus.Pending;

    private Order() { }  // EF rehydration

    // Factory: validates invariants, raises event
    public static Result<Order> Place(IReadOnlyList<OrderItem> items)
    {
        if (items.Count == 0)
            return Result<Order>.Fail(new OrderHasNoItems());

        var order = new Order();
        order.RaiseDomainEvent(new OrderCreated(
            OrderId: Guid.NewGuid(),
            Items: items,
            Total: items.Sum(i => i.Price * i.Quantity)));

        return Result<Order>.Success(order);
    }

    // When: apply event to aggregate state
    protected override void When(DomainEvent @event)
    {
        switch (@event)
        {
            case OrderCreated e:
                Id = e.OrderId;
                Items = e.Items;
                Total = e.Total;
                Status = OrderStatus.Pending;
                break;

            case OrderConfirmed e:
                Status = OrderStatus.Confirmed;
                break;

            case OrderCancelled e:
                Status = OrderStatus.Cancelled;
                break;
        }
    }
}

// Core/Aggregates/OrderStatus.cs
public enum OrderStatus
{
    Pending,
    Confirmed,
    Cancelled
}
```

**Base class (SharedKernel):**

```csharp
public abstract class AggregateRoot
{
    public Guid Id { get; protected set; }
    private readonly List<DomainEvent> _uncommittedEvents = new();

    public IReadOnlyList<DomainEvent> UncommittedEvents => _uncommittedEvents.AsReadOnly();

    protected void RaiseDomainEvent(DomainEvent @event)
    {
        _uncommittedEvents.Add(@event);
        When(@event);
    }

    public void LoadFromHistory(IEnumerable<DomainEvent> events)
    {
        foreach (var @event in events)
            When(@event);
    }

    protected abstract void When(DomainEvent @event);

    public void MarkEventsAsCommitted() => _uncommittedEvents.Clear();
}
```

## Value Objects

Immutable, equality-by-value. Create via factory method.

```csharp
// Core/ValueObjects/OrderItem.cs
public sealed record OrderItem
{
    public Guid ProductId { get; init; }
    public string Name { get; init; } = string.Empty;
    public decimal Price { get; init; }
    public int Quantity { get; init; }

    private OrderItem() { }

    public static Result<OrderItem> Of(Guid productId, string name, decimal price, int quantity)
    {
        if (string.IsNullOrWhiteSpace(name))
            return Result<OrderItem>.Fail(new InvalidOrderItem("Name is required"));

        if (price < 0)
            return Result<OrderItem>.Fail(new InvalidOrderItem("Price cannot be negative"));

        if (quantity <= 0)
            return Result<OrderItem>.Fail(new InvalidOrderItem("Quantity must be > 0"));

        return Result<OrderItem>.Success(new OrderItem
        {
            ProductId = productId,
            Name = name,
            Price = price,
            Quantity = quantity
        });
    }
}
```

## Domain Events (Internal to Module)

Raised during aggregate mutation. May be promoted to **integration events** (see [optional-event-sourcing.md](optional-event-sourcing.md)).

```csharp
// Core/DomainEvents/DomainEvent.cs (SharedKernel)
public abstract record DomainEvent
{
    public Guid AggregateId { get; init; } = Guid.NewGuid();
    public DateTime OccurredAt { get; init; } = DateTime.UtcNow;
}

// Core/DomainEvents/OrderCreated.cs
public sealed record OrderCreated : DomainEvent
{
    public Guid OrderId { get; init; }
    public required IReadOnlyList<OrderItem> Items { get; init; }
    public decimal Total { get; init; }
}

public sealed record OrderConfirmed : DomainEvent
{
    public Guid OrderId { get; init; }
}

public sealed record OrderCancelled : DomainEvent
{
    public Guid OrderId { get; init; }
}
```

## CQRS: Commands and Queries

### Commands (Write Side)

```csharp
// Core/Commands/CreateOrderCommand.cs
public sealed record CreateOrderCommand
{
    public required IReadOnlyList<(Guid ProductId, int Quantity)> OrderItems { get; init; }
}

// Core/Handlers/CreateOrderHandler.cs
public sealed class CreateOrderHandler(
    IOrderRepository orderRepository,
    IProductRepository productRepository) : ICommandHandler<CreateOrderCommand, Guid>
{
    public async Task<Guid> Handle(CreateOrderCommand command, CancellationToken cancellationToken)
    {
        // Fetch aggregates from repositories
        var products = await productRepository.GetByIdsAsync(
            command.OrderItems.Select(oi => oi.ProductId).ToList());

        // Build value objects
        var orderItems = command.OrderItems
            .Select(oi =>
            {
                var product = products.FirstOrDefault(p => p.Id == oi.ProductId);
                if (product == null)
                    throw new InvalidOperationException($"Product {oi.ProductId} not found");

                return OrderItem.Of(
                    oi.ProductId,
                    product.Name,
                    product.Price,
                    oi.Quantity);
            })
            .ToList();

        // Create aggregate via factory
        var placeResult = Order.Place(orderItems);
        if (placeResult.IsFailed)
            throw new DomainException(placeResult.Error!);

        // Save aggregate (persists uncommitted events)
        await orderRepository.Save(placeResult.Value);

        return placeResult.Value.Id;
    }
}
```

### Queries (Read Side)

Read queries do **not** rehydrate aggregates. They read **denormalized read models** built by event handlers.

```csharp
// Core/Queries/GetOrderDetailsQuery.cs
public sealed record GetOrderDetailsQuery
{
    public required Guid OrderId { get; init; }
}

public sealed record OrderDetailsDto
{
    public Guid OrderId { get; init; }
    public decimal Total { get; init; }
    public string Status { get; init; } = string.Empty;
    public IReadOnlyList<OrderLineDto> Lines { get; init; } = [];
}

public sealed record OrderLineDto
{
    public string ProductName { get; init; } = string.Empty;
    public decimal Price { get; init; }
    public int Quantity { get; init; }
}

// Core/Handlers/GetOrderDetailsHandler.cs
public sealed class GetOrderDetailsHandler(
    IOrderDetailsRepository readRepository) : IQueryHandler<GetOrderDetailsQuery, OrderDetailsDto>
{
    public async Task<OrderDetailsDto> Handle(GetOrderDetailsQuery query, CancellationToken cancellationToken)
    {
        return await readRepository.GetByIdAsync(query.OrderId, cancellationToken)
            ?? throw new OrderNotFound(query.OrderId);
    }
}
```

## Event Handlers: Read Model Projections

When a domain event is raised, event handlers update read models (EF Core tables).

```csharp
// Infrastructure/EventHandlers/OrderCreatedProjector.cs
public sealed class OrderCreatedProjector(OrderDetailsDbContext dbContext)
{
    public async Task Handle(OrderCreated @event)
    {
        var projection = new OrderDetailsReadModel
        {
            OrderId = @event.OrderId,
            Total = @event.Total,
            Status = "Pending",
            Lines = @event.Items
                .Select(oi => new OrderLineReadModel
                {
                    ProductName = oi.Name,
                    Price = oi.Price,
                    Quantity = oi.Quantity
                })
                .ToList()
        };

        dbContext.OrderDetails.Add(projection);
        await dbContext.SaveChangesAsync();
    }
}
```

Register in module:

```csharp
// OrderModule.cs
public IServiceCollection RegisterModule(IServiceCollection services)
{
    services.AddScoped<ICommandHandler<CreateOrderCommand, Guid>, CreateOrderHandler>();
    services.AddScoped<IQueryHandler<GetOrderDetailsQuery, OrderDetailsDto>, GetOrderDetailsHandler>();

    // Event projectors
    services.AddScoped<OrderCreatedProjector>();

    return services;
}
```

## Repository (Write Side)

Persists aggregates (and their uncommitted events).

```csharp
// Core/Ports/Outgoing/IOrderRepository.cs
public interface IOrderRepository
{
    Task Save(Order aggregate);
    Task<Order?> GetById(Guid id);
}

// Infrastructure/Adapter/EfCoreOrderRepository.cs (Event Sourcing version)
public sealed class EfCoreOrderRepository(OrderDbContext dbContext) : IOrderRepository
{
    public async Task Save(Order aggregate)
    {
        // Persist uncommitted events to event store
        var events = aggregate.UncommittedEvents;
        foreach (var @event in events)
        {
            var eventRecord = new EventRecord
            {
                StreamId = aggregate.Id,
                EventType = @event.GetType().Name,
                EventData = System.Text.Json.JsonSerializer.Serialize(@event),
                OccurredAt = @event.OccurredAt
            };
            dbContext.Events.Add(eventRecord);
        }

        aggregate.MarkEventsAsCommitted();
        await dbContext.SaveChangesAsync();
    }

    public async Task<Order?> GetById(Guid id)
    {
        var events = await dbContext.Events
            .Where(e => e.StreamId == id)
            .OrderBy(e => e.Version)
            .ToListAsync();

        if (events.Count == 0)
            return null;

        var order = new Order();
        foreach (var @event in events)
        {
            var domainEvent = System.Text.Json.JsonSerializer.Deserialize<DomainEvent>(@event.EventData);
            // Rehydrate via When()
        }

        return order;
    }
}
```

Or simple CRUD version (no event sourcing):

```csharp
// Infrastructure/Adapter/EfCoreOrderRepository.cs (Simple CRUD)
public sealed class EfCoreOrderRepository(OrderDbContext dbContext) : IOrderRepository
{
    public async Task Save(Order aggregate)
    {
        var entity = await dbContext.Orders.FirstOrDefaultAsync(o => o.Id == aggregate.Id);

        if (entity == null)
            dbContext.Orders.Add(new OrderEntity(aggregate));
        else
            entity.UpdateFrom(aggregate);

        await dbContext.SaveChangesAsync();
    }

    public async Task<Order?> GetById(Guid id)
    {
        var entity = await dbContext.Orders.FirstOrDefaultAsync(o => o.Id == id);
        return entity?.ToAggregate();
    }
}
```

## Checklist: DDD + CQRS Implementation

- [ ] Define aggregate root (factory method + When)
- [ ] Define value objects (immutable, equality-by-value)
- [ ] Define domain events (raised by aggregate)
- [ ] Define command (write operation)
- [ ] Define command handler (business logic, call aggregate factory, save)
- [ ] Define query (read operation)
- [ ] Define query handler (read-only, no aggregate mutation)
- [ ] Define read model entity (denormalized for query)
- [ ] Create event projector (handles domain events, updates read model)
- [ ] Implement repository (write side: aggregate persistence)
- [ ] Implement read repository (read side: read model queries)
- [ ] Test aggregate invariants with narrow tests
- [ ] Test command handler with mocked repositories
- [ ] Test query handler with read models
- [ ] Verify event projections keep read model in sync
