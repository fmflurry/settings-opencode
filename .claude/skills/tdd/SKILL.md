---
name: tdd
description: Test-driven development via strict RED-GREEN-REFACTOR cycle. Build event-sourced aggregates and domain logic with passing tests before any production code. Optional: outer-loop acceptance tests (Application layer, ATDD) for explicit use-case specification. Mandatory: 80%+ coverage, narrow + wide test layers, domain-driven design, immutable aggregates, no hardcoding. Applies universally to any stack's TDD discipline. See patterns.md for stack-specific examples. [[dotnet-clean-architecture]] for DDD context.
---

# Test-Driven Development — RED-GREEN-REFACTOR (mandatory baseline + optional ATDD outer loop)

## The Core Mandate: RED-GREEN-REFACTOR

Features are built via **strict TDD discipline**: every behavior emerges via a failing test, minimal production code makes it green, then refactor while tests stay green. Tests and production code **never change in the same commit**. Hardcoding/faking is expected in the green step, then triangulated away during refactoring or by new tests.

This discipline applies to **all layers**: domain aggregates, Application handlers, Infrastructure implementations.

## Optional: Double-Loop Method (ATDD Outer Loop)

For explicit use-case specification, you may adopt a **two-loop structure**: the outer loop turns a specification into acceptance tests at the handler level (Application layer); the inner loop builds domain behavior via strict RED-GREEN-REFACTOR. The outer loop helps document and test integration points; it is not mandatory.

```
OPTIONAL OUTER (ATDD): write the WHOLE shopping list of stub acceptance tests (all scenarios)
                                              │
                                              ▼  then, one stub at a time:
              flesh stub into real red test ──► create Application artifacts ──► still red
                                              │
                                              ▼  domain behavior missing?
                            INNER (TDD): red ─► green ─► refactor   (repeat)
                                              │
                                              ▼
                       acceptance test goes green ─► refactor ─► next stub ─► … ─► done


MANDATORY (all features, all layers):
              write test ─► compile shells ─► green code ─► refactor ──┐
                                                                       └─► next behavior
```

### Input: Specification

Before writing any test, a specification exists. It may come from:

- **OpenSpec change spec** (`openspec/changes/<change>/specs/<capability>/spec.md`) with `#### Scenario:` WHEN/THEN blocks.
- **Product Owner work item** (issue, backlog story, design doc) enumerating scenarios and examples.
- **Finalized use-case documentation** in `docs/usecases/<context>/` (less common going forward; prefer OpenSpec).

Specifications must enumerate **every scenario** (principal + alternatives) with **concrete examples** (1–3 per scenario) so the acceptance test list is exhaustive and unambiguous.

## Outer Loop (ATDD) — Application Layer & Acceptance Tests (Optional)

When adopting acceptance-test-driven design (ATDD), this is where you turn a specification into working Application plumbing + a test harness. The outer loop owns **handlers, commands/queries, read models, repository interfaces, and acceptance tests**. This is optional; you may also write these artifacts and their tests via the core RED-GREEN-REFACTOR cycle.

### Phase 1 — Build the shopping list (all stubs up front, red, bodyless)

Before implementing anything, turn **every scenario in the spec into a **stub acceptance test** — one per scenario: the principal/happy path plus every alternative path. This fixes the full scope of the use case as a visible backlog and tells you exactly **when the feature is done**.

These stubs are **red but deliberately bodyless** — you cannot write the real Arrange/Act/Assert yet, because you don't yet know how the use case will be exercised against the domain, nor what dependencies it will need. The body emerges in Phase 2, once the inner loop has shaped the domain.

```csharp
[Fact]
[Trait("Category", "Unit test")]
[Trait("Nature", "Acceptance test")]
public async Task PlaceOrder_WithNoOrderItems_ShouldFailAndReturnError()
{
    Assert.False(true, "shopping-list marker: scenario specified, body not writable yet");
}
```

- One stub per scenario — including alternative flows (errors, edge cases, shipping-fee tiers, …). A scenario's 1–3 examples become `[InlineData]` rows when the stub is fleshed out in Phase 2.
- Don't create any Application artifacts yet; stubs need only the test project.
- Commit the whole list in one go: `test(<context>): add acceptance test list for <UseCaseName>`.

### Phase 2 — Tackle the list one stub at a time

Repeat the loop below for each stub until the list is exhausted. **Work in order of complexity: the happy path first, in the simplest possible form**, then the alternative paths. **Commit at every phase** (red test, artifacts/compile, green, refactor) — each commit is a restore point.

