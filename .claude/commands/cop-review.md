---
description: Pre-merge code review of HEAD vs a target branch (stack-aware: Angular+TS → angular-cop; .NET → dotnet-cop)
---

# /cop-review — Pre-Merge Review

Review the current branch against a target branch before merging. Stack-aware: `code-reviewer` loads the matching cop skill based on the detected project type. Loads `AGENTS.md` from cwd. Runs tooling checks. Emits tiered report.

## Usage

```
/cop-review <target-branch> [--level=junior|senior] [--scope=...] [--no-tools]
```

## Arguments

- `<target-branch>` (required) — the branch the PR will merge into (e.g. `main`, `develop`, `release/2026.05`).
- `--level=junior` — verbose teaching mode with rationale + doc links for every finding.
- `--level=senior` (default) — terse one-liners.
- `--scope=...` — limit to a subset of checklists. Comma list. Defaults to all; on .NET, `ddd` is auto-enabled when the diff touches domain files.
- `--no-tools` — skip tooling checks and produce static review only (faster).

## Stack detection & skill loading

Before loading a skill, detect the project stack by checking these signals in cwd (search recursively):

| Signal | Stack | Skill to load | Tooling |
|---|---|---|---|
| `angular.json` present | Angular + TypeScript | `angular-cop` | `npx tsc --noEmit` + `npm run lint` |
| `*.csproj` / `*.sln` / `*.slnx` / `global.json` present | .NET | `dotnet-cop` | `dotnet build --nologo -clp:ErrorsOnly` + `dotnet format --verify-no-changes` |

If BOTH are present (rare monorepo), check which language the diff files are in (`.ts`/`.html` → angular-cop; `.cs`/`.csproj` → dotnet-cop). If still ambiguous, default to angular-cop and note the ambiguity in the report header.

`code-reviewer` executes this command directly and loads the applicable skill(s) itself. Never route through the `angular-cop`/`dotnet-cop` agents or `conductor`.

### Domain-diff default scope (.NET)

When the .NET diff touches domain files — paths under `**/*.Domain/**`, `**/Domain/**`, or `**/Core/**` — add `ddd` to the effective scope automatically, without waiting for an explicit `--scope=ddd`. The `dotnet-cop` skill then loads `dotnet-ddd` (`review-checklist.md`) for domain-layer findings. `--scope=ddd` still forces DDD checks when no domain file is detected.

## What you do

1. Parse `$ARGUMENTS`:
   - First positional token = `target`.
   - Flags as documented above.
   - If `target` missing, print usage and stop.
2. Verify you're inside a git repo (`git rev-parse --is-inside-work-tree`).
3. Detect the project stack using the rules above.
4. **Angular stack:** Load the **angular-cop** skill (`.claude/skills/angular-cop/`). Follow its pipeline section verbatim.
   **dotnet stack:** Load the **dotnet-cop** skill (`.claude/skills/dotnet-cop/`). Follow its pipeline section verbatim.
   > CC note: Use the `Skill` tool to load `angular-cop` or `dotnet-cop` by name. `code-reviewer` executes the skill pipeline itself — do not route through their agents or `conductor`.
5. Load `AGENTS.md` from repo root if it exists.
6. Execute the pipeline (steps 1-7 in the skill / agent prompt).
7. Emit the single markdown report. No preamble. No epilogue.

## Examples

```
/cop-review main
/cop-review develop --level=junior
/cop-review release/2026.05 --scope=signals,flurryx --no-tools
/cop-review main --scope=ports-adapters,ef-core
```

## Output

The review report is saved as a static HTML file under `docs/code-review/` — one file per review.

- Path: `docs/code-review/<topic>-remediation.html` (e.g. `docs/code-review/sales-remediation.html` for a Sales bounded-context review).
- Create the `docs/code-review/` directory if it does not exist.
- Use a `<topic>` that names the branch or the area under review (kebab-case); append `-remediation` when the report tracks fixes to prior findings.
- This applies to every `/cop-review` run (.NET via `dotnet-cop`, Angular via `angular-cop`, or both).

## Output Contract

A single markdown document with:
- Header (target, base SHA, head SHA, counts table, verdict)
- Blockers (🔴 / 🟠 / 🟢 when AGENTS.md mandates)
- Should-fix (🟡)
- Optional (🔵 / ❓) collapsed
- Tooling (build / lint / format summaries)
- Footer

Angular stack: see `.claude/skills/angular-cop/output-format.md` for the exact templates.
dotnet stack: see `.claude/skills/dotnet-cop/output-format.md` for the exact templates.

$ARGUMENTS
