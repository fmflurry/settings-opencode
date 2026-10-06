# Database Isolation: Schema-Per-Module + RLS

One PostgreSQL schema per module, all modules in the same database. Tenant isolation via
Row Level Security (RLS) keyed on the session GUC `app.tenant_id`, which is stamped by
`TenantSessionInterceptor`. Lightweight per-module roles enforce DML-only runtime access.

## Schema and Roles

### Create Schema

```sql
CREATE SCHEMA IF NOT EXISTS invoice AUTHORIZATION invoice_migrator;
```

### Create Lightweight Roles

Two roles per module:

1. **Migrator role (DDL):** Owns the schema, runs migrations. `BYPASSRLS` (DDL only),
   non-superuser.
   ```sql
   CREATE ROLE invoice_migrator
       NOSUPERUSER NOCREATEDB NOCREATEROLE
       BYPASSRLS;
   ```
   (`ALTER ROLE invoice_migrator WITH PASSWORD '…'` is applied separately; role attributes are
   only meaningful at creation time.)

2. **App role (DML):** Runtime only, `SELECT`/`INSERT`/`UPDATE`/`DELETE`. No DDL, no schema
   creation, **cannot bypass RLS**.
   ```sql
   CREATE ROLE invoice_app
       NOSUPERUSER NOCREATEDB NOCREATEROLE
       NOBYPASSRLS;
   ```
   (`ALTER ROLE invoice_app WITH PASSWORD '…'` applied separately.)

### Grant Permissions

Grant DML on current tables and sequences to the app role:

```sql
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA invoice TO invoice_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA invoice TO invoice_app;
```

Revoke schema creation (fail-closed):

```sql
GRANT CREATE ON SCHEMA invoice TO invoice_migrator;
GRANT USAGE ON SCHEMA invoice TO invoice_app;
REVOKE CREATE ON SCHEMA invoice FROM PUBLIC, invoice_app;
```

Set defaults for future tables (created by migrator):

```sql
ALTER DEFAULT PRIVILEGES FOR ROLE invoice_migrator IN SCHEMA invoice
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO invoice_app;

ALTER DEFAULT PRIVILEGES FOR ROLE invoice_migrator IN SCHEMA invoice
    GRANT USAGE, SELECT ON SEQUENCES TO invoice_app;
```

Lock down migration history (app cannot touch):

```sql
REVOKE ALL ON TABLE invoice.__EFMigrationsHistory FROM invoice_app;
```

Canonical reference implementation:
`backend/src/ThirdParties/GcPlatform.ThirdParties.Infrastructure/Persistence/ThirdPartiesSchemaMigrator.cs:163` (role DDL) and `:198` (RLS policy).

## Row Level Security (RLS)

All tenant-scoped tables enforce RLS. The session GUC `app.tenant_id` (set by
`TenantSessionInterceptor` when a connection opens) determines the tenant. **RLS is the
enforcement layer — do not add an EF Core `HasQueryFilter` tenant predicate.**

### Tenant-Scoped Entity: RLS Configuration

**EF Core configuration** (`Infrastructure/Persistence/Configurations/`):

```csharp
// Infrastructure/Persistence/Configurations/InvoiceConfiguration.cs
public sealed class InvoiceConfiguration : IEntityTypeConfiguration<Invoice>
{
    public void Configure(EntityTypeBuilder<Invoice> builder)
    {
        builder.ToTable("invoices", schema: "invoice");
        builder.HasKey(f => f.Id);
        builder.Property(f => f.TenantId).HasColumnName("tenant_id").IsRequired();
        // No HasQueryFilter for tenancy: FORCE RLS + app.tenant_id enforce isolation.
    }
}
```

**Migration (SQL):**

```sql
CREATE TABLE invoice.invoices (
    id TEXT PRIMARY KEY,
    number TEXT NOT NULL,
    customer_id TEXT NOT NULL,
    tenant_id UUID NOT NULL,
    invoice_date TIMESTAMP NOT NULL,
    payment_terms_days INT NOT NULL,
    due_date TIMESTAMP NOT NULL
);

-- Enable RLS
ALTER TABLE invoice.invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice.invoices FORCE ROW LEVEL SECURITY;

-- Policy: enforce tenant isolation both on read and write
CREATE POLICY invoices_tenant_isolation ON invoice.invoices
    USING      (tenant_id = (SELECT current_setting('app.tenant_id', true)))
    WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)));

-- Grants
GRANT SELECT, INSERT, UPDATE, DELETE ON invoice.invoices TO invoice_app;
```