1. **Pick one stub** and flesh it into a real failing acceptance test at the handler level, expressing the scenario's Given/When/Then. It may stop compiling — the command/handler may not exist yet. That's expected. (Writing the test, then artifacts to compile it, then code to green it follows the same *never tests-and-code in one step* rule — see inner loop below.)
2. **Create the minimal Application artifacts** to make it compile (only now, once the need is concrete):
   - **Command/Query** in `Application/Usecases/<UseCaseName>.cs` implementing `ICommand<Result<T>>` or `IQuery<Result<TDto>>`.
   - **Handler** in `Application/Handlers/<UseCaseName>Handler.cs` implementing `ICommandHandler<…>` / `IQueryHandler<…>`, collaborators injected via primary constructor.
   - **Read model** as a `record` DTO in `Application/ReadModels/` (for queries — backed by a projection, not by rehydrating the aggregate).
   - **Repository methods** added to the domain collection interface (`Orders`, `Products`, …) as the handler requires them. Write-side `Save` persists the aggregate's uncommitted events.
   - **Test doubles** in `tests/.../TestDoubles/` — a fake implementing the collection interface for the repository under write (e.g. `FakeInMemoryOrderRepository : Orders`, storing events or the aggregate in memory); use **NSubstitute** for read-only collaborators like `Products`.
3. **Run the acceptance test** — it should now compile and fail for the *right* reason (behavior missing, not compilation).
4. **Drive the behavior in with the inner loop** (see below): whenever the handler needs domain logic, switch to the inner loop and build it via domain unit tests — **only as far as this acceptance test needs**, then climb back up. Aggregate state must change only by raising/applying events.
5. **Acceptance test goes green.** Run the suite:
   ```powershell
   dotnet test --filter "Nature=Acceptance test"   # the outer-loop tests
   dotnet test                                      # everything
   ```
6. **Refactor** Application + domain with all tests green, then commit.
7. **Pick the next stub** and repeat until the whole shopping list is green and the spec is fully covered.

### Conventions for acceptance tests

- Stack: **xUnit v3** + **NSubstitute** + xUnit built-in `Assert`.
- Tag every test: `[Trait("Category", "Unit test")]` and `[Trait("Nature", "Acceptance test")]`.
- Acceptance tests live next to domain tests in `tests/GcPlatform.<Context>.Tests/` (e.g. handler tests in `PlaceOrderTests.cs`).
- Async handlers: `await handler.Handle(command, TestContext.Current.CancellationToken)`.
- Assert on the `Result`: `Assert.True(result.IsSuccess)`, `Assert.NotEqual(Guid.Empty, result.Data)`, and on persisted state via the fake (`orders.FindForTest(result.Data)`), or on the **events** the aggregate emitted.
- Verify collaborator interactions with NSubstitute where it matters: `sub.Received(1).Find(Arg.Any<List<Guid>>())`.
- Prefer a **fake** for the repository you write to, a **substitute** for query collaborators.

### Example (handler acceptance test)

```csharp
[Fact]
[Trait("Category", "Unit test")]
[Trait("Nature", "Acceptance test")]
public async Task PlaceOrder_WithOneItem_ShouldSaveOrderAndReturnOrderId()
{
    // Arrange
    var productId = new Guid("bec56751-d09e-4910-81da-fa87ca4b0325");
    var substitute = Substitute.For<Products>();
    substitute.Find(Arg.Any<List<Guid>>())
        .ReturnsAsync([new Product(productId, "Bordeaux rosé", 5.99m)]);
    var orders = new FakeInMemoryOrderRepository();
    var handler = new PlaceOrderHandler(orders, substitute);
    var command = new PlaceOrder { OrderItems = [new Tuple<Guid, int>(productId, 1)] };

    // Act
    var result = await handler.Handle(command, TestContext.Current.CancellationToken);

    // Assert
    Assert.True(result.IsSuccess);
    Assert.NotEqual(Guid.Empty, result.Data);
    Assert.Equal(result.Data, orders.FindForTest(result.Data)?.Id);
}
```

### Backlog markers

The `false.ShouldBeTrue()` stubs from Phase 1 *are* the backlog — each marks a specified-but-unbuilt scenario. A green suite with remaining stubs means the spec isn't fully covered yet. In Phase 2 you replace one marker at a time with a real test and drive it green.

### Commits (outer loop)

Follow the project's Conventional Commits. Typical rhythm: one `test(<context>): add acceptance test list for <UseCaseName>` (Phase 1), then per stub (Phase 2) a `test(<context>): …` when you flesh it into a real failing test, followed by `feat(<context>): …` commits as domain + Application code fill in.

### Boundary (outer loop)

The outer loop owns the **Application layer and acceptance tests**. Domain behavior and its unit tests belong to the inner loop below. Writing the specification itself is a separate activity (OpenSpec authoring or PO planning). Event-store and EF/RLS projection implementations belong to Infrastructure (see [[dotnet-clean-architecture]]).

---

## Inner Loop (TDD) — Domain Layer, Strict

This is the **inner loop**. Scope: the **domain layer only** — aggregates (`Order`), value objects (`OrderItem`), domain services. Tests are tagged `[Trait("Nature", "Developper test")]`, run fast, no mocks.

You enter this loop from the outer loop: pick the simplest scenario first (the happy path), expressed in the simplest possible way, then grow the implementation here.

## The one rule that governs everything

> **Never change tests and production code in the same step.**

Every step moves *either* the tests *or* the production code, never both. Concretely: each commit touches test files XOR production files. This is what keeps the design honest and the feedback unambiguous. The cycle below is just this rule applied repeatedly.

## The micro-cycle

