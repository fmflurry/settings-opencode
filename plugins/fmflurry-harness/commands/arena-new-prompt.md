---
description: Generate a new prompt adapter for LLM arena benchmark (classify/draft patterns)
---

# Arena New Prompt

> CC: Scaffold a new bench-able prompt following the real PromptAdapter<TInput,TOutput,TGroundTruth> contract and verified file layout. Read the task below carefully to understand the structure before generating code.

Generate a new prompt adapter for the LLM arena: $ARGUMENTS

## Your Task

Scaffold a complete, working prompt adapter following the proven `classify` / `draft` pattern. Your job is to generate code (the coder role), then emit a wiring checklist for manual completion by the user.

### 1. Parse Arguments

From `$ARGUMENTS`, extract:
- `promptId`: The new prompt's ID (e.g., `sentiment`, `summarize`). Used as a stable machine-readable identifier in types, filenames, and exports.

### 2. Generate Code Artifacts

Create the following files (structure mirrors `bench/cases-classify/` and `bench/prompts/classify.adapter.ts`):

#### A. Adapter Implementation: `ai-sdk/bench/prompts/<promptId>.adapter.ts`

A concrete implementation of `PromptAdapter<TInput, TOutput, TGroundTruth>` (see `bench/prompts/prompt-adapter.ts` for the contract). Must include:
- `id: PromptId` field set to the new promptId
- `runInstrumented(input: TInput, options?: AdapterRunOptions)` — calls the production instrumented agent function for this prompt
- `loadCases()` — returns the labeled bench cases array
- `scorers(output: TOutput, groundTruth: TGroundTruth, meta)` — returns `CriterionResult[]` from deterministic scoring

Reference: `bench/prompts/classify.adapter.ts` (lines 1–49) — mirrors this exactly, swapping `classifyThreadInstrumented` for your prompt's production instrumented function and `CLASSIFY_FALLBACK_CASES` for your cases export.

#### B. Adapter Tests: `ai-sdk/bench/prompts/<promptId>.adapter.test.ts`

Unit tests verifying the adapter loads cases, calls the instrumented function, and applies scorers correctly. Use node:test's `mock.module()` to stub the production function without network calls.

Reference: `bench/prompts/classify.adapter.test.ts` (full file) — copy the mocking pattern and structure, replace `classifyAdapter`/`Classification` with your adapter/output type.

#### C. Bench Cases: `ai-sdk/bench/cases-<promptId>/raw-case.ts`

Shared shape for all bench cases. Define `RawPromptIdCase` interface:
```typescript
import type { <PromptIdInput> } from '../../src/agents/dunning/<promptId>.schemas.ts';
import type { <PromptIdGroundTruth> } from '../types.ts';

export interface Raw<PromptId>Case {
  readonly id: string;
  readonly input: <PromptIdInput>;
  readonly groundTruth: <PromptIdGroundTruth>;
}
```

Reference: `bench/cases-classify/raw-case.ts` (lines 1–15).

#### D. Bench Cases Barrel: `ai-sdk/bench/cases-<promptId>/index.ts`

Concatenates individual case files (or splits by category like `silence.ts`, `promesse.ts` for classify). Must:
- Import all case definitions
- Concatenate into a single array
- Validate against a Zod schema at module load time
- Export `<PROMPTID>_FALLBACK_CASES: readonly <PromptIdBenchCase>[]`

Reference: `bench/cases-classify/index.ts` (full file) — structure is the template.

#### E. Individual Case Files: `ai-sdk/bench/cases-<promptId>/*.ts`

One or more files exporting `const <CATEGORY>_CASES: readonly Raw<PromptId>Case[]` with fictional data (no PII). Example: `bench/cases-classify/silence.ts`, `bench/cases-classify/promesse.ts`.

Stubs are acceptable for initial delivery — reviewers will fill in realistic cases.

#### F. Fallback Re-export: `ai-sdk/bench/cases.<promptId>.fallback.ts` (if used)

When your prompt's cases are split across a subdirectory, create a re-export barrel for backward compatibility (mirroring `bench/cases.classify.fallback.ts`):
```typescript
export {
  <PROMPTID>_FALLBACK_CASES,
  <PromptIdBenchCaseSchema>,
  <PromptIdGroundTruthSchema>,
} from './cases-<promptId>/index.ts';
export type { <PromptIdBenchCase>, <PromptIdGroundTruth> } from './cases-<promptId>/index.ts';
```

Reference: `bench/cases.classify.fallback.ts` (full file).

