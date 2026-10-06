# Testing Patterns

## Overview

Test pyramid: many fast unit tests at the base, fewer integration tests at the top. Target 80%+
coverage.

**Test framework:** xUnit v3 (`xunit.v3` 3.2.2, `xunit.runner.visualstudio` 3.1.5). Use
`[Fact]` / `[Theory]` / `[InlineData]`.
**Assertions:** built-in `Assert.*` and **Shouldly** (`.ShouldBe(...)`). Both are in use; Shouldly
is referenced by 5 of the 7 test projects. Do **not** add FluentAssertions (forbidden for
licensing), NUnit, NSubstitute, or Moq.
**Test doubles:** hand-rolled nested classes implementing the port interface
(`Stub*`, `Capturing*`, `Fake*`). There is no mocking library.
**Integration testing:** `WebApplicationFactory<Program>` + `Testcontainers.PostgreSql` for
real-Postgres/RLS tests.
**Workflow:** TDD RED-GREEN-REFACTOR for all new code.

## Test Organization

Tests live under `backend/tests/GcPlatform.<Module>.Tests/<Area>/`, where `<Area>` is one of:

```
backend/tests/GcPlatform.<Module>.Tests/
├── Application/      # use-case handler tests (subfoldered by area: Invoices/, Payments/, …)
├── Domain/           # aggregate/rule tests, no collaborators
├── Events/           # integration-event contract / handler tests
├── Infrastructure/   # adapter, DbContext, RLS isolation tests
├── Integration/      # Testcontainers-backed end-to-end / composition tests
├── Architecture/     # ArchUnitNET fitness functions
├── Composition/      # DI/module wiring tests
└── TestDoubles/      # optional shared doubles (some modules keep doubles nested)
```

**Test class naming:** `<VerbNoun>Should` (e.g. `CreateInvoiceShould`).
**Test method naming:** `<ShouldWhatWhen>` (descriptive, no `Test` prefix) — e.g.
`SaveInvoiceWhenValidCommand`, `Return401WhenUnauthorized`.

Run a project:

```bash
dotnet test backend/tests/GcPlatform.Sales.Tests
# Driver in Docker-gated tests explicitly:
GCPLATFORM_REQUIRE_DOCKER_TESTS=1 dotnet test backend/tests/GcPlatform.Sales.Tests
```

## Unit Tests

### Purpose

Test use-case business logic in isolation. Replace outgoing ports (repositories, external
services, tenant context) with hand-rolled doubles. Focus on happy path + unhappy paths.

### Structure: AAA Pattern (Arrange-Act-Assert)

```csharp
using GcPlatform.SharedKernel.Tenancy;
using GcPlatform.Sales.Invoices.Domain.Invoices;
using GcPlatform.Sales.Invoices.Domain.Invoices.Ports.Incoming;
using GcPlatform.Sales.Invoices.Domain.Invoices.Ports.Outgoing;
using Xunit;

namespace GcPlatform.Sales.Tests.Application.Invoices;

public sealed class CreateInvoiceShould
{
    [Fact]
    public async Task StampTenantFromContext_NotFromBody()
    {
        // Arrange
        var repo = new CapturingInvoiceRepository();
        var tenantContext = new StubTenantContext("tenant-abc");
        var useCase = new CreateInvoice(repo, tenantContext);

        // Act
        await useCase.ExecuteAsync(ValidCommand, CancellationToken.None);

        // Assert
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

### Shouldly Assertions

Shouldly is available in the projects that reference it (`GcPlatform.Sales.Tests`,
`GcPlatform.Identity.Tests`, `GcPlatform.Companies.Tests`, `GcPlatform.ThirdParties.Tests`,
`GcPlatform.McpAccess.Tests`):

```csharp
result.Succeeded.ShouldBeTrue();
result.Invoice.ShouldNotBeNull();
result.Invoice!.InvoiceNumber.ShouldBe("FAC-2024-001");
repo.AddedInvoices.ShouldHaveSingleItem();
collection.ShouldBeEmpty();
ex.SqlState.ShouldBe("42501");
```

Use built-in `Assert.*` when Shouldly is not referenced (e.g. `GcPlatform.Conversation.Tests`):

```csharp
Assert.NotNull(result);
Assert.Equal("F-001", result.InvoiceNumber);
Assert.True(result.Succeeded);
Assert.Empty(collection);
Assert.Single(collection);
Assert.Contains(item, collection);

