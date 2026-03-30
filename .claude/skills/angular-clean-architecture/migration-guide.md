# Mixed-to-Clean Refactor Workflow

When migrating a legacy/mixed module to Clean Architecture, follow these steps:

## 1. Analyze Current Module

- Locate domain rules buried in components or services
- Identify direct cross-domain couplings (imports from other domains)
- Map out NgRx actions/effects/reducers if present
- List BehaviorSubject-based state in services

## 2. Introduce Facade Boundary

- Create a facade class for the module
- Move orchestration logic from components into the facade
- Components should now only call facade methods

## 3. Extract Use Cases and Ports

- Move business rules from services to `application/use-cases/`
- Define abstract port classes in `domain/ports/` for external dependencies
- Keep use cases framework-agnostic

## 4. Isolate Infrastructure

- Create adapters in `infrastructure/` implementing the ports
- Move API calls from services to endpoint classes
- Create infrastructure providers binding ports to adapters

## 5. Align Store Patterns

- Replace NgRx stores or BehaviorSubject state with `BaseStore`
- Define typed enum + state type
- Use `handleStoreLoading` operator for async transitions
- Wire facades to use the new store

## 6. Replace Direct Domain Coupling

- Identify where one domain imports another's internals
- Create context providers and register in `ContextRegistry`
- Route all cross-domain interactions via `contextProvidersFor()`

## 7. Validate

- Run tests and build
- Fix regressions
- Verify no legacy patterns remain in the migrated module
