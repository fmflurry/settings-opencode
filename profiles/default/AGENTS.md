# Profile Instructions

<!-- Add your custom instructions for this profile here -->
<!-- These will be included when running `ocx opencode -p default` -->

## Angular Components

Components MUST use `templateUrl: './x.component.html'` (external template file), never inline HTML via `template:` in the `@Component` decorator. External templates preserve HTML tooling, enable IDE refactoring, reduce class file size, and keep diffs clean.

## Refactoring Rules

**CRITICAL: Always update tests when refactoring code**

When modifying source code, especially in Angular/TypeScript:
- If you convert methods to signals (e.g., `getFormattedX()` → `readonly formattedX = computed(...)`)
- If you rename, move, or change the signature of any method/function
- If you change the structure of any class/interface

**YOU MUST:**
1. Find ALL corresponding test files (`.spec.ts`, `.test.ts`)
2. Update test assertions to match the new API
3. Run tests locally to verify: `npx vitest run <path>.spec.ts`
4. Only mark task complete after all tests pass

**Common Pattern - Angular Signals:**
- Component: `getFormattedDate()` → `readonly formattedDate = computed(() => ...)`
- Template: `{{ getFormattedDate() }}` → `{{ formattedDate() }}`
- Tests: `component.getFormattedDate()` → `component.formattedDate()`

**NEVER:**
- Commit code with failing tests
- Assume tests will pass without verification
- Ignore pre-commit hook failures
