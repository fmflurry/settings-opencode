---
name: learned-skillbook
description: Curated learned skills (including drafts) loaded as one skill.
version: 1.0.0
scope: opencode
---

# Learned Skillbook

This skill is a single entry point that brings the content of the current learned skills into context.

## Source Files

- `~/.config/opencode/skills/learned/ddd-type-duplication-across-layers.md`
- `~/.config/opencode/skills/learned/transloco-testing-flat-keys.md`
- `~/.config/opencode/skills/learned/learned-codemap-jump-navigation-angular.md`
- `~/.config/opencode/skills/learned/learned-structured-debugging-pattern.md`
- `~/.config/opencode/skills/learned/learned-error-resolution-pattern.md`
- `~/.config/opencode/skills/learned/learned-codemap-generator-hygiene.md`
- `~/.config/opencode/skills/learned/learned-user-correction-integration-pattern.md`
- `~/.config/opencode/skills/learned/learned-project-conventions-extraction-pattern.md`

## Learned Skills (Inlined)

### DDD Type Duplication Across Layers

# DDD Type Duplication Across Layers

**Extracted:** 2026-02-23
**Context:** Angular DDD codebase (gc.webapp) where domain types are duplicated in infrastructure API models

## Problem

When adding a new value to a domain union type (e.g., `CalculationBase`), the build breaks because the same type is hardcoded separately in the infrastructure layer (API request/response models). The domain type compiles fine, but the adapter that maps domain models to API requests fails with `Type 'X' is not assignable to type 'A' | 'B' | 'C'`.

## Solution

After modifying a domain union type, always search the entire codebase for other occurrences of the same union values:

```bash
grep -r "'Value1'.*'Value2'.*'Value3'" src/app/<domain>/
```

Common locations for duplicated types in this codebase:

- `domains/models/` - Domain type (primary)
- `infrastructure/api/request/` - API request types
- `infrastructure/api/response/` - API response types
- `domains/rules/*.spec.ts` - Test files with hardcoded arrays

## Example

```typescript
// Domain model (updated)
export type CalculationBase =
  | "AmountExclTax"
  | "Hectoliter"
  | "Quantity"
  | "Kilogram"
  | "Liter";

// API request model (forgotten) - build break
export interface CreateTaxRequest {
  calculationBase: "AmountExclTax" | "Hectoliter" | "Quantity"; // missing new values!
}
```

## When to Use

- When adding values to any union type in a `domains/models/` file
- When modifying enums or string literal types in a DDD-structured feature
- Before running `npm run build` after type changes, proactively grep for all occurrences

### TranslocoTestingModule: Flat Keys for Programmatic translate()

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

### Codemap Jump Navigation (Angular)

# Codemap Jump Navigation (Angular)

Extracted: 2026-02-24
Source: session extraction

## Overview

Use codemaps as a jump-table to move from a user-facing screen to the code that wires it:
routes -> providers -> facade/use-case -> ports/adapters -> stores/proxies.

This is optimized for repos that use:

- standalone Angular routing (`routes.ts`)
- provider factories (`*providers.ts`)
- clean/hex layers (presentation/application/domain/infrastructure)

## Trigger

You need to debug or extend a feature and the repo is too large for ad-hoc grepping.

## Action

Start at the codemap index and follow the focused maps in order.

## Steps

1. Open `docs/CODEMAPS/INDEX.md`
2. Find the relevant route entry in `docs/CODEMAPS/ROUTING.md`
   - note lazy imports (`loadChildren`, `loadComponent`)
   - note provider calls attached to routes (`provide*()`)
3. Find provider wiring in `docs/CODEMAPS/PROVIDERS.md`
   - locate the `*providers.ts` or `*-service.providers.ts` file
   - look for cross-context wiring hints (`AppContext.*`)
4. Identify API surface via `docs/CODEMAPS/PUBLIC-APIS.md` (ports + provider factories)
5. Identify orchestration logic via `docs/CODEMAPS/APPLICATION.md` (facades + use-cases)
6. Identify state and caching via `docs/CODEMAPS/STATE.md` (stores + session proxies)
7. Sanity-check layer presence via `docs/CODEMAPS/LAYERS.md`

## Example

Regenerate the maps before a deep investigation:

