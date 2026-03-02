---
name: dotnet-clean-arch-hexagonal-modular
description: Scaffold and extend .NET 8 Minimal API BFF modules using Clean Architecture (Application/Core/Infrastructure), Hexagonal port/adapter boundaries, and reflection-based module isolation.
---

# .NET Clean + Hexagonal + Modular Architecture

## When To Activate

- Scaffolding a new .NET REST API following modular hexagonal architecture
- Adding a new module or feature slice to an existing project
- Adding an endpoint/use-case with infrastructure integration (DB, HTTP, queue, filesystem)
- Refactoring code toward ports/adapters and module isolation

## Architecture Overview

```text
api/
├── Module/
│   ├── IModule.cs                        # Module contract
│   ├── ModuleExtensions.cs               # Reflection-based auto-discovery
│   ├── <ModuleName>/
│   │   ├── <ModuleName>Module.cs         # DI entrypoint (implements IModule)
│   │   ├── Application/                  # Driving side (HTTP)
│   │   │   ├── Endpoint/                 # MinimalApi.Endpoint implementations
│   │   │   └── Validator/                # FluentValidation rules (optional)
│   │   ├── Core/                         # Domain hexagon (pure logic, zero infra deps)
│   │   │   ├── <UseCase>.cs              # Use case implementation
│   │   │   ├── Exception/                # Module-specific domain exceptions
│   │   │   ├── Model/                    # Domain models
│   │   │   │   └── Endpoint/             # Request/Response DTOs
│   │   │   └── Ports/
│   │   │       ├── Incoming/             # What domain exposes (use case interfaces)
│   │   │       └── Outgoing/             # What domain needs (infra abstractions)
│   │   └── Infrastructure/               # Driven side (DB, external services)
│   │       ├── Adapter/                  # Implements outgoing ports
│   │       └── Mapping/                  # AutoMapper profiles
├── Core/                                  # Shared kernel
│   ├── Data/
│   │   ├── Entities/                     # EF Core entities
│   │   └── Repositories/                # Repository interfaces + implementations
│   ├── Endpoint/                         # Base request/response (CorrelationId)
│   └── Interface/                        # Shared interfaces
├── Infrastructure/                        # Cross-cutting infrastructure
│   ├── Context/                          # DbContext + EF configurations
│   ├── Identity/                         # Auth middleware, JWT, passwords
│   └── ExceptionHandler.cs              # Global ProblemDetails handler
├── Shared/
│   └── Exceptions/                       # Domain exception hierarchy
├── Constants/                             # Auth, Roles, Policies constants
└── Program.cs                             # Composition root

tests/
├── narrow/                                # Unit tests (mocked ports)
│   └── <ModuleName>/
└── wide/                                  # Integration tests (WebApplicationFactory)
    └── <ModuleName>/
```

## Dependency Rules (CRITICAL)

```
Endpoint --> [Incoming Port] --> Use Case --> [Outgoing Port] <-- Adapter --> Repository/EF
   |               ^                               ^               |
Application       Core                            Core        Infrastructure
```

- **Core has ZERO infrastructure dependencies** — only defines ports (interfaces) and pure business logic.
- **Application depends on Core only** — calls incoming ports, never infrastructure directly.
- **Infrastructure depends on Core only** — implements outgoing ports using DB/HTTP/external SDKs.
- **Components never call use cases directly** — always through the incoming port (facade pattern).
- **Cross-module calls are forbidden as direct type references** — expose as a port and implement an adapter.

## Module Contract & Discovery

### IModule Interface

```csharp
// api/Module/IModule.cs
namespace api.Module;

public interface IModule
{
    IServiceCollection RegisterModule(IServiceCollection services);
}
```

### Reflection-Based Auto-Discovery

```csharp
// api/Module/ModuleExtensions.cs
namespace api.Module;

public static class ModuleExtensions
{
    private static readonly List<IModule> RegisteredModules = new();

    public static IServiceCollection RegisterModules(this IServiceCollection services)
    {
        var modules = DiscoverModules();
        foreach (var module in modules)
        {
            module.RegisterModule(services);
            RegisteredModules.Add(module);
        }
        return services;
    }

    private static IEnumerable<IModule> DiscoverModules()
    {
        return typeof(IModule).Assembly
            .GetTypes()
            .Where(t => t.IsClass && t.IsAssignableTo(typeof(IModule)))
            .Select(Activator.CreateInstance)
            .Cast<IModule>();
    }
}
```

