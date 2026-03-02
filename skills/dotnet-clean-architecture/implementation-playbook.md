# Implementation Playbook

Full code templates for each step of adding a new feature.

## 1. Create or Pick the Target Module

```csharp
// api/Module/<ModuleName>/<ModuleName>Module.cs
public class <ModuleName>Module : IModule
{
    public IServiceCollection RegisterModule(IServiceCollection services)
    {
        // Incoming port -> use case
        services.AddScoped<I<VerbNoun>, <VerbNoun>>();

        // Outgoing port -> adapter
        services.AddScoped<I<VerbNoun>Port, <VerbNoun>Adapter>();

        // AutoMapper
        services.AddAutoMapper(typeof(<VerbNoun>Profile).Assembly);

        return services;
    }
}
```

## 2. Define Request/Response DTOs

```csharp
// Core/Model/Endpoint/<VerbNoun>Request.cs
public class <VerbNoun>Request : BaseRequest
{
    public string Field { get; set; }
}

// Core/Model/Endpoint/<VerbNoun>Response.cs
public class <VerbNoun>Response : BaseResponse
{
    public Guid Id { get; set; }
}
```

## 3. Define Incoming Port

```csharp
// Core/Ports/Incoming/I<VerbNoun>.cs
public interface I<VerbNoun>
{
    Task<<ResponseModel>> HandleAsync(<RequestModel> request);
}
```

## 4. Define Outgoing Port

```csharp
// Core/Ports/Outgoing/I<VerbNoun>Port.cs
public interface I<VerbNoun>Port
{
    Task<bool> <ValidationCheck>(string value);
    Task<Guid> <ExecuteOperation>(<RequestModel> request);
}
```

## 5. Implement Use Case (Pure Business Logic)

```csharp
// Core/<VerbNoun>.cs
public class <VerbNoun>(I<VerbNoun>Port port) : I<VerbNoun>
{
    public async Task<<ResponseModel>> HandleAsync(<RequestModel> request)
    {
        Guard.Against.NullOrEmpty(request.Field);

        var valid = await port.<ValidationCheck>(request.Field);
        if (!valid)
            throw new <Domain>Exception(request.Field);

        var id = await port.<ExecuteOperation>(request);
        return new <ResponseModel> { Id = id };
    }
}
```

## 6. Implement Adapter

```csharp
// Infrastructure/Adapter/<VerbNoun>Adapter.cs
public class <VerbNoun>Adapter(
    I<Entity>Repository repository,
    IMapper mapper) : I<VerbNoun>Port
{
    public async Task<bool> <ValidationCheck>(string value)
    {
        var existing = await repository.GetByFieldAsync(value);
        return existing is null;
    }

    public async Task<Guid> <ExecuteOperation>(<RequestModel> request)
    {
        var entity = mapper.Map<<Entity>>(request);
        return await repository.Save(entity);
    }
}
```

## 7. Create AutoMapper Profile

```csharp
// Infrastructure/Mapping/<VerbNoun>Profile.cs
public class <VerbNoun>Profile : Profile
{
    public <VerbNoun>Profile()
    {
        CreateMap<<RequestModel>, <Entity>>();
    }
}
```

## 8. Create Validator (Optional)

```csharp
// Application/Validator/<VerbNoun>Validator.cs
public class <VerbNoun>Validator : AbstractValidator<<RequestModel>>
{
    public <VerbNoun>Validator()
    {
        RuleFor(r => r.Field)
            .NotEmpty().WithMessage("Field is required.")
            .MaximumLength(50).WithMessage("Field max 50 characters.");
    }
}
```

## 9. Create Endpoint

```csharp
// Application/Endpoint/<VerbNoun>Endpoint.cs
public class <VerbNoun>Endpoint(
    I<VerbNoun> useCase,
    IValidator<<RequestModel>> validator)
    : IEndpoint<Results<Created<<ResponseDto>>, BadRequest<ProblemDetails>>, <RequestDto>>
{
    public void AddRoute(IEndpointRouteBuilder app)
    {
        app.MapPost("api/<resource>", ([FromBody] <RequestDto> request) => HandleAsync(request));
    }

    public async Task<Results<Created<<ResponseDto>>, BadRequest<ProblemDetails>>> HandleAsync(<RequestDto> request)
    {
        var validation = await validator.ValidateAsync(request);
        if (!validation.IsValid)
            return TypedResults.BadRequest<ProblemDetails>(new ProblemDetails
            {
                Detail = string.Join("; ", validation.Errors.Select(e => e.ErrorMessage))
            });

        var result = await useCase.HandleAsync(request);
        return TypedResults.Created($"api/<resource>/{result.Id}",
            new <ResponseDto>(request.CorrelationId) { Id = result.Id });
    }
}
```

## 10. Register in Module

Update `<ModuleName>Module.cs` with all bindings (see step 1).

## 11. Add Domain Exceptions (If Needed)

```csharp
// Core/Exception/<Specific>Exception.cs  (or Shared/Exceptions/)
public class <Specific>Exception(string detail)
    : ProblemDetailsException($"<User-friendly message>: {detail}");
```
