---
name: worktree-destruction-safety
description: "Use when creating, removing, pruning, moving, or deleting a git worktree, including orca worktree and agent-harness worktree-rm."
---

# Worktree Destruction Safety (mandatory)

why-not-tooled: whether a checkout is safe to destroy depends on live git state, not a static analyzer.

A worktree directory is the **only copy** of any uncommitted work inside it. Removing one is a destructive data operation, not bookkeeping — treat it with the same caution as `rm -rf`, never like `git branch -d`.

**Boundary with [worktree-switching](worktree-switching.md):** that rule (where configured) governs *entering*, creating, and switching between worktrees. This rule governs their *destruction* — `git worktree remove`, `git worktree prune`, `git worktree move`, `orca worktree rm`, or any raw filesystem delete of a worktree directory. Read both; they do not overlap.

## Why this exists

Two incidents shaped this rule. A raw `git worktree remove --force` + `git worktree prune` run outside Orca's pipeline destroyed a worktree with no trash step, so the content was not recoverable. Later, `orca worktree rm` returned before the removal finished (`"removing": true`). Orca always runs `git worktree remove --force` internally, whatever CLI flags are passed. During that background removal, the repo's main checkout received `reset --hard` and `pull`, which destroyed an uncommitted tracked edit and an untracked file. The actor is unknown. The old checks inspected only the worktree being removed, not the other checkouts of the repo.

## Orca-managed detection (read-only, portable)

A repo is Orca-managed when either is true:

- it appears in `orca repo list`
- the target path is enumerated by `orca worktree list --json`

If the `orca` CLI is not installed or not on `PATH`, the Orca routing below does not apply — say so explicitly. The **mandatory pre-removal checks** further down apply regardless of Orca's presence; they are plain `git` and are always in scope.

## Mandatory: route worktree lifecycle through Orca when Orca-managed

Inside an Orca-managed repo, creation goes through `orca worktree create ...`. Removal goes through `agent-harness worktree-rm` (below), which routes to Orca itself.

Forbidden by default in an Orca-managed repo: raw `git worktree remove`, `git worktree prune`, `git worktree move`, a direct `orca worktree rm` call, and `rm -rf <worktree-dir>`. These bypass the checks and the trash step (`~/orca/workspaces/<repo>/.orca-worktree-trash/`).

## The only removal path: `agent-harness worktree-rm`

```bash
agent-harness worktree-rm <path>               # dry run: runs the checks, exits 3
agent-harness worktree-rm <path> --confirmed   # removes
```

The command:

- runs the pre-removal checks below and lists the target's ignored files before removing anything;
- routes the removal through Orca when the repo is Orca-managed, never with `--force` or `--run-hooks`; otherwise it runs `git worktree remove` without `--force`;
- verifies every other checkout that was dirty at start (content, file modes, index state, untracked files) and snapshots it first;
- waits for the removal to finish, then a settle window, then re-scans every other checkout;
- restores a changed checkout only if its HEAD is unchanged and it is clean.

In autonomous mode it removes the worktree only when the checks below pass, including a merged branch. With the flag off, a branch that is still ahead of `origin/<base>` is refused even when a pull request was squash-merged.

Exit codes: `0` removed and verified. `1` refused (a check STOP, or a snapshot that could not be created); the output names the reason. `2` usage error. `3` dry run (no `--confirmed`). `4` removal failed, or a changed checkout could not be restored. On `4` the snapshot refs are kept, and the output gives inspect and restore commands (`git -C <checkout> stash apply --index <ref>`, plus the diff to inspect first).

On success, each snapshot's sha is printed before its ref is released. The commit stays recoverable until `git gc` prunes it.

Timing knobs: env `AGENT_HARNESS_WORKTREE_RM_WAIT` (default 60 s) and `AGENT_HARNESS_WORKTREE_RM_SETTLE` (default 20 s). Timing and Orca overrides are honoured only in test mode. Config key `worktreeIdleMinutes` (default 60) sets the activity window for check 3.

## Mandatory pre-removal checks (any mechanism, any repo)

Run in order, before any removal — through `worktree-rm` or (per the Escape hatch) by a human:

1. `git -C <path> status --porcelain` — any output (uncommitted or untracked content) → **STOP**, surface it to the human. Never pass `--force` past this.
2. `git -C <path> rev-list --count origin/<base>..HEAD` — non-zero → **STOP**, report the exact count of commits not on the base branch.
3. `orca worktree list --json` (when Orca-managed) — a `lastActivityAt` within `worktreeIdleMinutes` → a session may be live in it → **STOP**. An activity state that cannot be read is also a **STOP** (the check fails closed).
4. Resolve the path being acted on and diff it against `git worktree list --porcelain` immediately before executing, so the agent removes the path it believes it is removing — not a stale or mistyped one.
5. Every OTHER checkout of the repo (the main checkout and sibling worktrees, from `git worktree list --porcelain`) is clean, or its uncommitted work is snapshotted first. A snapshot is a recoverable ref `refs/harness/snapshots/<ts>-<n>` that captures tracked content, file modes, index state, and untracked files.
6. The target is neither the main checkout nor the current working directory.

Any STOP means: report the finding to the human and wait. Do not reinterpret a general cleanup instruction as authorization to proceed past a STOP.

## Not covered

