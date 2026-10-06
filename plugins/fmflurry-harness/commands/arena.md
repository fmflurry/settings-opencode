---
description: Run LLM arena benchmark (classify/draft models against criteria)
---

# Arena Command

> CC: Execute this as a direct CLI wrapper. Run pre-flight checks, execute dry-run first, ask for confirmation, then run live. Read and present results.

Run LLM arena benchmark: $ARGUMENTS

## Your Task

Run the LLM arena benchmark to evaluate candidate models on classify/draft prompts. The arena benchmarks each model with multiple criteria (schema_valid, output_quality, latency, etc.) and aggregates results per config.

### 1. Parse Arguments

From `$ARGUMENTS`, extract:
- `prompt`: `classify` | `draft` | `all` (default: `all`)
- Optional flags:
  - `--dry-run` (automatic in step 2, you run this always first)
  - `--confirm` (automatic in step 4, only after user approval)
  - `--failures` (include failures in detail JSON)
  - `--max-cost <eur>` (budget cap in EUR; exit non-zero if exceeded)
  - `--reps <n>` (repetitions per case, default: as configured)
  - `--top <n>` (Stage 1 only: keep top N configs by ranking; default 3)
  - `--refine` + `--from <rankingFile>` (Stage 2: dense settings sweep on top-N winners; requires prior ranking.json)
  - `--rerank` + `--from <detailFile>` (Offline re-ranking: reload stored detail.json results, re-apply current thresholds (env vars), zero LLM calls, outputs updated ranking.json with provenance via rerankOf metadata)
  - `--suggest` + `--eu` (Shortlist generator: no LLM calls, writes candidates proposal; --eu uses eu.openrouter.ai host)

### 2. Pre-Flight Checks

Stop and report failure if ANY check fails.

**Environment Variables**:
```bash
LITELLM_MASTER_KEY            # LiteLLM gateway authentication
OPENROUTER_API_KEY            # OpenRouter fallback models
AZURE_AI_API_KEY              # Azure models
AZURE_AI_API_BASE             # Azure endpoint
ARENA_MAX_COST_EUR            # Budget cap in EUR (default: 10)
ARENA_USD_TO_EUR_RATE         # Static conversion rate (default: 0.86)
BENCH_FORCE_FALLBACK_CASES    # Force rich 25-case fallback datasets (default: 0; set to 1 for baseline runs)
ARENA_CALL_TIMEOUT_MS         # Per-call LLM abort timeout in ms (default: 120000; clamp: 10s–5min)
ARENA_TIME_BUDGET_MIN         # Global wall-clock budget in minutes (default: 60; hard stop if exceeded)
ARENA_CONCURRENCY             # Max concurrent API calls (default: 6; clamp: 1–16)
ARENA_CONCURRENCY_PER_MODEL   # Concurrency per model; AIMD throttle on 429 (default: 3; clamp: 1–8)
ARENA_GATE_SCHEMA_VALID_MIN   # Schema validation pass-rate minimum (default: 0.98; configurable 0.0–1.0)
ARENA_GATE_VERBATIM_MIN       # Verbatim exactness global minimum (default: 0.95; applies to draft montant/numFacture/echeance unless overridden)
ARENA_GATE_VERBATIM_AMOUNT_MIN # Override for montant field (default: ARENA_GATE_VERBATIM_MIN)
ARENA_GATE_VERBATIM_INVOICE_NUMBER_MIN # Override for numeroFacture field (default: ARENA_GATE_VERBATIM_MIN)
ARENA_GATE_VERBATIM_DUE_DATE_MIN # Override for echeance field (default: ARENA_GATE_VERBATIM_MIN)
ARENA_GATE_INTENT_MATCH_MIN # Classify quality gate threshold (default: 0.8; configurable 0.0–1.0)
ARTIFICIALANALYSIS_API_KEY    # Optional: enriches --suggest candidate priors
LITELLM_BASE_URL              # LiteLLM proxy base URL (default: http://localhost:4000/v1; must use port 4000 with docker-compose.override.yml)
```

**Create docker-compose.override.yml** (git-ignored) to publish LiteLLM on port 4000:
```yaml
services:
  litellm:
    ports:
      - "4000:4000"
```

