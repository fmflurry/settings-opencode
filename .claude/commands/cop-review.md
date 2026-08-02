# /cop-review — Pre-Merge Review

Review the current branch against a target branch before merging.

## Stack-aware delegation

Detect the project stack in cwd from these signals, then delegate via `Agent` tool to the matching subagent:

| Signal                                                  | Stack                | Subagent to delegate to | Tooling                                                                       |
| ------------------------------------------------------- | -------------------- | ----------------------- | ----------------------------------------------------------------------------- |
| `angular.json` present                                  | Angular + TypeScript | `angular-cop`           | `npx tsc --noEmit` + `npm run lint`                                           |
| `*.csproj` / `*.sln` / `*.slnx` / `global.json` present | .NET                 | `dotnet-cop`            | `dotnet build --nologo -clp:ErrorsOnly` + `dotnet format --verify-no-changes` |

If BOTH are present (rare monorepo), check which language the diff files are in (`.ts`/`.html` → angular-cop; `.cs`/`.csproj` → dotnet-cop). Delegate to both subagents when the diff contains both language groups. If ambiguous, default to angular-cop and note the ambiguity in your findings.

## Usage

```
/cop-review <target-branch> [--level=junior|senior] [--scope=...] [--no-tools]
```

- `<target-branch>` (required) — the branch the PR will merge into (e.g. `main`, `develop`, `release/2026.05`).
- `--level=junior` — verbose teaching mode with rationale + doc links for every finding.
- `--level=senior` (default) — terse one-liners.
- `--scope=...` — limit to a subset of checklists. Comma list. Defaults to all.
- `--no-tools` — skip tooling checks and produce static review only (faster).

## What you do

1. Parse the arguments:
    - Extract the target branch from the first positional argument.
    - If target is missing, print usage and stop.
2. Detect the stack from the signals above.
3. Call `Agent` with `subagent_type: "angular-cop"` or `subagent_type: "dotnet-cop"` (or both for monorepos with mixed content), passing the full command arguments. The subagent owns the rest: resolve the review window, load the applicable skill(s), run tooling, and render the report.
4. Synthesis: Subagents report findings only. After they complete, synthesize and return the unified review to the user.

## Examples

```
/cop-review main
/cop-review develop --level=junior
/cop-review release/2026.05 --scope=signals,flurryx --no-tools
/cop-review main --scope=ports-adapters,ef-core
```