var ex = Assert.Throws<ArgumentException>(() => { /* ... */ });
var ex = await Assert.ThrowsAsync<ArgumentException>(() => { /* ... */ });
```

### Test Doubles: Stubs, Captures, Fakes

Prefer behavioural doubles defined next to the test (nested `private sealed class`):

| Collaborator | Double | Why |
|---|---|---|
| Write-side repository | **Capturing** double collecting saved items | You assert what was persisted |
| Read-only repository returning data | **Stub** constructed with the canned result | You assert the returned value, not the interaction |
| `ITenantContext` | **Stub** returning a fixed tenant id, plus a `WasCalled` flag | Deterministic tenancy |
| Clock | fixed fake returning a constant | Deterministic `OccurredOn` |
| Event-sourced aggregate store | **Fake** in-memory stream (`InMemoryOrderRepository`) | You assert rehydrated state |

## Integration Tests

### Purpose

Test the full HTTP pipeline: endpoint → use case → repository → database. Verify contracts, error
handling, and cross-module integration.

### Setup: WebApplicationFactory

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
        var request = new CreateInvoiceRequest { /* ... */ };

        var response = await _client.PostAsJsonAsync("/api/invoices", request);

        response.StatusCode.ShouldBe(HttpStatusCode.Created);
    }
}
```

### Testcontainers + the Docker gate

Real-Postgres tests (RLS isolation, schema provisioning, Marten stores) use
`Testcontainers.PostgreSql`. They are gated by `GCPLATFORM_REQUIRE_DOCKER_TESTS=1`: without the
variable, Docker-dependent tests gracefully downgrade/skip rather than fail. Canonical helpers
live in `backend/tests/Shared/TestContainerImages.cs` (`RequireDockerOrFail`).

### RLS isolation test — tenant-scoped projection

Follow `backend/tests/GcPlatform.Api.Tests/Infrastructure/Persistence/InvoicesRlsIsolationShould.cs`.
It must assert:

- Cross-tenant read isolation (tenant A cannot see tenant B rows).
- `GetById` of a foreign-tenant row returns null.
- Raw SQL blocked by the `USING` clause.
- `INSERT`/`UPDATE` with a foreign `tenant_id` rejected by `WITH CHECK`
  (`PostgresException.SqlState == "42501"`).
- Fail-closed: no GUC set → zero rows, no error (validates the `, true` flag).

Migrations run under the per-context `<context>_migrator` (`BYPASSRLS`, DDL) connection; reads and
writes are exercised through the per-context `<context>_app` (`NOBYPASSRLS`, DML-only) connection
with the `app.tenant_id` GUC set by `TenantSessionInterceptor`. See
[database-isolation.md](database-isolation.md).

## TDD RED-GREEN-REFACTOR Workflow

### Step 1: RED — Write Failing Test

```csharp
[Fact]
public async Task SaveInvoiceWhenValidCommand()
{
    var repository = new CapturingInvoiceRepository();
    var useCase = new CreateInvoice(repository, new StubTenantContext("tenant-abc"));

    var result = await useCase.ExecuteAsync(ValidCommand, CancellationToken.None);

    Assert.NotNull(result.Invoice);
}
```

Compile → test fails (**RED**) because `CreateInvoice` doesn't exist.

### Step 2: GREEN — Minimal Implementation

Create just enough to pass the test. Code can be ugly; that's OK.

### Step 3: REFACTOR — Clean Up

Add more test cases to force generalization, then refactor. All tests pass (**GREEN** again). Commit.

## Coverage

```bash
dotnet test backend/tests/GcPlatform.Sales.Tests /p:CollectCoverage=true /p:CoverageFormat=json
```

Target **80%+ coverage** on the modules you build. Focus on happy paths and error cases that matter.

## Traits: Category + Nature

Two trait dimensions on every test (1163 uses across the suite):

- `[Trait("Category", "Unit test")]`
- `[Trait("Nature", "Developer test")]` (domain, inner loop) **or**
  `[Trait("Nature", "Acceptance test")]` (use case, outer loop)