**Constraints:**

- Module classes must have a **parameterless constructor**.
- Modules must live in the **same assembly** as `IModule` (unless you expand discovery).

## Base Classes (Shared Kernel)

```csharp
// api/Core/Endpoint/BaseMessage.cs
namespace api.Core.Endpoint;

public class BaseMessage
{
    public Guid CorrelationId { get; init; } = Guid.NewGuid();
}

// api/Core/Endpoint/BaseRequest.cs
public class BaseRequest(Guid correlationId) : BaseMessage;

// api/Core/Endpoint/BaseResponse.cs
public class BaseResponse(Guid correlationId) : BaseMessage;
```

## Domain Exceptions

```csharp
// api/Shared/Exceptions/ProblemDetailsException.cs
namespace api.Shared.Exceptions;

public class ProblemDetailsException(string detail) : Exception(detail);

// api/Shared/Exceptions/<Name>Exception.cs  (or module-level Core/Exception/)
public class <Name>Exception(string detail)
    : ProblemDetailsException($"<User-friendly message>: {detail}");
```

All domain exceptions extend `ProblemDetailsException`. The global `ExceptionHandler` converts them to RFC 7807 ProblemDetails responses (400 for domain exceptions, 500 for unexpected).

## Implementation Playbook (Add a New Feature)

Follow these steps **in order**.

### 1. Create or Pick the Target Module

```csharp
// api/Module/<ModuleName>/<ModuleName>Module.cs
namespace api.Module.<ModuleName>;

public class <ModuleName>Module : IModule
{
    public IServiceCollection RegisterModule(IServiceCollection services)
    {
        // Incoming port -> use case
        services.AddScoped<I<VerbNoun>, <VerbNoun>>();

        // Outgoing port -> adapter
        services.AddScoped<I<VerbNoun>Port, <VerbNoun>Adapter>();

        // AutoMapper
        services.AddAutoMapper(typeof(<VerbNoun>Profile).Assembly);

        return services;
    }
}
```

### 2. Define Request/Response DTOs

```csharp
// Core/Model/Endpoint/<VerbNoun>Request.cs
namespace api.Module.<ModuleName>.Core.Model.Endpoint;

public class <VerbNoun>Request : BaseRequest
{
    public string Field { get; set; }
}

// Core/Model/Endpoint/<VerbNoun>Response.cs
public class <VerbNoun>Response : BaseResponse
{
    public Guid Id { get; set; }
}
```

### 3. Define Incoming Port

```csharp
// Core/Ports/Incoming/I<VerbNoun>.cs
namespace api.Module.<ModuleName>.Core.Ports.Incoming;

public interface I<VerbNoun>
{
    Task<<ResponseModel>> HandleAsync(<RequestModel> request);
}
```

### 4. Define Outgoing Port

```csharp
// Core/Ports/Outgoing/I<VerbNoun>Port.cs
namespace api.Module.<ModuleName>.Core.Ports.Outgoing;

public interface I<VerbNoun>Port
{
    Task<bool> <ValidationCheck>(string value);
    Task<Guid> <ExecuteOperation>(<RequestModel> request);
}
```

### 5. Implement Use Case (Pure Business Logic)

```csharp
// Core/<VerbNoun>.cs
namespace api.Module.<ModuleName>.Core;

public class <VerbNoun>(I<VerbNoun>Port port) : I<VerbNoun>
{
    public async Task<<ResponseModel>> HandleAsync(<RequestModel> request)
    {
        Guard.Against.NullOrEmpty(request.Field);

        // Business rules via outgoing ports
        var valid = await port.<ValidationCheck>(request.Field);
        if (!valid)
            throw new <Domain>Exception(request.Field);

        var id = await port.<ExecuteOperation>(request);
        return new <ResponseModel> { Id = id };
    }
}
```

### 6. Implement Adapter

```csharp
// Infrastructure/Adapter/<VerbNoun>Adapter.cs
namespace api.Module.<ModuleName>.Infrastructure.Adapter;

public class <VerbNoun>Adapter(
    I<Entity>Repository repository,
    IMapper mapper) : I<VerbNoun>Port
{
    public async Task<bool> <ValidationCheck>(string value)
    {
        var existing = await repository.GetByFieldAsync(value);
        return existing is null;
    }

    public async Task<Guid> <ExecuteOperation>(<RequestModel> request)
    {
        var entity = mapper.Map<<Entity>>(request);
        return await repository.Save(entity);
    }
}
```

