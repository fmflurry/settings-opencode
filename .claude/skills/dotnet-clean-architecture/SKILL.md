---
name: dotnet-clean-architecture
description: Scaffolds and extends .NET 10 Minimal API modules using self-registering IModule + IEndpoint (reflection discovery) + hexagonal ports/adapters per module (Domain/Application/Infrastructure/Presentation). Use when creating new .NET modules, adding endpoints/use-cases, or refactoring toward ports/adapters and module isolation. Persistence is chosen per bounded context — EF Core CRUD and event-sourced Marten stores are both first-class. DDD/CQRS are optional additive patterns.
---

# .NET Clean Architecture: Minimal API + Hexagonal + Modular

**SOURCE OF TRUTH (SoT):** Minimal API endpoints self-register via `IEndpoint`, and each module
self-registers its DI via `IModule`; both are discovered by reflection in
`GcPlatform.SharedKernel.Modularity.ModuleExtensions`. Each module is a hexagon:
**Domain** (pure logic, zero infrastructure) → **Application** (use cases, ports) ↔
**Infrastructure** (adapters, EF Core or Marten, RLS). **Presentation** composes the module
(endpoints, the `<Module>Module : IModule` registrar) and is the only layer allowed to wire
Infrastructure. Persistence is **chosen per bounded context** — EF Core CRUD and event-sourced
Marten stores are both first-class; there is no global default (ADR-0037, ADR-0048). Modules
communicate asynchronously via serialized integration events over the Wolverine message bus —
events are the **only** inter-module contract (ADR-0014). Per-module language autonomy: the same
real-world entity may be named differently **across** modules, but every module's language MUST be
English, and within a module each concept has exactly one name. Database isolation is one
PostgreSQL schema per module with `FORCE ROW LEVEL SECURITY` (RLS), a per-module GUC
`app.tenant_id`, and lightweight per-module roles (ADR-0013/0038).

**Optional additive patterns** (opt-in per module): DDD (aggregates, value objects, domain
events) and CQRS (separate read/write models). Event Sourcing (Marten event stores) is a
**first-class persistence choice per bounded context**, not an optional add-on. See
[optional-ddd-cqrs.md](optional-ddd-cqrs.md) and [optional-event-sourcing.md](optional-event-sourcing.md).

## Language & Naming (MANDATORY)

All code MUST be written in English — identifiers, comments, and documentation — regardless of
the user's language or the conversation language. French (or any other non-English) identifiers,
comments, or docs are a hard violation. This mirrors the commit-message mandate
(rules/common/git-workflow.md § Language).

| Artifact | Rule |
|---|---|
| Identifiers (types, methods, properties, variables, parameters, enums, namespaces, test names) | English, PascalCase/camelCase per C# convention. No French, no accents, no transliteration. |
| Comments & XML docs | English, always. |
| Developer-facing strings (logs, exception messages, ProblemDetails `title`/`detail`) | English. |
| User-facing text | Never hardcoded French in the backend; end-user localization belongs to the frontend (Transloco). |
| DB objects (schemas, tables, columns) | English snake_case. |

**Module names: PascalCase + English.** A module lives directly under `backend/src/` (or under a
bounded-context folder, e.g. `backend/src/Sales/Invoices/`) as a set of projects:
`GcPlatform.<Module>.Domain`, `GcPlatform.<Module>.Application`,
`GcPlatform.<Module>.Infrastructure`, `GcPlatform.<Module>.Presentation`. The module registrar is
`<Module>Module : IModule`, discovered by reflection; the schema name is the lowercase
snake_case module name (e.g. `invoice`). `GcPlatform.Api` is the **host/composition root only**
— it holds no `Module/<ModuleName>/` tree.

