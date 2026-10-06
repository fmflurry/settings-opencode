---
name: angular-accessibility
description: Audit and fix common accessibility issues in Angular templates and Angular Material components. Use when the user mentions Lighthouse, axe, screen readers, keyboard navigation, ARIA, asks to fix a11y issues in Angular HTML templates, or after any feature, bug fix, or refactor that changed Angular templates.
---

# Angular Accessibility (a11y)

## When To Activate

- After any development touching Angular templates, including a new feature, bug fix, or refactor
- After updating Angular Material markup, control structure, labels, dialogs, tables, forms, or navigation UI
- Fixing Lighthouse, axe, or ESLint accessibility findings
- Auditing Angular templates or Angular Material screens
- Debugging keyboard navigation, focus order, or screen reader output
- Refactoring interactive UI in Angular HTML templates

## Default Post-Development Trigger

Run this skill as a final verification step whenever the implementation modified `.html` templates or materially changed rendered UI structure, even if the original task did not mention accessibility.

Typical triggers:

- New feature that introduces or changes template markup
- Bug fix that changes form controls, buttons, tables, dialogs, drawers, or navigation
- Refactor that restructures conditionals, loops, landmarks, headings, or interactive elements
- Angular Material component replacement or reconfiguration affecting labels, focus, or keyboard behavior

## Hard Rules

- Prefer semantic HTML first: native `<button>`, `<a>`, `<label>`, `<main>`, `<table>`, and `<th>` before ARIA workarounds
- Prefer visible labels, `<label for>`, `<mat-label>`, or `aria-labelledby` before `aria-label`
- Use ARIA to fill missing semantics, not to replace native semantics
- For native elements, bind ARIA with `[attr.aria-*]`
- For Angular Material components that expose dedicated inputs, prefer `[aria-label]` or `[aria-labelledby]` without `attr.`
- Do not add redundant roles to native controls (`role="button"` on `<button>`, `role="checkbox"` on `<input type="checkbox">`, etc.)
- All user-facing accessible text must be translated with Transloco. Never hard-code text in templates
- After each fix, verify keyboard and focus behavior, not just lint output

## Audit Workflow

1. Run the ESLint accessibility check first:
   ```bash
   npx eslint "src/app/<feature>/**/*.html"
   ```
2. Run an automated audit on the affected screen:
   - Lighthouse
   - axe DevTools or equivalent
3. Perform a keyboard-only smoke test:
   - `Tab` / `Shift+Tab` reaches all interactive controls in a logical order
   - `Enter` / `Space` activates buttons, toggles, and checkboxes
   - `Escape` closes dialogs, menus, or drawers where applicable
   - Focus remains visible throughout the flow
4. Spot-check the changed flow with a screen reader
5. Fix issues systematically using the patterns below
6. Re-run lint and the automated audit on the affected screen

---

## Common Issues & Fixes

### 1. Icon-only buttons - missing accessible name

Any `<button>` whose only content is a `<mat-icon>` or similar icon has no accessible name.

**Fix**: add a translated accessible name and mark the icon as decorative.

```html
<!-- ❌ Before -->
<button type="button" (click)="onClose()">
  <mat-icon>close</mat-icon>
</button>

<!-- ✅ After -->
<button
  type="button"
  [attr.aria-label]="t('scope.key.close-btn-aria')"
  (click)="onClose()"
>
  <mat-icon aria-hidden="true">close</mat-icon>
</button>
```

Same pattern applies to pagination, toggle, toolbar, and other icon-only actions.

---

### 2. Form controls - missing programmatic label

Prefer a visible label first. Use `aria-label` only when a visible label or `aria-labelledby` is not practical.

**Standard forms**: use `<label for>` or `<mat-label>`.

```html
<!-- ✅ Preferred in a regular form -->
<mat-form-field>
  <mat-label>{{ t('scope.key.amount') }}</mat-label>
  <input matInput id="amount" type="number" />
</mat-form-field>
```

**Dense table/grid cells**: use row-level context so each control is uniquely identifiable.

```html
<!-- ❌ Before -->
<input matInput type="number" [value]="row.amount" />
<mat-select [value]="row.type"></mat-select>

<!-- ✅ After -->
<input
  matInput
  type="number"
  [value]="row.amount"
  [attr.aria-label]="t('scope.key.amount-aria', { invoiceNumber: row.invoiceNumber })"
/>

<mat-select
  [value]="row.type"
  [aria-label]="t('scope.key.type-aria', { invoiceNumber: row.invoiceNumber })"
>
</mat-select>
```

---

### 3. Checkboxes without labels

Empty `mat-checkbox` components with no projected text need an accessible name.

```html
<!-- ❌ Before -->
<mat-checkbox
  [checked]="allSelected()"
  (change)="onToggleAll($event.checked)"
/>

<!-- ✅ After - header (select-all) -->
<mat-checkbox
  [aria-label]="t('scope.key.select-all-aria')"
  [checked]="allSelected()"
  (change)="onToggleAll($event.checked)"
/>

<!-- ✅ After - row (select one) -->
<mat-checkbox
  [aria-label]="t('scope.key.select-row-aria', { invoiceNumber: row.invoiceNumber })"
  [checked]="row.selected"
  (change)="onToggleItem(row.id, $event.checked)"
/>
```

---

### 4. Non-semantic interactive elements

Clickable `<div>` and `<span>` elements break keyboard and assistive technology behavior.

**Fix**: replace them with native interactive elements whenever possible.

