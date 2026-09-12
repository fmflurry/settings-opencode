# dotnet-cop / enforcement — BLOCK vs WARN severity checklist

Canonical severity list for dotnet-cop and the coder self-check. **BLOCK** findings fail review; the `.editorconfig`/analyzer + ArchUnitNET template makes the deterministic subset fail the build.

**Structure**: SoT BLOCK rules first (mandatory for all modules); optional-addon BLOCK rules clearly separated (CQRS/event-sourcing only when module opts in).

---

## ✅ MUST — SoT BLOCK (mandatory for all modules)

Review fails when any of these is present. Corresponds to 🔴 bug, 🟠 sec, and mandatory 🟢 arch findings.

| Rule | Detection | Why |
|---|---|---|
| **Business logic inside Minimal API endpoint handler** | Domain rule computed or branched in the driving layer | Endpoints sit in Application; domain rules here are invisible to Domain/Application unit tests and cannot be reused across entry points |
| **Module-isolation violation** — direct cross-module type reference | `using` directive in one module's file pointing to another module's non-shared namespace | Breaks the module boundary; creates compile-time coupling between domains that must evolve independently |
| **Cross-module assembly reference** (including `<Module>.Contracts`) | `<ProjectReference>` between module Domain/Application projects | Build-time coupling defeats the independence goal; use ports, adapters, and events |
| **EF leaking out of Infrastructure** | EF namespace or `DbContext` in Domain or Application files | Infrastructure must not leak into Domain; Domain must be testable without a real database |
| **Raw SQL with string interpolation** (SQL injection) | `FromSqlRaw($"...")` or `ExecuteSqlRaw($"...")` with interpolated variable | Gate-enforced: Roslyn CA2100 flags this |
| **Null-forgiving without guard** | CS8600/8602/8604 unsuppressed — unjustified `!` on nullable | Gate-enforced: `<Nullable>enable</Nullable>` required |
| **Missing CancellationToken on async I/O** | `async` method accepts `CancellationToken` but doesn't pass to `SaveChangesAsync`, `ToListAsync`, etc. | Gate-enforced: Roslyn CA2016 |
| **Single shared `DbContext` across modules** | One `DbContext` references entity types from multiple modules | Couples modules at infrastructure; prevents independent schema evolution |
| **Cross-schema access** | Query/migration violates module schema isolation (`SELECT ... FROM <other_context>.table`) | Modules must communicate via events, never via shared database |
| **Table created without FORCE ROW LEVEL SECURITY** | New table in context schema missing RLS enable + FORCE + policy + fail-closed flag | RLS is the isolation boundary; missing any element allows tenant-data leakage |
| **DDL by runtime role** | Migration grants DDL to `<context>_app` or tables owned by runtime role | `<context>_app` must be DML-only; only `<context>_migrator` performs DDL |
| **Business error thrown instead of returned** | `throw` for an expected/business condition in Domain or Application | Failures must flow as `Result`; throwing breaks typed error handling and forces 500 fallback |
| **Tests and production code in same commit** | Single commit's diff touches both `tests/**` and `src/**` | Inner loop: test XOR code per commit, each commit is a restorable state |
| **Module named non-English or non-PascalCase** | `Module/<Name>/` directory, namespace, `<Name>Module` class, or schema not English PascalCase (schema: lowercase snake_case) | Module names are permanent public contracts; English + PascalCase is the SoT (dotnet-clean-architecture § Language & Naming) |
| **Non-English identifier** | Any type/method/property/variable/namespace using French words or accented characters | Code is written in English; mixed-language modules break grep-ability and ubiquitous language |
| **Non-English comment or XML doc** | Comment or `///` doc in French (or other non-English) | Comments and docs are English everywhere |
| **Synonym for a canonical term** | Type/endpoint names a concept with a term absent from `docs/architecture/ubiquitous-language.md` | Ubiquitous language: one term per concept; synonyms fragment the vocabulary |

---

## 🔧 MUST (Optional-Addon) — BLOCK only when module opts in

The following rules apply **only when a module explicitly adopts the named pattern**. Do not enforce across all modules. When not in use, simpler patterns (standard CRUD, direct use-case requests) are acceptable.

### CQRS (when module signals CQRS adoption)

| Rule | Detection | Why |
|---|---|---|
| **Command/query not implementing the contract** | Use case doesn't implement `ICommand`/`IQuery` | Contracts enable type-safe handler dispatch |
| **Aggregate state mutated outside an event** | Public setter or external assignment outside `When()` handler | Event sourcing requires all state changes to be raised+applied events; direct mutation breaks stream rebuilding |
| **Aggregate created with `new` instead of factory** | `new <Aggregate>(...)` outside the factory | Invariants live in the factory; bypassing it creates invalid aggregates |
| **Query rehydrates instead of reading projection** | Read handler loads via write-side repo or replays events | Couples read path to write model and event-stream size |
| **Mutable domain event** | `IDomainEvent` with public setters or mutable class instead of `record` | Events are immutable append-only history; mutation corrupts replay |
| **Handler signature deviates from `Handle(msg, ct)`** | Bespoke method name or missing `CancellationToken` | Standard signature enables framework integration |

### Event Sourcing (when module signals event-sourcing adoption)

