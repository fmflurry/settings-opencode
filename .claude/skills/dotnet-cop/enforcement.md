# dotnet-cop / enforcement — BLOCK vs WARN severity checklist

This is the canonical severity list for dotnet-cop and the coder self-check. **BLOCK** findings fail review; the `.editorconfig`/analyzer template (see [enforcement-tooling.md](enforcement-tooling.md)) makes the deterministic subset fail the build.

---

## MUST — BLOCK

Review fails when any of these is present. Corresponds to 🔴 bug, 🟠 sec, and mandatory 🟢 arch findings.

| Rule | How to detect | Why |
|---|---|---|
| **Module-isolation violation** — direct cross-module type reference (must go through a port + adapter) | `using` directive in one module's file pointing to another module's non-shared namespace (e.g. `using MyApp.Module.Order.Core` inside `Module/User/`) | Breaks the module boundary; creates compile-time coupling between domains that must evolve independently |
| **Port/adapter direction violation** — Infrastructure or EF types leaking into Core or Application | `using Microsoft.EntityFrameworkCore` (or any infra namespace) inside a `Core/` or `Application/` file | The dependency rule is absolute: Core → nothing infrastructure. Leakage makes Core untestable without a real DB and couples domain logic to storage technology |
| **EF entities used as domain types in Core** — `*Entity` / EF-mapped type appears in a port signature or Core model | Port interface method returns or accepts a type that has EF `[Table]`/`[Key]` attributes or lives under `Infrastructure/` | Pins Core to EF's change-tracker lifecycle; prevents mapping in adapter; forces Core tests to stand up an EF context |
| **Business logic inside Minimal API endpoint handler** — domain rule computed or branched in the driving layer | Conditional logic (`if`/`switch`/calculation) on domain fields directly inside `app.MapX(...)` body or `HandleAsync` of an endpoint class | Endpoints sit in the Application (driving) layer; domain rules here are invisible to Core unit tests and cannot be reused across entry points (HTTP, CLI, batch) |
| **Missing `.AsNoTracking()` on read-only query paths** — EF query that never calls `SaveChangesAsync` still has change tracking enabled | EF LINQ query chain lacks `.AsNoTracking()` (or `AsNoTrackingWithIdentityResolution()`) and the calling method is read-only (no subsequent save) | Unnecessary tracking overhead; identity map grows unboundedly in long-lived scopes; misleads future maintainers who assume entities are tracked |
| **Business errors thrown instead of returned as `Result<T>`** — expected/business error thrown as exception instead of returned via Result pattern | Use case or handler calls `throw new <Domain>Exception(...)` for an expected/business condition; validation/input errors thrown instead of returned as `Result<T>.Fail(...)` | Business errors must be predictable and mapped to appropriate HTTP status (400/404/409) via `Result` pattern; throwing prevents typed error handling and forces a 500 fallback when the error is caught globally |
| **Missing ProblemDetails mapping** — raw 500 or unstructured error response escaping the global ExceptionHandler | Catch block returning `Results.StatusCode(500)` / `Results.Problem(...)` without going through the Result pattern or global exception handler; or `catch` that swallows exception instead of rethrowing | Bypasses the RFC 7807 contract; leaks internal stack traces or implementation details to callers; breaks client error-handling contracts |
| **`FromSqlRaw`/`ExecuteSqlRaw` with string interpolation** — SQL injection vector | `FromSqlRaw($"...")` or `ExecuteSqlRaw($"...")` where the interpolated expression contains a variable or parameter | Classic SQL injection; EF Core's parameterized APIs (`FromSqlRaw` with explicit parameters, LINQ) exist specifically to prevent this |
| **Nullable dereference / unjustified `!` null-forgiving operator** | `!` postfix on a nullable expression without a preceding null-guard; or CS8600/CS8602/CS8604 compiler warnings not suppressed via a legitimate null-check pattern | Hidden `NullReferenceException` at runtime; defeats the purpose of enabling nullable reference types |
| **Missing `CancellationToken` propagation on async I/O** | `async` method accepts a `CancellationToken` parameter but does not pass it to inner `await` calls (EF `ToListAsync`, `SaveChangesAsync`, `HttpClient.SendAsync`, etc.) | Uncooperative cancellation; long-running operations ignore user/timeout signals; resource waste and degraded resilience under load |

---

## SHOULD — WARN

Advisory findings. Reported as 🟡 risk or 🔵 nit. Do not block review on their own unless AGENTS.md escalates them.

| Rule | How to detect | Why |
|---|---|---|
| **Adapter throws raw infrastructure exception across port boundary** | `DbUpdateException`, `HttpRequestException`, or other infra-specific exception bubbles out of an adapter method without being caught and mapped to a domain exception | Port contract guarantees domain exceptions only; raw infra exceptions expose implementation details and break the abstraction |
| **Adapter contains business logic** | Conditional domain rules (discounts, eligibility checks, state transitions) found inside `Infrastructure/Adapter/` | Adapter responsibility is map-and-persist; business logic here is invisible to Core unit tests |
| **N+1 query pattern** | `foreach` loop with `await context.X.Where(...).ToListAsync()` inside; or `.Select` triggering lazy navigation without `.Include` | Generates one query per iteration; degrades to O(N) database round-trips |
| **Lazy loading enabled without justification** | `UseLazyLoadingProxies()` in DbContext registration, not explicitly permitted by AGENTS.md | Makes N+1 invisible until production load; performance surprises |
| **Missing query splitting on large multi-collection includes** | Two or more `.Include()` on collection navigations without `.AsSplitQuery()` | Cartesian product explosion; each extra collection multiplies result rows |
| **Single shared `DbContext` across modules** | A `DbContext` class references entity types from more than one module | Couples modules at the infrastructure level; prevents independent schema evolution and deployment |
| **`IModule` implementation missing parameterless constructor** | `IModule` class with a constructor that accepts parameters | Reflection-based `ModuleExtensions.RegisterModules` requires a parameterless constructor; silently skips or throws at startup |
| **Module exposes `internal` types in a `public` namespace** | Infrastructure or use-case concrete types with `public` visibility under a module-internal path | Soft module boundary; consumers can bypass the port contract even though it compiles |
| **Riok.Mapperly mapper defined outside `Infrastructure/Mapping/`** | `[Mapper]` annotated class in `Core/` or `Application/` | Mapping between EF entities and domain models belongs to Infrastructure; placing it elsewhere bleeds infra knowledge outward |
| **Unvalidated input reaching use case** | Endpoint calls `useCase.HandleAsync(req)` without a preceding FluentValidation check or validation endpoint filter | Invalid data enters the domain; domain exceptions become the first line of defense instead of a last resort |
| **Auth attribute missing on protected route** | `app.MapX(...)` for a mutation or sensitive-read route without `.RequireAuthorization(...)` | Unauthenticated callers reach the endpoint |
| **Naming convention deviation** | Port/adapter/endpoint/use-case names not matching `I<VerbNoun>` / `I<VerbNoun>Port` / `<VerbNoun>Adapter` / `<VerbNoun>Endpoint` pattern | Consistency; findability; grep-ability |
| **File size exceeds 400 lines** | File line count > 400 | Low cohesion signal; split by responsibility |
| **`SaveChangesAsync` called without `CancellationToken`** | `await context.SaveChangesAsync()` without passing the token | Partial fix of CancellationToken propagation; still a resource-waste risk |
