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
- `agent-harness worktree-rm <path> --confirmed`, when the worktree is clean and its branch is merged into the default
  branch, or its upstream or pull request is merged. A squash merge counts: `gh pr view <branch> --json state` is
  `MERGED` and HEAD is that pull request's head, or the branch tip is reachable from the default branch, or the trees
  are equal. It refuses a dirty worktree, unmerged work, the main checkout, and a path that is not a worktree of the
  repo. Raw `git worktree remove` stays denied.

These stay forbidden in every mode:

- any push to the base branch, with or without force
- `git push --mirror` and `git push --all`
- raw worktree removal: `git worktree remove|prune|move`, `orca worktree rm`, and recursive deletion of a worktree directory. `agent-harness worktree-rm <path> --confirmed` is allowed only under the checks in rule (d).
- raw branch deletion: `git branch -D`, `git push --delete` or `git push origin :<ref>`, `gh api -X DELETE .../git/refs/heads/...`.
  Only `agent-harness cleanup` deletes branches.
- commands on the deny list, and any merge other than `agent-harness ship-merge`
- `--no-verify`, or weakening a check: disabling or skipping a test, job or required check, `continue-on-error`, deleting a check, lowering thresholds
- merging a PR that matches `protectedPaths` (in `.claude/agent-harness.json`). A human merges it with `--confirmed`.

The flag does not authorise any action not listed above, and it does not authorise a merge that the gate refused.

**(e) Loop until done or escalated.** The run is a loop: ship, review, fix blockers, review again, merge, repeat. Each
iteration runs implement, verify, local review, push, CI, then `agent-harness ship-merge`. A refusal or a blocker sends
the run back to fix, then local review again, then push, CI and the merge retry. The push guard denies `git push` and
`gh pr create` until `agent-harness goal review code|security pass` is recorded for the exact diff. The run ends in
one of two states: the goal is `done` (PR merged), or it is escalated. Escalate only when a human-only blocker stops
it, or when a full loop iteration makes no progress (the same blocker and the same failure as the one before). Record
the reason with `agent-harness goal escalate "<reason>"`. Do not end the turn early while the goal is active and the
PR is unmerged, except to wait on background tests or reviews: record `agent-harness goal wait "<reason>" --ttl 30m`
(at most 24h), or end the turn while a background test, review, or subagent is still running. Those stops are not
counted. The review/fix loop stops when the same findings repeat (fingerprint piped to
`agent-harness goal bump`, exit 3), with a safety ceiling of 10 rounds. Stop and tell the user the remaining findings.
Do not start another fix round.

## OpenCode enforcement

`plugins/autonomy.ts` enforces the flag at runtime:

- Blocks the `question` tool while the flag is on (rules a and c).
- Injects autonomy context into the system prompt through `experimental.chat.system.transform`, using the shared `autonomy-context.sh` hook.
- Runs `autonomy-git-guard.sh` before each bash call and denies forbidden git commands (rule d).
- On `session.idle` of a root session, runs `ship-stop-gate.sh` and passes the session id plus running child sessions. If the gate blocks, the plugin re-prompts the session with the gate's reason. OpenCode has no stop hook, so the turn ends and a new one starts. A stop during `goal wait` or a live child review is not counted. Consecutive empty stops escalate at 5. A local commit, a review verdict, a higher fix iteration, or a new PR head resets that count. Thirty counted stops still escalate. Before both verdicts pass, the reason says to finish local review, not to push.

`install.sh` deploys the three hooks to `~/.config/opencode/scripts/agent-harness/hooks/`. OpenCode-only installs also get the `~/.local/bin/agent-harness` wrapper.

## Scope

- Interactive mode (flag off): rules (a) and (b) apply. Rule (d) does not apply, so confirm each irreversible action.
- The rules here do not change the verification gate, the orchestration routing, or the comment and code rules.
  Those keep applying in both modes.