Filter by trait: `dotnet test --filter "Nature=Acceptance test"`.

## Developer tests — domain (inner loop)

No doubles; the domain has no external collaborators. Test through factories, assert on state and
emitted events. Triangulate with `[Theory]`/`[InlineData]`.

```csharp
[Trait("Category", "Unit test")]
[Trait("Nature", "Developer test")]
public sealed class PlacingOrderShould
{
    [Fact]
    public void PlaceOrderWithOneItem_ReturnsOrderWithIdItemAndTotalAmount()
    {
        // Arrange
        var productId = Guid.Parse("9442d74b-91d2-469b-9a89-d42bc2f3c48f");
        var item = OrderItem.Of(productId, "Bordeaux rosé", 5.19m);

        // Act
        var result = Order.Place([item]);

        // Assert
        Assert.True(result.IsSuccess);
        Assert.NotEqual(Guid.Empty, result.Data.Id);
        Assert.Equal(5.19m, result.Data.Amount);
    }

    [Theory]
    [InlineData(2, 10.38)]
    [InlineData(3, 15.57)]
    public void PlaceOrderWithQuantity_ComputesTotalAmount(int quantity, decimal amount)
    {
        var item = OrderItem.Of(Guid.NewGuid(), "Bordeaux rosé", 5.19m, quantity);

        var result = Order.Place([item]);

        Assert.Equal(amount, result.Data.Amount);
    }
}
```

### Event-sourcing assertions

Assert on the events the aggregate **raised**, and that **rehydration** reproduces state:

```csharp
[Fact]
public void PlaceOrder_RaisesOrderPlaced()
{
    var item = OrderItem.Of(Guid.NewGuid(), "Bordeaux rosé", 5.19m);

    var order = Order.Place([item]).Data;

    Assert.Single(order.UncommittedEvents);
    Assert.IsType<OrderPlaced>(order.UncommittedEvents[0]);
}
```

## Acceptance tests — handler (outer loop)

Replace collaborators with hand-rolled doubles. Assert on the result and persisted state.

```csharp
[Fact]
[Trait("Category", "Unit test")]
[Trait("Nature", "Acceptance test")]
public async Task PlaceOrder_WithOneItem_SavesOrderAndReturnsOrderId()
{
    // Arrange
    var productId = new Guid("bec56751-d09e-4910-81da-fa87ca4b0325");
    var products = new StubProductRepository([new Product(productId, "Bordeaux rosé", 5.99m)]);

    var orders = new InMemoryOrderRepository();
    var handler = new PlaceOrderHandler(orders, products);
    var command = new PlaceOrder { OrderItems = [new Tuple<Guid, int>(productId, 1)] };

    // Act
    var result = await handler.Handle(command, CancellationToken.None);

    // Assert
    Assert.True(result.IsSuccess);
    Assert.NotEqual(Guid.Empty, result.Data);
    Assert.NotNull(orders.FindForTest(result.Data));
}
```

Not-yet-built scenarios stay as shopping-list markers until tackled:

```csharp
[Fact]
[Trait("Nature", "Acceptance test")]
public async Task PlaceOrder_WithSeveralItems_Succeeds() => await Task.CompletedTask;
```

## Packages

| Package | Version (reference) | Purpose |
|---|---|---|
| `xunit.v3` | 3.2.2 | test framework |
| `xunit.runner.visualstudio` | 3.1.5 | VS / `dotnet test` runner |
| `Microsoft.NET.Test.Sdk` | 18.9.0 | test host |
| `Shouldly` | 4.3.0 | assertions (5 of 7 test projects) |
| `coverlet.collector` | 10.0.1 | coverage |
| `Testcontainers.PostgreSql` | 4.14.0 | real Postgres for RLS / integration tests |
| `TngTech.ArchUnitNET(.xUnitV3)` | 0.13.3 | architecture fitness functions |
| `Npgsql` | — | .NET Postgres driver |

Test projects use xUnit only (see each `GcPlatform.<Module>.Tests.csproj`).

## Commit discipline

Tests and production code never change in the same commit (see [[tdd]]). `test(<context>): …` for
test changes; `feat(<context>): …` / `fix(<context>): …` for production.
