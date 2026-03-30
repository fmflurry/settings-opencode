# Testing Patterns

## Narrow (Unit) Tests — Mock Outgoing Ports

```csharp
// tests/narrow/<ModuleName>/<VerbNoun>Should.cs
public class <VerbNoun>Should
{
    private readonly I<VerbNoun> _useCase;
    private readonly I<VerbNoun>Port _port = Substitute.For<I<VerbNoun>Port>();

    public <VerbNoun>Should()
    {
        _useCase = new <VerbNoun>(_port);
    }

    [Fact]
    public async Task Return_Result_When_Successful()
    {
        _port.<ValidationCheck>(Arg.Any<string>()).Returns(true);
        _port.<ExecuteOperation>(Arg.Any<<RequestModel>>()).Returns(Guid.NewGuid());

        var result = await _useCase.HandleAsync(new <RequestModel> { Field = "value" });

        result.Id.Should().NotBeEmpty();
        await _port.Received().<ExecuteOperation>(Arg.Any<<RequestModel>>());
    }

    [Fact]
    public async Task Throw_Exception_When_Business_Rule_Violated()
    {
        _port.<ValidationCheck>(Arg.Any<string>()).Returns(false);

        var act = async () => await _useCase.HandleAsync(new <RequestModel> { Field = "value" });

        await act.Should().ThrowExactlyAsync<<Domain>Exception>();
    }
}
```

## Wide (Integration) Tests — Full HTTP Pipeline

```csharp
// tests/wide/<ModuleName>/<VerbNoun>EndpointShould.cs
public class <VerbNoun>EndpointShould : BaseEndpointWaf
{
    public <VerbNoun>EndpointShould()
    {
        var data = _entities.AsQueryable().BuildMockDbSet();
        var contextFake = Substitute.For<ICatalogContext>();
        contextFake.<DbSet>.Returns(data);

        var repository = new <Repository>(contextFake);

        App = new WafApp(x =>
        {
            x.AddSingleton<IRepository>(repository);
        });
    }

    [Fact]
    public async Task Return_Created_When_Valid()
    {
        var payload = JsonContent(new <RequestModel> { Field = "value" });
        var response = await GetResponseAsync("/api/<resource>", payload, HttpMethod.Post);

        response.StatusCode.Should().Be(HttpStatusCode.Created);
    }

    [Fact]
    public async Task Return_BadRequest_When_Invalid()
    {
        var payload = JsonContent(new <RequestModel> { Field = "" });
        var response = await GetResponseAsync("/api/<resource>", payload, HttpMethod.Post);

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }
}
```

## Key Libraries

| Library | Purpose |
|---------|---------|
| MinimalApi.Endpoint | Typed minimal API endpoints (`IEndpoint<TResult, TRequest>`) |
| AutoMapper | DTO <-> Entity mapping |
| FluentValidation | Request validation |
| Ardalis.GuardClauses | Defensive programming in use cases |
| NSubstitute | Test mocking (outgoing ports) |
| FluentAssertions | Test assertions |
| MockQueryable | Mock EF Core DbSets for wide tests |
