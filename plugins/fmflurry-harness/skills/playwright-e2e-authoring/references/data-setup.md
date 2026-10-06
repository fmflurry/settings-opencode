# Test Data Setup and Teardown

The suite tests against a **live** backend, so test data must be created and cleaned **the real way**: through the UI or via authentic API calls, never mocked or stubbed.

## Which helper for which need

| Helper | Exported functions | Use case |
|--------|-------------------|----------|
| `keycloak-token.ts` | `fetchAccessTokenViaPkce`, `KeycloakTokenSet` (type) | Fetch a fresh OAuth token for any authenticated API call from a spec. |
| `identity-accounts.ts` | `openDisposableAccount`, `DisposableAccount` (type) | Create a throwaway account (email + password + accountId) for password-reset tests. |
| `keycloak-admin.ts` | `revokeKeycloakSession` | Revoke a session server-side to trigger session-loss detection tests. |
| `mailpit.ts` | `waitForPasswordResetLink`, `waitForMessageTo`, `fetchMessageText`, `extractPasswordResetLink`, `countMessagesTo`, `purgeMessagesTo` | Poll Mailpit SMTP for a mail sent to an address, extract the password-reset link (`?jeton=<guid>`), count or purge messages for anti-enumeration checks. |
| `dunning-report-supply.ts` | `ensureUnreadRemindLine` | Guarantee the dunning report holds an unread "Relancer" line before a spec consumes it (triggers `POST /api/dunning/report/generate` and polls, up to 20 min). |

## Test accounts (important)

- **Default session:** `tenant-a-user` (seeded in TEN-A) via `PLAYWRIGHT_KC_USERNAME`/`PLAYWRIGHT_KC_PASSWORD` (defaults: `Nova-Delta-17!`). This is the shared session every authenticated module reuses via the `setup` project's captured `storageState`.
- **For password-reset flows:** Never reuse the shared `tenant-a-user` account. Provision a disposable account per test using `openDisposableAccount(request)` from `support/identity-accounts.ts` with a `@example.test` domain (IANA-reserved, RFC 2606).
- **Session/logout tests:** Use `dev-user` (credentials in `support/auth.setup.ts`), but note it has no `tenant_id` claim — tenant-scoped screens (dunning, notifications, payments) render empty for it.

## When to use what

| Scenario | How | Example |
|----------|-----|---------|
| **Read-only assertions** on seeded fixtures | Use directly; no setup needed. | Invoices `F-0001` and `F-0002` are always in the app. |
| **The test's main flow creates data** | Drive the UI workflow; that IS the test. | Creating a draft invoice via the composer form. |
| **Data is just a prérequis** (not the flow being tested) | Create via real API call in `test.beforeEach`. | Pre-creating an invoice so you can test its detail view. |

## Creating data via the authenticated API

The backend runs at `http://localhost:5100`. For routes behind `authSessionGuard`, you need a bearer access token.

### Getting a token

Tokens are **memory-only** under Authorization Code + PKCE (`TokenStore` never persists them — see `frontend/src/app/modules/auth/infrastructure/token-store.ts`), so the captured `storageState` (`support/auth-state.ts`) never contains one; it only carries the Keycloak SSO cookie + the session-hint marker that let a browser page re-authenticate silently. For a direct API call made from a spec (not through a browser page), fetch a fresh token with `support/keycloak-token.ts`'s `fetchAccessTokenViaPkce` — it runs the same Authorization Code + PKCE flow the SPA and the Bruno collection use, purely over HTTP (Playwright's `request` fixture, no browser):

```ts
// From a spec at tests/<module>/<feature>.spec.ts:
import { fetchAccessTokenViaPkce } from '../../support/keycloak-token';

const USERNAME = process.env['PLAYWRIGHT_KC_USERNAME'] ?? 'tenant-a-user';
const PASSWORD = process.env['PLAYWRIGHT_KC_PASSWORD'] ?? 'Nova-Delta-17!';

const { accessToken } = await fetchAccessTokenViaPkce(request, USERNAME, PASSWORD);
// accessToken <-- this is what goes in the Bearer header
```

