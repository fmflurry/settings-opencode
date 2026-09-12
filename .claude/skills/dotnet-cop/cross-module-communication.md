# dotnet-cop / cross-module communication (modular monolith)

How modules in the modular monolith communicate. A module is self-contained (for example, a
Sales module with subdomains such as Invoices, Customers, Payments, Dunning, Receivables,
Catalog). Hard blocker: NO direct cross-module data reads — only the Wolverine message bus +
per-module projections. This is the modular-monolith refinement of `modular-isolation.md`.

## 🟢 Architecture blockers

### Direct cross-module data read via shared DbContext (hard blocker)
A module MUST NOT read another module's data through a shared DbContext (e.g. a wide
`SalesDbContext`) or a cross-domain read port. Each module owns its read projections in its
OWN DbContext.

```csharp
// BAD — ModuleB.Infrastructure depends on ModuleA.Infrastructure (wide DbContext)
<ProjectReference Include="..\GcPlatform.ModuleA.Infrastructure\GcPlatform.ModuleA.Infrastructure.csproj" />  // 🟢 violation

// BAD — cross-domain read port in SharedKernel (DELETED, never reintroduce)
// GcPlatform.ModuleA.Domain.DunningPorts.ICustomerDunningReader

// GOOD — ModuleB owns its projection DbContext, fed by Wolverine integration events
var proj = await moduleBDb.InvoiceProjections.FirstAsync(p => p.InvoiceId == id);
```

### Cross-domain read ports in SharedKernel (hard blocker)
A module's `Domain` project (SharedKernel) holds domain shared types only. Deleted
cross-domain read-port namespaces (e.g. the Sales `DunningPorts.cs` / `ReceivablesPorts.cs`)
and the deleted cross-module reader adapters (e.g. the Sales `EfCore*DunningReader` /
`EfCore*ReceivablesReader` family) MUST NEVER be reintroduced.

### Wolverine projection pattern (the ONLY allowed inter-module read path)
Inter-module reads happen via the Wolverine message bus:
1. Source module emits a plain immutable `record` integration event in `GcPlatform.<Module>.Contracts` (Wolverine outbox).
2. Consumer module's Infrastructure subscribes and upserts into its OWN projection DbContext
   (e.g. `DunningDbContext`, `ReceivablesDbContext` for the Sales module's subdomains).
3. Consumer reads locally from its projection — never from the source module's DbContext.

Domain/Application layers stay Wolverine-free. Only Infrastructure references
`GcPlatform.<Module>.Contracts` + Wolverine. (ADR-0037: plain immutable `record` integration
events. Persistence is chosen per bounded context — EF Core CRUD and event-sourced Marten stores
are both first-class; neither is mandated.)

### `Model/` directory convention
Domain model / read-model types live in a `Model/` subdirectory within each module's Domain
project (SharedKernel included). EF `Entities/` stay in `Entities/`.

```csharp
// GOOD (example: the Sales module's Dunning subdomain)
namespace GcPlatform.Sales.Dunning.Domain.Model;     // read-model / domain model types
namespace GcPlatform.Sales.Dunning.Domain.Entities;  // EF-mapped entities
```

## Enforced by ArchUnitNET
The project's fitness functions (for example, `backend/tests/GcPlatform.Sales.Tests/Architecture/LayerDependencyRules.cs`
for the Sales module) encode patterns such as:
- `<Subdomain>_Infrastructure_must_not_depend_on_<OtherModule>_Infrastructure` (R1)
- `<Subdomain>_Infrastructure_must_not_depend_on_<OtherModule>Ports` (R2)
- deleted-file guards — reintroducing any deleted `EfCore*Reader.cs` fails the build.

## ADR pointers
- ADR-0014 — bus-only inter-BC communication.
- ADR-0010 — ArchUnitNET fitness function.
- ADR-0037 — plain immutable `record` integration events; CRUD vs event sourcing chosen per bounded context (ADR-0048 for the per-BC Marten store).
- ADR-0013 / ADR-0038 — schema + RLS per module.
