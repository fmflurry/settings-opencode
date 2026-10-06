# Implementation Playbook: Module Scaffold Step-by-Step

## Goal

**Naming:** module names MUST be PascalCase English (e.g. `Invoice`) — see SKILL.md § Language & Naming.

Scaffold a new bounded-context module (e.g. `Invoice`) from scratch, following the hexagon
architecture and TDD RED-GREEN-REFACTOR.

A module is a set of projects under `backend/src/<Module>/`:

```
backend/src/Invoice/
├── GcPlatform.Invoice.Domain/           # aggregate/entities, value objects, domain events, ports
├── GcPlatform.Invoice.Application/      # use-case handlers, commands, DTOs
├── GcPlatform.Invoice.Infrastructure/   # DbContext, adapters, migrations, RLS config
└── GcPlatform.Invoice.Presentation/     # IEndpoint classes + InvoiceModule : IModule
```

> **Bounded-context variance:** a full module (e.g. Identity) has all four projects. Sales
> subdomains (e.g. `Sales/Invoices`) fold the use cases into the Domain project and ship Domain +
> Infrastructure + Presentation only. Match the neighbours in the bounded context you extend.

## Example: CreateInvoice Use Case

### Phase 1: Specification (Out of Scope for This Playbook)

A product owner or OpenSpec change spec defines: "Create an invoice record with number, customer ID,
date, payment terms, and due date. Tenant is resolved from request context, not the request body.
Publish an `InvoiceHeaderChanged` integration event."

#### Step 0: Name the Module

Pick the canonical English term from `docs/architecture/ubiquitous-language.md` (register new
terms there in the same PR). PascalCase project/folder names; lowercase snake_case schema.

### Phase 2: Test First (RED-GREEN-REFACTOR)

#### Step 1: Failing Test — CreateInvoice Use Case

Create `backend/tests/GcPlatform.Invoice.Tests/Application/Invoices/CreateInvoiceShould.cs` with a
**failing** test. Use xUnit v3 (`[Fact]`), built-in `Assert` / Shouldly, and a hand-rolled
`Capturing*` double — there is no mocking library.

```csharp
using GcPlatform.SharedKernel.Tenancy;
using GcPlatform.Invoice.Domain.Invoices;
using GcPlatform.Invoice.Domain.Invoices.Ports.Incoming;
using GcPlatform.Invoice.Domain.Invoices.Ports.Outgoing;
using Xunit;

namespace GcPlatform.Invoice.Tests.Application.Invoices;

public sealed class CreateInvoiceShould
{
    [Fact]
    public async Task StampTenantFromContext_NotFromBody()
    {
        var repo = new CapturingInvoiceRepository();
        var tenantContext = new StubTenantContext("tenant-abc");
        var useCase = new CreateInvoice(repo, tenantContext);

        await useCase.ExecuteAsync(ValidCommand, CancellationToken.None);

        Assert.True(tenantContext.WasCalled);
        Assert.Single(repo.AddedInvoices);
    }

    private sealed class CapturingInvoiceRepository : IInvoiceRepository
    {
        public List<Invoice> AddedInvoices { get; } = [];
        public Task AddAsync(Invoice invoice, CancellationToken ct = default)
        {
            AddedInvoices.Add(invoice);
            return Task.CompletedTask;
        }
    }

    private sealed class StubTenantContext(string tenantId) : ITenantContext
    {
        public bool WasCalled { get; private set; }
        public string GetCurrentTenantId() { WasCalled = true; return tenantId; }
    }
}
```

**Run the test — it FAILS** because the types don't exist yet.

#### Step 2: Create the Minimal Structure (RED)

Create empty types that compile, in the real project layout:

**Domain/Invoices/Ports/Incoming/ICreateInvoice.cs:**
```csharp
namespace GcPlatform.Invoice.Domain.Invoices.Ports.Incoming;

public interface ICreateInvoice
{
    Task<CreateInvoiceResult> ExecuteAsync(CreateInvoiceCommand command, CancellationToken ct = default);
}
```

