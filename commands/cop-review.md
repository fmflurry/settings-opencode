---
description: Pre-merge code review of HEAD vs a target branch (stack-aware: Angular+TS → angular-cop; .NET → dotnet-cop)
agent: code-reviewer
subtask: true
---

# /cop-review — Pre-Merge Review

Review the current branch against a target branch before merging. Stack-aware: routes to the correct cop agent based on the detected project type. Loads `AGENTS.md` from cwd. Runs tooling checks. Emits tiered report.

## Usage

```
/cop-review <target-branch> [--level=junior|senior] [--scope=...] [--no-tools]
```

## Arguments

- `<target-branch>` (required) — the branch the PR will merge into (e.g. `main`, `develop`, `release/2026.05`).
- `--level=junior` — verbose teaching mode with rationale + doc links for every finding.
- `--level=senior` (default) — terse one-liners.
- `--scope=...` — limit to a subset of checklists. Comma list. Defaults to all.
- `--no-tools` — skip tooling checks and produce static review only (faster).

## Stack detection & routing

Before loading a skill, detect the project stack by checking these signals in cwd (search recursively):

| Signal                                                  | Stack                | Agent         | Tooling                                                                       |
| ------------------------------------------------------- | -------------------- | ------------- | ----------------------------------------------------------------------------- |
| `angular.json` present                                  | Angular + TypeScript | `angular-cop` | `npx tsc --noEmit` + `npm run lint`                                           |
| `*.csproj` / `*.sln` / `*.slnx` / `global.json` present | .NET                 | `dotnet-cop`  | `dotnet build --nologo -clp:ErrorsOnly` + `dotnet format --verify-no-changes` |

If BOTH are present (rare monorepo), check which language the diff files are in (`.ts`/`.html` → angular-cop; `.cs`/`.csproj` → dotnet-cop). If still ambiguous, default to angular-cop and note the ambiguity in the report header.

## Review Criteria

Review code across these categories:

### Security Issues (CRITICAL)
- [ ] Hardcoded credentials, API keys, tokens
- [ ] SQL injection vulnerabilities
- [ ] XSS vulnerabilities
- [ ] Missing input validation
- [ ] Insecure dependencies
- [ ] Path traversal risks
- [ ] Authentication/authorization flaws

### Code Quality (HIGH)
- [ ] Functions > 50 lines
- [ ] Files > 800 lines
- [ ] Nesting depth > 4 levels
- [ ] Missing error handling
- [ ] console.log statements
- [ ] TODO/FIXME comments
- [ ] Missing JSDoc for public APIs

### Best Practices (MEDIUM)
- [ ] Mutation patterns (use immutable instead)
- [ ] Unnecessary complexity
- [ ] Missing tests for new code
- [ ] Accessibility issues (a11y)
- [ ] Performance concerns

### Style (LOW)
- [ ] Inconsistent naming
- [ ] Missing type annotations
- [ ] Formatting issues

## Issue Report Format

For each issue found:

```
**[SEVERITY]** file.ts:123
Issue: [Description]
Fix: [How to fix]
```

## Verdict Rules

- **CRITICAL or HIGH issues**: Block commit, require fixes
- **MEDIUM issues**: Recommend fixes before merge
- **LOW issues**: Optional improvements

**IMPORTANT**: Never approve code with security vulnerabilities!

## What you do

1. Parse `$ARGUMENTS`:
   - First positional token = `target`.
   - Flags as documented above.
   - If `target` missing, print usage and stop.
2. Verify you're inside a git repo (`git rev-parse --is-inside-work-tree`).
3. Detect the project stack using the rules above.
4. **Angular stack:** Load the **angular-cop** skill at `skills/angular-cop/SKILL.md`. Follow its pipeline section verbatim.
   **dotnet stack:** Load the **dotnet-cop** skill at `skills/dotnet-cop/SKILL.md`. Follow its pipeline section verbatim.
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
