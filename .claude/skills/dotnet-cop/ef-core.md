# dotnet-cop / EF Core

DbContext per module/schema, migrations via `dotnet ef migrations add`, no lazy-loading surprises, AsNoTracking for reads, no N+1, query splitting, migration safety. **Doctrine**: schema-per-module isolation + FORCE RLS on all context-schema tables + lightweight app-role (DML-only, no DDL).

## 🟢 Blockers

### Single shared `DbContext` across modules (god context)
```csharp
// BAD — one DbContext references all module entity types
public class AppDbContext(DbContextOptions options) : DbContext(options)
{
    public DbSet<Order> Orders { get; set; }
    public DbSet<User> Users { get; set; }    // from different modules
    // ...
}

// GOOD — per-module DbContext
public class OrderDbContext(DbContextOptions<OrderDbContext> options) : DbContext(options)
{
    public DbSet<Order> Orders { get; set; }
}
public class UserDbContext(DbContextOptions<UserDbContext> options) : DbContext(options)
{
    public DbSet<User> Users { get; set; }
}
```
A shared DbContext couples modules at the infrastructure level, preventing independent schema evolution and deployment. Each module owns its own context and schema.

### Cross-schema access or grant (schema isolation violated)
A query, migration, or role grant violates module schema isolation:
- `GRANT ... ON SCHEMA <other_context> TO <context>_app` — forbidden cross-schema grant.
- `SELECT ... FROM <other_context>.table_name` or raw SQL cross-schema reference.
- `JOIN <other_context>.table` in a handler query.

**Doctrine**: Each module's `<context>_app` role may **only** access tables in its own `<context>` schema. Cross-module communication is exclusively via integration events (Wolverine bus), never via shared database tables.

### Table created without FORCE ROW LEVEL SECURITY (mandatory in all context schemas)

A new table is created in any context schema (via `CreateTable(...)` in a migration) without:
- `ALTER TABLE <context>.<table> ENABLE ROW LEVEL SECURITY;`
- `ALTER TABLE <context>.<table> FORCE ROW LEVEL SECURITY;`
- `CREATE POLICY <table>_tenant_isolation` with both `USING` and `WITH CHECK` clauses, fail-closed: `current_setting('app.tenant_id', true)` (the `, true` flag is **required**).

**Doctrine**: Bulk RLS enable happens once per context via `<Context>EnableRls` migration (enumerates all existing tables). All **subsequent tables** created in migrations must immediately include RLS + FORCE + policy in the **same migration**.

**Canonical pattern** (for new tables):
```sql
ALTER TABLE <context>.<table> ENABLE ROW LEVEL SECURITY;
ALTER TABLE <context>.<table> FORCE ROW LEVEL SECURITY;
CREATE POLICY <table>_tenant_isolation ON <context>.<table>
  USING  (tenant_id = (SELECT current_setting('app.tenant_id', true)))
  WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)));
```

For **child tables** without own `tenant_id`, use EXISTS subquery to the parent.

**Database provisioning:** When a new module adds schema/roles/RLS to the provisioning script (managed-DB scenario), consult the `db-provisioning` skill — it ensures the SQL script, app-boot provisioners, and conformance test stay synchronized across roles, grants, and RLS.

### DDL by runtime role or missing REVOKE CREATE (DML-only doctrine violated)

A migration grants DDL privileges to `<context>_app` or creates/owns objects under the runtime role:
- `GRANT CREATE ON SCHEMA <context> TO <context>_app`
- Table owned by `<context>_app` instead of `<context>_migrator`.
- Missing `REVOKE CREATE ON SCHEMA <context> FROM PUBLIC, <context>_app`.
- Runtime connection used to run migrations (schema ownership wrong).

**Doctrine**: `<context>_app` is DML-only (SELECT, INSERT, UPDATE, DELETE + USAGE on sequences). Only `<context>_migrator` (owner) performs DDL. Migrations run under `<Context>MigrationConnection` with `<context>_migrator` role.

### Raw SQL with string interpolation (SQL injection)
```csharp
// BAD — SQL injection
var sql = $"SELECT * FROM Orders WHERE CustomerId = '{customerId}'";
var orders = await context.Orders.FromSqlRaw(sql).ToListAsync();

// GOOD — parameterized
var orders = await context.Orders
    .FromSqlRaw("SELECT * FROM Orders WHERE CustomerId = {0}", customerId)
    .ToListAsync();

// BETTER — use LINQ (EF generates parameterized SQL)
var orders = await context.Orders
    .Where(o => o.CustomerId == customerId)
    .ToListAsync();
```