**Domain/Invoices/CreateInvoiceCommand.cs:**
```csharp
namespace GcPlatform.Invoice.Domain.Invoices;

public sealed record CreateInvoiceCommand(
    string InvoiceNumber,
    string CustomerId,
    DateOnly InvoiceDate,
    int PaymentTermsDays,
    DateOnly DueDate);
```

**Domain/Invoices/Invoice.cs:**
```csharp
namespace GcPlatform.Invoice.Domain.Invoices;

public sealed class Invoice
{
    public required string Id { get; init; }
    public required string TenantId { get; init; }
    public required string InvoiceNumber { get; init; }
    public required string CustomerId { get; init; }
    public required DateOnly InvoiceDate { get; init; }
    public required int PaymentTermsDays { get; init; }
    public required DateOnly DueDate { get; init; }
}
```

**Domain/Invoices/Ports/Outgoing/IInvoiceRepository.cs:**
```csharp
namespace GcPlatform.Invoice.Domain.Invoices.Ports.Outgoing;

public interface IInvoiceRepository
{
    Task AddAsync(Invoice invoice, CancellationToken ct = default);
    // ... other CRUD methods
}
```

**Domain/Invoices/Events/InvoiceHeaderChanged.cs** (integration-event contract normally lives in
`GcPlatform.<Module>.Contracts`):
```csharp
namespace GcPlatform.Invoice.Contracts;

public sealed record InvoiceHeaderChanged(
    Guid TenantId,
    Guid InvoiceId,
    string InvoiceNumber,
    string CustomerId);
```

**Run the test — it still FAILS** because the use case is not implemented.

#### Step 3: Implement the Use Case (GREEN)

**Application/Invoices/CreateInvoice.cs:**
```csharp
namespace GcPlatform.Invoice.Application.Invoices;

public sealed class CreateInvoice(
    IInvoiceRepository repository,
    ITenantContext tenantContext) : ICreateInvoice
{
    public async Task<CreateInvoiceResult> ExecuteAsync(
        CreateInvoiceCommand command, CancellationToken ct = default)
    {
        var tenantId = tenantContext.GetCurrentTenantId();   // tenant from context, NOT the body

        var invoice = new Invoice
        {
            Id = Guid.NewGuid().ToString(),
            TenantId = tenantId,
            InvoiceNumber = command.InvoiceNumber,
            CustomerId = command.CustomerId,
            InvoiceDate = command.InvoiceDate,
            PaymentTermsDays = command.PaymentTermsDays,
            DueDate = command.DueDate,
        };

        await repository.AddAsync(invoice, ct);
        return CreateInvoiceResult.Success(invoice);
    }
}
```

**Run the test — it PASSES.**

### Phase 3: Infrastructure (EF Core Adapter)

#### Step 4: DbContext Config

**Infrastructure/Persistence/Configurations/InvoiceConfiguration.cs:**
```csharp
namespace GcPlatform.Invoice.Infrastructure.Persistence.Configurations;

public sealed class InvoiceConfiguration : IEntityTypeConfiguration<Invoice>
{
    public void Configure(EntityTypeBuilder<Invoice> builder)
    {
        builder.ToTable("invoices", schema: "invoice");
        builder.HasKey(f => f.Id);
        builder.Property(f => f.TenantId).HasColumnName("tenant_id").IsRequired();
        builder.Property(f => f.InvoiceNumber).IsRequired().HasMaxLength(50);
        builder.Property(f => f.CustomerId).IsRequired();
        // No HasQueryFilter: FORCE RLS + app.tenant_id enforce tenant isolation (see database-isolation.md).
    }
}
```

**Infrastructure/Persistence/InvoiceDbContext.cs:**
```csharp
namespace GcPlatform.Invoice.Infrastructure.Persistence;

public sealed class InvoiceDbContext(DbContextOptions<InvoiceDbContext> options)
    : DbContext(options)
{
    public DbSet<Invoice> Invoices { get; set; }

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.ApplyConfiguration(new InvoiceConfiguration());
        base.OnModelCreating(modelBuilder);
    }
}
```

Add the RLS policy in a migration (`FORCE ROW LEVEL SECURITY` + `USING`/`WITH CHECK` on
`current_setting('app.tenant_id', true)`) per [database-isolation.md](database-isolation.md).

