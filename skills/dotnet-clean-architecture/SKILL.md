---
name: dotnet-clean-architecture
description: Scaffolds and extends .NET 8 Minimal API BFF modules using Clean Architecture (Application/Core/Infrastructure), Hexagonal port/adapter boundaries, and reflection-based module isolation. Use when creating new .NET modules, adding endpoints/use-cases with infrastructure integration, or refactoring toward ports/adapters and module isolation.
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

**For hard isolation:** Each module can be its own `.csproj` with a sibling `<ModuleName>.Contracts` assembly for public surface (incoming ports, DTOs, events). Consuming modules reference only the contracts assembly — compiler enforces boundaries. See [cross-module-communication.md § Enforcing Boundaries](cross-module-communication.md#enforcing-boundaries-assemblies--the-internal-keyword).

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
- **Cross-module calls are forbidden as direct type references** — module A's outgoing port must depend on module B's incoming port via an anti-corruption layer adapter; or use published integration events for decoupled async communication.
- **For hard isolation, give each module its own assembly and mark all non-contract types `internal`** — a consuming module references only the other module's `.Contracts` assembly. Compile-time enforcement > convention.

## Module Contract & Discovery

```csharp
// api/Module/IModule.cs
public interface IModule
{
    IServiceCollection RegisterModule(IServiceCollection services);
}
```

Modules are auto-discovered via reflection in `ModuleExtensions.cs`. Constraints: parameterless constructor. When modules are in separate assemblies, adapt `DiscoverModules()` to scan the module assemblies explicitly or use explicit registration in `Program.cs`. See [cross-module-communication.md § Reflection Discovery Adaptation](cross-module-communication.md#reflection-discovery-adaptation).

## Cross-Module Communication

Modules communicate via two contract forms: **synchronous in-process calls** (via anti-corruption layer adapter) and **asynchronous published events** (eventual consistency + idempotent consumers). Never reference another module's internal types directly.

**Synchronous (ACL Pattern):** Module A defines an outgoing port `I<VerbNoun>Port` in `Core/Ports/Outgoing/`. Module A's adapter in `Infrastructure/Adapter/` calls module B's incoming port `I<VerbNoun>`, translating between A's domain and B's public contract. A's core remains type-isolated from B's internals.

**Asynchronous (Event):** Module A publishes `<Noun><PastVerb>IntegrationEvent : BaseMessage` via `IEventBus` after state committed. Module B subscribes via `IIntegrationEventHandler<TEvent>`, registered in module initialization. Use transactional Outbox (same ACID transaction for state + event record) to guarantee delivery; consumers must be idempotent (check CorrelationId).

**For full patterns, templates, and tradeoffs** (sync vs. async, sagas, external brokers, eventual consistency guarantees): See [cross-module-communication.md](cross-module-communication.md).

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
| Module assembly | `<ModuleName>` | `User` (User.csproj) |
| Contracts assembly | `<ModuleName>.Contracts` | `User.Contracts` |
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
| Integration event | `<Noun><PastVerb>IntegrationEvent` | `UserRegisteredIntegrationEvent` |
| Event handler | `<Noun><PastVerb>Handler` | `UserRegisteredHandler` |
| Cross-module ACL port | `I<VerbNoun>Port` | `IGetUserEligibilityPort` |
| Narrow test class | `<VerbNoun>Should` | `RegisterUserShould` |
| Wide test class | `<VerbNoun>EndpointShould` | `RegisterUserEndpointShould` |

## Known Tradeoffs

- Module isolation is by **convention** (namespaces + folders) by default. For compile-time enforcement, split into separate assemblies with `internal` access modifiers on non-contract types. See [cross-module-communication.md § Enforcing Boundaries](cross-module-communication.md#enforcing-boundaries-assemblies--the-internal-keyword) for project layouts and `InternalsVisibleTo` for test access.
- Reflection-based discovery ties modules to the host assembly; when using separate module assemblies, adapt `DiscoverModules()` to scan referenced module assemblies or use explicit registration.
- EF Core entities and repository concerns should stay **out of module Core**; map in adapters via Riok.Mapperly.
- One incoming port per use case keeps interfaces focused (ISP); avoid god-interfaces grouping multiple operations.

## Checklist: Adding a New Feature

**Core module structure:**
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

**Error handling & testing:**
- [ ] Business errors return `Result<T>`, not exceptions
- [ ] Write narrow tests (mock outgoing ports)
- [ ] Write wide tests (WebApplicationFactory + service overrides)
- [ ] Verify 80%+ test coverage

**Cross-module integration (if applicable):**
- [ ] Cross-module sync dep expressed as ACL adapter: module A's outgoing port → module B's incoming port
- [ ] No direct type references between module cores
- [ ] If async: integration events reuse `BaseMessage` and `CorrelationId`
- [ ] If using Outbox: event written in same transaction as business state
- [ ] Async consumers are idempotent (dedup by CorrelationId or event ID)

**Assembly isolation (when enforcing boundaries at compile time):**
- [ ] Non-contract types marked `internal sealed`
- [ ] Consuming modules reference only `<Module>.Contracts` assembly
- [ ] `InternalsVisibleTo` set for narrow test assembly
- [ ] If needed: `DiscoverModules()` adapted to scan referenced module assemblies
