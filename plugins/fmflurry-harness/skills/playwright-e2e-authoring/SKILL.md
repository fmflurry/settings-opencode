---
name: playwright-e2e-authoring
description: Scaffold and extend Playwright E2E tests for the gc.platform suite (tests/playwright), wiring every artifact to the real frontend (localhost:4200) + real .NET backend — never mocks. Use whenever the user wants to add or write E2E / end-to-end tests, cover a new frontend feature module or screen, create a `.spec.ts`, add a Page Object Model (POM) or a Playwright fixture, or says things like "test the invoices page", "add an e2e test for <flow>", or "write Playwright tests for <feature>" — even when they do not mention the POM / fixture / no-mocks conventions. Produces a POM + module fixture + spec that follow the suite's four hard rules.
---

# Playwright E2E Authoring — gc.platform

This suite tests the **live** gc.platform stack end-to-end: the real Angular frontend (`http://localhost:4200`) plus the real `GcPlatform.Api` .NET backend, orchestrated by `docker-compose` at the repo root. Tests drive the full stack — there are no mocks, no stubs, no fake data.

**Path convention:** All paths in this document are relative to `tests/playwright/` (the test suite root).

Your job when this skill is active: turn a request like *"add E2E tests for the &lt;feature&gt; screen"* into a correct **POM + module fixture + spec**, colocated under `tests/<module>/`, that compiles under strict TypeScript and follows the conventions the existing `auth` and `invoices` modules already demonstrate.

## When to activate

- Adding E2E coverage for a new frontend feature module or screen.
- Writing a new `.spec.ts`, a Page Object Model, or a module fixture.
- Extending an existing module with another screen/POM.
- Any "test the X page/flow with Playwright" request, even when the conventions aren't named.

## The four rules (non-negotiable — they are project law)

These come from `tests/playwright/CLAUDE.md`. Everything this skill generates must honour them.

| # | Rule | What it means in practice |
|---|------|---------------------------|
| 1 | **No mocks** | Real frontend + real backend + real DB. No `page.route()`/`context.route()`, no MSW/sinon/nock, no fixture stubs, **no `page.waitForTimeout()`** or arbitrary sleeps. Create/clean test data via real API or UI. |
| 2 | **Page Object Model** | Every screen is a POM class under `tests/<module>/pages/` extending `BasePage`. Specs never call raw `page.locator()` — all DOM access flows through a POM. |
| 3 | **Work by fixture** | POMs are injected via Playwright fixtures (`test.extend`). Specs import `test`/`expect` from their **module fixture**, never from `@playwright/test`. Never `new SomePage()` inside a spec. |
| 4 | **Per application module** | One test folder per frontend feature: `frontend/src/app/modules/<module>` → `tests/<module>/`. POM, fixtures, and specs stay colocated. Cross-module helpers live in `support/`. |

## Before you start

1. **Confirm the stack is meant to be live.** Tests assume `docker-compose up` is running (frontend + backend healthy). You don't have to start it to author files, but never compensate for a missing backend with a mock.
2. **Find the frontend module** under `frontend/src/app/modules/<module>` so the test folder name mirrors it exactly (Rule 4). If unsure of the name, ask or inspect the frontend tree.
3. **Understand test accounts:** The default authenticated session uses `tenant-a-user` (seeded identity for tenant TEN-A via env vars `PLAYWRIGHT_KC_USERNAME`/`PLAYWRIGHT_KC_PASSWORD`, defaults: `Nova-Delta-17!`). Avoid reusing this account in password-reset specs — provision a disposable account via `support/identity-accounts.ts`. The `dev-user` identity has no `tenant_id` claim, so tenant-scoped screens (dunning, notifications, payments) render empty; use it only for session/logout tests.
4. **Decide public vs authenticated** — this picks which base fixture you extend. This is the single most important choice; see the table below and `references/fixtures.md`.

| Route kind | Example | Module fixture extends | POMs bound to | Extra step |
|------------|---------|------------------------|---------------|------------|
| **Authenticated** (behind `authSessionGuard`) | `/invoices` | `support/fixtures/auth.fixture` | `authenticatedPage` | Add the route to the warm-up loop in `support/auth.setup.ts` |
| **Public** | `/login`, `/activer` | `support/fixtures/base.fixture` | `page` | none |

## Workflow

Create the folder structure, then the artifacts in dependency order (POM → fixture → spec). Read the matching reference file before writing each kind — they hold the exact templates and the reasoning behind each convention.

1. **Scaffold the folders**
   ```
   tests/<module>/
   ├─ pages/        # one <screen>.page.ts per screen
   ├─ fixtures/     # <module>.fixture.ts
   └─ <feature>.spec.ts
   ```

