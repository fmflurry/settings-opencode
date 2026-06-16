# dotnet-cop / Minimal API endpoints

Endpoint mapping, route groups, ProblemDetails error handling, FluentValidation at boundary, typed results, no business logic in handlers.

## 🔴 Blockers

### Business logic inside endpoint handler
```csharp
// BAD — domain rule computed in the driving layer
app.MapPost("/orders", async (CreateOrderRequest req, IOrderRepo repo) =>
{
    if (req.Total > 1000) req.Discount = 0.1m;  // 🔴 business rule
    var order = await repo.SaveAsync(req);
    return Results.Ok(order);
});

// GOOD — endpoint delegates to incoming port (use case)
app.MapPost("/orders", async (CreateOrderRequest req, ICreateOrder useCase) =>
{
    var response = await useCase.HandleAsync(req);
    return Results.Created($"/orders/{response.Id}", response);
});
```
Why: endpoints sit in the Application (driving) layer. Domain rules belong in Core use cases, which are independently testable without the HTTP pipeline.

### Direct repository call from endpoint (skipping use case)
```csharp
// BAD — endpoint bypasses use case and calls outgoing port directly
app.MapGet("/users/{id}", async (Guid id, IUserPort port) =>
    Results.Ok(await port.FindByIdAsync(id)));

// GOOD — use case mediates
app.MapGet("/users/{id}", async (Guid id, IGetUser useCase) =>
    Results.Ok(await useCase.HandleAsync(new GetUserRequest(id))));
```
Layer rule: Application → Incoming Port → Core → Outgoing Port ← Infrastructure. Application never touches outgoing ports.

### Missing `TypedResults` / non-standard status codes
```csharp
// BAD — returns 200 for a resource creation
return Results.Ok(response);

// GOOD — 201 + Location header
return Results.Created($"/{resource}/{response.Id}", response);
```
And for errors, always use ProblemDetails:
```csharp
// BAD — plain string error
return Results.BadRequest("Invalid input");

// GOOD — typed ProblemDetails via domain exception handler
throw new ValidationException("Field is required");
// Global ExceptionHandler converts to ProblemDetails automatically
```

## 🟠 Security

### Unvalidated input reaching use case
```csharp
// BAD — no validation before calling use case
app.MapPost("/users", async (CreateUserRequest req, ICreateUser useCase) =>
    Results.Ok(await useCase.HandleAsync(req)));

// GOOD — FluentValidation filter or explicit check
app.MapPost("/users", async (CreateUserRequest req, ICreateUser useCase,
    IValidator<CreateUserRequest> validator) =>
{
    var result = await validator.ValidateAsync(req);
    if (!result.IsValid)
        return Results.ValidationProblem(result.ToDictionary());
    return Results.Created("/users", await useCase.HandleAsync(req));
});
```
Or use `AddValidatorsFromAssemblyContaining<T>()` + a validation endpoint filter to apply automatically.

### Auth attribute missing on protected route
Routes that require authentication must be decorated:
```csharp
// BAD — no authorization
app.MapDelete("/users/{id}", async (...) => ...);

// GOOD
app.MapDelete("/users/{id}", async (...) => ...).RequireAuthorization();
// Or use a policy: .RequireAuthorization("AdminOnly")
```

## 🟡 Risks

### Inline route group vs. `IEndpoint` / `MinimalApi.Endpoint` base
Project convention: endpoints implement `IEndpoint` and register themselves via the module. Inline `app.MapX` outside the module registration is a pattern violation:
```csharp
// BAD — endpoint registered in Program.cs directly
app.MapGet("/health", () => "OK");

// GOOD — registered via module
public class HealthEndpoint : IEndpoint { ... }
// Module.RegisterModule calls the endpoint's Map() method
```

### No cancellation token propagation
Long-running handlers must accept and forward `CancellationToken`:
```csharp
// BAD
app.MapGet("/report", async (IGenerateReport uc) =>
    Results.Ok(await uc.HandleAsync(new())));

// GOOD
app.MapGet("/report", async (IGenerateReport uc, CancellationToken ct) =>
    Results.Ok(await uc.HandleAsync(new(), ct)));
```

### Exception swallowed in handler instead of thrown for ExceptionHandler
The global `ExceptionHandler` converts domain exceptions to ProblemDetails. Catching and returning manually bypasses it:
```csharp
// BAD
try { await useCase.HandleAsync(req); }
catch (UserNotFoundException ex) { return Results.NotFound(ex.Message); }

// GOOD — let it bubble; ExceptionHandler maps it
await useCase.HandleAsync(req);
// ExceptionHandler sees UserNotFoundException -> 404 ProblemDetails
```

## 🔵 Nits

- Route groups should be defined in the module's endpoint registration, not scattered.
- Use `Results<T1, T2>` union return type for endpoints with multiple success/error paths so OpenAPI schema is precise.
- `[AsParameters]` for complex query-string binding instead of individual primitive parameters.
- Endpoint method names should match the use case verb: `MapCreateOrder`, `MapGetUser`, etc.

## Reporting

Cite the `app.Map*` call line for handler-contains-logic findings. Cite the missing `RequireAuthorization` line for auth findings. Include the from→to layer in architecture messages: `Application → Outgoing Port (skipped use case)`.