Each loop adds **one** behavior. Walk the states in order; each arrow is a separate step (and a separate commit):

```
(1 TEST)  write a failing test  ─ may not even compile
   │
   ▼
(2 CODE)  add the minimal empty shells so it COMPILES ─ signatures only, no behavior  → test is now RED
   │
   ▼
(3 CODE)  write the minimal code to make it GREEN ─ cheating/hardcoding is allowed and expected
   │
   ▼
(4 REFACTOR)  optional — refactor tests XOR code (never both), staying GREEN
   │
   └──► next behavior: back to (1), usually a new example that forces generalization
```

### (1) Write a failing test — test step

Write one small test naming the behavior you want. It is fine — expected, even — that it does **not compile** yet because the method/type doesn't exist. No production code in this step.

### (2) Make it compile with empty shells — code step

Add the **minimum** production code to compile: the type, the method signature, returning a default / throwing `NotImplementedException`. The test now compiles and runs **red**. Separate from (1).

### (3) Make it green with the minimal code — code step

Write the **least** code that turns the test green — and that explicitly includes **faking it**: if the test asserts an attribute equals `1`, **hardcode `1`**. Do not anticipate. You are not allowed to write generality the tests don't yet demand.

### (4) Refactor — one step at a time, never simultaneously

Stay green. You may refactor **both** the tests and the code — just **never within the same step**: do one, get green, commit, then do the other if needed.

- **Refactoring the code**: remove the cheats/hardcodes, extract methods, improve names and business expressiveness. Tests untouched in this step.
- **Refactoring the tests**: collapse near-duplicate `[Fact]`s into a `[Theory]` with `[InlineData(...)]`, delete obsolete tests. Production code untouched in this step.

The constraint is simultaneity, not exclusivity.

## Emergent design by triangulation

Minimal code is the mechanism that makes the design emerge:

1. First test: "amount should be `5.19`" → you **hardcode** `5.19`. Green.
2. Second test (a new example): "with quantity `2`, amount should be `10.38`" → the hardcode breaks. *This* forces `price * quantity`. Green.

Introduce a variable/branch/loop **only** when a new failing example makes the previous cheat insufficient — never before. Each `[InlineData]` row is one such triangulation step.

## Event sourcing in the inner loop

Aggregates mutate state **only** by raising and applying domain events — even under TDD:

- A factory/behavior method **validates**, then `Raise`s a past-tense event; the `When` handler applies it. Assert through the factory result and the resulting state, never by setting fields directly.
- When a behavior triggers a new state change, the natural TDD step is: a test asserting the new state → a new event + its `When` case to satisfy it.
- You can also test **rehydration**: `LoadFromHistory([...events...])` should reconstruct the same state as the factory path. Add this test once two events exist and replay matters — not before (triangulation).
- Keep events minimal: introduce an event (or a field on one) only when a test demands the state it carries.

## Conventions for domain unit tests

- Stack: **xUnit v3** + xUnit built-in `Assert`. No mocking — the domain has no external collaborators.
- Tag every test: `[Trait("Category", "Unit test")]` and `[Trait("Nature", "Developper test")]`.
- `[Theory]` + `[InlineData(...)]` for scenario examples (emerges during triangulation).
- Domain objects use **private constructors + static factory methods** (`Order.Place(...)`, `OrderItem.Of(...)`) — test through those, never `new`.
- Domain tests live in `tests/GcPlatform.<Context>.Tests/` (e.g. `PlacingOrderTests.cs`).

## Commits — one per phase, as a checkpoint

**Commit at every phase** of the micro-cycle, not just at the end. Each transition — failing test, compiling shells, green code, a refactor — is its own commit and a **restore point**: when an experiment goes wrong you drop back to the last green/red phase instantly.

Because tests and code never change together, each commit is homogeneous:
- `test(<context>): …` — the red test from (1), or a test-refactor from (4).
- `feat(<context>): …` / `fix(<context>): …` — the shells (2) and the green code (3), or a code-refactor from (4).

A diff that mixes test and production files means a step was skipped — split it.

## Stay only as long as the outer loop needs you

The inner loop is **in service of the outer loop** — stop and return to the outer loop the moment the domain is rich enough to pass the next acceptance test. Use the acceptance suite's order (happy path first) as your signal to stop — do not speculate beyond it.

## Boundary (inner loop)

Domain layer only. Commands, handlers, read models, repository implementations, the event store, EF/RLS projections, and acceptance tests belong to the outer loop and Infrastructure.

---

## All Stacks — Mandatory Core Discipline

Across all technology stacks (TypeScript, Python, Go, Rust, Java, .NET, etc.), the core is non-negotiable:
- **RED-GREEN-REFACTOR cycle**: failing test → minimal green code → refactor, never skip a phase.
- **Never tests and code in the same commit**: each commit is either a test or code change.
- **80%+ coverage**: narrow (unit), wide (integration), and critical E2E tests.
- **Immutable aggregates and events**: state change only through events; no in-place mutation.

See `patterns.md` in this skill for stack-specific test frameworks, mocking libraries, and file organization conventions.
