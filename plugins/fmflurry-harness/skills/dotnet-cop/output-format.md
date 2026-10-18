# dotnet-cop / output format

Two modes: `senior` (default, terse) and `junior` (verbose + teaching). Important findings (🔴) always include rationale regardless of mode. One badge per tag: 🔴 Important, 🟡 Nit, ⚪ Pre-existing, ❓ question (never blocks). Category labels (`[bug]`, `[sec]`, `[arch]`, `[risk]`, `[nit]`, `[comment]`, `[format]`) follow the tag. The tag rules are in the code-reviewer agent.

## Header (both modes)

```markdown
# 🚓 Dotnet-Cop Report

**Target:** `<target-branch>` @ `<base-sha-short>`
**Source:** `<current-branch>` @ `<head-sha-short>`
**Files changed:** N    **Insertions:** +X    **Deletions:** -Y

Comments: added 5 · verified 4 · forbidden 0 · false 1

| 🔴 Important | 🟡 Nit | ⚪ Pre-existing | ❓ |
|--------------|--------|-----------------|----|
| 3 | 5 | 1 | 1 |

**Verdict:** BLOCK | APPROVE
```

## Senior mode (terse)

One line per finding. Format:
```
<file>:L<line>: <badge> <Tag> [<category>]: <problem>. <fix>.
```

Example:
```markdown
## 🔴 Important
- `Module/Order/Application/Endpoint/CreateOrderEndpoint.cs`:L42: 🔴 Important [bug]: business rule (discount cap) computed inside endpoint handler. Move to `CreateOrder` use case behind incoming port.
- `Module/Order/Infrastructure/Adapter/OrderAdapter.cs`:L88: 🔴 Important [sec]: raw SQL string built with string interpolation — SQL injection risk. Use parameterized EF Core query or raw SQL with `FromSqlRaw` + parameters.
- `Module/User/Core/CreateUser.cs`:L12: 🔴 Important [arch]: use case imports `Microsoft.EntityFrameworkCore` directly. Core must have zero infrastructure dependencies. Move EF call to outgoing port / adapter. (AGENTS.md §Architecture)

## 🟡 Nit
- `Module/Order/Infrastructure/Adapter/OrderAdapter.cs`:L67: 🟡 Nit [risk]: query without `AsNoTracking()` on a read-only path. Adds EF tracking overhead.
- `Module/Order/Core/Model/Endpoint/CreateOrderRequest.cs`:L30: 🟡 Nit [risk]: no FluentValidation validator for this request; invalid input passes unvalidated to use case.
- `Module/User/UserModule.cs`:L10: 🟡 Nit [nit]: `RegisterModule` registers `Riok.Mapperly` mapper after scoped services — consider grouping infrastructure registrations.

## ⚪ Pre-existing
- `Module/Billing/Infrastructure/BillingDbContext.cs`:L20: ⚪ Pre-existing [arch]: shared DbContext already on the base branch. Does not block.

<details><summary>❓ Questions (1)</summary>

- `Module/Order/Core/CreateOrder.cs`:L4: ❓ intentional that `CreateOrder` does not check for duplicate order within the same day?
</details>

## Tooling
- **dotnet build**: 0 errors
- **dotnet format**: no formatting violations
- **tests**: not run (use `/tdd` or narrow/wide test suites)
```

## Junior mode (verbose + teaching)

Each finding becomes a block:

```markdown
### 🔴 Important [bug] `CreateOrderEndpoint.cs:L42` — business logic in endpoint handler

**Problem.** The endpoint handler directly computes the discount cap (`if (total > 1000) discount = 0.1m`). Minimal API endpoint handlers are part of the Application (driving) layer and must delegate all domain logic to an incoming port / use case. Encoding business rules here bypasses the Core layer, making them invisible to tests and impossible to reuse.

**Why it matters.** If this rule lives only in the endpoint, it is untestable without spinning up the full HTTP pipeline (WebApplicationFactory). It also creates a second source of truth when the same rule appears in a mobile or batch context.

**Fix.**
```csharp
// Core/Ports/Incoming/ICreateOrder.cs  (already exists)
public interface ICreateOrder
{
    Task<CreateOrderResponse> HandleAsync(CreateOrderRequest request);
}

// Core/CreateOrder.cs  (move the rule here)
public sealed class CreateOrder(ICreateOrderPort port) : ICreateOrder
{
    public async Task<CreateOrderResponse> HandleAsync(CreateOrderRequest request)
    {
        var discount = request.Total > 1000m ? 0.1m : 0m;  // rule lives here
        var entity = await port.SaveOrderAsync(request, discount);
        return new CreateOrderResponse(entity.CorrelationId, entity.Id);
    }
}

// Application/Endpoint/CreateOrderEndpoint.cs  (thin handler)
app.MapPost("/orders", async (CreateOrderRequest req, ICreateOrder useCase) =>
{
    var response = await useCase.HandleAsync(req);
    return Results.Created($"/orders/{response.Id}", response);
});
```

**References.**
- Project rule: `AGENTS.md §Architecture`
- Skill: [[dotnet-cop-optional-cqrs]], [[dotnet-cop-optional-event-sourcing]] (when module opts in)
- Pattern: dotnet-clean-architecture / SoT minimal-API / opt-in CQRS
```

Important findings (🔴) are always rendered in this block format even in senior mode.

## Verdict logic

Tooling hard-fail comes FIRST. A red build, forbidden comments, or **confirmed** false comments (per Trust limits) trump any static-review verdict.

```
if forbidden-comments > 0                                -> BLOCK (reason: "forbidden comments")
elif false-comments > 0 AND reviewed confirmed any      -> BLOCK (reason: "false comments confirmed by you with quoted repo line")
elif dotnet build errors > 0                              -> BLOCK (reason: "build red")
elif dotnet format violations > 0                       -> BLOCK (reason: "format violations")
elif any Important                                       -> BLOCK
elif any finding cites an AGENTS.md hard rule            -> BLOCK
else (no Important finding, no AGENTS.md hard-rule citation, tooling clean) -> APPROVE
```

❓ never blocks. ⚪ Pre-existing does not block. 🟡 Nit does not block unless that finding cites an AGENTS.md hard rule. Unconfirmed false/stale comments stay ❓.

(True false comments are only blocking if YOU have confirmed them by quoting a contradicting line from the repo itself; per comment-judge Trust limits.)

If `--no-tools` was passed, the tooling gate is skipped but the verdict line MUST explicitly note `(tooling skipped — verdict does not reflect build state)`.

## Footer

```markdown
---
Generated by `dotnet-cop`. Re-run with `/cop-review <target> --level=junior` for teaching format. Findings ≥80% confidence; uncertain items use `❓` instead of guessing.
```

## Mode auto-detection

If user passes no `--level`, default `senior`. If user message contains "junior", "new dev", "explain", "teach", or `--level=junior`, switch to junior. If mixed audience, render header + summary in senior format but render every 🔴 Important finding in junior block format.
