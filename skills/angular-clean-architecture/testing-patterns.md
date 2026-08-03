# Testing Patterns

Use the project's chosen test framework. Examples show **what to test**, not framework API.

## Facade Test — Mock Store + Use Cases

```typescript
describe('CompaniesFacade', () => {
  // Mock the flurryx store token: provide a fake with get/update/clear
  // Mock use case methods to return of(...)

  it('should return companies signal from store', () => {
    const result = facade.getAll();
    // store.get('COMPANIES') returns a signal with ResourceState
    expect(result().data).toHaveLength(1);
  });

  it('should delegate loading to use case + syncToStore', () => {
    facade.loadAll();
    expect(getCompaniesUseCase.execute).toHaveBeenCalled();
    // Verify store received update via syncToStore
  });

  it('should skip fetch when cached (@SkipIfCached)', () => {
    // Pre-populate store with status: 'Success'
    facade.loadAll();
    expect(getCompaniesUseCase.execute).not.toHaveBeenCalled();
  });
});
```

### Mocking the flurryx Store

```typescript
// Create a mock store matching the IStore interface
const mockStore = {
  get: jasmine.createSpy('get').and.returnValue(
    signal({ data: [mockCompany], isLoading: false, status: 'Success' })
  ),
  update: jasmine.createSpy('update'),
  clear: jasmine.createSpy('clear'),
  clearAll: jasmine.createSpy('clearAll'),
  startLoading: jasmine.createSpy('startLoading'),
};

// Provide via the store token
TestBed.configureTestingModule({
  providers: [
    CompaniesFacade,
    { provide: CompaniesStore, useValue: mockStore },
    { provide: GetCompaniesUseCase, useValue: mockUseCase },
  ],
});
```

## Component Test — Mock Facade Only

```typescript
describe('CompaniesListComponent', () => {
  // Provide a mocked facade returning signals with ResourceState
  // Components should ONLY depend on facade — no store or use case mocking

  it('should call facade to load companies', () => {
    expect(mockFacade.loadAll).toHaveBeenCalled();
  });

  it('should render data from facade signals', () => {
    // facade.getAll() returns signal({ data: [...], isLoading: false })
    // Verify rendered list matches
  });
});
```

## Use Case Test — Mock Ports

```typescript
describe('GetCompaniesUseCase', () => {
  // Mock the port, inject into the use case

  it('should delegate to port', () => {
    mockPort.getAll.mockReturnValue(of([mockCompany]));

    useCase.execute().subscribe((result) => {
      expect(result).toEqual([mockCompany]);
    });

    expect(mockPort.getAll).toHaveBeenCalled();
  });
});
```

## Adapter Test — Mock Endpoints

```typescript
describe('GetCompaniesAdapter', () => {
  // Mock the endpoint, verify DTO→domain mapping

  it('should map response DTOs to domain models', () => {
    mockEndpoint.getAll.mockReturnValue(of([mockResponse]));

    adapter.getAll().subscribe((result) => {
      expect(result[0].code).toBe(mockResponse.companyCode);
    });
  });
});
```

## Testing Principles

| Test Target | Mock | Verify |
|-------------|------|--------|
| Facade | Store (flurryx token) + use cases | Orchestration, caching behavior |
| Component | Facade only | Rendering + event delegation |
| Use case | Ports | Delegation + business logic |
| Adapter | Endpoints | DTO-to-model mapping (ACL) |

- Target **80%+ coverage**
- Never mock flurryx internals (`syncToStore`, decorators) — test their observable effect on the store mock
- Store is `providedIn: 'root'` — in tests, override with `{ provide: XStore, useValue: mockStore }`
- `@SkipIfCached` tests: pre-populate store mock with `status: 'Success'` to verify skip behavior
