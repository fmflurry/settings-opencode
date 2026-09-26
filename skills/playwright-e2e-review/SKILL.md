---
name: playwright-e2e-review
description: Audit Playwright E2E tests in the gc.platform suite (tests/playwright) against the four hard rules — no mocks, Page Object Model, work-by-fixture, one folder per frontend feature module — plus strict-TypeScript quality. Use whenever the user wants to review, check, audit, or "make sure it follows the conventions" for `.spec.ts` / POM / fixture files, before merging or committing E2E test changes, or asks "does this respect the Playwright rules?". Read-only: reports tiered findings with file:line and a concrete fix — it does not edit files.
---

# Playwright E2E Review — gc.platform

Audit Playwright test code against the suite's four hard rules (from `tests/playwright/CLAUDE.md`) and its strict-TypeScript bar. This skill is **read-only**: produce findings the author can act on, don't patch. If the user wants the fixes applied, hand the findings to the `playwright-e2e-authoring` skill or make the edits in a separate, explicit step.

**Path convention:** All paths in this document are relative to `tests/playwright/` (the test suite root).

## When to activate

- Reviewing new or changed `.spec.ts`, `*.page.ts`, or `*.fixture.ts` files.
- A pre-merge / pre-commit check of E2E test changes.
- "Does this follow the Playwright conventions?" / "audit these tests".

## Scope the review

Default to the changed files when there's a diff, otherwise the path the user names:

```bash
cd tests/playwright
git diff --name-only main...HEAD -- tests support   # changed test files
```

Read each file fully before judging — context matters (e.g. a `page.locator('tbody tr')` inside a POM is allowed; the same inside a spec is not).

## The checklist

### Rule 1 — No mocks (Critical)

The suite's entire value is that it hits the real stack. Any simulation is a Critical finding.

```bash
grep -rnE "page\.route|context\.route|waitForTimeout|mockServiceWorker|msw|sinon|nock|page\.fulfill" tests support --include='*.ts'
```

(Or use the harness Grep tool.)

- `page.route()` / `context.route()` / `route.fulfill()` → network interception. **Forbidden.**
- `page.waitForTimeout(...)` or any arbitrary sleep → flaky and banned; replace with a web-first assertion on the awaited state.
- MSW / sinon / nock / stub libraries, hardcoded response fixtures, fake data files → forbidden.

**Admitted exception:** A single `page.route()` with `times: 1` is allowed **only** to force a failure shape the real stack cannot produce deterministically (e.g. a 401, or `.abort()`), scoped to one URL pattern, carrying a JSDoc justification. Link to `../playwright-e2e-authoring/references/spec.md#admitted-exceptions` for examples and constraints. If the route stubs business data, simulates success, or widens beyond one request — Critical.

### Rule 2 — Page Object Model (High)

```bash
grep -rnE "(page|authenticatedPage)\.(locator|getBy|click|fill|goto)\(" tests --include='*.spec.ts'
```

(Or use the harness Grep tool.)

- A spec calling `page.locator(...)` / `page.getByRole(...)` / `page.click(...)` (or the same on `authenticatedPage`) directly → DOM access leaked out of a POM. Move it into a POM method.
- A spec that destructures `authenticatedPage` to touch the DOM directly (rather than calling POM methods) is the same violation.
- Every screen referenced by a spec should have a POM under `tests/<module>/pages/` that **extends `BasePage`** (`support/pages/base.page.ts`).
- Inside POMs: flag fragile selectors (raw CSS/XPath, index-based `nth(...)`) where a `getByRole`/`getByLabel`/`getByTestId` would work. `page.locator('tbody tr')` filtered by text is acceptable for structural collections.