**Key points:**
- `FORCE ROW LEVEL SECURITY`: even the table owner (migrator) is subject to RLS during data operations.
- `USING` clause: checked on `SELECT` and `DELETE`.
- `WITH CHECK` clause: checked on `INSERT` and `UPDATE`.
- `, true` in `current_setting('app.tenant_id', true)`: fail-closed — if the GUC is not set, the result is `NULL`, and no rows match `NULL` in the equality check.

### Child Entity (No Tenant Column): RLS via EXISTS

If a child table doesn't have its own `tenant_id` (e.g. `invoice_lignes`), use an `EXISTS`
subquery to the parent:

```sql
CREATE TABLE invoice.invoice_lignes (
    id TEXT PRIMARY KEY,
    invoice_id TEXT NOT NULL REFERENCES invoice.invoices(id) ON DELETE CASCADE,
    quantity INT NOT NULL,
    unit_price NUMERIC NOT NULL
);

ALTER TABLE invoice.invoice_lignes ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice.invoice_lignes FORCE ROW LEVEL SECURITY;

CREATE POLICY invoice_lignes_tenant_isolation ON invoice.invoice_lignes
    USING (
        EXISTS (
            SELECT 1 FROM invoice.invoices f
            WHERE f.id = invoice_lignes.invoice_id
            AND f.tenant_id = (SELECT current_setting('app.tenant_id', true))
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM invoice.invoices f
            WHERE f.id = invoice_lignes.invoice_id
            AND f.tenant_id = (SELECT current_setting('app.tenant_id', true))
        )
    );

GRANT SELECT, INSERT, UPDATE, DELETE ON invoice.invoice_lignes TO invoice_app;
```

No EF query filter is needed for child rows either — the database policy handles it.

## Session GUC Setup

`TenantSessionInterceptor` is an EF Core `DbConnectionInterceptor` (not a command interceptor).
It sets `app.tenant_id` immediately after a connection opens and resets it before the connection
returns to the pool. Open-time stamping is authoritative, so a pooled connection can never leak a
previous tenant's GUC.

Canonical implementation: `backend/src/SharedKernel/Tenancy/TenantSessionInterceptor.cs`.

```csharp
public sealed class TenantSessionInterceptor(ITenantContext tenantContext)
    : DbConnectionInterceptor
{
    public override void ConnectionOpened(DbConnection connection, ConnectionEndEventData _)
    {
        using var cmd = connection.CreateCommand();
        var tenantId = tenantContext.GetCurrentTenantId();
        cmd.CommandText = tenantId is null
            ? "RESET app.tenant_id"
            : "SELECT set_config('app.tenant_id', @tenant, false)";
        // ...bind @tenant and execute
    }

    // ConnectionClosing() RESETs app.tenant_id (belt-and-suspenders).
}
```

Register it on every module DbContext (Scoped), from the composition root:

```csharp
builder.Services.AddScoped<TenantSessionInterceptor>();

services.AddDbContext<InvoiceDbContext>((serviceProvider, options) =>
    options.UseNpgsql(connectionString)
           .AddInterceptors(serviceProvider.GetRequiredService<TenantSessionInterceptor>()));
```

`ITenantContext` resolves differently per scope:
- `CompositeTenantContext` on HTTP requests (reads the `accountId` claim).
- `AmbientTenant` on Wolverine handlers / background work (set by the handler scope).

Wolverine codegen must allow-list `AmbientTenant` so the handler and the `DbContext` share the
same scoped instance:

```csharp
opts.CodeGeneration.AlwaysUseServiceLocationFor<AmbientTenant>();
```

See `backend/src/GcPlatform.Api/Program.cs` for the registration and the ADR-0060 rationale.

## Connection Strings

Configure two per module in `appsettings.json`, e.g. for Sales:

```json
{
  "ConnectionStrings": {
    "SalesMigration": "Host=localhost;Database=gc_platform;User Id=sales_migrator;Password=…;",
    "SalesApp":       "Host=localhost;Database=gc_platform;User Id=sales_app;Password=…;"
  }
}
```

The bounded context is **config-aware**: its `ConfigureServices` entrypoint reads
`ConnectionStrings:SalesApp` / `ConnectionStrings:SalesMigration` and fails fast if absent (no
fallback connection string — ADR-0046/D6). Migrations run as the migrator role; runtime I/O uses
the app role with the interceptor attached.

