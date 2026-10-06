# Fixtures

Fixtures are how POMs and shared state reach a spec. The spec declares what it needs in its arguments and Playwright constructs it — the spec never instantiates a POM with `new`. This keeps construction, auth, and teardown in one place and lets Playwright memoize expensive setup (like a signed-in page) per test.

There are two layers:

- **Cross-module fixtures** in `support/fixtures/` — `base` (the root) and `auth` (adds `authenticatedPage`).
- **Module fixtures** in `tests/<module>/fixtures/<module>.fixture.ts` — extend one of the above and add that module's POMs.

A spec imports `test`/`expect` **only** from its module fixture, never from `@playwright/test`. That single import is what wires the whole chain together.

## The root: `base.fixture.ts`

```ts
import { test as base } from '@playwright/test';

// NOTE: use Record<never, never> (zero keys), NOT Record<string, never>.
// The latter adds an index signature `[k: string]: never` that poisons every
// downstream `.extend()` — each added POM fixture would infer `use: (r: never)`.
export type BaseFixtures = Record<never, never>;

export const test = base.extend<BaseFixtures>({});
export { expect } from '@playwright/test';
```

**Heed the gotcha.** `Record<never, never>` is an object type with no keys; `Record<string, never>` carries an index signature that breaks type inference in every fixture that extends it. If you ever touch this file, keep `Record<never, never>`.

## The auth layer: `auth.fixture.ts`

Authenticated routes sit behind `authSessionGuard`. Rather than log in through Keycloak's hosted page on every test, the `setup` project signs in **once** and captures Playwright's native `storageState` (cookies — including the Keycloak SSO cookie — + localStorage, which holds the session-hint marker). This fixture overrides the built-in `storageState` option so every context it creates already carries that state:

```ts
import { type Page } from '@playwright/test';
import { test as base } from './base.fixture';
import { AUTH_STATE_PATH } from '../auth-state';

type AuthFixtures = {
  /** A page already authenticated and sitting on the app shell (`/`). */
  authenticatedPage: Page;
};

export const test = base.extend<AuthFixtures>({
  storageState: AUTH_STATE_PATH,

  authenticatedPage: async ({ page }, use) => {
    await page.goto('/');

    // The shell renders the main nav landmark only once the boot-time
    // silent re-authentication round-trip has completed. Locates by
    // `data-testid`, deliberately not by accessible name/role: the nav's
    // aria-label is a translated string, so this wait stays locale-independent
    // no matter which language is active. The "Se déconnecter" button lives
    // inside the account menu's closed popover (role="menu"), so it is never
    // visible right after sign-in regardless of auth state.
    await page.getByTestId('main-nav').waitFor({ state: 'visible', timeout: 30000 });

    await use(page);
  },
});

export { expect } from '@playwright/test';
```

You normally **consume** `authenticatedPage`; you don't rewrite this file.

## Module fixture — public routes

Extends `base`. POMs are bound to the plain `page`:

```ts
import { test as baseTest } from '../../../support/fixtures/base.fixture';
import { <Screen>Page } from '../pages/<screen>.page';

type <Module>Fixtures = {
  <screen>Page: <Screen>Page;
};

export const test = baseTest.extend<<Module>Fixtures>({
  <screen>Page: async ({ page }, use) => {
    await use(new <Screen>Page(page));
  },
});

export { expect } from '@playwright/test';
```

## Module fixture — authenticated routes

Extends `auth`. Every POM is bound to `authenticatedPage`, which Playwright memoizes per test, so one sign-in serves all the POMs in a spec. This is the `invoices` pattern:

```ts
import { test as authTest } from '../../../support/fixtures/auth.fixture';
import { InvoicesListPage } from '../pages/invoices-list.page';
import { InvoiceComposerPage } from '../pages/invoice-composer.page';
import { InvoiceDetailPage } from '../pages/invoice-detail.page';

type InvoicesFixtures = {
  invoicesListPage: InvoicesListPage;
  invoiceComposerPage: InvoiceComposerPage;
  invoiceDetailPage: InvoiceDetailPage;
};

export const test = authTest.extend<InvoicesFixtures>({
  invoicesListPage: async ({ authenticatedPage }, use) => {
    await use(new InvoicesListPage(authenticatedPage));
  },
  invoiceComposerPage: async ({ authenticatedPage }, use) => {
    await use(new InvoiceComposerPage(authenticatedPage));
  },
  invoiceDetailPage: async ({ authenticatedPage }, use) => {
    await use(new InvoiceDetailPage(authenticatedPage));
  },
});

export { expect } from '@playwright/test';
```

## Combining fixture sets — `mergeTests`

If a module legitimately needs fixtures from two independent sets, compose them with `mergeTests` rather than chaining `.extend` across unrelated concerns:

```ts
import { mergeTests } from '@playwright/test';
import { test as authTest } from '../../../support/fixtures/auth.fixture';
import { test as somethingTest } from './something.fixture';

export const test = mergeTests(authTest, somethingTest).extend<<Module>Fixtures>({ /* … */ });
export { expect } from '@playwright/test';
```

## When the route is authenticated: warm it up

`support/auth.setup.ts` pre-navigates the authenticated routes once (serially, before workers fan out) so no parallel test pays a cold lazy-compile penalty. When you add an authenticated module, add its routes to that loop:

```ts
for (const route of ['/invoices', '/dunning', '/customers']) {
  await page.goto(route);
  await page.waitForLoadState('load');
}
```

The authoritative list is the loop in `support/auth.setup.ts` — append there, don't copy it here.

## Several fixtures in one module

A module may hold multiple fixture files when specs need genuinely different base states. Real example: `tests/auth/fixtures/` has three separate fixture files:

- `auth.fixture.ts` — unauthenticated journey (public routes like login, sign-up).
- `session.fixture.ts` — extends the shared `support/fixtures/auth.fixture`, reusing the storageState for an authenticated session.
- `stay-connected.fixture.ts` — simulates a browser restart by clearing storageState mid-flow.

Each fixture file should have a JSDoc header explaining its distinct purpose and why it cannot reuse an existing fixture. Never duplicate a fixture without documenting the separation.

## Decision recap

| Route | Extend | Bind POMs to | Warm-up edit |
|-------|--------|--------------|--------------|
| Public (`/login`, `/activer`) | `support/fixtures/base.fixture` | `page` | no |
| Authenticated (`/invoices`, …) | `support/fixtures/auth.fixture` | `authenticatedPage` | yes — add route to `auth.setup.ts` |