#### Step 5: EF Core Adapter

**Infrastructure/Adapter/EfCoreInvoiceRepository.cs:**
```csharp
namespace GcPlatform.Invoice.Infrastructure.Adapter;

public sealed class EfCoreInvoiceRepository(InvoiceDbContext dbContext) : IInvoiceRepository
{
    public async Task AddAsync(Invoice invoice, CancellationToken ct = default)
    {
        dbContext.Invoices.Add(invoice);
        await dbContext.SaveChangesAsync(ct);
    }

    // ... other CRUD methods
}
```

### Phase 4: HTTP Endpoint

#### Step 6: Endpoint (IEndpoint)

**Presentation/Endpoints/Invoices/CreateInvoiceEndpoint.cs:**
```csharp
namespace GcPlatform.Invoice.Presentation.Endpoints.Invoices;

public sealed class CreateInvoiceEndpoint : IEndpoint
{
    public void MapEndpoint(IEndpointRouteBuilder app)
    {
        app.MapPost("/api/invoices", HandleAsync)
            .WithName("CreateInvoice")
            .RequireAuthorization("RequireTenant");
    }

    private static async Task<IResult> HandleAsync(
        CreateInvoiceRequest request,
        ICreateInvoice createInvoice,
        CancellationToken cancellationToken)
    {
        var command = new CreateInvoiceCommand(
            request.InvoiceNumber,
            request.CustomerId,
            request.InvoiceDate,
            request.PaymentTermsDays,
            request.DueDate);

        var result = await createInvoice.ExecuteAsync(command, cancellationToken);
        return Results.Created($"/api/invoices/{result.Invoice!.Id}", result.Invoice);
    }
}
```

### Phase 5: Module Registration

#### Step 7: Module Class (IModule)

**Presentation/InvoiceModule.cs:**
```csharp
namespace GcPlatform.Invoice.Presentation;

public sealed class InvoiceModule : IModule
{
    public IServiceCollection RegisterModule(IServiceCollection services)
    {
        services.AddScoped<ICreateInvoice, CreateInvoice>();
        services.AddScoped<IInvoiceRepository, EfCoreInvoiceRepository>();
        return services;
    }
}
```

Registration is discovered by `ModuleExtensions.RegisterModulesFromAssembly` (see `SalesModule`
for the per-assembly fan-out pattern). A context that needs `IConfiguration` exposes a static
`ConfigureServices(services, configuration)` entrypoint that `Program.cs` calls explicitly.

### Phase 6: Integration Test (HTTP Pipeline)

#### Step 8: Integration Test

**backend/tests/GcPlatform.Invoice.Tests/Integration/CreateInvoiceEndpointShould.cs:**
```csharp
public sealed class CreateInvoiceEndpointShould : IAsyncLifetime
{
    private WebApplicationFactory<Program> _factory = null!;
    private HttpClient _client = null!;

    public Task InitializeAsync()
    {
        _factory = new WebApplicationFactory<Program>();
        _client = _factory.CreateClient();
        return Task.CompletedTask;
    }

    public Task DisposeAsync() => _factory.DisposeAsync().AsTask();

    [Fact]
    public async Task Return201WhenInvoiceCreated()
    {
        var request = new CreateInvoiceRequest
        {
            InvoiceNumber = "F-001",
            CustomerId = "customer-123",
            InvoiceDate = new DateOnly(2024, 1, 15),
            PaymentTermsDays = 30,
            DueDate = new DateOnly(2024, 2, 14),
        };

        var response = await _client.PostAsJsonAsync("/api/invoices", request);

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
    }
}
```

Docker-backed tests (Testcontainers/RLS) run with
`GCPLATFORM_REQUIRE_DOCKER_TESTS=1 dotnet test backend/tests/GcPlatform.Invoice.Tests`.

## Checklist: Implementation Playbook Complete

