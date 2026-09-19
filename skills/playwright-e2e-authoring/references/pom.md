# Page Object Model (POM)

A POM is the **only** place the suite is allowed to know how a screen is wired in the DOM. Specs talk to POMs in domain terms (`expectInvoiceVisible('F-0001', 'Marie Lefèvre')`), never in selectors. That keeps specs readable and means a markup change touches exactly one file.

## The `BasePage` contract

Every POM extends `BasePage` (`support/pages/base.page.ts`):

```ts
import { type Page } from '@playwright/test';

export abstract class BasePage {
  constructor(protected readonly page: Page) {}
}
```

`page` is `protected readonly`, so subclasses reach it via `this.page` and can't reassign it. That's all the base does — it exists to enforce a uniform constructor shape, not to add behaviour.

## Template

For a screen at route `/<route>` in module `<module>`, create `tests/<module>/pages/<screen>.page.ts`:

```ts
import { type Page, type Locator, expect } from '@playwright/test';
import { BasePage } from '../../../support/pages/base.page';

/** POM for the <screen> screen (route `/<route>`). */
export class <Screen>Page extends BasePage {
  private readonly heading: Locator;
  // ...one private readonly Locator per element the spec needs

  constructor(page: Page) {
    super(page);
    this.heading = page.getByRole('heading', { name: '<Heading>', exact: true });
  }

  async goto(): Promise<void> {
    await this.page.goto('/<route>');
  }

  /** Web-first readiness check — every POM should expose one. */
  async expectLoaded(): Promise<void> {
    await expect(this.heading).toBeVisible();
  }

  // Actions: clicks, fills, navigation — verbs that DO something.
  // Assertions: methods named expect* that encode a meaningful check.
}
```

The `../../../` climbs `pages/ → <module>/ → tests/ → playwright/`, then into `support/`. This depth is fixed for any POM under `tests/<module>/pages/`.

## Locator strategy (in priority order)

Prefer locators that mirror how a user perceives the page — they survive refactors and document intent:

1. `getByRole('button', { name: 'Établir une facture' })` — first choice.
2. `getByLabel('Adresse mail', { exact: true })` — form fields.
3. `getByTestId('…')` — when role/label can't disambiguate.
4. `getByText('Aucune facture.')` — visible copy / empty states.
5. CSS like `page.locator('tbody tr')` — **last resort**, only for structural collections with no accessible handle (e.g. table rows). Filter them by content rather than by index: `this.rows.filter({ hasText: invoiceNumber })`.

Use `{ exact: true }` when a loose name would match siblings (e.g. a heading "Facture" that's a prefix of other text).

## Methods: actions vs assertions

Keep two flavours of method, both returning `Promise<void>`:

- **Actions** perform UI interaction: `goto()`, `clickEstablish()`, `fill(email, password, company)`, `openInvoice(number)`.
- **Assertions** are named `expect…` and contain web-first `expect(locator)` checks: `expectLoaded()`, `expectInvoiceVisible(...)`, `expectRowCount(n)`, `expectMissingFieldsError()`.

Putting assertions in the POM (rather than in the spec) lets several specs reuse the same check and keeps the spec at the level of "what", not "how".

## Annotated real example

From `tests/invoices/pages/invoices-list.page.ts`:

```ts
import { type Page, type Locator, expect } from '@playwright/test';
import { BasePage } from '../../../support/pages/base.page';

export class InvoicesListPage extends BasePage {
  private readonly heading: Locator;
  private readonly establishButton: Locator;
  private readonly rows: Locator;          // structural — table body rows
  private readonly emptyState: Locator;

  constructor(page: Page) {
    super(page);
    this.heading = page.getByRole('heading', { name: 'Facture', exact: true });
    this.establishButton = page.getByRole('button', { name: 'Établir une facture' });
    this.rows = page.locator('tbody tr');   // last-resort CSS, then filtered by text
    this.emptyState = page.getByText('Aucune facture.');
  }

  async goto(): Promise<void> {
    await this.page.goto('/invoices');
  }

  async expectLoaded(): Promise<void> {
    await expect(this.heading).toBeVisible();
  }

  /** A row located by the invoice number it contains — not by index. */
  rowByNumber(invoiceNumber: string): Locator {
    return this.rows.filter({ hasText: invoiceNumber });
  }

  async expectInvoiceVisible(invoiceNumber: string, customerName: string): Promise<void> {
    const row = this.rowByNumber(invoiceNumber);
    await expect(row).toBeVisible();
    await expect(row).toContainText(customerName);
  }

  async openInvoice(invoiceNumber: string): Promise<void> {
    await this.rowByNumber(invoiceNumber).click();
  }
}
```

## Quality bar

- **No `any`** — repo-wide ban. Type locators as `Locator`, the ctor param as `Page`.
- **Immutable** — locators are `private readonly`, assigned once in the constructor.
- **No `console.log`** in test code.
- **No waits-by-sleep** — `expect(...).toBeVisible()` already retries; never `waitForTimeout`.
- A POM holds **locators + actions + assertions** for one screen. If it sprawls past one screen, split it.
