---
name: dotnet-cop
description: >
  Pre-merge code review for .NET 10 Minimal API / modular monolith pull requests.
  Diffs current branch against a target branch, applies .NET-specific checklists
  (Minimal API endpoints, modular isolation, ports & adapters / hexagonal, EF Core,
  C# strictness), runs dotnet build + dotnet format --verify-no-changes, and emits
  a tiered report (verbose for juniors, terse for seniors). Auto-loads project
   AGENTS.md rules. Use when `code-reviewer` selects .NET guidance for /cop-review,
   or when the dotnet-cop specialist is explicitly invoked.
---

# dotnet-cop

Pre-merge review. Compares HEAD vs `origin/<target>`. .NET-aware. Project-aware (reads `AGENTS.md`). Tooling-aware (runs dotnet build + dotnet format --verify-no-changes).

## When to Activate

- Selected by `code-reviewer` for .NET guidance during `/cop-review`
- dotnet-cop specialist is explicitly invoked

## Inputs

| Arg | Required | Default | Meaning |
|---|---|---|---|
| `<target>` | yes | — | Target branch (e.g. `main`, `develop`, `release/x`) |
| `--level` | no | auto | `junior` (verbose teaching) or `senior` (terse). Auto = senior. |
| `--scope` | no | all | Comma list: `minimal-api,isolation,ports-adapters,ef-core,csharp` |
| `--no-tools` | no | false | Skip dotnet build + format check (static review only) |

## Hard Rules

1. **Read-only.** Never patch code. Output report only.
2. **Diff window:** `git merge-base HEAD origin/<target>`..`HEAD`. Never review changes already on target.
3. **Confidence ≥ 80%.** Skip uncertain findings. Use `❓ q:` instead of speculative `🔴 bug:`.
4. **Project rules win.** `AGENTS.md` overrides this skill. Re-read on every run; do not cache between sessions.
5. **dotnet-clean-architecture ground truth:** load [[dotnet-clean-architecture]] SKILL.md before flagging architecture code. Do not invent APIs or patterns.
6. **No fluff.** No "great work", no restating what the diff already shows.

## Pipeline

```
1. Parse args -> target, level, scope
2. git fetch <remote> <target>          (silent; --quiet)
3. base = git merge-base HEAD <remote>/<target>
4. changed = git diff --name-status base..HEAD
5. Load <repo>/AGENTS.md (if exists) -> project rules
6. For each changed file:
     - Skim full file (not just hunk) for context
     - Apply relevant sub-checklists by extension/role:
         *Module.cs / *Extensions.cs        -> modular-isolation.md
         *Endpoint.cs (Minimal API)         -> minimal-api.md
         Core/Ports/Incoming/*.cs           -> ports-adapters.md
         Core/Ports/Outgoing/*.cs           -> ports-adapters.md
         Infrastructure/Adapter/*.cs        -> ports-adapters.md
         *DbContext.cs / Migrations/**      -> ef-core.md
         *.cs (any)                         -> csharp-strict.md
7. If !--no-tools:
     - dotnet build --nologo -clp:ErrorsOnly (full project; fail fast)
     - dotnet format --verify-no-changes (capture exit code)
8. Aggregate findings -> render via output-format.md
```

## Severity

| Tag | Meaning | Action |
|---|---|---|
| 🔴 bug | broken behavior, runtime crash, data loss | BLOCK merge |
| 🟠 sec | security risk (unvalidated input, leaked secret, auth bypass) | BLOCK merge |
| 🟡 risk | works today, fragile tomorrow (N+1, missing error mapping, scope violation) | Fix before merge |
| 🟢 arch | violates project architecture / layering | Fix before merge |
| 🔵 nit | style, naming, micro-optim | Optional |
| ❓ q | genuine question | Author decides |

Promote to BLOCK if AGENTS.md flags the category as mandatory.

## Sub-pages (read on demand)

- [[dotnet-cop-minimal-api]] — endpoint mapping, route groups, ProblemDetails, FluentValidation at boundary, no business logic in endpoints
- [[dotnet-cop-modular-isolation]] — module boundaries, no direct cross-module type references, communication via contracts/registry, reflection-based module discovery
- [[dotnet-cop-ports-adapters]] — hexagonal: Core defines ports, Infrastructure implements adapters; dependency direction; no EF entities leaking into Core
- [[dotnet-cop-ef-core]] — DbContext per module/schema, migrations, AsNoTracking, N+1, query splitting, migration safety
- [[dotnet-cop-output-format]] — junior vs senior render templates
- [[dotnet-cop-enforcement]] — BLOCK vs WARN severity checklist (load always)
- [[dotnet-cop-enforcement-tooling]] — `.editorconfig`, analyzer packages, and NetArchTest templates for deterministic enforcement in target repos

## AGENTS.md Loading

Always:

```bash
test -f AGENTS.md && cat AGENTS.md
test -f .agent/AGENTS.md && cat .agent/AGENTS.md
```

Parse rule blocks. Where this skill and AGENTS.md disagree, AGENTS.md wins. Cite the AGENTS.md line in the finding: `(AGENTS.md §<section>)`.

## Output Contract

Single markdown document, sections in fixed order:

1. **Summary** — target, base SHA, head SHA, files changed, finding counts by severity.
2. **Blockers** (🔴 / 🟠 / 🟢-when-AGENTS-mandates) — sorted by severity, then file path.
3. **Should-fix** (🟡) — same sort.
4. **Optional** (🔵 / ❓) — collapsible.
5. **Tooling** — dotnet build summary, dotnet format summary.
6. **Verdict** — `APPROVE` / `APPROVE-WITH-CHANGES` / `BLOCK`.

See [[dotnet-cop-output-format]] for full templates.

## Boundaries

- Does not write code fixes. Suggestions only.
- Does not run integration or unit tests by default (delegate to `tdd-guide`).
- Does not approve PRs in GitHub/Azure. Author posts the report manually.
- Does not auto-fix formatting. Reports format violations only.
- If no diff (HEAD == base), exit early with "no changes to review".
