# dotnet-cop / CQRS (optional, opt-in)

**Scope:** This rule applies only when a module explicitly opts into CQRS pattern. When CQRS is not in use, use simpler request/response patterns. Do not enforce CQRS across all modules.

Commands and queries implement the SharedKernel contracts; handlers expose a single `Handle(message, CancellationToken)` and inject domain interfaces via primary constructor; no business logic outside the domain.

## 🟢 Architecture blockers (when module opts in to CQRS)

### Command/query not implementing the contract
```csharp
// BAD — a use case that is just a method bag
public class PlaceOrder { public List<...> Items; }

// GOOD
public class PlaceOrder : ICommand<Result<Guid>> { public required IReadOnlyList<...> OrderItems { get; init; } }
public class FindOrder  : IQuery<Result<OrderDto>> { public required Guid Id { get; init; } }
```
Commands live in `Application/Usecases/`, implement `ICommand` / `ICommand<TResult>`; queries implement `IQuery<TResult>`.

### Handler signature deviates from `Handle(msg, ct)`
```csharp
// BAD — bespoke method name / no CancellationToken
public Task<Guid> Execute(PlaceOrder cmd) { ... }

// GOOD
public class PlaceOrderHandler(Orders orders, Products products) : ICommandHandler<PlaceOrder, Result<Guid>>
{
    public async Task<Result<Guid>> Handle(PlaceOrder command, CancellationToken cancellationToken = default) { ... }
}
```
Exactly one `Handle` per handler; collaborators injected via primary constructor; dependencies are **Domain interfaces** (`Orders`, `Products`), never concrete Infrastructure types.

### Business logic in the handler
```csharp
// BAD — domain rule computed in the handler
if (items.Sum(i => i.Price * i.Quantity) > 1000) discount = 0.1m;

// GOOD — handler orchestrates; the aggregate decides
var placed = Order.Place(items);   // rule lives in the aggregate
```
Handlers orchestrate (load → invoke aggregate behavior → persist → return Result). Calculations/branching on domain state belong in the aggregate or a domain service.

## 🟡 Risks

### Query handler rehydrates an aggregate
A `IQueryHandler` loading via the write-side repository (`Orders.Find`) or replaying events to answer a read. Reads must hit a projection/read model.

### Handler returns a bare value instead of `Result`
Command/query handlers should return `Result`/`Result<T>` so business failures are typed.

### Async suffix misuse
`Async` suffix added to handler/repository methods. Convention: async is the default, **no `Async` suffix**; suffix the synchronous overload with `Sync` if one exists.

## 🔵 Nits

- Command/query named `<Verb><Noun>` (`PlaceOrder`, `CancelOrder`); handler `<UseCase>Handler`.
- Read-model DTOs are `record`s in `Application/ReadModels/`.
- `required`/`init` for command inputs (immutable messages).

## Reporting

Cite the class declaration for contract/signature findings, and the offending expression line for handler-business-logic findings. Name the use case: `PlaceOrderHandler — business rule in handler, move to Order`. Note: only report CQRS findings when the module has explicitly adopted the CQRS pattern.
