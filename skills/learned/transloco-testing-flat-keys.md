# TranslocoTestingModule: Flat Keys for Programmatic translate()

**Extracted:** 2026-02-23
**Context:** Angular testing with @jsverse/transloco in gc.webapp

## Problem

When testing Angular components that use `this.transloco.translate('dotted.key.path')` programmatically, `TranslocoTestingModule` returns the raw key instead of the translated value. Nested object format in `langs` works for `*transloco="let t"` template directives but not for programmatic `translate()` calls.

## Solution

Use flat dot-delimited keys keyed by locale code instead of nested objects:

```typescript
// WRONG - works for directives only
TranslocoTestingModule.forRoot({
  langs: {
    taxes: {
      create: {
        summary: {
          calculation: { base: { kilogram: "kilogrammes" } },
        },
      },
    },
  },
});

// CORRECT - works for both directives and translate() calls
TranslocoTestingModule.forRoot({
  langs: {
    "fr-FR": {
      "taxes.create.summary.calculation.base.kilogram": "kilogrammes",
      "taxes.create.summary.calculation.base.liter": "litres",
    },
  },
  translocoConfig: {
    availableLangs: ["fr-FR"],
    defaultLang: "fr-FR",
  },
});
```

## When to Use

- When testing components that call `this.transloco.translate()` in TypeScript code
- When `TranslocoTestingModule` returns raw keys instead of translated values
- When component uses scoped translations with programmatic access
