# dotnet-cop / EF Core

DbContext per module/schema, migrations via `dotnet ef migrations add`, no lazy-loading surprises, AsNoTracking for reads, no N+1, query splitting, migration safety.

## 🔴 Blockers

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

### DbContext shared across modules (single god context)
Per the dotnet-clean-architecture convention, each module should use its own `DbContext` scoped to its schema/tables. A single `AppDbContext` that references all entity types couples modules at the infrastructure level:
```
✅ Module/Order/Infrastructure/Context/OrderDbContext.cs
✅ Module/User/Infrastructure/Context/UserDbContext.cs
❌ Infrastructure/Context/AppDbContext.cs (contains Order + User entities)
```
Flag if a new entity type from module A is added to a shared DbContext that already contains module B entities.

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

## 🔵 Nits

- `SaveChangesAsync(cancellationToken)` — always pass `CancellationToken` through from the endpoint.
- `FindAsync(id, cancellationToken)` preferred over `FirstOrDefaultAsync(x => x.Id == id)` for PK lookups (uses identity cache).
- Migrations should be named with a meaningful verb: `AddOrderStatusIndex`, not `Migration20260101`.
- `HasQueryFilter` for soft-delete entities — verify global filter is applied and not accidentally bypassed with `IgnoreQueryFilters()`.
- Entity configurations should live in `IEntityTypeConfiguration<T>` classes, not in `OnModelCreating` directly.

## Reporting

Cite the query line for N+1 and AsNoTracking findings. Cite the `migrationBuilder.DropColumn/Table` line for data-loss findings. Cite the `DbContext` class line for shared-context findings. Include table/entity name in the message when inferable.
