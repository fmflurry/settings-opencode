# dotnet-cop / Result pattern

Expected/business failures are **returned** as `Result`/`Result<T>`, never thrown. `Error` carries a code and message; mapping to HTTP status happens at the API boundary. Throwing is reserved for genuinely unexpected/unrecoverable conditions.

## 🔴 Blockers

### Business error thrown instead of returned
```csharp
// BAD — expected/business condition thrown
if (items.Count == 0) throw new OrderHasNoItemsException();

// GOOD — returned as a failed Result
if (items.Count == 0) return Result<Order>.Fail(new OrderHasNoItems());
```
Applies in Domain factories/behavior and in Application handlers. Throwing forces a 500-style fallback and prevents typed, composable error handling.

### Result ignored / not propagated
```csharp
// BAD — handler discards a failed Result and continues
var placed = Order.Place(items);          // Result<Order>
await orders.Save(placed.Data);           // Data is default on failure!

// GOOD — short-circuit on failure
if (placed.IsFailed) return Result<Guid>.Fail(placed.Errors[0]);
await orders.Save(placed.Data);
```

### Generic/undifferentiated error
A single catch-all `Error` type used for distinct business failures. Errors must be subclassed per failure so callers and tests can discriminate by `Code`.

### Throwing across a repository/port boundary for an expected condition
Infrastructure surfacing a raw `DbUpdateException`/unique-violation as an exception when it represents a known business failure (e.g. duplicate) — map it to a failed `Result` (or a domain error) at the boundary.

## 🟡 Risks

### Result success without data
`Result<T>.Success()` where `T` data is expected by the caller — return `Success(value)`.

## 🔵 Nits

- Error code convention: `<context>.<rule>` (e.g. `ordering.order-has-no-items`).
- One `Error` subclass per file under the context's Domain.
- Check `IsFailed`/`IsSuccess` explicitly; don't infer from `Data` being null.

## Reporting

Cite the `throw` line for thrown-business-error findings and the call line for ignored-Result findings. Quote the error type and code where present.
