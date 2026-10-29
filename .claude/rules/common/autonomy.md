# Autonomy (mandatory)

Applies to every task. The toggle is `agent-harness autonomy on|off|status`. The state file is
`.claude/state/autonomy.on`. The workflow is in the `ship` skill.

## Rules

**(a) One clarification round first.** Every task starts with one AskUserQuestion round on the load-bearing unknowns.
Each question is dependency-safe and comes with a recommended option. Skip the round only in autonomous mode.

**(b) Notify only when needed.** Use `agent-harness notify question|waiting|done|failure "<msg>" [pr]`.
Notify when a human's attention is needed, and when the goal ends:

- `question`: the run must stop for a human answer.
- `waiting`: a permission prompt or an idle prompt needs a human, or a human action is needed outside the session.
- `failure`: the run escalates.
- `done`: the goal is merged.

Do not notify for progress.

**(c) Autonomous mode: decide, log, never ask.** With the flag on, decide from the repo and the evidence.
Log each assumption with `show-your-work`, and pin it under `## Locked decisions` in the PR. Do not call
AskUserQuestion. Fix every blocker the agent can fix (review findings, failing checks, conflicts, a stale branch,
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
- worktree removal in any form, including `agent-harness worktree-rm` (it refuses while the flag is on), per the worktree
  destruction rule (the `worktree-destruction-safety` skill). The one exception is the teardown in rule (d).
- raw branch deletion: `git branch -D`, `git push --delete` or `git push origin :<ref>`, `gh api -X DELETE .../git/refs/heads/...`.
  Only `agent-harness cleanup` deletes branches.
- commands on the deny list in `.claude/settings.json`, and the Bash commands the git guard hook denies (merges
  other than `agent-harness ship-merge`, pushes to the base branch, `reset --hard`, `branch -D`, shell writes to
  the harness paths)
- `--no-verify`, or weakening a check: disabling or skipping a test, job or required check, `continue-on-error`, deleting a check, lowering thresholds
- merging a PR that matches `protectedPaths` (in `.claude/agent-harness.json`). A human merges it with `--confirmed`.

The flag does not authorise any action not listed above, and it does not authorise a merge that the gate refused.

**(e) Loop until done or escalated.** The run is a loop: ship, review, fix blockers, review again, merge, repeat. Each
iteration runs implement, verify, local review, push, CI, then `agent-harness ship-merge`. A refusal or a blocker sends
the run back to fix, then local review again, then push, CI and the merge retry. The push guard denies `git push` and
`gh pr create` until `agent-harness goal review code|security pass` is recorded for the exact diff. The run ends in
one of two states: the goal is `done` (PR merged), or it is escalated. Escalate only when a human-only blocker stops
it, or when a full loop iteration makes no progress (the same blocker and the same failure as the one before). Record
the reason with `agent-harness goal escalate "<reason>"`. The Stop hook (`ship-stop-gate`) blocks an early stop while
the goal is active and the PR is unmerged. Five consecutive empty stops escalate. A local commit, a review verdict, a
higher fix iteration, or a new PR head resets that count. Thirty counted stops still escalate. A stop is not counted
during `agent-harness goal wait "<reason>" --ttl 30m` (at most 24h), or while a background test, review, or subagent is
still running. Before both verdicts pass, the block says to finish local review, not to push. The hook fails open when
the host cannot be read. The review/fix loop stops when the same findings repeat (fingerprint piped to
`agent-harness goal bump`, exit 3), with a safety ceiling of 10 rounds. Stop and tell the user the remaining findings.
Do not start another fix round. Do not work around the loop by ending the turn, except while that wait is active or
while that background work is still running.

## Scope

- Interactive mode (flag off): rules (a) and (b) apply. Rule (d) does not apply, so confirm each irreversible action.
- The rules here do not change the verification gate, the orchestration routing, or the comment and code rules.
  Those keep applying in both modes.
