---
name: ship
description: >-
  Use when the user asks to deliver a goal end to end, autonomously, or "ship" a change through
  implementation, PR, review, CI and merge. Triggers: "/ship <goal>", "ship this", "deliver end to end",
  "autonomously". Not for a single commit or a single PR; route those to the git-specialist agent.
---

# Ship

`/ship <goal>` drives one goal from clarification to a squash-merged PR on the base branch. The goal state lives
in `.claude/state/goal.json`. In Claude Code, the Stop hook keeps the session working until the PR is merged or the
goal escalates.

The goal text is `$ARGUMENTS`.

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
3. **Plan.** Dispatch the `planner` agent. Keep the plan in the log, not in chat.
4. **Branch or worktree.** The branch MUST be named `claude/<slug>`. See lifecycle step 4 for the commands.
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
   Fix every confirmed CRITICAL and HIGH finding, push through `git-specialist`, run
   `agent-harness goal sha <sha>`, then re-run the review on the new diff. Max 3 rounds. If a CRITICAL or HIGH finding
   is still open after round 3, escalate. When the review ends, post one summary PR comment in the format of
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
    says yes. It enforces the merge rails listed in the README. Then
    `agent-harness notify done "<msg>" <pr>` and `agent-harness goal status`.

## Stop conditions

Stop and report when one of these holds. Do not loop past them.

- **Done.** The PR is merged. Run `agent-harness notify done`.
- **Escalated.** `agent-harness goal bump` exits 3 (five fix rounds used). Record the reason with
  `agent-harness goal escalate "<reason>"`, which writes the `reason` field. Run `agent-harness notify failure`,
  then stop.
- **No progress.** The Stop hook escalates after five no-progress blocks, or after 30 blocks in total. Treat it as
  escalated.
- **Security.** A gitleaks finding or a secret exposure: stop, run `security-reviewer`, rotate. Never allowlist.
- **Human-only decision.** New dependency, branch-name policy, workflow edit, or a gate rule you cannot satisfy
  from the repo. Run `agent-harness notify waiting`, then stop.
- **Merge refused.** `ship-merge` refused for a reason you cannot fix. Report the refusal reason.

## Hard limits

- Merge only through `agent-harness ship-merge`. Never `gh pr merge`, never a push to the base branch.
- Never a push to the base branch, with or without force. Never `git push --mirror` or `--all`, never `--no-verify`.
  Never a skipped or disabled test, or an edit to a workflow file. Force pushes on the PR branch are allowed.
- No worktree removal. No deny-list commands (see the autonomy rule).
- A PR that matches `protectedPaths` is refused by `ship-merge` in autonomous mode. A human merges it with `--confirmed`.
- Never add a label, post a comment, or create a status to get past a refusal. Gates read only what the host and
  the workflows wrote.
- Stop-condition notifications are the only way the run speaks outside the session. Do not notify for progress.

## Output

Report the PR URL, the goal status from `agent-harness goal status`, the iteration count, the verification output
tails, and any assumptions that the user should check. Keep it short.