**Ubiquitous language.** One canonical English term per domain concept — no synonyms, no ad-hoc
translations. Canonical terms are anchored in `docs/architecture/ubiquitous-language.md` and
aligned with the frontend module names (`invoices`, `payments`, `dunning`, `customers`,
`catalog`). Per-module language autonomy allows different names across modules for the same
real-world entity; it does NOT allow synonyms within a module, and it does NOT allow non-English
names.

## When To Activate

- Scaffolding a new .NET REST API with modular hexagonal architecture.
- Adding a new module or use case to an existing project.
- Adding an endpoint/use-case with EF Core CRUD or an event-sourced Marten store.
- Refactoring code toward ports/adapters and module isolation.
- Integrating with other modules via integration events.

## Architecture Overview

```text
backend/
├── GcPlatform.slnx
├── src/
│   ├── SharedKernel/                         # shared types ONLY — no application logic
│   │   ├── Modularity/
│   │   │   ├── IModule.cs                    # RegisterModule(IServiceCollection)
│   │   │   ├── IEndpoint.cs                  # MapEndpoint(IEndpointRouteBuilder)
│   │   │   └── ModuleExtensions.cs           # reflection discovery (modules + endpoints)
│   │   ├── Tenancy/                          # ITenantContext, AmbientTenant, TenantSessionInterceptor
│   │   └── ...
│   ├── GcPlatform.Api/                       # HOST / composition root (NOT a module tree)
│   │   ├── Program.cs                        # composes bounded contexts + endpoint discovery
│   │   ├── Infrastructure/                   # host cross-cutting wiring (auth, tenancy, DB bootstrap)
│   │   └── ...
│   ├── <Module>/                             # e.g. Identity, McpAccess, ThirdParties, Companies
│   │   ├── GcPlatform.<Module>.Domain/
│   │   │   ├── Aggregates/  (or Entities/)
│   │   │   ├── ValueObjects/
│   │   │   ├── Events/                       # domain events (past-tense records)
│   │   │   ├── Exceptions/
│   │   │   └── Model/
│   │   ├── GcPlatform.<Module>.Application/
│   │   │   ├── <UseCase>/                    # <UseCase>Command.cs, <UseCase>Handler.cs, <UseCase>Result.cs
│   │   │   └── Ports/                        # incoming + outgoing port interfaces
│   │   ├── GcPlatform.<Module>.Infrastructure/
│   │   │   ├── Persistence/                  # DbContext, Configurations/, Migrations/
│   │   │   └── Adapter/                      # outgoing-port adapters (EfCore…, Marten…)
│   │   └── GcPlatform.<Module>.Presentation/
│   │       ├── Endpoints/                    # IEndpoint implementations (+ Requests/, Responses/)
│   │       └── <Module>Module.cs             # IModule registration (composition root of the module)
│   ├── Sales/                                # bounded context made of subdomains
│   │   ├── GcPlatform.Sales.Domain/
│   │   ├── GcPlatform.Sales.Infrastructure/
│   │   ├── GcPlatform.Sales.Presentation/    # SalesModule.ConfigureServices(...)
│   │   ├── GcPlatform.Sales.Contracts/       # integration-event contracts
│   │   ├── Catalog/  Customers/  Invoices/  Payments/  Dunning/  Receivables/
│   │   └── ...                               # each subdomain: Domain + Infrastructure + Presentation
│   └── Conversation/                         # single-project module
└── tests/
    └── GcPlatform.<Module>.Tests/
        ├── Application/  Domain/  Events/  Infrastructure/
        ├── Integration/  Architecture/  Composition/
        └── ...
```

**Layering variance:** a full module (e.g. Identity) has all four projects. Some Sales subdomains
(e.g. Invoices) fold the use cases into the Domain project and ship Domain + Infrastructure +
Presentation only. Match the neighbouring subdomain in the bounded context you are extending.

## Hexagon Rules (CRITICAL)