### 7. Create AutoMapper Profile

```csharp
// Infrastructure/Mapping/<VerbNoun>Profile.cs
namespace api.Module.<ModuleName>.Infrastructure.Mapping;

public class <VerbNoun>Profile : Profile
{
    public <VerbNoun>Profile()
    {
        CreateMap<<RequestModel>, <Entity>>();
    }
}
```

### 8. Create Validator (Optional)

```csharp
// Application/Validator/<VerbNoun>Validator.cs
namespace api.Module.<ModuleName>.Application.Validator;

public class <VerbNoun>Validator : AbstractValidator<<RequestModel>>
{
    public <VerbNoun>Validator()
    {
        RuleFor(r => r.Field)
            .NotEmpty().WithMessage("Field is required.")
            .MaximumLength(50).WithMessage("Field max 50 characters.");
    }
}
```

### 9. Create Endpoint

```csharp
// Application/Endpoint/<VerbNoun>Endpoint.cs
using MinimalApi.Endpoint;

namespace api.Module.<ModuleName>.Application.Endpoint;

public class <VerbNoun>Endpoint(
    I<VerbNoun> useCase,
    IValidator<<RequestModel>> validator)
    : IEndpoint<Results<Created<<ResponseDto>>, BadRequest<ProblemDetails>>, <RequestDto>>
{
    public void AddRoute(IEndpointRouteBuilder app)
    {
        app.MapPost("api/<resource>", ([FromBody] <RequestDto> request) => HandleAsync(request));
    }

    public async Task<Results<Created<<ResponseDto>>, BadRequest<ProblemDetails>>> HandleAsync(<RequestDto> request)
    {
        var validation = await validator.ValidateAsync(request);
        if (!validation.IsValid)
            return TypedResults.BadRequest<ProblemDetails>(new ProblemDetails
            {
                Detail = string.Join("; ", validation.Errors.Select(e => e.ErrorMessage))
            });

        var result = await useCase.HandleAsync(request);
        return TypedResults.Created($"api/<resource>/{result.Id}",
            new <ResponseDto>(request.CorrelationId) { Id = result.Id });
    }
}
```

### 10. Register in Module

Update `<ModuleName>Module.cs` with all bindings (see step 1).

### 11. Add Domain Exceptions (If Needed)

```csharp
// Core/Exception/<Specific>Exception.cs  (or Shared/Exceptions/)
namespace api.Module.<ModuleName>.Core.Exception;

public class <Specific>Exception(string detail)
    : ProblemDetailsException($"<User-friendly message>: {detail}");
```

### 12. Write Tests