```html
<!-- ❌ Before -->
<div class="close-action" (click)="onClose()">
  <mat-icon>close</mat-icon>
</div>

<!-- ✅ After -->
<button
  type="button"
  class="close-action"
  [attr.aria-label]="t('scope.key.close-btn-aria')"
  (click)="onClose()"
>
  <mat-icon aria-hidden="true">close</mat-icon>
</button>
```

Use `<a>` for navigation and `<button>` for in-page actions.

---

### 5. Viewport blocks zoom

`maximum-scale` or `user-scalable=no` in the viewport meta tag prevents low-vision users from magnifying the page.

**Fix** (`src/index.html`): keep only `width=device-width, initial-scale=1.0`.

```html
<!-- ❌ Before -->
<meta
  name="viewport"
  content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no"
/>

<!-- ✅ After -->
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
```

---

### 6. Missing `<main>` landmark

Screen readers use landmarks to jump between page regions. A page must have exactly one `<main>` element.

In this project the layout can render two conditional branches (mobile / desktop). Each branch should expose its content wrapper as `<main>`. Since they are mutually exclusive, only one `<main>` is in the DOM at a time.

```html
<!-- mobile: main.component.html -->
<!-- ❌ Before: <div class="main-container"> -->
<main class="main-container" cdkVirtualScrollingElement>
  <gc-sub-header />
  <router-outlet />
</main>

<!-- desktop: page.component.html -->
<!-- ❌ Before: <div class="desktop-page-content"> -->
<main class="desktop-page-content">
  <router-outlet />
</main>
```

> SCSS that targets `.main-container` or `.desktop-page-content` keeps working when only the element tag changes.

---

### 7. Spinners and loading states

`mat-progress-spinner` already follows the ARIA `progressbar` pattern. Do not replace it with `role="status"`.

**Fix**:

- keep the component's default semantics
- add an accessible name if the spinner would otherwise be ambiguous
- use a nearby `aria-live="polite"` message only when the loading state itself must be announced

```html
<!-- ✅ Spinner keeps its default progressbar semantics -->
<mat-progress-spinner
  [attr.aria-label]="t('shared.loading-aria')"
  mode="indeterminate"
  diameter="32"
/>

<!-- ✅ Optional live region when the loading state should be announced -->
@if (isLoading()) {
<span aria-live="polite">{{ t('shared.loading-aria') }}</span>
}
```

---

### 8. Dialogs, drawers, and disclosure controls

Interactive overlays and expandable sections must expose state and preserve focus behavior.

**Verify**:

- the trigger has an accessible name
- expandable controls expose `aria-expanded` when they show or hide related content
- dialogs have a visible title and, when needed, a description
- focus moves into the dialog when opened and returns to the trigger when closed

```html
<button
  type="button"
  aria-controls="filters-panel"
  [attr.aria-expanded]="isFiltersOpen()"
  (click)="toggleFilters()"
>
  {{ t('scope.key.filters') }}
</button>

@if (isFiltersOpen()) {
<section id="filters-panel">...</section>
}
```

For Angular Material dialogs, keep the built-in focus management unless there is a concrete need to change it.

---

## Translation Convention

All accessible names and descriptions must use translated strings via Transloco. Never hard-code French or any other language directly in templates.

- In templates, follow the existing `t('scope.key')` pattern
- Key naming: append `-aria` to accessible-name keys and `-description` when the text is used for extra context
- Add keys to the feature's scoped `fr-FR.json`
- Use contextual params when the label must uniquely identify a row or control

**Example JSON additions:**

```json
{
  "table": {
    "select-all-aria": "Sélectionner toutes les échéances",
    "select-row-aria": "Sélectionner l'échéance {{invoiceNumber}}",
    "discount-amount-aria": "Montant escompte pour la facture {{invoiceNumber}}"
  },
  "pagination": {
    "previous-aria": "Page précédente",
    "next-aria": "Page suivante"
  },
  "selection-detail": {
    "close-btn-aria": "Fermer le volet de détails"
  }
}
```

---

## Validation Checklist

After fixing, verify:

- [ ] Viewport meta tag has no `maximum-scale` or `user-scalable=no`
- [ ] Page has exactly one `<main>` landmark
- [ ] All icon-only buttons have an accessible name
- [ ] Decorative icons inside labelled controls use `aria-hidden="true"`
- [ ] Form controls have a visible label, `aria-labelledby`, or `aria-label` as appropriate
- [ ] Empty `mat-checkbox` components have `[aria-label]` or `[aria-labelledby]`
- [ ] Clickable `div` and `span` elements were replaced with semantic controls
- [ ] Expand/collapse controls expose `aria-expanded` when applicable
- [ ] Dialogs and drawers keep correct focus entry and focus return behavior
- [ ] Loading indicators keep correct semantics and use a live region only when announcement is needed
- [ ] Informative images have meaningful `alt`; decorative images use empty `alt=""`
- [ ] Keyboard-only navigation works end-to-end and focus stays visible
- [ ] All accessible text uses translated strings
- [ ] ESLint passes: `npx eslint "src/app/<feature>/**/*.html"`
- [ ] Automated audit was re-run on the affected screen

---

## Known Limits

- This skill covers common template and component-level accessibility issues, not full WCAG certification
- Color contrast, timing, motion, content wording, and design-system token changes may require separate design or product decisions
- Complex screen reader behavior should be validated on the real user flow, not assumed from lint output alone
