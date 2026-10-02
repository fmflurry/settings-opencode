# Coding Style

## Immutability (CRITICAL)

ALWAYS create new objects, NEVER mutate existing ones:

```
// Pseudocode
WRONG:  modify(original, field, value) → changes original in-place
CORRECT: update(original, field, value) → returns new copy with change
```

Rationale: Immutable data prevents hidden side effects, makes debugging easier, and enables safe concurrency.

## File Organization

MANY SMALL FILES > FEW LARGE FILES:
- High cohesion, low coupling
- 200-400 lines typical, 800 max
- Extract utilities from large modules
- Organize by feature/domain, not by type

## Error Handling

ALWAYS handle errors comprehensively:
- Handle errors explicitly at every level
- Provide user-friendly error messages in UI-facing code
- Log detailed error context on the server side
- Never silently swallow errors

## Input Validation

ALWAYS validate at system boundaries:
- Validate all user input before processing
- Use schema-based validation where available
- Fail fast with clear error messages
- Never trust external data (API responses, user input, file content)

## Core Principles

**KISS (Keep It Simple, Stupid):** Simplest solution that works. Avoid over-engineering. No premature optimization. Easy to understand beats clever code.

**DRY (Don't Repeat Yourself):** Extract common logic. Create reusable components. Share utilities. Avoid copy-paste programming.

**YAGNI (You Aren't Gonna Need It):** Don't build before needed. Avoid speculative generality. Add complexity only when required.

## Naming Conventions

**Descriptive names:** Variable and function names should be self-documenting. Choose clear over clever.

```typescript
// Good: Descriptive
const marketSearchQuery = "election";
const isUserAuthenticated = true;

// Bad: Unclear
const q = "election";
const flag = true;
```

**Function naming:** Use verb-noun pattern. Names read like actions.

```typescript
// Good
async function fetchMarketData(id: string) {}
function calculateSimilarity(a: number[], b: number[]) {}
function isValidEmail(email: string): boolean {}

// Bad
async function market(id: string) {}
function similarity(a, b) {}
```

**Fluent naming:** Chain methods for readable prose. Names enable fluent interfaces.

```typescript
// Good: Fluent
const searchCustomers = inject(SearchCustomersUseCase);
return this.searchCustomers.by(filters);

// Bad: Doesn't read well
public searchCustomers(filters) {
  return this.searchCustomers.search(filters);
}
```

## Control Flow

**Early returns over deep nesting:** Guard clauses flatten logic. Avoid pyramids of indentation.

```typescript
// Good: Early returns
if (!user) return;
if (!user.isAdmin) return;
if (!market) return;
// Do something

// Bad: Deep nesting
if (user) {
  if (user.isAdmin) {
    if (market) {
      // Do something
    }
  }
}
```

## Constants

**Magic numbers → named constants:** Unexplained numbers hurt readability. Use named constants for clarity.

```typescript
// Good
const MAX_RETRIES = 3;
const DEBOUNCE_DELAY_MS = 500;
if (retryCount > MAX_RETRIES) {}
setTimeout(callback, DEBOUNCE_DELAY_MS);

// Bad
if (retryCount > 3) {}
setTimeout(callback, 500);
```

## Testing

**AAA pattern (Arrange-Act-Assert):** Structure tests clearly. Setup → execute → verify.

```typescript
test("calculates similarity correctly", () => {
  // Arrange
  const vector1 = [1, 0, 0];
  const vector2 = [0, 1, 0];

  // Act
  const similarity = calculateCosineSimilarity(vector1, vector2);

  // Assert
  expect(similarity).toBe(0);
});
```

**Descriptive test names:** Test names explain what is tested, not just "works".

```typescript
// Good
test("returns empty array when no markets match query", () => {});
test("throws error when OpenAI API key is missing", () => {});

// Bad
test("works", () => {});
test("test search", () => {});
```

## Asynchronous Code

**Promise.all for independent operations:** Parallel execution is faster than sequential.

```typescript
// Good: Parallel
const [users, markets, stats] = await Promise.all([
  fetchUsers(),
  fetchMarkets(),
  fetchStats(),
]);

// Bad: Sequential
const users = await fetchUsers();
const markets = await fetchMarkets();
const stats = await fetchStats();
```

## Angular Components

Components MUST use `templateUrl: './x.component.html'` (external template file), never inline HTML via `template:` in the `@Component` decorator. External templates preserve HTML tooling, enable IDE refactoring, reduce class file size, and keep diffs clean.

## Code Quality Checklist

Before marking work complete:
- [ ] Code is readable and well-named
- [ ] Functions are small (<50 lines)
- [ ] Files are focused (<800 lines)
- [ ] No deep nesting (>4 levels)
- [ ] Proper error handling
- [ ] No hardcoded values (use constants or config)
- [ ] No mutation (immutable patterns used)