**False negatives (grep won't catch):** Locators obtained via a destructured `page` stored in a variable (e.g. `const { getByRole } = page; getByRole(...)`), or obtained via `context.newPage()` inline in the test. Read the file to verify. **False positive:** `page.goto` in a public-route `beforeEach` is allowed (part of test setup, not implementation detail).

### Rule 3 — Work by fixture (High)

```bash
grep -rnE "from '@playwright/test'" tests --include='*.spec.ts'   # specs must NOT import from here
grep -rnE "new \w+Page\(" tests --include='*.spec.ts'             # POMs must come from fixtures
```

(Or use the harness Grep tool.)

- A spec importing `test`/`expect` from `@playwright/test` instead of its module fixture (`./fixtures/<module>.fixture`) → loses fixtures. **Fix the import.**
- `new SomePage(...)` inside a spec → POM instantiated by hand instead of injected. Provide it as a fixture key.
- A module fixture should extend `base` (public routes) or `auth` (authenticated routes) and re-export `expect`.
- Authenticated-route POMs should be bound to `authenticatedPage`, not a fresh `page`.
- **Admitted exceptions:** Importing `BrowserContext` types from `@playwright/test` is allowed for multi-context tests (Medium "verify justification" instead of High). Hand-instantiating a POM with `test.use({ storageState: undefined })` is allowed for alternate-tenant tests. Link to `../playwright-e2e-authoring/references/spec.md#admitted-exceptions` for constraints.
- **Orphan POMs:** Each POM class under `tests/<module>/pages/` must be exposed by a key in the module fixture. Flag any POMs that are imported nowhere (Medium).

### Rule 4 — Per application module (Medium)

- Test folder `tests/<module>/` must mirror a real `frontend/src/app/modules/<module>`. Flag mismatched or invented module names.
- POM, fixtures, and specs for a module stay **colocated** under that folder; cross-module helpers belong in `support/`, not copied between modules.
- Naming: `<screen>.page.ts`/`<Screen>Page`, `<module>.fixture.ts`, `<feature>.spec.ts`.

### TypeScript & hygiene

```bash
# Detect `any` type (not English word "any" in comments):
grep -rnE ":\s*any\b|as any|<any[,>]" tests support --include='*.ts'

# Detect console.log in test code:
grep -rnE "console\.log" tests support --include='*.ts'

# Detect leftover test markers:
grep -rnE "test\.(only|skip|fixme)\(" tests --include='*.spec.ts'
```

(Or use the harness Grep tool.)

- `any` type annotation (`: any`, `as any`, `<any>`) → repo-wide ban (High). Locators are `Locator`, ctor params `Page`.
- `console.log` in test code → remove.
- Mutated shared state instead of fresh objects → flag (immutability is a repo rule).
- **Leftover test markers:** `test.only`, `test.skip`, `test.fixme` without a reason string → High for `.only` (blocks CI), Medium for `.skip`/`.fixme` (explain why). Note: `forbidOnly` is CI-enforced, not locally.
- **Warm-up check (Medium):** Every authenticated route navigated by a POM's `goto()` must appear in the route warm-up loop of `support/auth.setup.ts`. Cross-check the two lists — missing routes cause cold-compile flakiness.
- **Comment audit (High):** If the repo provides `scripts/check-added-comments.sh`, run it against the base branch; otherwise `git diff -U0 | grep -nE '^\+.*(//|/\*|#|<!--)'`, to verify all added/changed comments are truthful and belong to allowed classes (`~/.claude/rules/common/code-comments.md`, or the repo's copy). False or forbidden comments block approval.

## Independent verification

Don't trust a green self-report — compile it yourself:

```bash
cd tests/playwright
npx tsc --noEmit --pretty false
```

Report the result. If it errors, those are Critical findings regardless of the checklist.

## Output format

Lead with a one-line verdict, then findings grouped by severity, each with `file:line`, the rule it breaks, and a concrete fix. Close with what's clean so the author knows it was actually checked.

```
## Playwright E2E review — <scope>

Verdict: <BLOCK / approve with fixes / clean>

### Critical
- tests/foo/foo.spec.ts:23 — Rule 1 (no mocks): `page.route('**/api/x')` intercepts the backend.
  Fix: delete the route; assert against the real response, seed data via the `request` fixture.

### High
- tests/foo/foo.spec.ts:1 — Rule 3 (fixtures): imports `test` from `@playwright/test`.
  Fix: `import { test, expect } from './fixtures/foo.fixture';`

### Medium
- ...

### Clean
- POMs extend BasePage and use getByRole/getByLabel throughout.
- `npx tsc --noEmit` passes.
```

Keep it terse and specific — a reviewer should be able to jump to each `file:line` and act without re-reading the rules.

**For the fix wording:** Reuse the templates in `../playwright-e2e-authoring/references/pom.md`, `fixtures.md`, `spec.md`, and `data-setup.md` so fixes feel native to the suite's conventions.

**On duplication:** The four core rules are already stated in `tests/playwright/CLAUDE.md` (canonical). This skill's checklist adds procedure and the review's own verification steps; do not restate the full rules, only reference them.