- **Ignored files**, in the target and in other checkouts. They are not snapshotted and not part of the post-removal scan. The script lists the target's ignored files before removing; those are at risk.
- **Untracked nested git repositories.** They are reported as a note, not snapshotted.
- **Submodule contents.** Not snapshotted and not verified.

## After removal

- Wait until the worktree is really gone, then a settle window. A `"removing": true` answer is not completion.
- Re-scan every other checkout. Any change is reported as `changed during removal`.
- Restore a changed checkout only if its HEAD is unchanged and it is clean. Otherwise exit `4`: the refs are kept and the output gives inspect and restore commands.
- On success, each snapshot's sha is printed before its ref is released.

## Guard

In every mode, not only autonomy, the harness guard denies:

- raw `orca worktree rm|remove|delete`, and `git worktree remove|prune|move`, including forms with global options or aliases;
- recursive `rm`, `mv`, `trash`, `rsync --delete`, and `find -delete` aimed at a worktree directory or its parent;
- interpreter-level `rmtree` calls.

With autonomy off, `agent-harness worktree-rm <path> --confirmed` prompts the human before it runs. With autonomy on, that exact command is allowed through and the script's checks are the boundary. Raw `git worktree remove` stays denied in every mode. `git worktree prune -n` (dry run) stays allowed.

The guard is heuristic text matching. It cannot catch a command assembled at run time, such as a path built in a variable. The script's own checks are the real boundary; the guard is a speed bump, not a safety guarantee.

## Autonomy

Autonomous mode trusts the agent to finish its work, and worktree teardown is part of that. `agent-harness worktree-rm <path> --confirmed` runs while the flag is on only when every check in this skill passes and the branch is merged:

- the path is a listed worktree of this repo, not the main checkout, and not the current directory
- `git status --porcelain` is empty
- the branch is merged into the default branch: the tip is reachable from `origin/<base>` or from the local default branch, or its tree equals that branch, or `gh pr view <branch> --json state` (or the same query for the upstream branch) reports `MERGED` and the worktree HEAD is that pull request's head

It refuses a dirty worktree, unmerged work, the main worktree, and a path that is not one of the repo's worktrees. The message names the reason. Raw `git worktree remove` stays denied. With the flag off, the command is unchanged: the git guard still asks, and a squash-merged branch that is ahead of `origin/<base>` is still refused.

## Goal worktrees

`/ship` goal worktrees are created by `agent-harness ship-init` and registered in `<git-common-dir>/agent-harness/goals/<slug>.json`. Two commands remove one:

- `agent-harness teardown-merged-worktree <pr>`, in autonomous mode, for the registered worktree of a PR that is MERGED. It also deletes that goal's branches and registry.
- `agent-harness worktree-rm <path> --confirmed` removes a clean, merged worktree, including a goal worktree, and leaves the branch and the registry in place.

Raw `git worktree remove` stays forbidden in every mode.

The teardown runs these checks, and re-runs them right before removal:

1. The PR is MERGED.
2. The worktree HEAD and the branch equal the PR head commit. This replaces the `origin/<base>..HEAD` count for goal worktrees, because a squash merge rewrites history.
3. The path is a listed, real (non-symlink) worktree, and not the main checkout.
4. The tree is clean, including untracked files (check 1 above).
5. When Orca-managed, there is no Orca activity within `worktreeIdleMinutes` (default 60). Activity that cannot be read is a STOP.
6. The ignored files are listed before removal. They are not snapshotted, and they are lost.
7. The registry file name equals the slug of the PR head branch, and the recorded path has the ship-init layout
   (`<main>-wt/<slug>`, or an Orca workspace path ending in `/<slug>` for an Orca-created goal). A registry status of
   `escalated` or `blocked` is a STOP.
8. Orca detection fails closed: a target under `*/orca/workspaces/*` in a repo Orca does not list, or an installed
   `orca` whose repo list cannot be read, is a STOP. Paths are compared after `pwd -P` on both sides.

The teardown does not touch the main checkout: no fetch, switch or pull, and a dirty main does not block it. The local
branch is deleted once the worktree is gone because it is then checked out nowhere.

The teardown never passes `--force`. With Orca, a refusal keeps the worktree and there is no git fallback. A partial result keeps the registry (status merged) and prints the rerun command. Rerunning it is the normal fix.

A blocked or escalated goal is never torn down: its worktree, branch and registry stay in place.
## Escape hatch

A human who wants a raw `git worktree` operation runs it themselves; the guard denies agents in every mode. Before running it:

- State the exact command that will run.
- State plainly that it bypasses Orca's trash and is not recoverable through Orca, and that it skips the snapshot, verification, and restore steps.

Authorization must name the operation, not just the goal. A general "clean up worktrees" instruction is not a go-ahead.

## Anti-patterns

- Running `git worktree remove --force` (or `rm -rf`) on an Orca-managed repo because it's faster than the CLI.
- Treating `orca worktree rm` as finished when it returns. Its return does not mean the removal completed.
- Treating a clean `git worktree list` as proof the directory is safe to delete — it doesn't tell you about uncommitted content or live activity.
- Checking only the worktree being removed. Other checkouts of the repo can change during removal.
- Treating the guard as the safety boundary. It matches text; the script's checks are the boundary.
- Proceeding past a `git status --porcelain` non-empty result because the caller "just wants it gone."
- Authorizing raw git worktree ops from an inferred "clean everything up" brief instead of a named command.
