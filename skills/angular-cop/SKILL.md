---
name: angular-cop
description: >
  Pre-merge code review for Angular + TypeScript pull requests. Diffs current branch
  against a target branch, applies Angular-specific checklists (signals, RxJS, clean
  architecture, flurryx, TS strict), runs lint + tsc, and emits a tiered report
  (verbose for juniors, terse for seniors). Auto-loads project AGENTS.md rules.
  Use when user runs /cop-review, says "pre-merge review", "review before merging",
  "check my PR against <branch>", or invokes the angular-cop agent.
---

# angular-cop

Pre-merge review. Compares HEAD vs `origin/<target>`. Angular-aware. Project-aware (reads `AGENTS.md`). Tooling-aware (runs lint + tsc).

## When to Activate

- `/cop-review <target>` slash command
- User asks for review before merging a PR
- User specifies a target branch and wants a diff review
- angular-cop agent is invoked

## Inputs

| Arg | Required | Default | Meaning |
|---|---|---|---|
| `<target>` | yes | — | Target branch (e.g. `main`, `develop`, `release/x`) |
| `--level` | no | auto | `junior` (verbose teaching) or `senior` (terse). Auto = senior. |
| `--scope` | no | all | Comma list: `signals,rxjs,arch,flurryx,ts,a11y` |
| `--no-tools` | no | false | Skip lint + tsc (static review only) |

## Hard Rules

1. **Read-only.** Never patch code. Output report only.
2. **Diff window:** `git merge-base HEAD origin/<target>`..`HEAD`. Never review changes already on target.
3. **Confidence ≥ 80%.** Skip uncertain findings. Use `❓ q:` instead of speculative `🔴 bug:`.
4. **Project rules win.** `AGENTS.md` overrides this skill. Re-read on every run; do not cache between sessions.
5. **flurryx ground truth:** load the [[flurryx]] skill before flagging state-management code. Do not invent APIs.
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
          *.component.ts / *.html  -> signals.md, rxjs.md, clean-architecture.md, a11y
         *.facade.ts / *.store.ts -> flurryx.md, clean-architecture.md
         *.adapter.ts / *.port.ts -> clean-architecture.md
         *.ts                     -> typescript-strict.md
7. If !--no-tools:
     - npm run lint -- --quiet (or eslint --quiet) on changed files
     - npx tsc --noEmit (full project; abort early on first 50 errors)
8. Aggregate findings -> render via output-format.md
```

## Severity

| Tag | Meaning | Action |
|---|---|---|
| 🔴 bug | broken behavior, runtime crash, data loss | BLOCK merge |
| 🟠 sec | security risk (XSS, leaked secret, auth bypass) | BLOCK merge |
| 🟡 risk | works today, fragile tomorrow (leak, race, missing teardown) | Fix before merge |
| 🟢 arch | violates project architecture / layering | Fix before merge |
| 🔵 nit | style, naming, micro-optim | Optional |
| ❓ q | genuine question | Author decides |

Promote to BLOCK if AGENTS.md flags the category as mandatory.

## Sub-pages (read on demand)

- [[angular-cop-enforcement]] — BLOCK vs warn severity checklist (load always)
- [[angular-cop-enforcement-tooling]] — ESLint flat config + architecture plugins for app repos
- [[angular-cop-signals]] — Angular signals, change detection, OnPush, computed, no-method-in-template
- [[angular-cop-rxjs]] — RxJS hygiene, takeUntilDestroyed, async pipe, leak patterns
- [[angular-cop-clean-architecture]] — facade / use-case / port / adapter / store boundaries
- [[angular-cop-flurryx]] — flurryx-specific rules (decorator order, keyed stores, no manual Record updates)
- [[angular-cop-typescript-strict]] — no `any`, immutability, narrowing, no `!`, readonly
- [[angular-cop-output-format]] — junior vs senior render templates

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
5. **Tooling** — lint summary, tsc summary, test status if available.
6. **Verdict** — `APPROVE` / `APPROVE-WITH-CHANGES` / `BLOCK`.

See [[angular-cop-output-format]] for full templates.

## Boundaries

- Does not write code fixes. Suggestions only.
- Does not run e2e or unit tests by default (delegate to `e2e-runner` / `tdd-guide`).
- Does not approve PRs in GitHub/Azure. Author posts the report manually.
- Does not auto-fix lint. Reports counts only.
- If no diff (HEAD == base), exit early with "no changes to review".
