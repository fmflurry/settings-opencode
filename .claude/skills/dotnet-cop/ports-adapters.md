# dotnet-cop / ports & adapters (hexagonal)

Core defines ports (interfaces). Infrastructure implements adapters. Dependency direction enforced. No EF entities or infrastructure types leaking into Core.

## 🟢 Architecture blockers

### Core imports infrastructure namespace
```csharp
// BAD — use case in Core/ references EF Core or HTTP client
using Microsoft.EntityFrameworkCore;           // 🟢 in Core/ use case
using System.Net.Http;                         // 🟢 in Core/ use case

// GOOD — Core knows only its own types + BCL primitives
// Core/<VerbNoun>.cs has zero using directives pointing to Infrastructure/
```
The dependency rule is absolute: Core → nothing infrastructure. If Core needs data, it calls an outgoing port interface defined in `Core/Ports/Outgoing/`.

### EF Core entity type crosses the port boundary into Core
```csharp
// BAD — outgoing port returns EF entity
public interface IGetOrderPort
{
    Task<OrderEntity> FindByIdAsync(Guid id);  // 🟢 EF entity in port signature
}

// GOOD — port returns a domain model
public interface IGetOrderPort
{
    Task<Order> FindByIdAsync(Guid id);        // domain model, no EF dependency
}
```
EF entities stay in `Infrastructure/`. Map in the adapter using Riok.Mapperly before crossing the port.

### Adapter imports from another module's Core
```csharp
// BAD — Order adapter references User domain model
using MyApp.Module.User.Core.Model;            // 🟢 cross-module Core import

// GOOD — use shared contracts or a dedicated outgoing port in OrderModule
```

### Incoming port not an interface
```csharp
// BAD — concrete class used as incoming port
public class CreateOrder
{
    public async Task<CreateOrderResponse> HandleAsync(CreateOrderRequest req) { ... }
}
// Endpoint injects CreateOrder (concrete) — can't be mocked in narrow tests

// GOOD — interface in Core/Ports/Incoming/
public interface ICreateOrder
{
    Task<CreateOrderResponse> HandleAsync(CreateOrderRequest req);
}
public sealed class CreateOrder(ICreateOrderPort port) : ICreateOrder { ... }
```

### Outgoing port not an interface
Same rule: `Core/Ports/Outgoing/I<VerbNoun>Port.cs` must be an interface. Adapters in `Infrastructure/Adapter/` implement it.

### Use case registered directly without port interface
```csharp
// BAD — binds concrete type without the port interface
services.AddScoped<CreateOrder>();

// GOOD — binds incoming port -> use case
services.AddScoped<ICreateOrder, CreateOrder>();
services.AddScoped<ICreateOrderPort, CreateOrderAdapter>();
```

## 🟡 Risks

### Adapter throws raw infrastructure exceptions across the port boundary
```csharp
// BAD — raw DbUpdateException escapes adapter
public async Task<Order> SaveAsync(Order order)
{
    await context.Orders.AddAsync(MapToEntity(order));
    await context.SaveChangesAsync();  // DbUpdateException bubbles raw
}

// GOOD — adapter maps to domain exception
try { await context.SaveChangesAsync(); }
catch (DbUpdateException ex) when (ex.IsUniqueConstraintViolation())
{
    throw new OrderAlreadyExistsException(order.Id.ToString());
}
```
Port contract guarantees domain exceptions only. Raw infrastructure exceptions are an abstraction leak.

### Adapter has business logic
```csharp
// BAD — adapter applies discount logic
public async Task<Order> SaveAsync(CreateOrderRequest req)
{
    if (req.Total > 1000) req.Discount = 0.1m;  // 🟡 business rule
    ...
}

// GOOD — adapter only maps and persists
public async Task<Order> SaveAsync(Order order)
{
    var entity = mapper.Map<OrderEntity>(order);
    await context.Orders.AddAsync(entity);
    await context.SaveChangesAsync();
    return mapper.Map<Order>(entity);
}
```

### Riok.Mapperly mapper defined outside Infrastructure
Riok.Mapperly mappers map between EF entities and domain models. They belong in `Infrastructure/Mapping/`, not in Core or Application:
```
✅ Infrastructure/Mapping/CreateOrderMapper.cs
❌ Core/Mapping/CreateOrderMapper.cs
❌ Application/Mapping/CreateOrderMapper.cs
```

### One adapter handles multiple unrelated outgoing ports
ISP violation: each adapter should implement one outgoing port. Split large adapters into focused ones.

## 🔵 Nits

- Incoming port naming: `I<VerbNoun>` (e.g. `ICreateOrder`, `IGetUser`).
- Outgoing port naming: `I<VerbNoun>Port` (e.g. `ICreateOrderPort`, `IGetUserPort`).
- Adapter naming: `<VerbNoun>Adapter` (e.g. `CreateOrderAdapter`).
- One interface per file; one adapter per interface.
- Ports folder structure: `Core/Ports/Incoming/` and `Core/Ports/Outgoing/`.

## Reporting

Cite the `using` directive line for Core-imports-infrastructure findings. Cite the port method signature line for EF-entity-crosses-boundary findings. Include layer names: `Core ← Infrastructure (direction violation)`.