Run in your shell (from repo root):
```bash
# Check env vars are set
echo "LITELLM_MASTER_KEY: ${LITELLM_MASTER_KEY:-NOT SET}"
echo "OPENROUTER_API_KEY: ${OPENROUTER_API_KEY:-NOT SET}"
echo "AZURE_AI_API_KEY: ${AZURE_AI_API_KEY:-NOT SET}"
echo "AZURE_AI_API_BASE: ${AZURE_AI_API_BASE:-NOT SET}"
```

**LiteLLM Gateway Reachability**:
```bash
# Check LiteLLM health endpoint (port 4000 via override)
curl -s http://localhost:4000/health || echo "Gateway unreachable"
# Alternative: check if Docker container is running
docker ps | grep litellm
```

**Model Configuration**:
- Read `ai-sdk/bench/arena.candidates.ts` — list of candidate models.
- Cross-check: every model in `arena.candidates.ts` must have an entry in `litellm/config.yaml`.
- If any model lacks a config entry, **warn and stop**. Say which models are missing.

### 3. Run Dry-Run

From `ai-sdk/` directory:
```bash
npm run arena -- --prompt $PROMPT --dry-run
```

Replace `$PROMPT` with the parsed prompt value from step 1 (e.g., `classify`, `draft`, or `all`).

**Parse Output**:
- Dry-run shows: number of cases, number of configs (model × settings combinations), total expected API calls.
- Extract and present **projected cost** per prompt and per config.
- Show table format (costs in EUR primary, USD approximation in parentheses):
  ```
  Prompt     | Cases | Configs | Est. Calls | Est. Cost
  -----------+-------+---------+------------+---------------------------
  classify   |   10  |    4    |     40     | €2.15 (≈$2.50)
  draft      |    8  |    4    |     32     | €1.51 (≈$1.75)
  -----------+-------+---------+------------+---------------------------
  TOTAL      |   18  |    4    |     72     | €3.66 (≈$4.25)
  ```

### 4. Ask User Confirmation

**Call `AskUserQuestion`** (do NOT assume approval):

```
Ready to run arena benchmark. Projected cost: €3.66 (≈$4.25)

Prompt: all (classify + draft)
Cases: 18
Configs: 4 models × settings
Repetitions: as configured

Proceed with live run? (yes/no)
```

**Only proceed if user replies affirmatively** (yes, proceed, ok, etc.). If they say no or ask questions, stop.

### 5. Run Live (After Confirmation)

From `ai-sdk/` directory:
```bash
npm run arena -- --prompt $PROMPT --confirm [--failures] [--max-cost EUR_VALUE] [--reps N]
```

Pass through any optional flags the user included in `$ARGUMENTS`:
- `--failures` if present
- `--max-cost` with the EUR value if present
- `--reps` with repetition count if present

**Monitor execution**:
- Watch for exit code:
  - `0` = success
  - non-zero = budget cap hit (`budgetStopped` flag) OR schema_valid pass-rate is 0 OR cost data missing (`costDataMissing: true`)
- If non-zero, report it explicitly. Partial results may still be written.
- **Cost data missing**: If LiteLLM cost headers are absent, the run stops as a safety measure. Check that all models have cost metadata in `litellm/config.yaml` and that the gateway is returning pricing information.

### 6. Parse and Present Results

Results are written to `bench/results/`:
- `<runId>.summary.json` — aggregated per-config pass-rates for each criterion
- `<runId>.detail.json` — full case × config × repetition audit trail (failures included if `--failures` was used)
- `<runId>.ranking.json` — **(Stage 1 output)** top-N configs per prompt, ranked by quality gates then cost/latency; serves as input to `--refine --from`
- `<runId>.verdict.json` — **(Stage 2 output, refine mode)** final ordered (model, settings) rotation per prompt; directs fallback priority in litellm config
- `<date>.candidates.proposed.json` — **(--suggest output)** shortlist generator result; apply to `arena.candidates.ts` manually

**Read both files** and synthesize:

#### Summary Table (Per Prompt)

For each prompt (classify, draft), show ranked table. Example format with classify criteria (costs in EUR, USD approximation in parentheses):

```
Model & Settings        | Schema Valid | Intention Match | Latency (s) | Cost
------------------------|--------------|-----------------|-------------|---------------------------
gpt-5-mini (t=0.5)      |    94%       |     90%         |    0.6      | €0.0069 (≈$0.0080)
mistral-small-2503 (t=0.7) |  88%      |     84%         |    0.5      | €0.0034 (≈$0.0040)
```

