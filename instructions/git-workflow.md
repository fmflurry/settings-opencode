# Git Workflow (mandatory)

**Applies to `git-specialist` and to any agent about to run `git commit` or `git push`.** This is the canonical spec for commit cohesion and staging discipline — `git-specialist` operates against these exact rules. Do not restate the full spec elsewhere in an agent prompt; reference this file instead.

## Commit Message Format

```
<type>: <description>

<optional body>
```

Types: feat, fix, refactor, docs, test, chore, perf, ci

## Language (mandatory)

Every commit message MUST be written in English — subject, body, and footers — regardless of
the user's language, the orchestrator's language, or the conversation language. French (or any
other non-English) commit messages are a hard violation; do not commit until rewritten.
When the user describes a change in French, translate the intent into an English summary —
never quote or transliterate the French. Conventional Commits format and the type/scope/length
rules above are unchanged. The same English requirement applies to PR titles and PR bodies.

## Precedence (mandatory)

Logical cohesion is the hard rule; commit size is a signal, never a blocker. A commit is one coherent logical set of changes. Size never justifies breaking a coherent set apart. When cohesion and a size number conflict, cohesion wins.

## Counting Scope

The size signal below counts only review-weight changes: application source code and application configuration.

Exempt from the count: test fixtures and test data (Bruno `.bru`, `.http`, seed files, test JSON/CSV/XML), snapshots, documentation and markdown, generated migrations, generated/scaffolded code, lock files (`package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`, `bun.lock`), binaries/assets, pure renames detected as `R100`.

## Commit Size Signal (non-blocking)

More than ~15 counted files or ~400 counted lines in a commit → look for a legal split (see Legal-Split Test below) and report the observed counted numbers. This is a signal to check for a natural split — never a reason to refuse, block, unstage, or delay a commit.

## Legal-Split Test

A split is legal only if every resulting commit has:

- (a) a distinct `type(scope)`
- (b) a one-line raison d'être that does not mention size, count, or volume

If no candidate split passes this test, commit the coherent set as a single commit and report the observed numbers. That is a normal, acceptable outcome — not a failure.

## Forbidden Split Patterns

Never produce, no matter the size pressure:

- a commit subject with `partie 1` / `partie 2`, `part 1` / `part 2`, `(1/2)`, `suite`, `bis`, or any numeric/continuation suffix
- two consecutive commits sharing the same `type(scope)` produced by cutting one coherent change in half
- a split whose only justification is fitting under a threshold

## Mandatory Pre-Commit Self-Check

Before every `git commit`, in order:

1. Run `git diff --cached --shortstat` and `git diff --cached --name-only`.
2. Apply the Counting Scope above and compare the result against the Commit Size Signal thresholds.
3. Apply the Legal-Split Test. If a legal split exists, restage into the split commits. Otherwise keep the coherent set as one commit — do not force a split to fit the numbers.
4. Report the observed counted file/line numbers for each commit, plus a one-line reason whenever a threshold was exceeded and no legal split existed.

## Disciplined Staging

- Never `git add -A`, `git add .`, `git add --all`, `git commit -a`, or `git commit -am`.
- Stage by **explicit path** only — one command per coherent group of files.
- Run `git status` before and after staging to confirm no unintended file rode along.

## Canonical Split Order (bottom-up)

When a change spans layers, split commits in this order. Each commit should stay as close to compilable as its layer allows:

1. `chore`/cross-cutting infra (project files, packages, configuration)
2. domain (entities, value objects, rules)
3. application (ports, handlers, use cases)
4. infrastructure (adapters, persistence, HTTP clients)
5. api/presentation (endpoints, DI wiring, `Program.cs`)
6. tests (or co-commit with the layer under test when doing TDD)
7. docs/ADR

## Atomicity Rules

- One commit = one `type(scope):`. If the subject needs an "and", or the body lists 3+ heterogeneous bullets, split into 2+ commits.
- Never mix a mass rename/move with a behavior change.
- Never mix docs and code in the same commit, except an ADR directly tied to the change.
- Conventional Commits, subject ≤ 50 characters, types: feat, fix, refactor, docs, test, chore, perf, ci.

## Commit Sequencing (commit-as-you-go)

- Each logical unit is committed immediately and atomically by `git-specialist`.
- When a change spans multiple logical units, `git-specialist` sequences it into multiple atomic commits itself, in compilability order (see Canonical Split Order above). No separate planning agent is involved; commit sequencing is `git-specialist`'s own job.
- Every split produced this way MUST pass the Legal-Split Test above — cohesion defines a "logical unit", not a size threshold.

## Pull Request Workflow

The `/create-pull-request` command owns the PR body contract (`## Content` / `## QA tests` / `## Locked decisions` / `## Non-blocking follow-ups`). When that command is not used, `git-specialist` falls back to its own minimal template (short `## Summary` section) and drops empty sections.

In all cases:
1. Analyze full commit history (not just the latest commit)
2. Use `git diff [base-branch]...HEAD` to see all changes
3. Push with `-u` flag if new branch

## Feature Implementation Workflow

1. **Plan First**
   - Delegate to `planner` for an implementation plan
   - Identify dependencies and risks
   - Break down into phases

2. **TDD Approach**
   - Delegate to `tdd-guide`
   - Write tests first (RED)
   - Implement to pass tests (GREEN)
   - Refactor (IMPROVE)
   - Verify 80%+ coverage

3. **Code Review**
   - Delegate to `code-reviewer` immediately after writing code
   - Address CRITICAL and HIGH issues
   - Fix MEDIUM issues when possible

4. **Commit & Push**
   - Detailed commit messages
   - Follow Conventional Commits format
