---
description: Pre-merge code review of HEAD vs a target branch (stack-aware: Angular+TS → angular-cop; .NET → dotnet-cop)
agent: code-reviewer
subtask: true
---

# /cop-review — Pre-Merge Review

Review the current branch against a target branch before merging. `code-reviewer` owns and executes this command directly. It may load the applicable `angular-cop` and/or `dotnet-cop` **skills** for review guidance, but must never route through `conductor` or delegate to another agent.

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

## Stack detection & direct skill selection

Detect the project stack in cwd, then load the applicable review skill yourself:

| Signal                                                  | Stack                | Skill to load | Tooling                                                                       |
| ------------------------------------------------------- | -------------------- | ------------- | ----------------------------------------------------------------------------- |
| `angular.json` present                                  | Angular + TypeScript | `angular-cop` | `npx tsc --noEmit` + `npm run lint`                                           |
| `*.csproj` / `*.sln` / `*.slnx` / `global.json` present | .NET                 | `dotnet-cop`  | `dotnet build --nologo -clp:ErrorsOnly` + `dotnet format --verify-no-changes` |

If BOTH are present (rare monorepo), check which language the diff files are in (`.ts`/`.html` → angular-cop skill; `.cs`/`.csproj` → dotnet-cop skill). Load both skills when the diff contains both language groups. If still ambiguous, default to angular-cop and note the ambiguity in the report header.

Review criteria, issue format, and verdict rules are documented in the `angular-cop` and `dotnet-cop` skills. Load the applicable skill(s) for authoritative guidance.

### Domain-diff default scope (.NET)

When the .NET diff touches domain files — paths under `**/*.Domain/**`, `**/Domain/**`, or `**/Core/**` — add `ddd` to the effective scope automatically, without waiting for an explicit `--scope=ddd`. The `dotnet-cop` skill then loads `dotnet-ddd` (`review-checklist.md`) for domain-layer findings. `--scope=ddd` still forces DDD checks when no domain file is detected.

## What you do

1. Parse `$ARGUMENTS`:
    - First positional token = `target`.
    - Flags as documented above.
    - If `target` missing, print usage and stop.
2. Resolve the review window yourself with `git merge-base HEAD <remote>/<target>` (fall back to the local target branch when necessary), then inspect only `BASE..HEAD`.
3. Apply the direct skill-selection rules above. Load the matching `angular-cop` and/or `dotnet-cop` skill as guidance; do not invoke their agents, `planner`, or `conductor`.
4. Run the applicable read-only tooling unless `--no-tools` is present, then render one report using the output contract below. No preamble. No epilogue.

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

Angular stack: see `skills/angular-cop/output-format.md` for the exact templates.
dotnet stack: see `skills/dotnet-cop/output-format.md` for the exact templates.

$ARGUMENTS