(Draft prompts would show: schema_valid, verbatim_montant, verbatim_numeroFacture, verbatim_echeance criteria.)

#### Weak Spots Analysis

For each criterion, identify:
- Which config(s) score below 80% pass-rate
- Which criterion is the bottleneck (lowest pass-rate across all configs)

Example (classify prompt):
```
WEAK SPOTS:
- schema_valid: mistral-small-2503 at 82% (1 validation error in case #5)
- intention_match: gpt-5-mini at 85% (misclassified intent in case #7)
- confidence_calibration: mistral-small-2503 at 79% (overconfident on edge cases)
```

#### Failures Summary

If `--failures` was used and detail.json contains failures:
- Count failures per config
- Categorize: schema validation errors, output quality rejects, latency timeout
- List case IDs that failed

#### Cost & Budget

- Total cost for this run (EUR, with USD approximation)
- Cost per prompt (EUR with USD approximation)
- Cost per config (EUR with USD approximation)
- Conversion rate used: `ARENA_USD_TO_EUR_RATE` (default 0.86)
- Summary JSON metadata includes: `costEur`, `costUsd`, `usdToEurRate`
- If `--max-cost` was set: remaining budget or "budget exceeded" status

#### Raw Paths

Point user to:
- Summary: `bench/results/<runId>.summary.json`
- Detail: `bench/results/<runId>.detail.json`

### 7. Handle Budget Cap

If the run exited with non-zero and `budgetStopped` is true in the summary:
```
BUDGET CAPPED: Run halted before completion.
Remaining budget: €0.00 (≈$0.00)
Cases completed: 12 / 18
Results are partial. Re-run with higher --max-cost to complete.
```

List which configs/prompts completed and which were cut off.

---

## Stage 2: Refine Mode

Narrow dense settings sweep on top-N winners from a previous Stage 1 run.

**Usage**:
```bash
npm run arena -- --refine --from <rankingFile> --prompt <classify|draft> [--reps N] [--max-cost EUR]
```

**Requirements**:
- `--from <rankingFile>`: path to a prior run's `<runId>.ranking.json` (e.g., `bench/results/20260122-1430.ranking.json`)
- `--prompt`: required; specifies which prompt (classify or draft) to refine

**Behavior**:
- Loads top-N configs from the ranking file (default top 3, configurable with `--top`)
- Re-evaluates each with extended settings sweeps (e.g., temperature ranges, token limits)
- Produces `<runId>.verdict.json` with final ordered (model, settings) tuple per prompt
- Exit 0 on success; exit non-zero if ranking file missing or unreadable

**Example**:
```bash
npm run arena -- --refine --from bench/results/20260122-1430.ranking.json --prompt classify --reps 3
```

---

## Shortlist Generator (--suggest)

Generate candidate model shortlist without running benchmarks. Useful for exploring new models before arena investment.

**Usage**:
```bash
npm run arena -- --suggest [--eu] [--reps N]
```

**Flags**:
- `--eu`: Use eu.openrouter.ai host (for GDPR/regional routing); default is openrouter.io
- `--reps`: Dry-run argument; default 1

**Behavior**:
- No LLM calls; analysis only
- Reads available OpenRouter model catalog (via API list endpoint)
- Scores candidates by availability, cost, latency reputation, and optional `ARTIFICIALANALYSIS_API_KEY` priors
- Writes `bench/results/<date>.candidates.proposed.json` with ranked candidate list
- Exits 0 always (non-fatal); user manually curates and applies to `arena.candidates.ts`

**Output Format** (`<date>.candidates.proposed.json`):
```json
{
  "generatedAt": "2026-01-22T14:30:00Z",
  "candidates": [
    {
      "model": "openrouter/openai/gpt-5-mini",
      "provider": "OpenRouter",
      "costPer1kTokens": { "input": 0.05, "output": 0.15 },
      "estimatedLatencyMs": 250,
      "score": 0.92,
      "reason": "Cost-efficient, low latency, strong quality reputation"
    }
  ]
}
```

---

## Offline Re-Ranking (--rerank)

Re-apply quality gate thresholds to stored detail.json results without re-running LLM calls. Useful after threshold policy changes (env vars updated) to audit impact on prior runs.

