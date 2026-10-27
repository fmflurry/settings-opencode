---
description: Enforce TDD workflow with 80%+ coverage. /tdd refactor pins current behavior first.
agent: main
subtask: true
---

# TDD Command

Implement the following using strict test-driven development: $ARGUMENTS

## TDD Cycle (MANDATORY)

```
RED → GREEN → REFACTOR → REPEAT
```

1. **RED**: Write a failing test FIRST
2. **GREEN**: Write minimal code to pass the test
3. **REFACTOR**: Improve code while keeping tests green
4. **REPEAT**: Continue until feature complete

## Refactor mode

`/tdd refactor` (the first argument is `refactor`, or the task is a behavior-preserving restructure) does not start RED.

1. Write characterization tests that pin the current observable behavior.
2. Run them on the unchanged code. They pass immediately. A failure means the test is wrong: fix the test, not the code.
3. Freeze those tests. The restructure does not edit them.
4. `coder` is not installed. The main agent does this inline and loads the `coder` skill. Production code changes. The characterization tests stay as written.
5. New behavior still uses RED: a failing test first, then the smallest code.

`/tdd` without `refactor` stays RED → GREEN → REFACTOR.

## Your Task

### Step 1: Define Interfaces (SCAFFOLD)
- Define TypeScript interfaces for inputs/outputs
- Create function signature with `throw new Error('Not implemented')`

### Step 2: Write Failing Tests (RED)
- Write tests that exercise the interface
- Include happy path, edge cases, and error conditions
- Run tests - verify they FAIL

### Step 3: Implement Minimal Code (GREEN)
- Write just enough code to make tests pass
- No premature optimization
- Run tests - verify they PASS

### Step 4: Refactor (IMPROVE)
- Extract constants, improve naming
- Remove duplication
- Run tests - verify they still PASS

### Step 5: Check Coverage
- Target: 80% minimum
- 100% for critical business logic
- Add more tests if needed

## Coverage Requirements

| Code Type | Minimum |
|-----------|---------|
| Standard code | 80% |
| Financial calculations | 100% |
| Authentication logic | 100% |
| Security-critical code | 100% |

## Test Types to Include

- **Unit Tests**: Individual functions
- **Edge Cases**: Empty, null, max values, boundaries
- **Error Conditions**: Invalid inputs, network failures
- **Integration Tests**: API endpoints, database operations

---

**MANDATORY**: Tests must be written BEFORE implementation. Never skip the RED phase.
