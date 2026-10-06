# dotnet-cop / modular isolation

Module boundaries, no direct cross-module type references, communication via contracts/registry, reflection-based module discovery. Hard blocker: cross-module dependencies flow ONLY through events (via Wolverine bus) or intent interfaces implemented by consumers.

## 🟢 Architecture blockers

### Direct cross-module type reference (concrete type, not contract)
```csharp
// BAD — Module A imports concrete class from Module B's internal namespace
using MyApp.Module.Order.Core;           // inside Module.User — 🟢 violation

// GOOD — Module A uses a shared contract / public API or receives via DI
using MyApp.Shared.Contracts.Orders;     // contract defined in Shared kernel
```
Modules communicate **only via**:
1. Shared kernel contracts (`Shared/` or `Core/Interface/`) for stateless operations
2. A dependency-inversion port: Module A defines an outgoing port; Module B's adapter implements it and is registered in B's module
3. Integration events via Wolverine bus (one-way, loosely coupled, no shared types)

Note: Each module **names and models the same real-world concept independently** by design (e.g., `User` vs `Vinegrower`). This is NOT a consistency violation — it is module autonomy. The cop MUST NOT flag such naming differences as issues.

### Cross-module project reference (assembly-level coupling)
```xml
<!-- BAD — direct ProjectReference across module boundaries -->
<ProjectReference Include="..\Module.Order.Core\Module.Order.Core.csproj" />  <!-- in Module.User.Application.csproj -->

<!-- BAD — Module B references a .Contracts assembly from Module A -->
<ProjectReference Include="..\Module.Order.Contracts\Module.Order.Contracts.csproj" />  <!-- hard blocker -->

<!-- GOOD — if cross-module communication needed, define intent interface in SharedKernel
         or invert the dependency: Module B defines an outgoing port, A implements the adapter -->
```
Cross-module assembly references (including `<Module>.Contracts`) are hard blockers. Build-time coupling between modules defeats the independence goal. Use ports and adapters; events via the bus.

### A module reads another module's data via shared DbContext or cross-domain read port (hard blocker)
In the modular monolith, each module is self-contained (for example, a Sales module with
subdomains such as Invoices, Customers, Payments, Dunning, Receivables, Catalog). A module
MUST NOT read another module's data through a shared DbContext or a cross-domain read port.

```csharp
// BAD — ModuleB.Infrastructure reads ModuleA data via a wide shared DbContext
using GcPlatform.ModuleA.Infrastructure;            // 🟢 violation (shared DbContext)
var invoice = await moduleADb.Invoices.FirstAsync(...);

// BAD — cross-domain read port defined in SharedKernel (DELETED, never reintroduce)
// GcPlatform.ModuleA.Domain.DunningPorts.ICustomerDunningReader

// GOOD — ModuleB owns its projection in its own DbContext, fed by Wolverine integration events
// (e.g. the Sales module's Dunning subdomain owns DunningDbContext)
using GcPlatform.Sales.Dunning.Infrastructure.Persistence;
var proj = await dunningDb.DunningInvoiceProjections.FirstAsync(p => p.InvoiceId == id);
```
- Each module owns its read projections in its OWN DbContext (its own schema, RLS via
  `TenantSessionInterceptor`). For example, the Sales module's Dunning/Receivables subdomains
  own `DunningDbContext`/`ReceivablesDbContext`; they must NOT reference another module's
  `Infrastructure`/DbContext.
- Inter-module communication happens ONLY via the Wolverine message bus. Integration events are
  plain immutable `record`s in `GcPlatform.<Module>.Contracts` (Wolverine outbox). Domain/
  Application layers stay Wolverine-free; only Infrastructure references
  `GcPlatform.<Module>.Contracts` + Wolverine.
- A module's `Domain` (SharedKernel) holds domain shared types only — NOT inter-module read
  ports. Deleted cross-domain read-port files (e.g. the Sales `DunningPorts.cs`/
  `ReceivablesPorts.cs`) and the deleted cross-module reader adapters (e.g. the Sales
  `EfCore*DunningReader` / `EfCore*ReceivablesReader` family) MUST NEVER be reintroduced.