```bash
npm run codemaps:generate
```

## Caveats

- The routing/providers extraction is heuristic; treat it as a shortlist, not ground truth.
- Prefer the curated docs for intent/architecture: `docs/CODEMAPS/ARCHITECTURE.md`, `docs/CODEMAPS/MODULES.md`, `docs/CODEMAPS/FILES.md`.

### Structured Debugging Pattern

# Structured Debugging Pattern

Extracted: 2026-02-17
Source: session extraction

## When to use

Use this pattern when handling recurring debugging workflows.

## Steps

1. Form one hypothesis at a time from observable symptoms.
2. Instrument selectively (logs, runtime values, targeted reads).
3. Narrow scope until one causative change is identified.
4. Validate fix with focused and then broader checks.

## Caveats

- Avoid noisy instrumentation that obscures signal.
- Prefer deterministic repro over probabilistic assumptions.

### Error Resolution Pattern

# Error Resolution Pattern

Extracted: 2026-02-17
Source: session extraction

## When to use

Use this pattern when handling recurring error resolution workflows.

## Steps

1. Capture the exact failure and affected scope.
2. Identify the smallest reproducible scenario.
3. Patch the root cause, then verify with targeted tests.
4. Document guardrails to avoid recurrence.

## Caveats

- Do not overfit to a single failing example if broader behavior differs.
- Avoid masking failures with broad catch-all handlers.

### Codemap Generator Hygiene (Frontend)

# Codemap Generator Hygiene (Frontend)

Extracted: 2026-02-24
Source: session extraction

## Overview

Patterns for maintaining a codemap generator that stays useful over time.

## Trigger

You are adding or updating a codemap generator for a frontend Angular repo.

## Actions

### 1) Generate high-signal maps (not file inventories)

Prefer maps that answer:

- where is the screen wired? (routing)
- where are providers composed? (providers)
- what is the facade/use-case entry? (application)
- where is state/caching? (state)
- what is the cross-context surface? (public APIs)

### 2) Keep outputs stable

Avoid volatile metrics and noisy diffs:

- sort lists
- cap samples
- avoid per-file line counts

### 3) Use domain-accurate taxonomy

Do not introduce misleading subsystem names (for example "database" or "backend" in a frontend app).

### 4) Treat generated outputs as an atomic set

If one generated file is wrong, fix the generator and regenerate the whole set.
Do not partially delete generated outputs (INDEX + links will drift).

### 5) Make the generator reproducible

- pin the runner in devDependencies
- add an npm script
- commit the generated docs if they are expected to be consumed by agents

## Example snippet (heuristic extraction)

Use regex-based extraction when speed and determinism matter (no AST required):

```ts
// loadChildren targets
extractRegexAll(
  content,
  /loadChildren\s*:\s*\(\)\s*=>\s*import\(['\"]([^'\"]+)['\"]\)/g,
);

// providers attached to routes
extractRegexAll(content, /(provide[A-Za-z0-9_]+\(\))/g);
```

## Caveats

- Heuristics can miss edge cases; keep curated architecture docs alongside generated maps.
- If generator output becomes too large, add more focused maps instead of increasing caps.

### User Correction Integration Pattern

# User Correction Integration Pattern

Extracted: 2026-02-23
Source: session extraction

## When to use

Use this pattern when handling recurring user corrections workflows.

## Steps

1. Extract the correction as a concrete rule.
2. Apply the rule to current work and nearby decisions.
3. Re-validate outputs against updated expectations.
4. Capture the correction in reusable guidance.

## Caveats

- Do not partially apply corrections; update all relevant touchpoints.
- If corrections conflict, prefer latest explicit user instruction.

### Project Conventions Extraction Pattern

# Project Conventions Extraction Pattern

Extracted: 2026-02-23
Source: session extraction (consolidated)

## When to use

Use this pattern when you want to turn "how we do things in this repo" into a concrete checklist that can be reused.

## Steps

1. Identify recurring project conventions applied during the session.
2. Translate each convention into a simple decision checklist.
3. Show one concrete example from the session.
4. List anti-patterns that should be rejected in future work.

## Caveats

- Conventions evolve; revalidate periodically against source docs.
- Do not generalize project-specific rules to unrelated repositories.