```
Domain (pure logic)
  ↑
  ├── Depends on: NOTHING
  └── Used by: Application + Infrastructure

Application (use cases, ports)
  ↑
  ├── Depends on: Domain
  └── Used by: Infrastructure + Presentation

Infrastructure (EF Core / Marten, adapters, external SDKs)
  ↑
  ├── Depends on: Domain + Application
  └── Used by: <Module>Module.cs (DI registration)

Presentation (endpoints + module registrar)
  ├── Depends on: Domain + Application + Infrastructure
  └── Composition root of the module (same exemption Program.cs has)
```

- **Domain** has zero infrastructure dependencies. Houses aggregates/entities, value objects,
  domain events, incoming ports, and outgoing port **interfaces**.
- **Application** depends only on Domain. Houses use-case handlers, commands/queries, and DTOs.
  No EF Core, no database queries.
- **Infrastructure** depends on Domain + Application. Implements outgoing ports (repositories,
  adapters), owns the DbContext / Marten store, migrations, RLS configuration, external SDK calls.
- **Presentation** wires the module: endpoint classes and the `<Module>Module : IModule` registrar
  (the only place allowed to reference Infrastructure).
- **Components never call use cases directly.** Always use the incoming port.
- **Cross-module calls forbidden as direct type references.** Module A's Domain/Application
  depends on Module B's public integration-event contract (`GcPlatform.<Module>.Contracts`) only.
- **No `Infrastructure → Infrastructure` cross-module references.** Each module owns its read
  projections in its own DbContext.

## Module Discovery & Registration

`GcPlatform.SharedKernel.Modularity` defines the contracts and the reflection registrar:

```csharp
// SharedKernel/Modularity/IModule.cs
public interface IModule
{
    IServiceCollection RegisterModule(IServiceCollection services);
}

// SharedKernel/Modularity/IEndpoint.cs
public interface IEndpoint
{
    void MapEndpoint(IEndpointRouteBuilder app);
}

// SharedKernel/Modularity/ModuleExtensions.cs — discovers IModule and IEndpoint by reflection
services.RegisterModulesFromAssembly(typeof(SomeModule).Assembly);
services.RegisterEndpointsFromAssembly(typeof(Program).Assembly);
app.MapDiscoveredEndpoints();
```

A module's registrar lives in its Presentation project:

```csharp
// Presentation/InvoicesModule.cs
public sealed class InvoicesModule : IModule
{
    public IServiceCollection RegisterModule(IServiceCollection services)
    {
        services.AddScoped<ICreateInvoice, CreateInvoice>();
        services.AddScoped<IInvoiceRepository, EfCoreInvoiceRepository>();
        return services;
    }
}
```

Bounded contexts that need `IConfiguration` (connection strings, provisioning options) cannot use
the config-less `IModule.RegisterModule` contract. They expose a static composition entrypoint
that `Program.cs` calls explicitly — e.g. `IdentityModule.ConfigureServices(services, configuration)`,
`GcPlatform.Sales.Presentation.SalesModule.ConfigureServices(...)`,
`ConversationModule.ConfigureServices(...)`. `SalesModule` then fans out to its subdomain
`IModule` registrars via `RegisterModulesFromAssembly`. `Program.cs` is the composition root and
owns tenancy, auth, and DB bootstrap wiring.

> The host assembly is `GcPlatform.Api`; there is **no** `GcPlatform.Api/Module/<ModuleName>/`
> tree and no `GcPlatform.Api.Module.<ModuleName>` namespace. Modules are their own projects.

## Persistence: Chosen Per Bounded Context

Persistence is a **per-bounded-context** decision. Both options are first-class:

- **EF Core CRUD** — a single read-write relational model for contexts whose domain does not
  warrant event streams (`Sales.*`, `McpAccess`).
- **Event-sourced / Marten** — aggregates persisted as event streams when the domain warrants it
  (`Identity`, `Companies`, `ThirdParties`). See
  ADR-0048: one Marten store **per
  bounded context**, wired as an ancillary store, never host-global `AddMarten`.