- [ ] Incoming port: `I<VerbNoun>` in `Domain/<Area>/Ports/Incoming/`
- [ ] Outgoing port: `I<VerbNoun>Repository` in `Domain/<Area>/Ports/Outgoing/`
- [ ] Use case: `<VerbNoun>` in `Application/<Area>/`, implements the incoming port
- [ ] Entity/aggregate: `<Noun>` in `Domain/<Area>/`
- [ ] DTOs: `<VerbNoun>Request/Response` in `Presentation/Endpoints/<Area>/Requests|Responses/`
- [ ] Integration event contract: `GcPlatform.<Module>.Contracts` (plain `record`, body `TenantId`)
- [ ] EF Core config: `<Entity>Configuration` in `Infrastructure/Persistence/Configurations/`
- [ ] DbContext: `<ModuleName>DbContext` in `Infrastructure/Persistence/`
- [ ] EF Core adapter: `EfCore<VerbNoun>Repository` in `Infrastructure/Adapter/`
- [ ] Endpoint: `<VerbNoun>Endpoint : IEndpoint` in `Presentation/Endpoints/`
- [ ] Module registration: `<ModuleName>Module : IModule` in `Presentation/`
- [ ] RLS: `FORCE ROW LEVEL SECURITY` + `app.tenant_id` policy + `<module>_app`/`<module>_migrator` roles
- [ ] Tests under `backend/tests/GcPlatform.<Module>.Tests/<Area>/` (xUnit v3 + `Assert`/Shouldly, hand-rolled doubles)
- [ ] Verify 80%+ test coverage
- [ ] Module is discovered by `ModuleExtensions.RegisterModulesFromAssembly(...)`

---

The remaining sections describe the **optional DDD + event-sourcing double-loop** some bounded
contexts use. They are templates: the aggregate base class (`AggregateRoot`), `IEventStore`, and
`Result<T>` shown here are not part of `backend/src/SharedKernel` today. The real event-sourced
implementation is **Marten**, one ancillary store per bounded context (ADR-0048) — see
`backend/src/Companies/` and `backend/src/ThirdParties/` before hand-rolling an event store.

## 0. Specification first

No code until a spec exists: an OpenSpec change spec (`openspec/changes/<change>/specs/<capability>/spec.md`) or a Product Owner work item enumerating scenarios and examples.

## 1. Shopping list of acceptance stubs (outer loop Phase 1)

```csharp
// backend/tests/GcPlatform.<Context>.Tests/Application/<UseCaseName>Should.cs
[Fact]
public async Task <UseCaseName>_<HappyPathScenario>_ShouldSucceed() => false.ShouldBeTrue();

[Fact]
public async Task <UseCaseName>_<AlternativeScenario>_ShouldFailAndReturnError() => false.ShouldBeTrue();
```

Commit: `test(<context>): add acceptance test list for <UseCaseName>`.

## 2. Command / Query (Application/UseCases)

```csharp
// Application/UseCases/<UseCaseName>.cs
public class <UseCaseName> : ICommand<Result<Guid>>
{
    public required <InputType> <Input> { get; init; }
}

// or a query:
public class Find<Aggregate> : IQuery<Result<<Aggregate>Dto>>
{
    public required Guid Id { get; init; }
}
```

## 3. Handler (Application/Handlers) — primary-ctor DI of domain interfaces

```csharp
// Application/Handlers/<UseCaseName>Handler.cs
public class <UseCaseName>Handler(<Aggregate>s aggregates /*, read collaborators */)
    : ICommandHandler<<UseCaseName>, Result<Guid>>
{
    public async Task<Result<Guid>> Handle(<UseCaseName> command, CancellationToken cancellationToken = default)
    {
        var created = <Aggregate>.<Factory>(/* validated inputs */);
        if (created.IsFailed) return Result<Guid>.Fail(created.Errors[0]);

        await aggregates.Save(created.Data);        // appends uncommitted events to the stream
        return Result<Guid>.Success(created.Data.Id);
    }
}
```

Query handler:

