# Worktree Destruction Safety (mandatory)

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

- runs the pre-removal checks below;
- routes the removal through Orca when the repo is Orca-managed, never with `--force` or `--run-hooks`; otherwise it runs `git worktree remove` without `--force`;
- waits for the removal to finish, verifies every checkout, and restores any damage from its snapshot.

It refuses while autonomy is on.

Exit codes: `0` removed and verified. `1` refused (autonomy on, a check STOP, or a snapshot that could not be created); the output names the reason. `2` usage error. `3` dry run (no `--confirmed`). `4` removal failed, or damage could not be restored. On `4`, the snapshot refs are kept and printed with a `git -C <checkout> stash apply --index <ref>` command.

Timing knobs: env `AGENT_HARNESS_WORKTREE_RM_WAIT` (default 60 s) and `AGENT_HARNESS_WORKTREE_RM_SETTLE` (default 20 s). Config key `worktreeIdleMinutes` (default 60) sets the activity window for check 3.

## Mandatory pre-removal checks (any mechanism, any repo)

Run in order, before any removal — through `worktree-rm` or (per the Escape hatch) raw:

1. `git -C <path> status --porcelain` — any output (uncommitted or untracked content) → **STOP**, surface it to the human. Never pass `--force` past this.
2. `git -C <path> rev-list --count origin/<base>..HEAD` — non-zero → **STOP**, report the exact count of commits not on the base branch.
3. `orca worktree list --json` (when Orca-managed) — a `lastActivityAt` within `worktreeIdleMinutes` → a session may be live in it → **STOP**.
4. Resolve the path being acted on and diff it against `git worktree list --porcelain` immediately before executing, so the agent removes the path it believes it is removing — not a stale or mistyped one.
5. Every OTHER checkout of the repo (the main checkout and sibling worktrees, from `git worktree list --porcelain`) is clean, or its uncommitted work is snapshotted first. A snapshot is a recoverable ref `refs/harness/snapshots/<ts>-<n>` that includes untracked files. Ignored files are NOT covered by a snapshot; they stay at risk.
6. The target is neither the main checkout nor the current working directory.

Any STOP means: report the finding to the human and wait. Do not reinterpret a general cleanup instruction as authorization to proceed past a STOP.

## After removal

- Wait until the worktree is really gone, then a settle window. A `"removing": true` answer is not completion.
- Verify each other checkout (check 5 again). If one changed, restore it from its snapshot.
- Never leave a snapshot unreported. A snapshot that was not restored is printed with its ref and the restore command.

## Guard

In every mode, not only autonomy, the harness guard denies raw `orca worktree rm`, `git worktree remove|prune|move`, and `rm -r` on a worktree directory. `agent-harness worktree-rm <path> --confirmed` prompts the human before it runs.

## Autonomy

Worktree removal stays forbidden in autonomous mode (see the autonomy rule). `worktree-rm` refuses while the flag is on.

## Escape hatch

A human may explicitly authorise a raw `git worktree` operation instead of `worktree-rm`. When they do:

- State the exact command that will run.
- State plainly that it bypasses Orca's trash and is not recoverable through Orca, and that it skips the snapshot and restore steps.
- Get an explicit OK to that specific command. Never infer this from a general "clean up worktrees" instruction — the authorization must name the operation, not just the goal.

## Anti-patterns

- Running `git worktree remove --force` (or `rm -rf`) on an Orca-managed repo because it's faster than the CLI.
- Treating `orca worktree rm` as finished when it returns. Its return does not mean the removal completed.
- Treating a clean `git worktree list` as proof the directory is safe to delete — it doesn't tell you about uncommitted content or live activity.
- Checking only the worktree being removed. Other checkouts of the repo can change during removal.
- Proceeding past a `git status --porcelain` non-empty result because the caller "just wants it gone."
- Authorizing raw git worktree ops from an inferred "clean everything up" brief instead of a named command.