**Enforced by ArchUnitNET** (for example, `backend/tests/GcPlatform.Sales.Tests/Architecture/LayerDependencyRules.cs`
for the Sales module):
- `<Subdomain>_Infrastructure_must_not_depend_on_<OtherModule>_Infrastructure` (R1: `X.Infrastructure ⊥ Y.Infrastructure`)
- `<Subdomain>_Infrastructure_must_not_depend_on_<OtherModule>Ports` (R2: no `*.DunningPorts`/`*.ReceivablesPorts` refs)
- deleted-file guards: the Sales `EfCoreInvoiceDunningReader`, `EfCoreReceivablesInvoiceReader`,
  `EfCoreCustomerDunningReader`, `EfCorePaymentDunningReader`, `EfCoreReceivablesCustomerReader`,
  `EfCoreReceivablesPaymentReader` family — reintroducing any fails the build.

### Domain model / read-model types must live in `Model/` (convention)
Within each module's Domain project, domain model / read-model types live in a `Model/`
subdirectory; EF `Entities/` stay in `Entities/`. SharedKernel follows the same `Model/`
convention (for example, the Sales module's `GcPlatform.Sales.Domain`).

```csharp
// GOOD (example: the Sales module's Dunning subdomain)
namespace GcPlatform.Sales.Dunning.Domain.Model;     // read-model / domain model types
namespace GcPlatform.Sales.Dunning.Domain.Entities;  // EF-mapped entities
```

### Module registers services from another module
```csharp
// BAD — UserModule registers OrderPort (belongs to OrderModule)
public class UserModule : IModule
{
    public IServiceCollection RegisterModule(IServiceCollection services)
    {
        services.AddScoped<ICreateOrderPort, CreateOrderAdapter>();  // 🟢 wrong module
        return services;
    }
}
```
Each module owns its own DI registrations. Cross-module dependencies must flow through ports or be received as constructor parameters.

### Module discovered via hardcoded list instead of reflection
```csharp
// BAD — explicit list breaks when a new module is added
services.RegisterModule(new UserModule());
services.RegisterModule(new OrderModule());

// GOOD — reflection-based auto-discovery per ModuleExtensions
services.RegisterModules(Assembly.GetExecutingAssembly());
```
`ModuleExtensions.RegisterModules` scans the assembly for `IModule` implementations with a parameterless constructor. New modules are discovered automatically.

### `IModule` implementation missing parameterless constructor
```csharp
// BAD — reflection discovery requires parameterless ctor
public class ReportModule(IConfiguration config) : IModule { ... }

// GOOD — use IConfiguration via service locator in RegisterModule
public class ReportModule : IModule
{
    public IServiceCollection RegisterModule(IServiceCollection services)
    {
        services.AddScoped<IGenerateReport, GenerateReport>();
        // IConfiguration injected at use-case level, not here
        return services;
    }
}
```

## 🟡 Risks

### Module exposes internal implementation type in public namespace
If consumers can import `MyApp.Module.Order.Infrastructure.Adapter.OrderAdapter` directly, the module boundary is effectively broken even if the code compiles:
- Internal implementation types should be `internal sealed`.
- Only DTOs, ports, and exceptions in `Core/` need `public` visibility.

### Shared state via static field across modules
```csharp
// BAD — static cache shared by all modules
public static class GlobalCache
{
    public static readonly ConcurrentDictionary<string, object> Items = new();
}
```
Cross-module state must flow through registered services (singleton scoped to DI container), not static fields.

### Test project imports module internals directly
Integration tests should target the HTTP API surface (WebApplicationFactory) or replace outgoing ports via DI override:
```csharp
// BAD — test directly newing up internal use case
var uc = new RegisterUser(new FakeUserPort());

// GOOD — replace outgoing port via factory
factory.WithWebHostBuilder(b =>
    b.ConfigureServices(s =>
        s.AddScoped<IRegisterUserPort, FakeUserPort>()));
```

## 🔵 Nits

- Module folder name should match the class name: folder `Module/Order/` → class `OrderModule`.
- Module registration order should be deterministic; sort alphabetically in `Program.cs` call if ordering matters.
- `IModule` should live in a single shared location (`api/Module/IModule.cs`) — never duplicated.

## Reporting

Cite the `using` directive line for cross-module import findings. Cite the `<ProjectReference>` line for assembly-level coupling findings. Cite the `RegisterModule` method for wrong-module DI registration findings. Include the module names: `UserModule → OrderModule.Infrastructure (forbidden direct reference)`.

**Explicit rule:** When two modules use different names for the same domain concept (e.g., `User` vs `Vinegrower`), do NOT flag this. State: `"Per-module language autonomy: Order calls them 'Item', Invoicing calls them 'LineItem'. This is by design."` Do not raise as an inconsistency.

Language autonomy applies **across** modules, never **within** one: it does not exempt ANY module from the English + PascalCase BLOCK rules in enforcement.md, and it does not permit synonyms for one concept inside a single module.
