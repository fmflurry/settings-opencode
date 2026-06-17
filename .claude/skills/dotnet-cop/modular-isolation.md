# dotnet-cop / modular isolation

Module boundaries, no direct cross-module type references, communication via contracts/registry, reflection-based module discovery.

## 🟢 Architecture blockers

### Direct cross-module type reference (concrete type, not contract)
```csharp
// BAD — Module A imports concrete class from Module B's internal namespace
using MyApp.Module.Order.Core;           // inside Module.User — 🟢 violation

// GOOD — Module A uses a shared contract / public API
using MyApp.Shared.Contracts.Orders;     // contract defined in Shared kernel
```
Modules communicate only via:
1. Shared kernel contracts (`Shared/` or `Core/Interface/`)
2. A dependency-inversion port: Module A defines an outgoing port; Module B's adapter implements it and is registered in B's module.

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
Each module owns its own DI registrations. Cross-module dependencies must flow through ports.

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

Cite the `using` directive line for cross-module import findings. Cite the `RegisterModule` method for wrong-module DI registration findings. Include the module names: `UserModule → OrderModule.Infrastructure (forbidden direct reference)`.
