---
name: ship
description: >-
  Use when the user asks to deliver a goal end to end, autonomously, or "ship" a change through
  implementation, PR, review, CI and merge. Triggers: "/ship <goal>", "ship this", "deliver end to end",
  "autonomously". Not for a single commit or a single PR; route those to the git-specialist agent.
---

# Ship

`/ship <goal>` drives one goal from clarification to a merged PR (method per repo) on the base branch. The goal state lives
in `.claude/state/goal.json`. In Claude Code, the Stop hook keeps the session working until the PR is merged or the
goal escalates.

The goal text is `$ARGUMENTS`.

## The ship loop

In autonomous mode the run is a loop, not a checklist. It repeats until the PR merges:

1. **Implement.** Tests first, then code, through `tdd-guide` and `coder`.
2. **Verify.** Run the project checks yourself.
3. **Push and open the PR** (draft).
4. **Thorough local review** of the PR diff.
5. **CI.** Wait for the required checks and the optional review status. Read the review threads.
6. **Merge** with `agent-harness ship-merge`. This is the only merge path. It checks hard facts. Its refusal is input
   to the loop, not the end of the run.

Any blocker (see [Blockers](#blockers)) sends the run back to **fix**, then **review again**, then **retry the merge**.
The run ends only in one of two states: `done` (the PR is merged), or a genuine human-only blocker. A no-progress
iteration is also an escalation (see [Stop conditions](#stop-conditions)).

## Config

Read `.claude/agent-harness.json` in the target repo before stage 1. All keys are optional:
`base`, `requiredChecks`, `reviewStatus`, `reviewStatusCreator`, `verify`, `protectedPaths`.
Defaults are in the "Autonomous mode" section of this repo's README.

## Modes

| Mode | Flag | Clarify | Merge |
|---|---|---|---|
| Interactive | off | One AskUserQuestion round on load-bearing unknowns | Ask first, then run `agent-harness ship-merge <pr> --confirmed` |
| Autonomous | on (`/autonomous on`) | Skipped. Assumptions are logged and pinned in the PR | `agent-harness ship-merge <pr>` (the flag gates it) |

Check the mode with `agent-harness autonomy status`. The rules behind both modes are in the `autonomy` rule
(`.claude/rules/common/autonomy.md`).

## Stages

1. **Clarify.** Ask one dependency-safe AskUserQuestion round, with a recommended option per question.
   In autonomous mode skip it and log each assumption with `show-your-work`.
2. **Set the goal.** `agent-harness goal set "$ARGUMENTS" <criteria...>`. Criteria: PR merged to the base branch,
   every `requiredChecks` entry green, the `verify` commands green, the `reviewStatus` status successful on the head
   (when configured), zero open review threads.
2b. **Check open PRs.** Follow [open-pr-check.md](../../.claude/rules/common/open-pr-check.md) before planning or
    implementing. Record each overlapping PR's decision; a `Wait or cancel` outcome escalates.
3. **Plan.** Dispatch the `planner` agent. Keep the plan in the log, not in chat.
4. **Branch or worktree.** The branch MUST follow the branch convention `<type>/<scope>-<short-description>` from the git-workflow skill (for example `fix/ship-branch-naming`); `git-specialist` names it. See lifecycle step 4 for the commands.
   Never remove a worktree; see the worktree destruction rule (`.claude/rules/common/worktree-destruction-safety.md`).
5. **Implement.** `tdd-guide` writes the failing tests, then `coder` implements. Both get a 6-field brief per the
   brief contract rule. Commits go through `git-specialist`.
6. **Verify.** Run the verification yourself, not through a subagent's self-report. Commands are in
   [lifecycle.md](references/lifecycle.md#6-verify).
7. **Draft the PR.** Dispatch `git-specialist` to push the branch and open a draft PR with the body sections
   `## Content`, `## QA tests`, `## Locked decisions`, `## Non-blocking follow-ups`. Put every assumption under
   `## Locked decisions`. Then `agent-harness goal pr <n>`.
8. **Thorough review (local).** Still draft. Dispatch in one message, so they run in parallel, each on
   `git diff <base>...HEAD`: `code-reviewer` (correctness), `security-reviewer` (auth, secrets, input, CI,
   permissions), and the stack cop when it applies: `angular-cop` for Angular/TS, `dotnet-cop` for .NET.
   `database-reviewer` when SQL changed. Verify each finding against the code and drop the ones you cannot confirm.
   Every confirmed CRITICAL and HIGH finding is a blocker: fix it, push through `git-specialist`, run
   `agent-harness goal sha <sha>`, then review again on the new diff. There is no round cap; the no-progress rule
   below decides when to stop. When the review ends, post one summary PR comment in the format of
   [review-format.md](references/review-format.md). It is an audit trail for a human. It is not a GitHub status, and
   `ship-merge` does not read it.
9. **Mark ready.** `gh pr ready <n>`. `ship-merge` refuses drafts and never marks a PR ready, so this step is required.
10. **Wait for CI.** `gh pr checks <n> --watch`. On a failed check, use the `loop-on-ci` skill, which routes failures
    through the `fix-ci` skill. When the repo sets `reviewStatus`, also check that status on the head. On a failure,
    fix the cause, push through `git-specialist`, then `agent-harness goal sha <sha>`. Run `agent-harness goal bump`
    before each fix round.
11. **Comments.** Run the `get-pr-comments` skill to list open threads. Address each one with a fix or a reply that
    says why not, then resolve the threads you addressed. See lifecycle step 11.
12. **Merge.** Autonomous mode: `agent-harness ship-merge <pr>`. Interactive mode: add `--confirmed` after the user
    says yes. The merge method is chosen with `--method squash|rebase|merge`; without it the script uses `mergeMethod`
    from `.claude/agent-harness.json`, else the repo's first allowed method (squash, rebase, merge). It enforces the merge rails listed in the README. On a refusal, read the reason and go back to the loop (see
    [Blockers](#blockers)).
13. **Post-merge cleanup.** After a successful merge, `ship-merge` runs `agent-harness cleanup <pr>`. Read the
    `cleanup:` lines it prints (`remote`, `local`, `checkout`, `backup`, `worktree`). For an item kept for a fixable
    reason (for example a checkout switch that failed on a dirty tree), fix the cause without discarding changes, then
    run `agent-harness cleanup <pr>` once more. Never remove a worktree; cleanup only reports it. Then
    `agent-harness notify done "<msg>" <pr>` and `agent-harness goal status`.

## Blockers

A blocker is anything that stops the merge or the review from going green. Classify it, then act.

### Fixed by the agent, without asking

The agent fixes these itself, pushes, and runs the loop again. Do not notify for them.

- **Review findings.** Confirmed CRITICAL and HIGH findings from stage 8. MEDIUM findings go under
  `## Non-blocking follow-ups`.
- **Failing tests, lint or build.** Fix the diff. Never skip or disable a test to get past it.
- **CI failures caused by code or config in the repo.** This includes workflow and CI config when the cause lies
  there. Route each failure through `fix-ci`. Re-run a flaky job once with `gh run rerun <run-id> --failed`. A second
  failure is real.
- **Merge conflicts.** Rebase onto the base, resolve, then push with `git push --force-with-lease` on the PR branch.
  Never push to the base branch.
- **Branch behind base.** Update it (rebase or merge the base in), then push.
- **Unresolved threads.** Address each one, then resolve it (stage 11).
- **A `ship-merge` refusal.** Read the reason, fix the cause, retry. Never add a label, post a comment, or create a
  status to get past a refusal.

### Human-only: escalate and stop

The agent cannot resolve these. Run `agent-harness goal escalate "<reason>"`, then `agent-harness notify waiting`
(for a human action outside the session) or `agent-harness notify failure` (for an escalation), then stop.

- Missing credentials or secrets.
- Account limits or billing (for example an artifact or minutes quota).
- An external outage (the host, a registry, or a third-party service is down).
- A product decision that the repo cannot answer.
- An action on the forbidden list (see Hard limits).
- The no-progress cap is reached (see Stop conditions).

## Stop conditions

The run ends in one of two states: **done** or **escalated**. Do not stop early while the goal is active and the PR
is unmerged. Do not end the turn to wait for a fix you can make yourself.

- **Done.** The PR is merged and `agent-harness cleanup` has run (stage 13). Run `agent-harness notify done`.
- **Human-only blocker.** Escalate as described above. Stop.
- **No progress.** A full loop iteration (fix, review, CI, merge) produces no progress: the same blocker and the same
  failure as the iteration before. Escalate with `agent-harness goal escalate "<reason>"` and notify failure. A new
  failure, a new finding, or a green check counts as progress.
- **Safety stop.** The Stop hook escalates after five no-progress blocks, or after 30 blocks in total. Treat it as
  escalated. `agent-harness goal bump` exits 3 at its own safety ceiling (30 fix rounds, a backstop, not a target); treat that exit as an
  escalation too.
- **Security.** A gitleaks finding or a secret exposure: stop, run `security-reviewer`, rotate. Never allowlist.

## Hard limits

- Merge only through `agent-harness ship-merge`. Never `gh pr merge`, never a push to the base branch.
- Never a push to the base branch, with or without force. Never `git push --mirror` or `--all`, never `--no-verify`.
  Never weaken a check: disabling or skipping a test, job or required check, `continue-on-error`, deleting a check, or lowering thresholds. Force pushes on the PR branch are allowed.
- No worktree removal, including `agent-harness worktree-rm` (see the worktree destruction rule, `.claude/rules/common/worktree-destruction-safety.md`). No deny-list commands (see the autonomy rule).
- Branches are deleted only by `agent-harness cleanup`, never by raw `git branch -D`, `git push --delete`, or the API.
- A PR that matches `protectedPaths` is refused by `ship-merge` in autonomous mode. A human merges it with `--confirmed`.
- Never add a label, post a comment, or create a status to get past a refusal. Gates read only what the host and
  the workflows wrote.
- Stop-condition notifications are the only way the run speaks outside the session. Builds and releases are never
  triggered automatically. Do not notify for progress.

## Output

Report the PR URL, the goal status from `agent-harness goal status`, the loop iteration count, the verification output
tails, and any assumptions that the user should check. Report what cleanup removed or kept: the remote and local head
branch, the backups, the base checkout, and any worktree kept. Keep it short.