| Rule | Detection | Why |
|---|---|---|
| **State mutated outside an event** | Direct field assignment, public setter, or state change not raised as event | Event sourcing foundation: all state changes are raised+applied events |
| **Mutating or deleting committed events** | Migration or code updates/deletes event-store rows | Append-only doctrine: correct errors via compensating events |
| **`UncommittedEvents` not cleared after persistence** | Repository `Save` appends events but doesn't call `MarkEventsAsCommitted()` | Events will be re-appended on next save |
| **Missing optimistic concurrency check on event append** | Event-store append lacks `expectedVersion` check | Risk of lost updates under concurrent writers |

---

## ⚠️ SHOULD — WARN

Advisory findings. Reported as 🟡 risk or 🔵 nit. Do not block on their own unless AGENTS.md escalates.

| Rule | Detection | Why |
|---|---|---|
| **Missing `.AsNoTracking()` on read-only query paths** | EF query never calls `SaveChangesAsync` but tracking is enabled | Unnecessary tracking overhead; identity map grows unboundedly |
| **N+1 query pattern** | Loop executing one query per row; `.Select` triggering lazy navigation without `.Include` | O(N) round-trips instead of O(1) |
| **Lazy loading enabled without justification** | `UseLazyLoadingProxies()` not explicitly permitted by AGENTS.md | Makes N+1 invisible until production |
| **Missing query splitting on large multi-collection includes** | Two or more `.Include()` on collection navigations without `.AsSplitQuery()` | Cartesian product explosion |
| **Migration removes column without data preservation** | `DropColumn` or `DropTable` without preceding data-migration or backup comment | Risk of irreversible data loss |
| **Saving changes without transaction** | Multiple `SaveChangesAsync` calls where partial failure leaves inconsistent state | Atomic unit-of-work needed |
| **Adapter throws raw infrastructure exception** | `DbUpdateException`, `HttpRequestException` bubbles without mapping | Port contract guarantees domain exceptions only |
| **Adapter contains business logic** | Domain rules (discounts, eligibility) found in Infrastructure adapter | Adapter responsibility is map-and-persist only |
| **Unvalidated input reaching use case** | Endpoint calls use case without preceding validation | Invalid data enters the domain |
| **Auth attribute missing on protected route** | Mutation or sensitive-read endpoint without `.RequireAuthorization()` | Unauthenticated callers can reach the endpoint |
| **`IModule` missing parameterless constructor** | `IModule` class with constructor parameters | Reflection-based discovery requires a parameterless ctor |
| **Module exposes `internal` types in public namespace** | Implementation types with `public` visibility in module-internal paths | Soft module boundary bypass risk |
| **File size exceeds 400 lines** | File line count > 400 | Low-cohesion signal; split by responsibility |
| **Riok.Mapperly mapper outside Infrastructure** | `[Mapper]` class in Domain or Application | Mapping belongs in Infrastructure |
| **Naming convention deviation** | Port/adapter/endpoint/use-case names don't match expected pattern | Consistency and grep-ability |
| **Missing test traits** | Test method missing `[Trait("Category","Unit test")]` and `[Trait("Nature",…)]` | Traits power CI filtering |
| **Wrong test framework** | Non-xUnit, FluentAssertions, NUnit, NSubstitute or Moq usage in new tests | xUnit v3 + built-in `Assert`/Shouldly + hand-rolled test doubles is the SoT; report other frameworks in NEW tests only |
| **Mapping logic outside Infrastructure** | Event↔row / DTO↔entity mapping in Domain/Application | Mapping belongs to Infrastructure |
| **Tenant-scoped entity without RLS migration** | Entity with `TenantId` but table lacks `ENABLE`/`FORCE ROW LEVEL SECURITY` + `app.tenant_id` policy | RLS is the enforcement layer; there is no EF Core tenant `HasQueryFilter` |
| **Missing CancellationToken propagation on event-store append** | Event append without passing `CancellationToken` | Resource-waste risk; uncooperative cancellation under load |
| **Snapshot drift** | Snapshot/restore exists but uncovered by round-trip test | Verifies event-sourcing consistency |
| **Missing rehydration test** | New aggregate with events but no test asserting `LoadFromHistory` ⇄ factory state round-trip | Verifies event-sourcing consistency |
| **Query returning aggregate shape instead of thin DTO** | Projection returns write-model or aggregate type instead of denormalized shape | Reads must project to lean DTOs |
| **Inline endpoint registration vs. `IEndpoint` pattern** | `app.MapX` outside module registration | Module ownership and reflection discovery |
| **Hardcoded user-facing French string in backend** | French end-user text in a response body outside ProblemDetails | End-user localization belongs to the frontend |

---

## Summary

**SoT (mandatory for all)**: Minimal API, modular isolation (hard cross-module blockers), ports & adapters, schema-per-module + FORCE RLS + lightweight roles, Result pattern, C# strictness (nullable, CancellationToken), English-only code & PascalCase English module naming.

**Persistence (chosen per bounded context)**: EF Core CRUD and event-sourced Marten stores are both first-class; no global default. Review requires an explicit, justified choice per bounded context (ADR-0037, ADR-0019, ADR-0048).

**Optional-addon (block only if module opts in)**: CQRS pattern rules, event sourcing enforcement rules.

**Advisory (WARN)**: N+1, tracking, lazy loading, validation, transactions, naming, test traits, mapping placement.
