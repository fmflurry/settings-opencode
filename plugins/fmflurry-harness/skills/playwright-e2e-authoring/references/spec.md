# Specs

A spec describes behaviour in user terms and delegates every DOM detail to a POM. If a reader can't tell what a test verifies without opening the POM, the abstraction is in the wrong place.

## The one import rule

A spec imports `test` and `expect` **only** from its module fixture — never from `@playwright/test`. That import is what carries the right POMs (and, for authenticated modules, the signed-in page) into the test:

```ts
import { test, expect } from './fixtures/<module>.fixture';
```

Importing from `@playwright/test` directly is a Rule 3 violation: the test would lose its fixtures and you'd be tempted to `new` a POM by hand.

## Structure

Group related tests with `test.describe`; lift shared navigation/readiness into `test.beforeEach`. Keep each `test` focused on one behaviour.

```ts
import { test } from './fixtures/<module>.fixture';

// Hits the real frontend + backend — no mocks.
test.describe('<Module> — <area>', () => {
  test.beforeEach(async ({ <screen>Page }) => {
    await <screen>Page.goto();
    await <screen>Page.expectLoaded();
  });

  test('<does the expected thing>', async ({ <screen>Page }) => {
    await <screen>Page.expect<Something>();
  });

  // A test can pull several POMs at once — Playwright builds each from the fixture.
  test('<navigates between screens>', async ({ <screen>Page, <other>Page }) => {
    await <screen>Page.<action>();
    await <other>Page.expectLoaded();
  });
});
```

## Annotated real example

From `tests/invoices/invoices-list.spec.ts` — note it imports only `test`, pulls POMs by name, and never touches a selector:

```ts
import { test } from './fixtures/invoices.fixture';

// Hits the real frontend + backend (auth) — no mocks. Invoice data is served by
// the app's seeded in-memory repository (F-0001, F-0002).
test.describe('Invoices — list', () => {
  test.beforeEach(async ({ invoicesListPage }) => {
    await invoicesListPage.goto();
    await invoicesListPage.expectLoaded();
  });

  test('lists the seeded invoices with their customers', async ({ invoicesListPage }) => {
    await invoicesListPage.expectInvoiceVisible('F-0001', 'Marie Lefèvre');
    await invoicesListPage.expectInvoiceVisible('F-0002', 'Paul Durand');
  });

  test('navigates to the composer from the establish button', async ({
    invoicesListPage,
    invoiceComposerPage,
  }) => {
    await invoicesListPage.clickEstablish();
    await invoiceComposerPage.expectLoaded();
  });
});
```

## Assertions: web-first only

Use Playwright's auto-retrying assertions through POM methods. They poll until the condition holds or the timeout expires, which is why **no arbitrary waits are ever needed**:

- `expect(locator).toBeVisible()`, `.toContainText(...)`, `.toHaveCount(n)`, `.toHaveValue(...)`.
- Prefer asserting on **what the user sees** over implementation details (URLs, DOM structure, network).

Forbidden (Rule 1):

- `page.waitForTimeout(...)` or any sleep — flaky and banned. If you're tempted to wait, assert on the thing you're waiting for instead.
- `page.route()` / `context.route()`, MSW, sinon, nock — no network interception.
- Hardcoded response stubs or fixture data files.

## Test data: real, created and cleaned the real way

The stack is live, so data is real. The seeded repository already provides fixtures like `F-0001`/`F-0002` for read-only assertions. When a test needs to **create** data:

- Set it up through the real UI workflow, or via an authentic API call using Playwright's `request` fixture.
- Tear it down the same way (real API/UI) in `test.afterEach` or a teardown step, so runs stay independent and repeatable.

```ts
test('creates then removes a draft', async ({ invoiceComposerPage, request }) => {
  // ...drive the UI to create, assert, then clean up via a real API call.
});
```

Never reach for a mock to avoid the round-trip — that defeats the whole suite.

## Naming conventions

| Artifact | Convention | Example |
|----------|-----------|---------|
| POM | `<screen>.page.ts` → class `<Screen>Page` | `invoices-list.page.ts` → `InvoicesListPage` |
| Module fixture | `<module>.fixture.ts` | `invoices.fixture.ts` |
| Spec | `<feature>.spec.ts` | `invoices-list.spec.ts` |
| Module folder | mirrors `frontend/src/app/modules/<module>` | `tests/invoices/` |

`describe` titles extend the pattern to `Module — area (<requirement refs>)`, where requirement refs are optional but preferred:

- `Auth — password reset caducity (S25, R14)`
- `Catalog — referencing an article (US1)`
- `Dunning — Generate report (10.4)`

Test titles remain a lowercase behaviour phrase (`lists the seeded invoices with their customers`).

## Admitted exceptions to the rules

Three rare cases deviate from the core rules and are allowed, with strict constraints:

### 1. Bounded fault injection (Rule 1 exception)

A `page.route()` is permitted **only** to force a failure shape the real stack cannot produce deterministically — a single synthetic response (e.g. 401 with `times: 1`, or `.abort()`) scoped to one request or one URL pattern. The route must carry a header comment explaining why no real path exists.

- **Allowed:** One synthetic 401 on the first `/api/**` request to test authentication-loss recovery.
- **Forbidden:** Stubbing a success response, simulating multiple requests, widening beyond one URL.

**Precedents:**
- `tests/auth/silent-session-end.spec.ts` — forces a single 401 to trigger token refresh.
- `tests/dunning/dunning-generate-report.spec.ts:175` — aborts `**/hubs/dunning**` to test the polling fallback.

### 2. Multi-context scenarios (Rule 3 exception)

Importing `BrowserContext` or other types from `@playwright/test` is permitted when a spec legitimately needs independent browser contexts (e.g. two devices for the same identity). POMs still come from `pages/`, no raw locators in the spec body.

**Precedent:** `tests/auth/device-local-logout.spec.ts` — two independent SSO cookie jars to prove local logout does not revoke the peer device.

### 3. Hand-instantiated POM with alternate tenant (Rule 3 exception)

Hand-instantiating a POM from `support/pages/` with `test.use({ storageState: undefined })` is permitted when a spec must sign in as a different account or tenant than the shared authenticated session.

**Precedent:** `tests/dunning/dunning-generate-report.spec.ts:168-180` — tenant-B test that reuses POMs but with a different storageState.
