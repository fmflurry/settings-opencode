# Autonomy (mandatory)

Applies to every task. The toggle is `agent-harness autonomy on|off|status`. The state file is
`.claude/state/autonomy.on` in Claude Code, and the `ship` skill owns the workflow in both harnesses.

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
`ask` tool. If a blocker stops you, escalate with `agent-harness notify failure` and stop.

**(d) The one documented exception.** "Irreversible actions need explicit confirmation" (see
[question-handling.md](question-handling.md)) does not apply to these actions while the flag is on:

- `agent-harness ship-merge <pr>` (it still enforces its own gate)
- pushes to branches other than the base branch
- force pushes (`--force`, `--force-with-lease`, `-f`, `+refspec`) on branches other than the base branch, which are allowed
- worktree creation (`orca worktree create ...` or `git worktree add`)

These stay forbidden in every mode:

- any push to the base branch, with or without force
- `git push --mirror` and `git push --all`
- worktree removal (`git worktree remove`, `prune`, `move`, or deleting a worktree directory)
- commands on the deny list, and any merge other than `agent-harness ship-merge`
- `--no-verify`, disabling a test, or editing a workflow file
- merging a PR that matches `protectedPaths` (in `.claude/agent-harness.json`). A human merges it with `--confirmed`.

The flag does not authorise any action not listed above, and it does not authorise a merge that the gate refused.

**(e) Continue until done or escalated.** The run ends in one of two states: the goal is `done` (PR merged), or it
is escalated (`agent-harness goal bump` exits 3, the no-progress escalation fires, or a human-only decision blocks
it). Record the reason with `agent-harness goal escalate "<reason>"`. Do not end the turn early while the goal is
active and the PR is unmerged.

## OpenCode enforcement

OpenCode has no git guard hook and no stop gate. Rules (d) and (e) are enforced by this instruction and by the
merge gate in `agent-harness ship-merge`, not by a runtime hook. Keep the deny list tight, and check the branch
before every push.

## Scope

- Interactive mode (flag off): rules (a) and (b) apply. Rule (d) does not apply, so confirm each irreversible action.
- The rules here do not change the verification gate, the orchestration routing, or the comment and code rules.
  Those keep applying in both modes.