### Migration removes column without data preservation strategy
A migration that drops a column or table on a live database can cause irreversible data loss. Flag when:
- `migrationBuilder.DropColumn(...)` appears without a preceding data-migration step.
- `migrationBuilder.DropTable(...)` with no archived or backup comment.

Require the author to confirm: (a) column has no live data, OR (b) a data-migration migration precedes this one, OR (c) this is a dev-only migration.

### Saving changes without wrapping related operations in a transaction
```csharp
// BAD — two SaveChangesAsync calls; partial failure leaves inconsistent state
await context.Orders.AddAsync(order);
await context.SaveChangesAsync();                      // 🔴 committed
await context.OrderItems.AddRangeAsync(items);
await context.SaveChangesAsync();                      // fails -> order exists, items missing

// GOOD — single unit of work
await context.Orders.AddAsync(order);
await context.OrderItems.AddRangeAsync(items);
await context.SaveChangesAsync();                      // atomic
```

## 🟡 Risks

### Missing `AsNoTracking()` on read-only query
```csharp
// BAD — tracking enabled on a pure read path
var orders = await context.Orders
    .Where(o => o.CustomerId == id)
    .ToListAsync();

// GOOD
var orders = await context.Orders
    .AsNoTracking()
    .Where(o => o.CustomerId == id)
    .ToListAsync();
```
Read-only queries (no subsequent `SaveChangesAsync`) pay unnecessary tracking overhead. Add `AsNoTracking()` or use `AsNoTrackingWithIdentityResolution()` when navigations are involved.

### N+1 query pattern
```csharp
// BAD — one query per order item (N+1)
var orders = await context.Orders.ToListAsync();
foreach (var order in orders)
{
    var items = await context.OrderItems
        .Where(i => i.OrderId == order.Id)
        .ToListAsync();
}

// GOOD — eager load with Include
var orders = await context.Orders
    .Include(o => o.Items)
    .ToListAsync();
```
Also flag `.Select` projections that trigger lazy navigation loads without `Include`.

### Lazy loading enabled without explicit justification
```csharp
// BAD — lazy loading makes N+1 invisible until production
services.AddDbContext<AppDbContext>(o =>
    o.UseLazyLoadingProxies());

// GOOD — explicit eager or split loading
// Use .Include() or .AsSplitQuery() for large navigations
```
If lazy loading is present, flag it as 🟡 risk unless AGENTS.md explicitly allows it.

### Migration without corresponding snapshot update
EF Core auto-generates the `*ModelSnapshot.cs`. A migration file added without an updated snapshot indicates the migration was hand-edited or generated incorrectly — flag for author verification.

### Query splitting missing on large collection navigations
```csharp
// BAD — Cartesian explosion with multiple collection includes
var orders = await context.Orders
    .Include(o => o.Items)
    .Include(o => o.Tags)
    .ToListAsync();

// GOOD — split query avoids Cartesian product
var orders = await context.Orders
    .AsSplitQuery()
    .Include(o => o.Items)
    .Include(o => o.Tags)
    .ToListAsync();
```

### Tenant-scoped entity without RLS policy (isolation gap)
An entity/table with a `tenant_id` column (tenant-scoped) is added/modified without:
- `ENABLE ROW LEVEL SECURITY` + `FORCE ROW LEVEL SECURITY` on the table, and
- a policy `USING`/`WITH CHECK (tenant_id = current_setting('app.tenant_id', true))`.

**Risk:** Real isolation loss. RLS keyed on the `app.tenant_id` GUC (stamped by `TenantSessionInterceptor`) is the mandatory isolation mechanism. There is **no** EF Core `HasQueryFilter` tenant predicate in this repo — do not add one and do not expect one.

## 🔵 Nits

- `SaveChangesAsync(cancellationToken)` — always pass `CancellationToken` through from the endpoint.
- `FindAsync(id, cancellationToken)` preferred over `FirstOrDefaultAsync(x => x.Id == id)` for PK lookups (uses identity cache).
- Migrations should be named with a meaningful verb: `AddOrderStatusIndex`, not `Migration20260101`.
- `HasQueryFilter` for soft-delete entities — verify global filter is applied and not accidentally bypassed with `IgnoreQueryFilters()`.
- Entity configurations should live in `IEntityTypeConfiguration<T>` classes, not in `OnModelCreating` directly.

## Reporting

Cite the query line for N+1 and AsNoTracking findings. Cite the `migrationBuilder.DropColumn/Table` line for data-loss findings. Cite the `DbContext` class line for shared-context findings. Include table/entity name in the message when inferable.
