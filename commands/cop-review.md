---
description: Direct pre-merge code review of HEAD vs a target branch by code-reviewer
agent: code-reviewer
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
- `--scope=...` — limit to a subset of checklists. Comma list. Defaults to all.
- `--no-tools` — skip tooling checks and produce static review only (faster).

## Stack detection & direct skill selection

Detect the project stack in cwd, then load the applicable review skill yourself:

| Signal                                                  | Stack                | Skill to load | Tooling                                                                       |
| ------------------------------------------------------- | -------------------- | ------------- | ----------------------------------------------------------------------------- |
| `angular.json` present                                  | Angular + TypeScript | `angular-cop` | `npx tsc --noEmit` + `npm run lint`                                           |
| `*.csproj` / `*.sln` / `*.slnx` / `global.json` present | .NET                 | `dotnet-cop`  | `dotnet build --nologo -clp:ErrorsOnly` + `dotnet format --verify-no-changes` |

If BOTH are present (rare monorepo), check which language the diff files are in (`.ts`/`.html` → angular-cop skill; `.cs`/`.csproj` → dotnet-cop skill). Load both skills when the diff contains both language groups. If still ambiguous, default to angular-cop and note the ambiguity in the report header.

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
