---
name: fix-merge-conflicts
description: Resolve merge conflicts via rebase, validate build and tests, and finalize with a backup branch. Linear history, never force-push without explicit consent.
---

# Fix merge conflicts

If the current project has `.claude/skills/fix-merge-conflicts/SKILL.md` or `.opencode/skills/fix-merge-conflicts/SKILL.md`, read it and its `references/`; project specifics override this generic version.

## Trigger

Branch has unresolved merge conflicts and needs a reliable path to a buildable state. Prefer rebase (linear history) over merge when safe.

## Hard Rules

1. **Never break behavior.** Minimal, correctness-first edits only. Preserve intent, both sides when safe.
2. **Back up first.** Create a backup branch before starting; restore from it if you abort or hit verification failures.
3. **Abort on doubt.** Any conflict about intent (not just text), verification failing twice, or data-model conflicts (EF Migrations, ORM snapshots) → `git rebase --abort`, restore backup, STOP.
4. **Stage explicit paths only.** Never `git add -A`, `.`, or `commit -a`. Always `git add -- <path> <path>` for specific files.
5. **No hooks or config changes.** Never pass `--no-verify`, never use `git rebase -i`, never edit git config or rerere settings.
6. **Push only with explicit consent.** Present the push command and await human approval; never push without it.

## Preflight

Before starting the rebase:

1. Run `git status --porcelain`. Any output → **STOP**. Commit or stash uncommitted changes first.
2. Check for in-progress merge or rebase: `git rev-parse --git-path MERGE_HEAD` and `git rev-parse --git-path rebase-merge`. If either exists, ask the human about `git merge --abort` or `git rebase --abort` to clear it.
3. Run `git fetch origin` to ensure base ref is current.
4. Determine the base: ask for the base ref (e.g., `origin/main`), or run `gh pr view --json baseRefName` to extract it from the PR.
5. Record the current HEAD SHA and upstream SHA (`@{u}`): `git rev-parse HEAD` and `git rev-parse @{u}`.

## Backup

1. Generate backup branch name: `backup/<branch-name-with-slashes-as-hyphens>-<YYYYMMDDHHMM>` (lowercase).
2. Validate against regex `^backup/[a-z0-9]+(-[a-z0-9]+)*$`.
3. Create backup: `git branch backup/<name>`. Confirm it matches the regex.

## Rebase

1. Run `git rebase origin/<base>` (no `--rebase-merges`, no `-i`).
2. If there are few commits and the conflict pattern is predictable, optionally pass `--exec "<verify-command>"` to test each replayed commit.
3. At the first conflict stop, inspect the conflicting files.

## Each Stop

During rebase conflict stops, follow this workflow for each file:

1. **List conflicts:** `git diff --name-only --diff-filter=U`.
2. **Warn about ours/theirs:** Remind that during rebase, "ours" = upstream (origin/<base>) and "theirs" = the replayed commit (the one being re-applied).
3. **Read intent:** `git show REBASE_HEAD` to see what the replayed commit intended.
4. **Minimal edit:** Edit conflicted files with the smallest, safest change. Prefer preserving both sides when the code can coexist.
5. **Regenerate lockfiles:** After resolving code conflicts, run the package manager's lockfile refresh (e.g., `npm install --package-lock-only`, `pnpm install --frozen-lockfile`, `yarn install --no-save`) for any touched package.json or dependency files.
6. **Verify:** Run compile, lint, and relevant tests on the resolved files.
7. **Stage resolved files:** `git add -- <resolved-file> <resolved-file> …`. Never use `-A` or `.`.
8. **Check for lingering markers:** `git diff --check` and `git diff HEAD` to ensure no conflict markers remain.
9. **Continue rebase:** `GIT_EDITOR=true git rebase --continue`.

### Abort Conditions

**STOP and restore backup** if:

- Data-model conflicts (EF Migrations, ORM snapshots) — high-risk; human review required.
- A conflict is about intent, not text (e.g., two branches renamed the same function differently; you cannot decide automatically).
- Verification fails twice in a row on the same stop (indication of a deeper issue).
- For SQL bootstrap/seed files: keep both rows and run the related test to verify.
- For harness JSON/JSONC: run a parse check to validate syntax.
- For ORM migration / snapshot files: STOP (data model conflicts).

When aborting: `git rebase --abort`, then confirm `git rev-parse HEAD` matches the recorded backup SHA. If needed to restore, `git reset --hard backup/<name>` **only with explicit human consent** (matches the global safety rule forbidding reset --hard without explicit ask). Report the incident and wait for human guidance.

## Finish

Once all conflicts are resolved and verification passes:

1. **Full verification gate:** Run build, lint, and full test suite on the entire rebased stack.
2. **Show the changes:** Run `git range-diff origin/<base> backup/<x> HEAD` to display how each commit's diff was preserved through the rebase.
3. **Present the push command:** `git push --force-with-lease=<branch>:<recorded @{u} sha> origin <branch>`. Show this command to the human and await explicit consent before running it.
4. **After push:** Verify with `git status` that the remote-tracking branch updated.
5. **Delete backup (on request only):** Ask the human before deleting the backup branch; if approved, run `git branch -d backup/<name>`.

## Roles

- **Orchestrator:** Drives the workflow, makes judgment calls on conflict resolution intent, decides when to abort.
- **Git-specialist:** Runs all git commands; stages and continues rebase; presents the final push command.
- **Coder:** Edits conflicted files when intent is unclear but resolvable.
- **Build-error-resolver:** Fixes broken builds or test failures discovered during verification.

In single-agent sessions, the same agent follows these same rules.

## Output

Report:
- Backup branch ref and SHA
- Base ref and SHA
- Each conflict stop: files involved, resolution decisions, verification evidence
- `git range-diff` summary showing each commit's integrity
- Final push command (awaiting human consent)
- Post-push status verification
