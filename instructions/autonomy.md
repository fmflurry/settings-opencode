# Autonomy (mandatory)

Applies to every task. The toggle is `agent-harness autonomy on|off|status`. The state file is
`.claude/state/autonomy.on`, shared with OpenCode along with `goal.json`. The `ship` skill owns the workflow in both harnesses.

## Rules

**(a) One clarification round first.** Every task starts with one `ask` tool round on the load-bearing unknowns.
Each question is dependency-safe and comes with a recommended option. Skip the round only in autonomous mode.

**(b) Notify only when needed.** Use `agent-harness notify question|waiting|done|failure "<msg>" [pr]`.
Notify when a human's attention is needed, and when the goal ends:

- `question`: the run must stop for a human answer.
- `waiting`: a permission prompt or an idle prompt needs a human, or a human action is needed outside the session.
- `failure`: the run escalates.
- `done`: the goal is merged.

Do not notify for progress.

**(c) Autonomous mode: decide, log, never ask.** With the flag on, decide from the repo and the evidence.
Log each assumption with `show-your-work`, and pin it under `## Locked decisions` in the PR. Do not call the
`ask` tool. Fix every blocker the agent can fix (review findings, failing checks, conflicts, a stale branch,
unresolved threads, a `ship-merge` refusal) and loop. Escalate only a human-only blocker, with
`agent-harness notify failure` (or `waiting`) and stop. The `ship` skill lists both classes.

**(d) The one documented exception.** "Irreversible actions need explicit confirmation" (see
[question-handling.md](question-handling.md)) does not apply to these actions while the flag is on:

- `agent-harness ship-merge <pr>` (it still enforces its own gate)
- pushes to branches other than the base branch
- force pushes (`--force`, `--force-with-lease`, `-f`, `+refspec`) on branches other than the base branch, which are allowed
- goal worktree creation through `agent-harness ship-init` (the init step of `/ship`; `orca worktree create ...` in an Orca-managed repo)
- `agent-harness cleanup <pr> [--keep-branch]` (also run by `agent-harness ship-merge` for an unregistered PR), only after the PR is MERGED:
  deletes that PR's own head branch (remote and local) and the goal's recorded backup branches. Nothing else.
- `agent-harness teardown-merged-worktree <pr>` (run by `agent-harness ship-merge` for a registered goal), only after the PR is MERGED:
  removes the registered goal worktree of that PR, then its remote and local head branch, then its registry file. It runs
  only when every check in the worktree destruction rule passes, and it never touches the main checkout. Nothing else.

These stay forbidden in every mode:

- any push to the base branch, with or without force
- `git push --mirror` and `git push --all`
- worktree removal in any form, including `agent-harness worktree-rm` (it refuses while the flag is on). The one exception is the teardown in rule (d).
- raw branch deletion: `git branch -D`, `git push --delete` or `git push origin :<ref>`, `gh api -X DELETE .../git/refs/heads/...`.
  Only `agent-harness cleanup` deletes branches.
- commands on the deny list, and any merge other than `agent-harness ship-merge`
- `--no-verify`, or weakening a check: disabling or skipping a test, job or required check, `continue-on-error`, deleting a check, lowering thresholds
- merging a PR that matches `protectedPaths` (in `.claude/agent-harness.json`). A human merges it with `--confirmed`.

The flag does not authorise any action not listed above, and it does not authorise a merge that the gate refused.

**(e) Loop until done or escalated.** The run is a loop: ship, review, fix blockers, review again, merge, repeat. Each
iteration runs implement, verify, push, review, CI, then `agent-harness ship-merge`. A refusal or a blocker sends the
run back to fix, then review again, then retry the merge. The run ends in one of two states: the goal is `done` (PR
merged), or it is escalated. Escalate only when a human-only blocker stops it, or when a full loop iteration makes no
progress (the same blocker and the same failure as the one before). Record the reason with
`agent-harness goal escalate "<reason>"`. Do not end the turn early while the goal is active and the PR is unmerged.

## OpenCode enforcement

`plugins/autonomy.ts` enforces the flag at runtime:

- Blocks the `question` tool while the flag is on (rules a and c).
- Injects autonomy context into the system prompt through `experimental.chat.system.transform`, using the shared `autonomy-context.sh` hook.
- Runs `autonomy-git-guard.sh` before each bash call and denies forbidden git commands (rule d).
- On `session.idle` of a root session, runs `ship-stop-gate.sh`. If the gate blocks, the plugin re-prompts the session with the gate's reason. OpenCode has no stop hook, so the turn ends and a new one starts. The gate's caps escalate after 5 no-progress blocks or 30 in total.

`install.sh` deploys the three hooks to `~/.config/opencode/scripts/agent-harness/hooks/`. OpenCode-only installs also get the `~/.local/bin/agent-harness` wrapper.

## Scope

- Interactive mode (flag off): rules (a) and (b) apply. Rule (d) does not apply, so confirm each irreversible action.
- The rules here do not change the verification gate, the orchestration routing, or the comment and code rules.
  Those keep applying in both modes.