```csharp
public class Find<Aggregate>Handler(<Aggregate>ReadModels readModels)
    : IQueryHandler<Find<Aggregate>, Result<<Aggregate>Dto>>
{
    public async Task<Result<<Aggregate>Dto>> Handle(Find<Aggregate> query, CancellationToken cancellationToken = default)
    {
        var dto = await readModels.Find(query.Id);   // reads a projection, never rehydrates the aggregate
        return dto is null
            ? Result<<Aggregate>Dto>.Fail(new <Aggregate>NotFound(query.Id))
            : Result<<Aggregate>Dto>.Success(dto);
    }
}
```

## 4. Domain — event-sourced aggregate (driven in via [[tdd]])

```csharp
// SharedKernel/Ddd/AggregateRoot.cs — base class (write once, in SharedKernel)
public abstract class AggregateRoot : IAggregateRoot
{
    private readonly List<IDomainEvent> _uncommitted = [];
    public Guid Id { get; protected set; }
    public long Version { get; private set; }
    public IReadOnlyList<IDomainEvent> UncommittedEvents => _uncommitted;

    protected void Raise(IDomainEvent @event) { Apply(@event); _uncommitted.Add(@event); }
    public void LoadFromHistory(IEnumerable<IDomainEvent> history) { foreach (var e in history) Apply(e); }
    private void Apply(IDomainEvent @event) { When(@event); Version = @event.Version; }
    protected abstract void When(IDomainEvent @event);
    public void MarkEventsAsCommitted() => _uncommitted.Clear();
    public virtual ISnapshot? ToSnapshot() => null;
}
```

```csharp
// Domain/<Aggregate>.cs
public class <Aggregate> : AggregateRoot
{
    public /* state */ { get; private set; }
    private <Aggregate>() { }

    public static Result<<Aggregate>> <Factory>(/* inputs */)
    {
        // validate; on failure: return Result<<Aggregate>>.Fail(new <Domain>Error());
        var agg = new <Aggregate>();
        agg.Raise(new <Aggregate><PastTenseEvent>(StreamId: Guid.NewGuid(), Version: 1, /* data */));
        return Result<<Aggregate>>.Success(agg);
    }

    protected override void When(IDomainEvent @event)
    {
        switch (@event)
        {
            case <Aggregate><PastTenseEvent> e:
                Id = e.StreamId;
                /* set state from e */
                break;
        }
    }
}

// Domain/<Aggregate><PastTenseEvent>.cs — immutable, past tense
public record <Aggregate><PastTenseEvent>(Guid StreamId, long Version, /* data */) : IDomainEvent
{
    public Guid Id { get; } = Guid.NewGuid();
    public DateTime OccurredOn { get; init; } = default;   // injected via IDateTimeProvider in real code
}

// Domain/<ValueObject>.cs — record + private ctor + static factory
public record <ValueObject>
{
    private <ValueObject>(/* fields */) { /* ... */ }
    public static <ValueObject> Of(/* fields */) => new(/* ... */);
}
```

## 5. Repository interface (Domain) + in-memory fake (tests)

```csharp
// Domain/<Aggregate>s.cs — collection-named, no "I" prefix
public interface <Aggregate>s
{
    Task Save(<Aggregate> aggregate);
    Task<<Aggregate>?> Find(Guid id);
}
```

```csharp
// tests/.../TestDoubles/FakeInMemory<Aggregate>Repository.cs
public class FakeInMemory<Aggregate>Repository : <Aggregate>s
{
    private readonly Dictionary<Guid, List<IDomainEvent>> _streams = new();

    public Task Save(<Aggregate> aggregate)
    {
        var stream = _streams.TryGetValue(aggregate.Id, out var s) ? s : _streams[aggregate.Id] = [];
        stream.AddRange(aggregate.UncommittedEvents);
        aggregate.MarkEventsAsCommitted();
        return Task.CompletedTask;
    }

    public Task<<Aggregate>?> Find(Guid id) => Task.FromResult(Rehydrate(id));
    public <Aggregate>? FindForTest(Guid id) => Rehydrate(id);

    private <Aggregate>? Rehydrate(Guid id)
    {
        if (!_streams.TryGetValue(id, out var events)) return null;
        var agg = (<Aggregate>)Activator.CreateInstance(typeof(<Aggregate>), nonPublic: true)!;
        agg.LoadFromHistory(events);
        return agg;
    }
}
```

