---
description: Pre-merge code review of HEAD vs a target branch (Angular + TypeScript focused)
agent: angular-cop
subtask: true
---

# /cop-review — Pre-Merge Review

Review the current branch against a target branch before merging. Angular + TypeScript focused. Loads `AGENTS.md` from cwd. Runs `tsc --noEmit` + `npm run lint`. Emits tiered report.

## Usage

```
/cop-review <target-branch> [--level=junior|senior] [--scope=signals,rxjs,arch,flurryx,ts,a11y] [--no-tools]
```

## Arguments

- `<target-branch>` (required) — the branch the PR will merge into (e.g. `main`, `develop`, `release/2026.05`).
- `--level=junior` — verbose teaching mode with rationale + doc links for every finding.
- `--level=senior` (default) — terse one-liners.
- `--scope=...` — limit to a subset of checklists. Comma list. Defaults to all.
- `--no-tools` — skip `tsc` + `lint` and produce static review only (faster).

## What you do

1. Parse `$ARGUMENTS`:
   - First positional token = `target`.
   - Flags as documented above.
   - If `target` missing, print usage and stop.
2. Verify you're inside a git repo (`git rev-parse --is-inside-work-tree`).
3. Load the **angular-cop** skill at `skills/angular-cop/SKILL.md`. Follow its pipeline section verbatim.
4. Load `AGENTS.md` from repo root if it exists.
5. Execute the pipeline (steps 1-7 in the skill / agent prompt).
6. Emit the single markdown report. No preamble. No epilogue.

## Examples

```
/cop-review main
/cop-review develop --level=junior
/cop-review release/2026.05 --scope=signals,flurryx --no-tools
```

## Output Contract

A single markdown document with:
- Header (target, base SHA, head SHA, counts table, verdict)
- Blockers (🔴 / 🟠 / 🟢 when AGENTS.md mandates)
- Should-fix (🟡)
- Optional (🔵 / ❓) collapsed
- Tooling (tsc / lint summaries)
- Footer

See `skills/angular-cop/output-format.md` for the exact templates.

$ARGUMENTS