See [Testing Pattern](#testing-pattern) below.

## Testing Pattern

### Narrow (Unit) Tests — Mock Outgoing Ports

```csharp
// tests/narrow/<ModuleName>/<VerbNoun>Should.cs
public class <VerbNoun>Should
{
    private readonly I<VerbNoun> _useCase;
    private readonly I<VerbNoun>Port _port = Substitute.For<I<VerbNoun>Port>();

    public <VerbNoun>Should()
    {
        _useCase = new <VerbNoun>(_port);
    }

    [Fact]
    public async Task Return_Result_When_Successful()
    {
        _port.<ValidationCheck>(Arg.Any<string>()).Returns(true);
        _port.<ExecuteOperation>(Arg.Any<<RequestModel>>()).Returns(Guid.NewGuid());

        var result = await _useCase.HandleAsync(new <RequestModel> { Field = "value" });

        result.Id.Should().NotBeEmpty();
        await _port.Received().<ExecuteOperation>(Arg.Any<<RequestModel>>());
    }

    [Fact]
    public async Task Throw_Exception_When_Business_Rule_Violated()
    {
        _port.<ValidationCheck>(Arg.Any<string>()).Returns(false);

        var act = async () => await _useCase.HandleAsync(new <RequestModel> { Field = "value" });

        await act.Should().ThrowExactlyAsync<<Domain>Exception>();
    }
}
```

### Wide (Integration) Tests — Full HTTP Pipeline

```csharp
// tests/wide/<ModuleName>/<VerbNoun>EndpointShould.cs
public class <VerbNoun>EndpointShould : BaseEndpointWaf
{
    public <VerbNoun>EndpointShould()
    {
        var data = _entities.AsQueryable().BuildMockDbSet();
        var contextFake = Substitute.For<ICatalogContext>();
        contextFake.<DbSet>.Returns(data);

        var repository = new <Repository>(contextFake);

        App = new WafApp(x =>
        {
            x.AddSingleton<IRepository>(repository);
        });
    }

    [Fact]
    public async Task Return_Created_When_Valid()
    {
        var payload = JsonContent(new <RequestModel> { Field = "value" });
        var response = await GetResponseAsync("/api/<resource>", payload, HttpMethod.Post);

        response.StatusCode.Should().Be(HttpStatusCode.Created);
    }

    [Fact]
    public async Task Return_BadRequest_When_Invalid()
    {
        var payload = JsonContent(new <RequestModel> { Field = "" });
        var response = await GetResponseAsync("/api/<resource>", payload, HttpMethod.Post);

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }
}
```

## Key Libraries

| Library              | Purpose                                                      |
| -------------------- | ------------------------------------------------------------ |
| MinimalApi.Endpoint  | Typed minimal API endpoints (`IEndpoint<TResult, TRequest>`) |
| AutoMapper           | DTO <-> Entity mapping                                       |
| FluentValidation     | Request validation                                           |
| Ardalis.GuardClauses | Defensive programming in use cases                           |
| NSubstitute          | Test mocking (outgoing ports)                                |
| FluentAssertions     | Test assertions                                              |
| MockQueryable        | Mock EF Core DbSets for wide tests                           |

## Naming Conventions

| Artifact          | Pattern                    | Example                      |
| ----------------- | -------------------------- | ---------------------------- |
| Module class      | `<ModuleName>Module`       | `UserModule`                 |
| Incoming port     | `I<VerbNoun>`              | `IRegisterUser`              |
| Outgoing port     | `I<VerbNoun>Port`          | `IRegisterUserPort`          |
| Use case          | `<VerbNoun>`               | `RegisterUser`               |
| Adapter           | `<VerbNoun>Adapter`        | `RegisterUserAdapter`        |
| Endpoint          | `<VerbNoun>Endpoint`       | `RegisterUserEndpoint`       |
| Validator         | `<VerbNoun>Validator`      | `RegisterUserValidator`      |
| Mapper profile    | `<VerbNoun>Profile`        | `RegisterUserProfile`        |
| Request DTO       | `<VerbNoun>Request`        | `RegisterUserRequest`        |
| Response DTO      | `<VerbNoun>Response`       | `RegisterUserResponse`       |
| Domain exception  | `<Noun>Exception`          | `UserAlreadyExistsException` |
| Narrow test class | `<VerbNoun>Should`         | `RegisterUserShould`         |
| Wide test class   | `<VerbNoun>EndpointShould` | `RegisterUserEndpointShould` |

## Known Tradeoffs

- Module isolation is by **convention** (namespaces + folders) unless you split into separate projects/assemblies.
- Reflection-based discovery ties modules to the host assembly; expand `DiscoverModules()` if modules move to other assemblies.
- EF Core entities and repository concerns should stay **out of module Core**; map in adapters via AutoMapper.
- One incoming port per use case keeps interfaces focused (ISP); avoid god-interfaces grouping multiple operations.

## Checklist: Adding a New Feature

- [ ] Create/pick module folder: `Module/<ModuleName>/`
- [ ] Define request/response DTOs: `Core/Model/Endpoint/`
- [ ] Define incoming port: `Core/Ports/Incoming/I<VerbNoun>.cs`
- [ ] Define outgoing port: `Core/Ports/Outgoing/I<VerbNoun>Port.cs`
- [ ] Implement use case: `Core/<VerbNoun>.cs`
- [ ] Implement adapter: `Infrastructure/Adapter/<VerbNoun>Adapter.cs`
- [ ] Create AutoMapper profile: `Infrastructure/Mapping/<VerbNoun>Profile.cs`
- [ ] Create validator (if needed): `Application/Validator/<VerbNoun>Validator.cs`
- [ ] Create endpoint: `Application/Endpoint/<VerbNoun>Endpoint.cs`
- [ ] Register bindings in module: `<ModuleName>Module.cs`
- [ ] Add domain exceptions if needed
- [ ] Write narrow tests (mock outgoing ports with NSubstitute)
- [ ] Write wide tests (WebApplicationFactory + service overrides)
- [ ] Verify 80%+ test coverage