Neither is "the default"; pick per bounded context and record the rationale in the relevant ADR.

```csharp
// Domain/Invoices/Ports/Outgoing/IInvoiceRepository.cs
public interface IInvoiceRepository
{
    Task<Invoice?> GetByIdAsync(string id, CancellationToken ct = default);
    Task AddAsync(Invoice invoice, CancellationToken ct = default);
    Task UpdateAsync(Invoice invoice, CancellationToken ct = default);
    Task DeleteAsync(string id, CancellationToken ct = default);
}

// Infrastructure/Adapter/EfCoreInvoiceRepository.cs
public sealed class EfCoreInvoiceRepository(InvoiceDbContext dbContext) : IInvoiceRepository
{
    public async Task<Invoice?> GetByIdAsync(string id, CancellationToken ct = default)
        => await dbContext.Invoices.FirstOrDefaultAsync(f => f.Id == id, ct);

    public async Task AddAsync(Invoice invoice, CancellationToken ct = default)
    {
        dbContext.Invoices.Add(invoice);
        await dbContext.SaveChangesAsync(ct);
    }

    // ...
}
```

## Database Isolation: Schema Per Module + Tenant GUC

One PostgreSQL schema per module, all modules in the same database, isolated by
`FORCE ROW LEVEL SECURITY` keyed on the session GUC `app.tenant_id`. See
[database-isolation.md](database-isolation.md) for the full setup: schema creation, role
provisioning, RLS policies, and the `TenantSessionInterceptor`.

The GUC is set by `GcPlatform.SharedKernel.Tenancy.TenantSessionInterceptor`, an EF Core
`DbConnectionInterceptor` that runs `SELECT set_config('app.tenant_id', @tenant, false)` on
`ConnectionOpened` and `RESET app.tenant_id` on `ConnectionClosing` (and whenever no tenant
resolves). **There is no EF Core `HasQueryFilter` tenant predicate** — RLS is the enforcement
layer.

```sql
ALTER TABLE invoice.invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice.invoices FORCE ROW LEVEL SECURITY;

CREATE POLICY invoices_tenant_isolation ON invoice.invoices
    USING      (tenant_id = (SELECT current_setting('app.tenant_id', true)))
    WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)));
```

Per-module roles: `<module>_app` (`NOBYPASSRLS`, DML-only runtime) and `<module>_migrator`
(`BYPASSRLS`, DDL/migrations only, owns the schema). See [database-isolation.md](database-isolation.md).

## Integration Events: Events-Only Cross-Module Communication

Modules communicate **asynchronously via integration events only**. Events are immutable,
serialized `record` types, published through the Wolverine message bus (durable outbox).
Consumers must be idempotent. Handlers live in the consuming module's Infrastructure.

**Two-source tenancy rule (mandatory):** any publish whose message reaches a handler that writes
an RLS-protected table must carry the tenant in **two independent places**:
1. the Wolverine **envelope** (`DeliveryOptions.TenantId`) — sets the `app.tenant_id` GUC;
2. the message **body** `TenantId` property — supplies the `tenant_id` column value.

The `WITH CHECK` policy compares both; a mismatch is rejected at the database layer with SQLSTATE
`42501`. Wolverine codegen must also allow-list the ambient tenant via
`opts.CodeGeneration.AlwaysUseServiceLocationFor<AmbientTenant>();` so the handler scope shares the
stamped tenant. See `.claude/rules/common/wolverine-tenancy.md`.

```csharp
// GcPlatform.Sales.Contracts — plain, immutable integration event
public sealed record InvoiceHeaderChanged(Guid TenantId, Guid InvoiceId, string Number, /* ... */);

// Consumer (Infrastructure): write the body TenantId into the RLS-protected projection
await projectionDbContext.InvoiceProjections.AddAsync(new InvoiceProjection
{
    TenantId = @event.TenantId,   // from the body, NOT from ITenantContext or the envelope
    // ...
}, ct);
```

