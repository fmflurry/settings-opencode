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