## Verification Test

Test that RLS is enforced: the app role cannot `SELECT` other tenants, cannot `ALTER` tables, and
can only DML its own schema. Use `Testcontainers.PostgreSql` (Docker), xUnit v3 (`[Fact]`), and
built-in `Assert` / Shouldly. Follow
`backend/tests/GcPlatform.Api.Tests/Infrastructure/Persistence/InvoicesRlsIsolationShould.cs` and
`backend/tests/GcPlatform.McpAccess.Tests/Infrastructure/McpAccessPrivilegeIsolationShould.cs`.

```csharp
public sealed class InvoiceRlsIsolationShould
{
    [Fact]
    public async Task AppRoleCanSelectOwnTenant()
    {
        // Arrange: insert as migrator, then query as app role with a matching GUC.
        // Act
        var invoices = await appContext.Invoices.ToListAsync();

        // Assert
        invoices.ShouldHaveSingleItem();
        invoices[0].Number.ShouldBe("F-001");
    }

    [Fact]
    public async Task AppRoleCannotSelectOtherTenant()
    {
        var invoices = await appContext.Invoices.ToListAsync();
        invoices.ShouldBeEmpty();
    }

    [Fact]
    public async Task InsertWithForeignTenantIsRejectedWith42501()
    {
        var ex = await Should.ThrowAsync<PostgresException>(() => WriteForeignTenantRow());
        ex.SqlState.ShouldBe("42501");
    }

    [Fact]
    public void AppRoleCannotAlterTable()
    {
        using var connection = new NpgsqlConnection(AppRoleConnectionString);
        connection.Open();
        using var cmd = connection.CreateCommand();
        cmd.CommandText = "ALTER TABLE invoice.invoices DROP COLUMN number;";

        var ex = Assert.Throws<NpgsqlException>(() => cmd.ExecuteNonQuery());
        ex.Message.ShouldContain("permission denied");
    }
}
```

Run Docker-gated tests with:

```bash
GCPLATFORM_REQUIRE_DOCKER_TESTS=1 dotnet test backend/tests/GcPlatform.Api.Tests
```

## Canonical References

Real examples in the codebase:

- Schema/role/policy provisioning: `backend/src/ThirdParties/GcPlatform.ThirdParties.Infrastructure/Persistence/ThirdPartiesSchemaMigrator.cs`
- Tenant interceptor: `backend/src/SharedKernel/Tenancy/TenantSessionInterceptor.cs`
- Tenant context: `backend/src/SharedKernel/Tenancy/` (`ITenantContext`, `AmbientTenant`, `CompositeTenantContext`)
- RLS isolation tests: `backend/tests/GcPlatform.Api.Tests/Infrastructure/Persistence/InvoicesRlsIsolationShould.cs`, `.../PaymentsRlsIsolationShould.cs`
- Wolverine tenancy rules: `.claude/rules/common/wolverine-tenancy.md`
- ADRs: ADR-0013, ADR-0038 (schema + role + RLS per module), ADR-0060 (session/GUC/envelope)

## Checklist: Database Isolation

- [ ] Create schema: `CREATE SCHEMA <module> AUTHORIZATION <module>_migrator;`
- [ ] Create migrator role: `<module>_migrator` (owner, `NOSUPERUSER`, `BYPASSRLS`)
- [ ] Create app role: `<module>_app` (`DML-only`, `NOSUPERUSER`, `NOBYPASSRLS`)
- [ ] Grant schema usage to app role; revoke `CREATE`
- [ ] Set `ALTER DEFAULT PRIVILEGES` for future tables/sequences
- [ ] Lock down `__EFMigrationsHistory`: `REVOKE ALL FROM <module>_app`
- [ ] Tenant-scoped tables: `ENABLE` + `FORCE ROW LEVEL SECURITY` with
      `USING`/`WITH CHECK (tenant_id = current_setting('app.tenant_id', true))`
- [ ] NO EF Core tenant query filter — RLS is the enforcement layer
- [ ] Register `TenantSessionInterceptor` (Scoped) on the module DbContext
- [ ] Configure two connection strings: migration (migrator role) + runtime (app role)
- [ ] Boot code: migrate with migrator role, then switch to app role for runtime
- [ ] RLS isolation test: app role can't read/write other tenants, can't DDL
- [ ] Docker-gated tests run with `GCPLATFORM_REQUIRE_DOCKER_TESTS=1`