See [cross-module-communication.md](cross-module-communication.md) for the outbox, idempotency,
and envelope-stamping patterns.

## Testing

Tests live under `backend/tests/GcPlatform.<Module>.Tests/<Area>/`, where `<Area>` is one of
`Application`, `Domain`, `Events`, `Infrastructure`, `Integration`, `Architecture`,
`Composition`. Use xUnit v3 (`[Fact]` / `[Theory]`) with built-in `Assert.*` plus **Shouldly**
(`.ShouldBe(...)`) — both are in use, and Shouldly is referenced by 5 of the 7 test projects.
There is **no mocking library**: write nested `Stub*` / `Capturing*` / `Fake*` doubles that
implement the port interface.

```csharp
// Application/Invoices/CreateInvoiceShould.cs (xUnit v3 + Shouldly)
public sealed class CreateInvoiceShould
{
    [Fact]
    public async Task SaveInvoiceWhenValidCommand()
    {
        var repository = new CapturingInvoiceRepository();
        var useCase = new CreateInvoice(repository);

        var result = await useCase.ExecuteAsync(command, CancellationToken.None);

        result.Id.ShouldNotBe(Guid.Empty);
        repository.Saved.ShouldHaveSingleItem();
    }

    private sealed class CapturingInvoiceRepository : IInvoiceRepository
    {
        public List<Invoice> Saved { get; } = [];
        public Task AddAsync(Invoice invoice, CancellationToken ct = default)
        {
            Saved.Add(invoice);
            return Task.CompletedTask;
        }
        // ...
    }
}
```

Integration and RLS tests use **Testcontainers.PostgreSql** and require Docker. Gate them with
the `GCPLATFORM_REQUIRE_DOCKER_TESTS=1` environment variable — without it, Docker-dependent tests
gracefully downgrade / skip:

```bash
GCPLATFORM_REQUIRE_DOCKER_TESTS=1 dotnet test backend/tests/GcPlatform.Sales.Tests
```

Architecture fitness functions use `TngTech.ArchUnitNET.xUnitV3`. See
[testing-patterns.md](testing-patterns.md) for the AAA structure, Shouldly/`Assert` usage,
hand-rolled doubles, Testcontainers RLS isolation, and TDD RED-GREEN-REFACTOR. There is no
NUnit, FluentAssertions, NSubstitute, or Moq in this repository.

## Optional Additive Patterns

### DDD + CQRS (Opt-In Per Module)

When a bounded context has complex domain logic, use DDD tactical patterns: aggregates (private
constructor + factory methods, mutate only via domain events), value objects (immutable, equality
by value), domain events (past-tense records). CQRS splits write `*Command` handlers from read
`*Query` handlers; queries read projections, never rehydrate aggregates.

See [optional-ddd-cqrs.md](optional-ddd-cqrs.md).

### Event Sourcing (Per Bounded Context)

Event sourcing is a **first-class persistence choice**, selected per bounded context when the
domain needs an immutable audit trail, temporal queries, or event-driven projections. The real
implementation is **Marten**, one ancillary store per bounded context (ADR-0048) — see the
`Companies` and `ThirdParties` modules for working examples.

See [optional-event-sourcing.md](optional-event-sourcing.md) and
ADR-0048.

## Naming Conventions

All names below are English. `<ModuleName>` is PascalCase English (e.g. `Invoice`).