## 6. Event-store-backed repository (Infrastructure)

The real store is Marten (ADR-0048); the port shape is:

```csharp
// Infrastructure/Persistence/EventSourced<Aggregate>s.cs
public class EventSourced<Aggregate>s(IEventStore store, ISnapshotStore snapshots) : <Aggregate>s
{
    public async Task Save(<Aggregate> aggregate)
    {
        await store.Append(aggregate.Id, aggregate.UncommittedEvents, expectedVersion: aggregate.Version - aggregate.UncommittedEvents.Count);
        if (aggregate.ToSnapshot() is { } snap) await snapshots.Save(snap);
        aggregate.MarkEventsAsCommitted();
    }

    public async Task<<Aggregate>?> Find(Guid id)
    {
        var snapshot = await snapshots.Load(id);
        var fromVersion = snapshot?.Version ?? 0;
        var events = await store.Read(id, fromVersion);
        if (snapshot is null && events.Count == 0) return null;
        var agg = (<Aggregate>)Activator.CreateInstance(typeof(<Aggregate>), nonPublic: true)!;
        agg.LoadFromHistory(events);
        return agg;
    }
}
```

See the Marten implementations in `backend/src/Companies/GcPlatform.Companies.Infrastructure/Persistence/MartenCompaniesEventStore.cs` and `backend/src/ThirdParties/`.

## 7. Read model + projection (Infrastructure)

Queries read projections, **never** rehydrate aggregates. A projection subscribes to the stream and writes denormalized rows.

```csharp
// Application/ReadModels/<Aggregate>Dto.cs
public record <Aggregate>Dto(Guid Id, /* denormalized fields */);

// Application/ReadModels/<Aggregate>ReadModels.cs (interface, read side)
public interface <Aggregate>ReadModels { Task<<Aggregate>Dto?> Find(Guid id); }

// Infrastructure/Projections/<Aggregate>Projection.cs
public class <Aggregate>Projection(<ProjectionDbContext> db) : IProjection<<Aggregate><PastTenseEvent>>
{
    public async Task On(<Aggregate><PastTenseEvent> e, CancellationToken ct)
    {
        db.<Aggregate>Rows.Add(new <Aggregate>Row { Id = e.StreamId, /* map */, TenantId = e.TenantId });
        await db.SaveChangesAsync(ct);
    }
}
```

## 8. Tenant-scoped projection → RLS (mandatory)

When the projection table is tenant-scoped, apply the four-layer RLS pattern. Templates and
canonical files are in [database-isolation.md](database-isolation.md). Essentials:

```csharp
// EF config — no tenant HasQueryFilter; RLS is the enforcement layer
builder.ToTable("<table>");
builder.Property(e => e.TenantId).HasColumnName("tenant_id").IsRequired();
builder.HasOne<Tenant>().WithMany().HasForeignKey(e => e.TenantId).OnDelete(DeleteBehavior.Restrict);
```

```csharp
// Migration — FORCE + USING + WITH CHECK + fail-closed flag (ADR-0038)
migrationBuilder.Sql("ALTER TABLE <context>.<table> ENABLE ROW LEVEL SECURITY;");
migrationBuilder.Sql("ALTER TABLE <context>.<table> FORCE ROW LEVEL SECURITY;");
migrationBuilder.Sql("""
    CREATE POLICY <table>_tenant_isolation ON <context>.<table>
      USING      (tenant_id = (SELECT current_setting('app.tenant_id', true)))
      WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)));
    """);
```

Child tables without their own `tenant_id` use an `EXISTS` subquery to the parent. Write an RLS
isolation test (see [testing-patterns.md](testing-patterns.md)).

## 9. Business errors as Result, never thrown

```csharp
// Domain/<Domain>Error.cs — subclass the SharedKernel Error
public sealed class <Domain>Error() : Error("<user-facing message>", "<context>.<rule-code>");

// in a factory/handler:
return Result<T>.Fail(new <Domain>Error());
```

Throwing is reserved for genuinely unexpected/unrecoverable conditions (IO/DB/framework). HTTP
status mapping, if any entry point needs it, happens at the edge — never in Domain/Application.
