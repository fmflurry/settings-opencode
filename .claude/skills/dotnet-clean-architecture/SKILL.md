---
name: dotnet-clean-architecture
description: Scaffolds and extends .NET 10 Minimal API BFF modules using Clean Architecture (Application/Core/Infrastructure), Hexagonal port/adapter boundaries, and reflection-based module isolation. Use when creating new .NET modules, adding endpoints/use-cases with infrastructure integration, or refactoring toward ports/adapters and module isolation.
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
│   │       └── Mapping/                  # Riok.Mapperly mapper classes
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

```csharp
// api/Module/IModule.cs
public interface IModule
{
    IServiceCollection RegisterModule(IServiceCollection services);
}
```

Modules are auto-discovered via reflection in `ModuleExtensions.cs`. Constraints: parameterless constructor, same assembly as `IModule`.

## Base Classes (Shared Kernel)

```csharp
public class BaseMessage { public Guid CorrelationId { get; init; } = Guid.NewGuid(); }
public class BaseRequest(Guid correlationId) : BaseMessage;
public class BaseResponse(Guid correlationId) : BaseMessage;
```

## Error Handling: Result Pattern

For **expected / business errors**, return a `Result<T>` instead of throwing. Throwing is reserved for genuinely unexpected/unrecoverable exceptions only.

```csharp
public sealed class Result<T>
{
    public bool IsSuccess { get; }
    public T? Value { get; }
    public Error? Error { get; }

    private Result(T value) => (IsSuccess, Value, Error) = (true, value, null);
    private Result(Error error) => (IsSuccess, Value, Error) = (false, default, error);

    public static Result<T> Ok(T value) => new(value);
    public static Result<T> Fail(Error error) => new(error);
}

public sealed record Error(int StatusCode, string Title, string Detail);
```

**Mapping to HTTP**: The global `ExceptionHandler` is reserved for genuinely unexpected exceptions only (IO/DB/framework crashes) → 500 response. Business/validation errors must return a `Result<T>` and map via:

```csharp
public static class ResultExtensions
{
    public static IResult ToHttpResult<T>(this Result<T> result) =>
        result.IsSuccess
            ? Results.Ok(result.Value)
            : Results.Problem(
                statusCode: result.Error!.StatusCode,
                title: result.Error.Title,
                detail: result.Error.Detail);
}
```

## Implementation Playbook

Follow these steps **in order**. **For full templates with code**: See [implementation-playbook.md](implementation-playbook.md).

1. Create or pick the target module (`<ModuleName>Module.cs` implementing `IModule`)
2. Define request/response DTOs in `Core/Model/Endpoint/`
3. Define incoming port in `Core/Ports/Incoming/I<VerbNoun>.cs`
4. Define outgoing port in `Core/Ports/Outgoing/I<VerbNoun>Port.cs`
5. Implement use case in `Core/<VerbNoun>.cs` — pure business logic
6. Implement adapter in `Infrastructure/Adapter/<VerbNoun>Adapter.cs`
7. Create Riok.Mapperly mapper in `Infrastructure/Mapping/<VerbNoun>Mapper.cs`
8. Create validator (optional) in `Application/Validator/<VerbNoun>Validator.cs`
9. Create endpoint in `Application/Endpoint/<VerbNoun>Endpoint.cs`
10. Register all bindings in `<ModuleName>Module.cs`
11. Add domain exceptions if needed
12. Write tests (see [testing-patterns.md](testing-patterns.md))

## Testing

**For full testing patterns**: See [testing-patterns.md](testing-patterns.md).

| Test Type | Scope | Approach |
|-----------|-------|----------|
| Narrow (unit) | Use case logic | Mock outgoing ports with NSubstitute |
| Wide (integration) | Full HTTP pipeline | WebApplicationFactory + service overrides |

Target **80%+ coverage**.

## Naming Conventions

| Artifact | Pattern | Example |
|----------|---------|---------|
| Module class | `<ModuleName>Module` | `UserModule` |
| Incoming port | `I<VerbNoun>` | `IRegisterUser` |
| Outgoing port | `I<VerbNoun>Port` | `IRegisterUserPort` |
| Use case | `<VerbNoun>` | `RegisterUser` |
| Adapter | `<VerbNoun>Adapter` | `RegisterUserAdapter` |
| Endpoint | `<VerbNoun>Endpoint` | `RegisterUserEndpoint` |
| Validator | `<VerbNoun>Validator` | `RegisterUserValidator` |
| Mapper class | `<VerbNoun>Mapper` | `RegisterUserMapper` |
| Request DTO | `<VerbNoun>Request` | `RegisterUserRequest` |
| Response DTO | `<VerbNoun>Response` | `RegisterUserResponse` |
| Domain exception | `<Noun>Exception` | `UserAlreadyExistsException` |
| Narrow test class | `<VerbNoun>Should` | `RegisterUserShould` |
| Wide test class | `<VerbNoun>EndpointShould` | `RegisterUserEndpointShould` |

## Known Tradeoffs

- Module isolation is by **convention** (namespaces + folders) unless you split into separate projects/assemblies.
- Reflection-based discovery ties modules to the host assembly; expand `DiscoverModules()` if modules move to other assemblies.
- EF Core entities and repository concerns should stay **out of module Core**; map in adapters via Riok.Mapperly.
- One incoming port per use case keeps interfaces focused (ISP); avoid god-interfaces grouping multiple operations.

## Checklist: Adding a New Feature

- [ ] Create/pick module folder: `Module/<ModuleName>/`
- [ ] Define request/response DTOs: `Core/Model/Endpoint/`
- [ ] Define incoming port: `Core/Ports/Incoming/I<VerbNoun>.cs`
- [ ] Define outgoing port: `Core/Ports/Outgoing/I<VerbNoun>Port.cs`
- [ ] Implement use case: `Core/<VerbNoun>.cs`
- [ ] Implement adapter: `Infrastructure/Adapter/<VerbNoun>Adapter.cs`
- [ ] Create Riok.Mapperly mapper: `Infrastructure/Mapping/<VerbNoun>Mapper.cs`
- [ ] Create validator (if needed): `Application/Validator/<VerbNoun>Validator.cs`
- [ ] Create endpoint: `Application/Endpoint/<VerbNoun>Endpoint.cs`
- [ ] Register bindings in module: `<ModuleName>Module.cs`
- [ ] Business errors return `Result<T>`, not exceptions
- [ ] Write narrow tests (mock outgoing ports)
- [ ] Write wide tests (WebApplicationFactory + service overrides)
- [ ] Verify 80%+ test coverage