| Artifact | Pattern | Example |
|----------|---------|---------|
| Module projects | `backend/src/<Module>/GcPlatform.<Module>.{Domain,Application,Infrastructure,Presentation}` | `backend/src/Identity/GcPlatform.Identity.Domain` |
| Module class | `<ModuleName>Module : IModule` (in Presentation) | `InvoicesModule` |
| Use case / handler | `<VerbNoun>` | `CreateInvoice` |
| Incoming port | `I<VerbNoun>` | `ICreateInvoice` |
| Outgoing port | `I<VerbNoun>Repository` | `IInvoiceRepository` |
| Endpoint | `<VerbNoun>Endpoint : IEndpoint` | `CreateInvoiceEndpoint` |
| Integration event | `<Noun><PastVerb>` record in `GcPlatform.<Module>.Contracts` | `InvoiceHeaderChanged` |
| Event handler | `<Noun><PastVerb>Handler` (Infrastructure) | `InvoiceHeaderChangedHandler` |
| DbContext | `<ModuleName>DbContext` | `InvoiceDbContext` |
| Entity | `<Noun>` | `Invoice` |
| Test project / area | `backend/tests/GcPlatform.<Module>.Tests/<Area>/` | `GcPlatform.Sales.Tests/Application/` |
| Test class | `<VerbNoun>Should` | `CreateInvoiceShould` |

## Checklist: Adding a Module

- [ ] Pick the module name: canonical English term from `docs/architecture/ubiquitous-language.md`, PascalCase (e.g. `Invoice`, `Payment`, `Dunning`)
- [ ] Create the project set under `backend/src/<Module>/`: `GcPlatform.<Module>.Domain`, `.Application`, `.Infrastructure`, `.Presentation`
- [ ] Define incoming port: `Application/Ports/I<VerbNoun>.cs`
- [ ] Define outgoing port: `Domain`/`Application` `Ports/I<VerbNoun>Repository.cs`
- [ ] Implement use case: `Application/<UseCase>/<UseCase>Handler.cs`
- [ ] Define aggregate/entity + domain events: `Domain/Aggregates/`, `Domain/Events/`
- [ ] Create endpoint: `Presentation/Endpoints/<VerbNoun>Endpoint.cs` implementing `IEndpoint`
- [ ] Create the adapter: `Infrastructure/Adapter/EfCore<VerbNoun>Repository.cs` (or a Marten store)
- [ ] Create DbContext + config: `Infrastructure/Persistence/`
- [ ] Create module registration: `Presentation/<ModuleName>Module.cs` implementing `IModule`
- [ ] Add RLS: `FORCE ROW LEVEL SECURITY` + `app.tenant_id` policy + `<module>_app`/`<module>_migrator` roles
- [ ] Publish/consume integration events via Wolverine with envelope **and** body `TenantId`
- [ ] Write tests under `backend/tests/GcPlatform.<Module>.Tests/<Area>/` (xUnit v3 + `Assert`/Shouldly)
- [ ] Verify 80%+ coverage; run Docker-gated tests with `GCPLATFORM_REQUIRE_DOCKER_TESTS=1`
- [ ] All identifiers, comments, and docs in English; no synonym introduced for an existing canonical term

## Related Documentation

- [implementation-playbook.md](implementation-playbook.md) — Step-by-step module creation guide.
- [testing-patterns.md](testing-patterns.md) — xUnit v3, Shouldly/`Assert`, hand-rolled doubles, Testcontainers, TDD patterns.
- [cross-module-communication.md](cross-module-communication.md) — Integration events, Wolverine, outbox, idempotency, tenancy stamping.
- [database-isolation.md](database-isolation.md) — Schema-per-module, RLS, `app.tenant_id`, per-module roles.
- [optional-ddd-cqrs.md](optional-ddd-cqrs.md) — DDD/CQRS for complex domains (opt-in).
- [optional-event-sourcing.md](optional-event-sourcing.md) — Event sourcing with Marten (per bounded context).

## Real Examples

See `backend/src/` for working examples:
- Full four-project module: `backend/src/Identity/`
- Bounded context with subdomains: `backend/src/Sales/` (`Invoices`, `Payments`, `Dunning`, …)
- Event-sourced (Marten) modules: `backend/src/Companies/`, `backend/src/ThirdParties/`
- Host composition root: `backend/src/GcPlatform.Api/Program.cs`
