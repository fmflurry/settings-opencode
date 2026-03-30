# Testing Patterns

Use the project's chosen test framework and testing utilities. The examples below show **what to test**, not the specific framework API.

## Facade Test — Mock Store + Use Cases

```typescript
describe('CustomersFacade', () => {
  // Set up the facade with mocked store and use cases
  // Mock store.get() to return a signal with ResourceState
  // Mock use case methods

  it('should return customers signal from store', () => {
    const result = facade.getAllCustomers();
    expect(store.get).toHaveBeenCalledWith(CustomersStoreEnum.CUSTOMERS);
    expect(result().data).toHaveLength(1);
  });

  it('should delegate loading to use case + store operator', () => {
    facade.loadAllCustomers({ searchTerm: 'test' });
    expect(searchUseCase.by).toHaveBeenCalledWith({ searchTerm: 'test' });
  });
});
```

## Component Test — Mock Facade Only

```typescript
describe('CustomersListComponent', () => {
  // Provide a mocked facade returning signals with ResourceState
  // Components should ONLY depend on facade — no store or use case mocking needed

  it('should call facade to load customers', () => {
    expect(mockFacade.loadAllCustomers).toHaveBeenCalled();
  });

  it('should render data from facade signals', () => {
    // Verify the component reads facade signals correctly
  });
});
```

## Use Case Test — Mock Ports

```typescript
describe('GetCustomersUseCase', () => {
  // Mock the port, inject into the use case

  it('should delegate to port', () => {
    const filters: CustomerFilters = { searchTerm: 'test' };
    mockPort.for.mockReturnValue(of([]));

    useCase.for(filters).subscribe((result) => {
      expect(result).toEqual([]);
    });

    expect(mockPort.for).toHaveBeenCalledWith(filters);
  });
});
```

## Testing Principles

| Test Target | Mock | Verify |
|-------------|------|--------|
| Facade | Store + use cases | Orchestration logic |
| Component | Facade only | Rendering + event delegation |
| Use case | Ports | Delegation + business logic composition |
| Adapter | Endpoints | DTO-to-model mapping |

Target **80%+ coverage**.
