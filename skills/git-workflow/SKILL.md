---
name: git-workflow
description: Use this skill for any git work such as creating branches, staging changes, writing commit messages, pushing branches, or preparing pull requests. Delegates git execution to the git-specialist agent.
---

# Git Workflow Skill

Use this skill whenever the task involves git.

## When to Activate

- Creating or renaming branches
- Staging changes
- Writing commit messages
- Creating commits
- Pushing branches
- Preparing pull requests
- Reviewing branch names or commit message format

## Required Delegation

When git work is needed, delegate to the dedicated `git-specialist` subagent via the `/git` command.

- Do not handle substantive git workflow directly in the main agent when `/git` can handle it.
- Use the `git-specialist` agent for branch naming, commit message drafting, staging, commits, and pushes.
- Keep non-git implementation work in the main agent, then switch to `/git` for repository operations.
- If you are already the `git-specialist` agent, execute the git task directly and do not re-delegate it. Follow the Canonical spec section below.

## Commit Convention

Every commit message must follow this format:

```text
<type>(<scope>): <short summary>

[optional body]

[optional footer(s)]
```

When scope is not useful or not clear, this no-scope form is also valid:

```text
<type>: <short summary>
```

### Allowed Types

- `feat`: A new feature
- `fix`: A bug fix
- `docs`: Documentation only changes
- `style`: Changes that do not affect behavior, such as formatting
- `refactor`: Code changes that neither fix a bug nor add a feature
- `test`: Adding or correcting tests
- `chore`: Maintenance tasks such as tooling or build updates

### Commit Rules

- **English only**: subject and body MUST be English, even when the diff or conversation is French.
- Prefer including a meaningful `scope` when the affected area is clear
- Omit `scope` instead of inventing one when it is not clear
- Use a concise present-tense summary
- Keep the summary focused on intent, not a file-by-file changelog
- Match the type to the actual purpose of the change

### Examples

- `feat(api): add user authentication endpoint`
- `fix(auth): prevent empty login submission`
- `chore(settings): sync opencode configuration`

## Branch Convention

Every branch name must follow this format:

```text
<type>/<scope>-<short-description>
```

### Branch Rules

- Reuse the same allowed `type` values as commits
- `scope` is required for branches
- `scope` must be a single lowercase token with letters and numbers only
- The first `-` after `/` separates `scope` from `short-description`
- Use a short kebab-case description
- Keep the branch name specific to the actual change
- If branch scope is ambiguous, ask one short question before creating the branch

### Examples

- `feat/auth-login-form`
- `fix/api-token-refresh`
- `chore/settings-git-workflow`

## Git Specialist Expectations

The `git-specialist` agent must:

- inspect repository status before acting
- draft compliant branch names and commit messages
- stage only relevant changes
- avoid destructive git commands unless explicitly requested
- push only when requested or clearly part of the delegated git task
- detect the host from `git remote get-url origin` and use the matching CLI for PR work: `gh` for GitHub, `az repos pr` for Azure DevOps
- preserve repository history hygiene

## Pull Request Rules

When the task includes PR creation or inspection:

- Follow the `pr-visual-report` skill before opening or updating the PR. Run `agent-harness kpi feature` before rendering the HTML (Conductor and Monolith). Commit `docs/pr-reports/<branch-slug>.html`, `.png`, and `.metrics.json`, and include `## Visual report` plus the metrics table in the body. `agent-harness pr-report-check` checks the body and warns when metrics are missing or partial. The hook blocks `gh` and `az` when the visual section is missing. A docs typo or a version bump only may skip, with the reason on the skip line.
- detect the host from `git remote get-url origin`:
  - `github.com` → use `gh`
  - `dev.azure.com` / `visualstudio.com` → use `az repos pr` (Azure CLI + `azure-devops` extension)
  - otherwise → stop and report an unsupported host
- push the current branch with upstream tracking first if needed
- if a PR already exists for the current branch, return that URL instead of creating a duplicate
- choose the base branch from the repository default branch when available, otherwise prefer `main`, then `master`
- use a concise PR title aligned with the branch purpose and commit intent (conventional commit format)
- include a short `## Summary` section in the PR body
- Azure DevOps defaults: reviewers = group `PIXELS`; `--draft` is not supported by `az repos pr` (ignore the flag for Azure)

## Output Expectations

For git tasks, return:

- the branch name used or proposed
- the commit message used or proposed
- whether the branch was pushed
- the pull request URL when a PR exists or was created
- any blockers, such as ambiguous scope or unstaged unrelated changes

## Canonical spec

**Applies to `git-specialist` and to any agent about to run `git commit` or `git push`.** This is the canonical spec for commit cohesion and staging discipline. `git-specialist` operates against these rules and does not restate them. Other agents delegate.

## Commit Message Format

```
<type>: <description>

<optional body>
```

Types: feat, fix, refactor, docs, test, chore, perf, ci

Note: Attribution disabled globally via ~/.claude/settings.json.

## Language (mandatory)

Every commit message MUST be written in English — subject, body, and footers — regardless of
the user's language, the orchestrator's language, or the conversation language. French (or any
other non-English) commit messages are a hard violation; do not commit until rewritten.
When the user describes a change in French, translate the intent into an English summary —
never quote or transliterate the French. Conventional Commits format and the type/scope/length
rules above are unchanged. The same English requirement applies to PR titles and PR bodies.

## Precedence (mandatory)

This is the canonical spec — `git-specialist` operates against these exact rules. Do not restate the full spec elsewhere; reference this section instead.

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

The `/create-pull-request` command owns the PR body contract (`## Content` / `## QA tests` / `## Locked decisions` / `## Non-blocking follow-ups`). When that command is not used, `git-specialist` falls back to its own minimal template (short `## Summary` section) and drops empty sections. Either body also includes `## Visual report`, from the `pr-visual-report` skill. Run `agent-harness kpi feature` before that HTML. A docs typo or a version bump only may skip, with the reason stated.

In all cases:
1. Analyze full commit history (not just the latest commit)
2. Use `git diff [base-branch]...HEAD` to see all changes
3. Push with `-u` flag if new branch

## Feature Implementation Workflow

1. **Plan First**
   - Use **planner** agent to create implementation plan
   - Identify dependencies and risks
   - Break down into phases

2. **TDD Approach**
   - Use **tdd-guide** agent
   - Write tests first (RED)
   - Implement to pass tests (GREEN)
   - Refactor (IMPROVE)
   - Verify 80%+ coverage

3. **Code Review**
   - Use **code-reviewer** agent immediately after writing code
   - Address Important issues
   - Fix Nit issues when they are trivial in the same change

4. **Commit & Push**
   - Detailed commit messages
   - Follow conventional commits format

## Cursor plugin version

From plugin 0.4.1 on, a PR that touches plugin sources bumps the patch number only and adds a CHANGELOG heading for that version. `scripts/cursor-plugin/config.json` field `version` is the source of truth. The build copies it into `plugins/fmflurry-harness/.cursor-plugin/plugin.json`. `node scripts/cursor-plugin/check.mjs` requires a strictly greater version when plugin sources differ from the base branch.
