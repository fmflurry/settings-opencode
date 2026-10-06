---
name: verify-this
description: "Verify a claim with fresh local evidence: restate it falsifiably, capture baseline and treatment, compare artifacts, and return VERIFIED, NOT VERIFIED, or INCONCLUSIVE."
---

# Verify This

If the current project has `.claude/skills/verify-this/SKILL.md` or `.opencode/skills/verify-this/SKILL.md`, read it and its `references/`; project specifics override this generic version.

Verification is not a recap. It proves or disproves a specific claim with repeatable evidence.

## When To Use

- The user asks "verify this", "prove it works", "did this fix it", or "show me the evidence".
- A bug fix needs a before/after repro.
- A UI, CLI, API, performance, or memory claim needs measurement.
- A test passes but the user-visible behavior still needs confirmation.

Do not use this for vague claims like "the code is cleaner". Ask for a measurable claim first.

## Workflow

1. Restate the claim in falsifiable form: condition, metric, and threshold.
2. Pick the smallest local surface that can disprove it.
3. Capture a baseline from the old state: merge base, parent commit, failing branch, or current broken repro.
4. Capture treatment from the changed state with the same command, data, warmup, and environment.
5. Compare raw artifacts: numbers, screenshots, terminal transcripts, HTTP responses, profiles, heap snapshots, or test output.
6. Return exactly one verdict: `VERIFIED`, `NOT VERIFIED`, or `INCONCLUSIVE`.

## Local Surfaces

Choose the smallest harness-native surface that isolates the claim. Detect the project stack from `AGENTS.md`, `CLAUDE.md`, and manifests, then select the appropriate surface:

### TypeScript / Angular projects

- **Code behavior:** Focused unit/integration test, or a minimal repro script.
  - Typecheck: `npx tsc --noEmit`
  - Tests: `npm test -- <file-path>` (Jest/Vitest pattern matching)
- **UI behavior:** Throwaway Playwright script under `/tmp` run against the dev-server URL in `angular.json` or `package.json` scripts. Dispatch to `e2e-runner` for critical flows. Never commit ephemeral test scripts to the repo.
- **CLI/TUI behavior:** Terminal transcript or demo recording showing stdin/stdout diff.
- **API behavior:** `curl <detected-api-url>` or a manual HTTP request.

### .NET / C# projects

- **Code behavior:** Unit/integration test with `dotnet test --filter "<FilterExpression>"` (matches namespace, class, or method).
- **API behavior:** Read `Properties/launchSettings.json` for `applicationUrl`, then `curl` against that endpoint.
- **Database:** Read-only access via `dotnet` context or connection string from config. SELECT/EXPLAIN only, no mutations.

### Database / SQL

- **Read-only queries:** `psql "$DATABASE_URL"` or `docker exec <container-name> psql`, via environment or compose file.
- **Schema inspection:** `\d`, `\di`, `\dt` and SELECT from `information_schema.*`.
- **Query performance:** `EXPLAIN ANALYZE` only; no modifications.

### Performance & memory

- **Wall-clock timing:** `time <command>` or `perf` on the same machine.
- **Memory:** Heap snapshots before/after the suspected operation.

## Artifact Layout

When safe to write artifacts:

```text
/tmp/verify-this/<claim-slug>/
├── claim.md
├── timeline.md
├── baseline/
├── treatment/
├── diff/
└── verdict.md
```

**Baseline capture** (do NOT use `git worktree add` on Orca-managed repos — use `git archive` instead):
```bash
git archive <base-ref> | tar -x -C /tmp/verify-this/<slug>/baseline-src
```

If artifacts may contain sensitive code, prompts, screenshots, HTTP bodies, or heap data, keep only the minimal inline evidence unless the user agrees to disk storage.

## Verdict Rules

- `VERIFIED`: baseline and treatment differ in the predicted direction, by the claimed threshold, with no obvious confound.
- `NOT VERIFIED`: the behavior is unchanged, moves the wrong way, or misses the threshold.
- `INCONCLUSIVE`: no valid baseline, noisy signal, failed measurement, or an environment difference invalidates the comparison.

## Output

Use this shape:

```text
VERIFIED | NOT VERIFIED | INCONCLUSIVE
Claim: <falsifiable claim>

Evidence:
<metric/artifact>: baseline=<...>, treatment=<...>, delta=<...>, threshold=<...>

Reasoning:
<one tight paragraph naming the evidence and any confounds>
```

Do not soften a negative result. A clear `NOT VERIFIED` is useful.

---

**Note:** A green build is required but does not make a claim VERIFIED. The build certifies syntax and type safety; the verification tests behavior.