#### G. Zod Schemas in `ai-sdk/bench/types.ts`

Add two new schema + type exports to `bench/types.ts`:
- `<PromptIdGroundTruthSchema>` — the ground truth Zod schema (e.g., `ClassifyGroundTruthSchema`)
- `<PromptIdGroundTruth>` — inferred TypeScript type

Example (from `bench/types.ts` lines 141–157):
```typescript
export const <PromptId>GroundTruthSchema = z.object({
  // Define expected ground truth fields here
});
export type <PromptId>GroundTruth = z.infer<typeof <PromptId>GroundTruthSchema>;
```

### 3. Wiring Checklist (Manual)

After code generation, the user must wire the adapter into the arena. This is intentionally manual — it ensures the user understands each integration point:

- [ ] **`ai-sdk/bench/types.ts`**: Add `<promptId>` to the `PromptId` union (line 167) if not already there. Ensure ground-truth schemas are present (step 2.G above).

- [ ] **`ai-sdk/bench/arena-main.ts`**: Import the new adapter and register it in the `adapters` map (lines 57–60):
  ```typescript
  import { <promptId>Adapter } from './prompts/<promptId>.adapter.ts';
  
  const adapters: Readonly<Record<PromptId, ArenaAdapterHandle>> = {
    classify: toArenaAdapterHandle(classifyAdapter),
    draft: toArenaAdapterHandle(draftAdapter),
    <promptId>: toArenaAdapterHandle(<promptId>Adapter),  // ADD THIS LINE
  };
  ```

- [ ] **`ai-sdk/bench/arena.candidates.ts`**: Add to `ARENA_CANDIDATES` and `ARENA_PROMPT_PROFILES`:
  ```typescript
  export const ARENA_CANDIDATES: Readonly<Record<PromptId, ArenaPromptCandidates>> = {
    draft: { baselines: BASELINES, candidates: CANDIDATES },
    classify: { baselines: BASELINES, candidates: CANDIDATES },
    <promptId>: { baselines: BASELINES, candidates: CANDIDATES },  // ADD THIS LINE
  };
  
  export const ARENA_PROMPT_PROFILES: Readonly<Record<PromptId, PromptProfile>> = {
    draft: { needsStructuredOutput: true, minContext: 8000, language: 'fr', inputTokensApprox: 900, outputTokensApprox: 350 },
    classify: { needsStructuredOutput: true, minContext: 8000, language: 'fr', inputTokensApprox: 1200, outputTokensApprox: 120 },
    <promptId>: { needsStructuredOutput: true, minContext: 8000, language: 'fr', inputTokensApprox: <est>, outputTokensApprox: <est> },  // ADD THIS LINE
  };
  ```
  Replace `<est>` with estimated token counts for your prompt.

- [ ] **`ai-sdk/package.json`**: Add test path to the `test` script (line 14) to include your adapter tests:
  ```json
  "test": "node --experimental-strip-types ... bench/prompts/<promptId>.adapter.test.ts ..."
  ```

### 4. Verification

After wiring, run these commands from `ai-sdk/` to validate:

```bash
# TypeScript check
npx tsc --noEmit --pretty false

# Run your adapter tests only
node --experimental-strip-types --experimental-test-module-mocks --test bench/prompts/<promptId>.adapter.test.ts

# Run the full test suite
npm test

# Dry-run arena with your new prompt (verify it shows up in candidate count)
npm run arena -- --prompt <promptId> --dry-run
# or include it in all:
npm run arena -- --prompt all --dry-run
```

All commands must exit 0. If any fail:
- Fix TypeScript errors first (typos, missing imports, schema shape mismatches)
- Verify test mocks are wired correctly (see classify.adapter.test.ts for the pattern)
- Ensure all wiring checklist items are completed (step 3 above)

---

## Notes

- **No PII in cases**: All bench cases must be fictional — names, invoice refs, amounts, dates are invented.
- **Schema-constrained output required**: Every prompt must parse against a Zod schema (enforce via `PromptProfile.needsStructuredOutput`). Free-text-only models will be rejected at arena config-build time.
- **Structuredoutput declaration mandatory**: Every model in `ARENA_CANDIDATES` must declare `structuredOutput: true` (or be excluded from that prompt — see `arena.candidates.ts` for the enforcement).
- **PromptAdapter is the contract**: The adapter is the uniform interface the arena runner speaks to. If it doesn't match the contract (prompt-adapter.ts), the runner will fail at runtime.
- **Cases are immutable**: Use `readonly` on all case types. The arena loads them once at startup and distributes to concurrency workers.