**Usage**:
```bash
npm run arena -- --rerank --from <detailFile> --prompt <classify|draft>
```

**Requirements**:
- `--from <detailFile>`: path to a prior run's `<runId>.detail.json` (e.g., `bench/results/20260122-1430.detail.json`)
- `--prompt`: required; specifies which prompt (classify or draft) to re-rank

**Behavior**:
- Loads stored case results from detail.json
- Re-applies current threshold policy (reads env vars `ARENA_GATE_*_MIN`)
- Produces new `<runId>.ranking.json` with updated gate decisions and near-miss analysis
- Metadata includes `rerankOf: "<original-runId>.detail.json"` for provenance
- Exit 0 on success; exit non-zero if detail file missing or unreadable
- Zero API calls; all computation local

**Output** (updated `<runId>.ranking.json`):
- Per-config pass-rates with actual-vs-threshold comparisons
- Eliminated configs flagged with reason (which threshold(s) missed, margin to gate)
- Survivors ranked by cost/latency as per standard policy

**Example**:
```bash
npm run arena -- --rerank --from bench/results/20260122-1430.detail.json --prompt draft
```

This re-evaluates draft results under current draft gate thresholds (default: schema_valid ≥ 0.98, all verbatim criteria ≥ 0.95), outputs a new ranking reflecting potential threshold changes since the original run.

---

## Recommended Workflow

### Phase 1: Baseline with Full Cases

Run full arena benchmark using fallback case datasets:

```bash
export BENCH_FORCE_FALLBACK_CASES=1
/arena all --max-cost 15.0
```

This generates:
- `<runId>.summary.json` and `<runId>.detail.json` (full audit trail)
- `<runId>.ranking.json` (top-3 per prompt, ranked by quality gates)

### Phase 2: Optional Candidate Exploration

If exploring new models:

```bash
/arena --suggest --eu
```

Review `bench/results/<date>.candidates.proposed.json`, curate additions, then update `arena.candidates.ts` manually. Re-run Phase 1 with enriched candidates.

### Phase 3: Refine Top Winners

Dense settings sweep on winners from Phase 1:

```bash
/arena --refine --from bench/results/<runId>.ranking.json --prompt classify --reps 3
```

This generates `<runId>.verdict.json` with final (model, settings) tuples per prompt.

### Phase 4: Apply to Fallback Chain

Manually apply `<runId>.verdict.json` ordering to `litellm/config.yaml` fallback routing.

**Example:** If `<runId>.verdict.json` contains:
```json
{
  "draft": [
    { "model": "gpt-5-mini", "settings": { "temperature": 0.5 } },
    { "model": "mistral-small-2503", "settings": { "temperature": 0.7 } }
  ],
  "classify": [
    { "model": "mistral-small-2503", "settings": { "temperature": 0.6 } },
    { "model": "gpt-5-mini", "settings": { "temperature": 0.4 } }
  ]
}
```

Update `litellm/config.yaml` fallbacks to match the ordered (rank 1, rank 2, ...) rotation:
```yaml
litellm_settings:
  fallbacks:
    # Draft: gpt-5-mini primary (rank 1), mistral-small-2503 fallback (rank 2)
    - gpt-5-mini-draft: ["mistral-small-2503-draft"]
    # Classify: mistral-small-2503 primary (rank 1), gpt-5-mini fallback (rank 2)
    - mistral-small-2503-classify: ["gpt-5-mini-classify"]
    - gpt-5-mini-classify: []  # no further fallback
```

Wire temperature overrides into arena-pricing.ts per-model config or add them to litellm_params if they vary per alias.

---

## Example Invocation

```
/arena classify --max-cost 3.0 --failures
```

Expected flow:
1. Parse: prompt=classify, max-cost=3.0 (in EUR), failures=true
2. Pre-flight checks (env vars, gateway, configs)
3. Dry-run: show projected cost for classify only (€2.15 ≈ $2.50 USD)
4. Ask confirmation
5. Run live: `npm run arena -- --prompt classify --confirm --failures --max-cost 3.0`
6. Read summary/detail, present ranked table for classify, weak spots, failures, cost (EUR primary with USD approximation)
7. Provide JSON paths for audit

---

## Monitoring & Progress

During live execution:

