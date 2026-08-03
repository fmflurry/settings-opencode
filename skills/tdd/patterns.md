# TDD Patterns by Stack

This document covers test-driven development across different language stacks. Core principles remain the same everywhere: RED → GREEN → REFACTOR, 80%+ coverage, isolation, and explicit error handling.

## TypeScript / JavaScript (Jest, Vitest)

### File Organization

```
src/
├── components/
│   ├── Button/
│   │   ├── Button.tsx
│   │   └── Button.test.tsx
├── app/
│   └── api/
│       └── markets/
│           ├── route.ts
│           └── route.test.ts
└── e2e/
    ├── markets.spec.ts
    └── auth.spec.ts
```

### Unit Test Pattern

```typescript
describe('Button Component', () => {
  it('renders with correct text', () => {
    render(<Button>Click me</Button>)
    expect(screen.getByText('Click me')).toBeInTheDocument()
  })

  it('calls onClick when clicked', () => {
    const handleClick = jest.fn()
    render(<Button onClick={handleClick}>Click</Button>)
    fireEvent.click(screen.getByRole('button'))
    expect(handleClick).toHaveBeenCalledTimes(1)
  })
})
```

### Integration Test Pattern (API)

```typescript
describe('GET /api/markets', () => {
  it('returns markets successfully', async () => {
    const request = new NextRequest('http://localhost/api/markets')
    const response = await GET(request)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(Array.isArray(data.data)).toBe(true)
  })

  it('validates query parameters', async () => {
    const request = new NextRequest('http://localhost/api/markets?limit=invalid')
    const response = await GET(request)
    expect(response.status).toBe(400)
  })
})
```

### E2E Test Pattern (Playwright)

```typescript
test('user can search and filter markets', async ({ page }) => {
  await page.goto('/')
  await page.click('a[href="/markets"]')
  
  await expect(page.locator('h1')).toContainText('Markets')
  
  await page.fill('input[placeholder="Search markets"]', 'election')
  await page.waitForTimeout(600)
  
  const results = page.locator('[data-testid="market-card"]')
  await expect(results).toHaveCount(5, { timeout: 5000 })
})
```

### Mocking External Services

#### Supabase Mock
```typescript
jest.mock('@/lib/supabase', () => ({
  supabase: {
    from: jest.fn(() => ({
      select: jest.fn(() => ({
        eq: jest.fn(() => Promise.resolve({
          data: [{ id: 1, name: 'Test' }],
          error: null
        }))
      }))
    }))
  }
}))
```

#### API Mock
```typescript
jest.mock('@/lib/openai', () => ({
  generateEmbedding: jest.fn(() => Promise.resolve(
    new Array(1536).fill(0.1)
  ))
}))
```

### Coverage Verification

```bash
npm run test:coverage
# Required: 80%+ branches, functions, lines, statements
```

Coverage thresholds in package.json:
```json
{
  "jest": {
    "coverageThresholds": {
      "global": {
        "branches": 80,
        "functions": 80,
        "lines": 80,
        "statements": 80
      }
    }
  }
}
```

## Common Testing Anti-Patterns (All Stacks)

### ❌ WRONG: Implementation Details
```typescript
// Testing internal state instead of behavior
expect(component.state.count).toBe(5)
```

### ✅ CORRECT: User-Visible Behavior
```typescript
// Test what users or the system see
expect(screen.getByText('Count: 5')).toBeInTheDocument()
```

### ❌ WRONG: Test Interdependence
```typescript
test('creates user', () => { /* sets global state */ })
test('updates user', () => { /* depends on previous test */ })
```

### ✅ CORRECT: Independent Tests
```typescript
test('creates user', () => {
  const user = createTestUser()
  // Test logic
})

test('updates user', () => {
  const user = createTestUser() // Fresh setup
  // Test logic
})
```

## Best Practices (Universal)

1. **Write Tests First** — Always RED-GREEN-REFACTOR
2. **One Assertion Per Test** — Focus on single behavior
3. **Descriptive Test Names** — Explain what's being tested
4. **Arrange-Act-Assert** — Clear test structure
5. **Mock External Dependencies** — Isolate unit tests
6. **Test Edge Cases** — Null, empty, invalid, boundary
7. **Test Error Paths** — Not just happy paths
8. **Keep Tests Fast** — Unit tests < 50ms each
9. **Clean Up After Tests** — No side effects
10. **Review Coverage Reports** — Identify gaps

## Success Metrics

- 80%+ code coverage achieved
- All tests passing (green)
- No skipped or disabled tests
- Fast test execution (unit tests < 30s total)
- E2E tests cover critical user flows
- Tests catch bugs before production