Always import `fetchAccessTokenViaPkce` from `support/keycloak-token.ts` rather than reimplementing the flow — see `tests/dunning/dunning-generate-report.spec.ts` for a real call site.

**Token reuse:** Rather than fetching a fresh token on every call (costly), fetch once per test in a small `accessToken` fixture:

```ts
import { test as authTest } from './auth.fixture';
import { fetchAccessTokenViaPkce } from '../../support/keycloak-token';

const USERNAME = process.env['PLAYWRIGHT_KC_USERNAME'] ?? 'tenant-a-user';
const PASSWORD = process.env['PLAYWRIGHT_KC_PASSWORD'] ?? 'Nova-Delta-17!';

type MyFixtures = { accessToken: string };

export const test = authTest.extend<MyFixtures>({
  accessToken: async ({ request }, use) => {
    const { accessToken } = await fetchAccessTokenViaPkce(request, USERNAME, PASSWORD);
    await use(accessToken);
  },
});
```

Then use `{ request, accessToken }` in your test — reuse the same token in `test.afterEach` for teardown.

### Using the token in an API call

Pass the token in the `Authorization` header:

```ts
test('creates then deletes an invoice draft', async ({ request }) => {
  const { accessToken } = await fetchAccessTokenViaPkce(request, USERNAME, PASSWORD);

  // Create data via the real, authenticated API
  const createResponse = await request.post('http://localhost:5100/api/invoices', {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    data: {
      // payload for the backend
    },
  });

  const invoice = (await createResponse.json()) as { id: string; number: string };

  // Test the UI against the created invoice...

  // Clean up in teardown (see below)
});
```

**Important:** The endpoint paths and payloads above are placeholders — check the backend's actual routes (`GcPlatform.Api`) before writing the call. If a request comes back `401`, verify the token against a successful authenticated request in the browser's DevTools **Network** tab.

## Test teardown: cleaning up real data

Use `test.afterEach` to delete any data your test created, so runs stay independent and repeatable:

```ts
test.afterEach(async ({ request }) => {
  const { accessToken } = await fetchAccessTokenViaPkce(request, USERNAME, PASSWORD);

  // Delete the invoice we created
  if (invoiceId) {
    await request.delete(`http://localhost:5100/api/invoices/${invoiceId}`, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
      },
    });
  }
});
```

**Isolation:** Every test that creates data must clean it up. If test A doesn't clean up after itself, test B (or a rerun of test A) may see stale or conflicting data.

## Defensive patterns

`fetchAccessTokenViaPkce` already throws with a descriptive message at every step of the flow (authorize failing, bad credentials, a state mismatch, a failed code exchange) — a caller does not need to re-validate its return value defensively; a rejected promise IS the failure signal. What you should still guard is your own assumptions about the response shape of whatever endpoint you call WITH the token:

```ts
const createResponse = await request.post('http://localhost:5100/api/invoices', {
  headers: { Authorization: `Bearer ${accessToken}` },
  data: { /* … */ },
});
if (!createResponse.ok()) {
  throw new Error(`Invoice creation failed (HTTP ${createResponse.status()}).`);
}
```

**Verify once during development:** Run the setup project in isolation (`npm run test:e2e -- --project setup`) and inspect the generated `playwright/.auth/session.json` file to confirm it matches your expectations (native Playwright `storageState` shape: `cookies` + `origins[].localStorage`).

## Forbidden: Do not mock to avoid round-trips

Never stub the API response to bypass the real create/delete:

```ts
// ❌ WRONG: intercepting the network instead of creating real data (Rule 1)
await page.route('**/api/invoices', (route) =>
  route.fulfill({ json: [{ id: '123', number: 'F-999' }] }),
);

// ❌ WRONG: hardcoded response fixtures asserted against instead of the live API
const fakeInvoice = { id: '123', number: 'F-999' };
```

The real API call is part of the contract verification. If the backend breaks, the test must catch it.

---

**Reference:** See `keycloak-token.ts` for the PKCE token-fetch logic, and `auth-state.ts` / `auth.setup.ts` for the browser-session `storageState` capture.