2. **Write the POM(s)** — one per screen. → read `references/pom.md`
   - Extend `BasePage` (`import { BasePage } from '../../../support/pages/base.page';`).
   - Declare `private readonly` `Locator`s, assign them in the constructor.
   - Prefer `getByRole()` / `getByLabel()` / `getByTestId()` over CSS/XPath.
   - Expose actions (`goto`, clicks, fills) and high-level assertions (`expectLoaded`, `expect…`).

3. **Write the module fixture** — `fixtures/<module>.fixture.ts`. → read `references/fixtures.md`
   - Extend `base` (public) or `auth` (authenticated) per the table above.
   - Provide every POM as a fixture key.
   - Re-export `expect`.

4. **Write the spec(s)** — `<feature>.spec.ts`. → read `references/spec.md`
   - `import { test, expect } from './fixtures/<module>.fixture';`
   - Group with `test.describe`, share setup with `test.beforeEach`.
   - Use web-first assertions only; no sleeps, no network interception.
   - If the test creates data (not just reads seeded fixtures), read `references/data-setup.md` for API-based setup/teardown patterns.

5. **If the routes are authenticated**, append them to the route warm-up loop in `support/auth.setup.ts` so the dev server's lazy compile is paid once, serially, before workers fan out.

## Shared helpers in support/

When setting up test data or managing test state across modules, reach for these helpers:

| Helper | Purpose |
|--------|---------|
| `keycloak-token.ts` | Fetch a fresh access token via Authorization Code + PKCE flow for API calls from specs. |
| `identity-accounts.ts` | Provision a disposable account (email + password + accountId) via `POST /identity/accounts` for password-reset flows. |
| `keycloak-admin.ts` | Revoke a Keycloak session server-side (admin API); used to trigger session-loss tests. |
| `mailpit.ts` | Poll Mailpit SMTP for password-reset emails and extract the reset link. |
| `dunning-report-supply.ts` | Poll the dunning report generation status and check when lines appear. |

## Time budgets

The config (`playwright.config.ts`) sets generous defaults for the real stack:

- `timeout: 90_000` — per-test wall-clock limit (90s for frontend + backend round-trips + lazy compile).
- `expect.timeout: 15_000` — auto-retry window for assertions (15s for Transloco fetch + transforms).
- CI: `retries: 1`, `workers: 2` — one safety retry, two parallel workers.

Raise limits only for tests that legitimately need extra time (e.g., AI report generation: `test.setTimeout(20 * 60 * 1000);`) with a comment explaining why.

## Admitted exceptions

See `references/spec.md#admitted-exceptions` for bounded fault injection, multi-context, and alternate-tenant patterns. All three are strict, justified-only uses; never extend beyond their examples.

## Multiple fixtures per module

A module may hold several fixture files when specs need genuinely different base states. Example: `tests/auth/fixtures/` has three:

- `auth.fixture.ts` — unauthenticated journey (public routes like login, sign-up).
- `session.fixture.ts` — extends the shared `support/fixtures/auth.fixture`, reusing the storageState.
- `stay-connected.fixture.ts` — simulates a browser restart by clearing storageState mid-flow.

Each fixture explains its purpose in a JSDoc; never duplicate a fixture without documenting why the separation is necessary.

## Routing

The `e2e-runner` agent and `/e2e` command hand Playwright work to this skill. After implementation, the `playwright-e2e-review` skill audits the result against the four rules.

## Reference files

Read the one that matches what you're writing — don't write from memory:

- `references/pom.md` — Page Object Model template, locator strategy, the `BasePage` contract, annotated real example.
- `references/fixtures.md` — base vs auth fixtures, the `authenticatedPage` mechanism, the `Record<never, never>` gotcha, module-fixture templates, `mergeTests`.
- `references/spec.md` — spec structure, web-first assertions, real-data setup/teardown, naming conventions.
- `references/data-setup.md` — creating and cleaning test data via the real API, seeded vs. transient data, extracting auth tokens, defensive teardown patterns.

## Verify before done

The suite is strict TypeScript (`tsc` with `strict: true`, `noImplicitAny`) and the repo bans the `any` type. Before reporting success:

```bash
cd tests/playwright
npx tsc --noEmit --pretty false      # must be clean
```

If the stack is up, you can also run the new module:

```bash
npm run test:e2e -- tests/<module>
```

Note: the suite runs against **system Chrome** (`channel: 'chrome'` in `playwright.config.ts`) because the Playwright browser CDN is firewall-blocked here. Don't add `firefox`/`webkit` projects expecting downloaded browsers.