- **Progress lines**: Arena outputs `[HH:MM:SS] <config> case <N>/<total> (reps <R>/<reps_configured>) — ETA <MM>m` every 30s or per-case (whichever sooner).
- **Time budget warning**: If elapsed time approaches global `ARENA_TIME_BUDGET_MIN` (e.g., 50/60 min consumed), a one-time warning is issued: `[WARN] Global time budget ~exhausted (50/60 min); may halt remaining configs.` Soft warning; continue if user overrides via SIGTERM suppression.
- **Per-call timeout**: If a single LLM call exceeds `ARENA_CALL_TIMEOUT_MS`, it is aborted as a timeout failure (recorded in detail.json, not a crash).
- **Concurrency throttle**: If 429 (rate limit) received, AIMD backoff reduces `ARENA_CONCURRENCY_PER_MODEL` temporarily (e.g., 3 → 2 → 1).

**Docker/Host Setup Note**: When running arena from the host (not inside Docker), `LITELLM_BASE_URL` must point to the published LiteLLM port. With `docker-compose.override.yml` (which publishes port 4000), set:
```bash
export LITELLM_BASE_URL=http://localhost:4000/v1
```

---

## Exit Codes

- **0**: Success. All cases evaluated.
- **Non-zero**: Budget cap tripped (`budgetStopped`) OR schema_valid pass-rate is 0 across all configs OR cost data missing (`costDataMissing: true`).

When exit is non-zero, results are **partial** — report clearly. If `costDataMissing` is true, inform the user that LiteLLM cost headers were absent and the run was stopped as a safety measure. Recommend checking `litellm/config.yaml` for complete model cost metadata.

---

## Ranking Policy

Ranking priority (Stage 1 output in `<runId>.ranking.json`):

1. **Quality Gates** (configurable thresholds; eliminate configs that fail):
   - **Classify**: schema_valid ≥ `ARENA_GATE_SCHEMA_VALID_MIN` (default 0.98) AND intention_match ≥ `ARENA_GATE_INTENTION_MATCH_MIN` (default 0.8)
   - **Draft**: schema_valid ≥ `ARENA_GATE_SCHEMA_VALID_MIN` (default 0.98) AND verbatim_montant ≥ `ARENA_GATE_VERBATIM_MONTANT_MIN` (default 0.95) AND verbatim_numeroFacture ≥ `ARENA_GATE_VERBATIM_NUMERO_FACTURE_MIN` (default 0.95) AND verbatim_echeance ≥ `ARENA_GATE_VERBATIM_ECHEANCE_MIN` (default 0.95)
   - **Rationale**: Hard 100% gates eliminated valid models due to binomial sampling (99% model fails 100% gate ~53% of the time over 75 samples). Configurable thresholds prevent systematic false negatives and allow model merit assessment despite sampling variance.

2. **Threshold recording & near-miss flagging**: Every config's pass-rate is recorded in `ranking.json` with actual-vs-threshold comparisons. Configs within margin 0.05 of a gate are flagged as "near-miss" for investigation.

3. **Remaining gate failures** (configs that fail gates): Listed separately as "eliminated" with failure reason (which threshold(s) crossed, actual vs. configured minimum).

4. **Among gate-passing configs**, rank by:
   - Cost (EUR, ascending — cheapest first)
   - Latency p50 (seconds, ascending — fastest first)

**Example ranking output** (classify, after quality gates applied):
```
PASS:
1. mistral-small-2503 (t=0.7)   — schema_valid: 97%, intention_match: 82%, €0.0034/call, p50: 0.5s
2. gpt-5-mini (t=0.5)           — schema_valid: 96%, intention_match: 89%, €0.0069/call, p50: 0.6s

FAIL (below configured thresholds):
- llama-2-70b (t=0.9)           — schema_valid: 92% (threshold: 98%), intention_match: 0.72 (threshold: 0.8) [near-miss on intention_match: margin 0.08]
- grok-4-20 (t=0.6)             — verbatim_echeance: 0.60 (threshold: 0.95) [far from threshold]
```

---

## Notes

- Always run `--dry-run` first. Never skip to live run.
- Cost projections are estimates; actual cost may vary slightly (rounding, API pricing changes).
- Schema validation is critical — if all configs fail schema_valid, the benchmark is invalid; recommend debugging model outputs.
- Latency includes API round-trip and processing; network conditions affect results.
