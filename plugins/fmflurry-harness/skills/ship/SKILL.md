---
name: ship
description: >-
  Use when the user asks to deliver a goal end to end, autonomously, or "ship" a change through
  implementation, PR, review, CI and merge. Triggers: "/ship <goal>", "ship this", "deliver end to end",
  "autonomously". Not for a single commit or a single PR. If the `git-specialist` agent is installed, route those to that agent. Otherwise the main agent loads the `git-workflow` skill and does the commit or PR inline.
---

# Ship

`/ship <goal>` drives one goal from init to a merged PR (method per repo) on the base branch. Each goal gets its own
worktree and branch. The goal registry is local and untracked: `<git-common-dir>/agent-harness/goals/<slug>.json`, one
file per goal, and it survives the worktree. `<slug>` is the registry file name that `ship-init` prints as `slug=<slug>`.
There is one state location: the main checkout (`<main>/.claude/state`, holding `goal.json` and `autonomy.on`). Every
script and hook resolves it from the first entry of `git worktree list`, so running from the main checkout or from inside
the worktree gives the same result. `goal.json` carries `branch` and `slug`, and the registry mirror is keyed on them. In Claude Code, the Stop hook keeps the session working until the PR is
merged or the goal escalates.

The goal text is `$ARGUMENTS`.

## Goal worktree lifecycle

The main checkout is never used for goal work.

1. **Init (first action).** `agent-harness ship-init <type> <scope> <desc> --goal "<text>"` creates a dedicated
   worktree and branch from the latest `origin/<base>`, then registers `{v, goal, slug, branch, path, base, via, pr, head_oid, status,
   reason, report, created_at}` and writes `branch`, `slug` and `base` into `goal.json`. It prints the worktree path on stdout and
   `slug=<slug>` on stderr. Resume an existing PR with `agent-harness ship-init --adopt <pr>`; if that PR is still a
   draft, run `gh pr ready <pr>` before `ship-merge`, which refuses drafts.
2. **Cycle.** Implement, verify, local review, local fix loop, push and open the PR, CI, merge.
3. **Report before merge.** Render the outcome show-me summary into the worktree at `docs/agent-reports/`, commit it in
   the PR, and embed it in the PR body. Do this on the success path and on the blocked path. The visual report required
   when the PR is opened lives at `docs/pr-reports/` and is a different file.
4. **Merged.** `agent-harness ship-merge <pr>` merges, then runs `agent-harness teardown-merged-worktree <pr>` for a
   registered goal.
5. **Blocked or escalated.** Never tear down unless the PR is merged. Keep the worktree, the branch and the registry.

Rules for the orchestrator:

- Do not `cd` in the orchestrator's persistent shell. Use `git -C <wt> ...` or absolute paths.
- Every subagent brief names the worktree path, with absolute paths, and every FILES entry lives under that path.

## The ship loop

In autonomous mode the run is a loop, not a checklist. It repeats until the PR merges:

1. **Implement.** Tests first, then code, inside the goal worktree. If `tdd-guide` is installed, dispatch to that agent for the tests. If `coder` is installed, dispatch to that agent for the code. Otherwise the main agent loads the `tdd` and `coder` skills and does the work inline.
2. **Verify.** Run the project checks yourself.
3. **Thorough local review** of the diff (`code-reviewer`, `security-reviewer`, the stack cop, `database-reviewer` when
   SQL changed). Record each verdict with `agent-harness goal review code|security pass|fail`.
4. **Local fix loop.** Fix confirmed findings, re-run the checks, review again, until both verdicts pass.
5. **Push and open the PR** (ready, not draft). The push guard denies a push or `gh pr create` without both passing
   verdicts for the exact diff.
6. **CI.** Wait for the required checks and the optional review status. Read the review threads. Failing checks go
   through `loop-on-ci` and `fix-ci`; comments are addressed one by one.
7. **Merge** with `agent-harness ship-merge`, then teardown. This is the only merge path. It checks hard facts. Its
   refusal is input to the loop, not the end of the run.

Any blocker (see [Blockers](#blockers)) sends the run back to **fix**, then **review again locally**, then **push**,
then **CI again**, then **retry the merge**. A CI or comment fix is never pushed unreviewed.
The run ends only in one of two states: `done` (the PR is merged and torn down), or escalated (a human-only blocker or
the no-progress rule, see [Stop conditions](#stop-conditions)).

## Config

Read `.claude/agent-harness.json` in the target repo before stage 1. All keys are optional:
`base`, `requiredChecks`, `reviewStatus`, `reviewStatusCreator`, `verify`, `protectedPaths`, `mergeMethod`,
`worktreeIdleMinutes`.
Defaults are in the "Autonomous mode" section of this repo's README.
When the repo has an `.envrc` and `direnv` is installed, harness `gh` calls take their environment from it (the `gh` binary stays pinned). An approved `.envrc` and the files it sources (`.envrc.local`, `.env`) are trusted: autonomy denies writes to `.envrc` and `direnv allow|permit|grant|edit`.

## Modes

| Mode | Flag | Clarify | Merge |
|---|---|---|---|
| Interactive | off | One AskUserQuestion round on load-bearing unknowns | Ask first, then run `agent-harness ship-merge <pr> --confirmed` |
| Autonomous | on (`/autonomous on`) | Skipped. Assumptions are logged and pinned in the PR | `agent-harness ship-merge <pr>` (the flag gates it) |

Check the mode with `agent-harness autonomy status`. The rules behind both modes are in the `autonomy` rule
(`.claude/rules/common/autonomy.md`).

## Stages

0. **Init.** The first action of the run. `agent-harness ship-init <type> <scope> <desc> --goal "$ARGUMENTS"`, or
   `--adopt <pr>` to resume. It creates the goal worktree and registers it. Details in
   [lifecycle.md](references/lifecycle.md#0-init).
1. **Clarify.** Ask one dependency-safe AskUserQuestion round, with a recommended option per question.
   In autonomous mode skip it and log each assumption with `show-your-work`.
2. **Set the goal.** `agent-harness goal set "$ARGUMENTS" <criteria...>`. Criteria: PR merged to the base branch,
   every `requiredChecks` entry green, the `verify` commands green, the `reviewStatus` status successful on the head
   (when configured), zero open review threads.
2b. **Check open PRs.** Follow the `open-pr-check` skill (`skills/open-pr-check/SKILL.md`) before planning or
    implementing. Record each overlapping PR's decision; a `Wait or cancel` outcome escalates.
3. **Plan.** If the `planner` agent is installed, dispatch to that agent with the goal worktree path. Otherwise the main agent loads the `planner` skill and writes the plan inline. Keep the plan in the log, not in chat.
4. **Implement.** If `tdd-guide` is installed, dispatch to that agent to write the failing tests. Otherwise the main agent loads the `tdd` skill and writes them inline. If `coder` is installed, dispatch to that agent to implement. Otherwise the main agent loads the `coder` skill and implements inline. Both passes get a 6-field brief per the
   brief contract rule, and the FILES paths sit under the goal worktree. If `git-specialist` is installed, commits go through that agent. Otherwise the main agent loads the `git-workflow` skill and commits inline.
5. **Verify.** Run the verification yourself with `git -C <wt>` or in the worktree, not through a subagent's
   self-report. Commands are in [lifecycle.md](references/lifecycle.md#5-verify).
5b. **Visual report.** After verify, follow the `pr-visual-report` skill. Commit `docs/pr-reports/<branch-slug>.html`
   and `.png` in the worktree before the local review, so the review diff includes them. A later edit of those files
   needs a new review. This is separate from the outcome PNG in `docs/agent-reports/`.
6. **Thorough review and fix (local).** Nothing is pushed yet. Dispatch in one message, so they run in parallel, each
   on `git diff <base>...HEAD`: `code-reviewer` (correctness), `security-reviewer` (auth, secrets, input, CI,
   permissions), and the stack cop when it applies. If `angular-cop` is installed, dispatch to that agent for Angular/TS. Otherwise dispatch to `cop` when that agent is installed (it loads the `angular-cop` skill). If `dotnet-cop` is installed, dispatch to that agent for .NET. Otherwise dispatch to `cop` when that agent is installed (it loads the `dotnet-cop` skill). If neither cop agent is installed, the main agent loads the matching skill and reviews inline.
   `database-reviewer` when SQL changed. Verify each finding against the code and drop the ones you cannot confirm.
   Record each verdict with `agent-harness goal review code pass|fail` and `agent-harness goal review security pass|fail`.
   Every confirmed Important finding is a blocker: fix it locally, re-run the local checks, then review again on the
   new diff. Nit and Pre-existing findings do not block. The tag rules are in the code-reviewer agent (Finding tags).
   Before each fix round pipe the confirmed findings (`<reviewer>:<path>` or `ci:<check>`, one per line) to
   `agent-harness goal bump`. It stops the run (exit 3, goal escalated) when the same findings come back after a fix
   round, or at the safety ceiling of 10 rounds. Tell the user the remaining confirmed Important findings and do not
   start another fix round. The push guard denies `git push` and `gh pr create` while the active goal has no passing
   code and security review for the exact diff being pushed. Any change to that diff, including a rebase conflict
   resolution, needs a new review. A commit that touches only `docs/agent-reports/` does not. A commit that touches
   `docs/pr-reports/` does.
7. **Push and open the PR.** If `git-specialist` is installed, dispatch to that agent to push the branch and open the PR, ready (not draft), with the
   body sections `## Content`, `## QA tests`, `## Locked decisions`, `## Non-blocking follow-ups`, and `## Visual report`.
   Put every assumption under `## Locked decisions`. Run `agent-harness pr-report-check --body-file` on the body file.
   Then `agent-harness goal pr <n>` and `agent-harness goal sha <sha>`. Right
   after `gh pr create`, post the review summary comment in the format of
   [review-format.md](references/review-format.md). It is an audit trail for a human. It is not a GitHub status, and
   `ship-merge` does not read it.
8. **Re-review before every later push.** The review gate applies to each push after the PR exists. Every CI or comment
   fix is: fix locally, re-run the local checks, review the new diff locally (the reviewers may review only
   `git diff <last-reviewed-sha>..HEAD`) and record `agent-harness goal review code|security pass`, then push, then CI
   again, then retry `ship-merge`. The report commit (stage 11) is exempt: it changes only `docs/agent-reports/`.
   Refreshing `docs/pr-reports/` is not exempt. When the diff the visual report describes has changed, refresh that
   report in the fix commit before the re-review.
9. **Wait for CI.** `gh pr checks <n> --watch`. On a failed check, use the `loop-on-ci` skill, which routes failures
   through the `fix-ci` skill. When the repo sets `reviewStatus`, also check that status on the head. On a failure,
   fix the cause, re-review (stage 8), then push. If `git-specialist` is installed, dispatch to that agent for the push. Otherwise the main agent loads the `git-workflow` skill and pushes inline. Then `agent-harness goal sha <sha>`. Pipe the
   failing checks (`ci:<check>`) to `agent-harness goal bump` before each fix round. Exit 3 means the same failures
   repeated or the ceiling is hit: stop and tell the user the remaining findings.
10. **Comments.** Run the `get-pr-comments` skill to list open threads. Address each one with a fix or a reply that
    says why not, then resolve the threads you addressed. See lifecycle step 10.
11. **Report.** Generate the show-me HTML, render it with `agent-harness report <slug|branch> <html>` into the worktree at
    `docs/agent-reports/<yyyy-mm-dd>-<slug>.png`, commit it in the PR, and embed it in the PR body with a commit-SHA
    permalink (`blob/<sha>/...?raw=true`), so it survives branch deletion. Push, then
    `agent-harness goal sha <sha>`, then wait for CI on the new head. Details in
    [lifecycle.md](references/lifecycle.md#11-report).
12. **Merge.** Autonomous mode: `agent-harness ship-merge <pr>`. Interactive mode: add `--confirmed` after the user
    says yes. The merge method is chosen with `--method squash|rebase|merge`; without it the script uses `mergeMethod`
    from `.claude/agent-harness.json`, else the repo's first allowed method (squash, rebase, merge). It enforces the
    merge rails listed in the README. On a refusal, read the reason and go back to the loop (see
    [Blockers](#blockers)).
13. **Teardown.** After a successful merge, `ship-merge` runs `agent-harness teardown-merged-worktree <pr>` for a
    registered goal (plain `agent-harness cleanup <pr>` for an unregistered PR). Read the lines it prints. For an item
    kept for a fixable reason, fix the cause, then rerun the printed command. Rerunning is the normal fix, not an
    escalation. Then post the outcome comment (see [Final report](#final-report)), open the show-me HTML locally,
    run `agent-harness notify done "<msg>" <pr>`, and `agent-harness goal status`.

## Blockers

A blocker is anything that stops the merge or the review from going green. Classify it, then act.

### Fixed by the agent, without asking

The agent fixes these itself, pushes, and runs the loop again. Do not notify for them.

- **Review findings.** Confirmed Important findings from stage 6. Nit and Pre-existing findings go under
  `## Non-blocking follow-ups`. Pre-existing findings never block.
- **Failing tests, lint or build.** Fix the diff. Never skip or disable a test to get past it.
- **CI failures caused by code or config in the repo.** This includes workflow and CI config when the cause lies
  there. Route each failure through `fix-ci`. Re-run a flaky job once with `gh run rerun <run-id> --failed`. A second
  failure is real.
- **Merge conflicts.** Rebase onto the base, resolve, then push with `git push --force-with-lease` on the PR branch.
  Never push to the base branch.
- **Branch behind base.** Update it (rebase or merge the base in), then push.
- **Unresolved threads.** Address each one, then resolve it (stage 10).
- **A `ship-merge` refusal.** Read the reason, fix the cause, retry. Never add a label, post a comment, or create a
  status to get past a refusal.
- **A teardown partial result.** Rerun `agent-harness teardown-merged-worktree <pr>` (the printed command).

### Human-only: escalate and stop

The agent cannot resolve these. Run `agent-harness goal escalate "<reason>"`, then `agent-harness notify waiting`
(for a human action outside the session) or `agent-harness notify failure` (for an escalation). Then follow the
blocked path in [Stop conditions](#stop-conditions), and stop.

- Missing credentials or secrets.
- Account limits or billing (for example an artifact or minutes quota).
- An external outage (the host, a registry, or a third-party service is down).
- A product decision that the repo cannot answer.
- An action on the forbidden list (see Hard limits).
- The no-progress cap is reached (see Stop conditions).
- The same findings repeat after a fix round, or the safety ceiling of 10 rounds is reached. Tell the user the remaining Important findings (see Stop conditions).

## Stop conditions

The run ends in one of two states: **done** (merged and torn down) or **escalated**. Do not stop early while the goal is
active and the PR is unmerged. Do not end the turn to wait for a fix you can make yourself.

- **Done.** The PR is merged, `agent-harness teardown-merged-worktree` has run (stage 13), and `agent-harness notify done`
  has been sent. The worktree, branch and registry are gone, unless teardown printed a partial result, which is kept
  until the rerun succeeds.
- **Human-only blocker.** Escalate as described above, then the blocked path. Stop.
- **No progress.** A full loop iteration (fix, review, CI, merge) produces no progress: the same Important finding and the same
  failure as the iteration before. The same non-review blocker with the same failure also counts. Escalate with
  `agent-harness goal escalate "<reason>"` and notify failure, then the blocked path. A new failure, a new finding, or a
  green check counts as progress.
- **Repeated findings.** `agent-harness goal bump` exits 3 when the same findings (fingerprint of the stdin lines)
  repeat after a fix round, or when fix rounds reach the safety ceiling of 10. Stop. Tell the user the remaining
  confirmed Important findings. Do not start another fix round. The no-progress rule above can still escalate earlier.
- **Safety stop.** The Stop gate escalates after 5 NO-PROGRESS blocks or 30 blocks in total. Treat it as escalated, then
  the blocked path. A `goal bump` exit 3 is the same kind of stop: the Important findings that remain go to the user, and the loop ends.
- **Security.** A gitleaks finding or a secret exposure: stop, run `security-reviewer`, rotate. Never allowlist.

### Blocked path

Never tear down a blocked or escalated goal unless its PR is merged. In this order:

1. Keep the worktree, the branch and the registry (`status` escalated, with the reason).
2. Generate and render the report (stage 11), and commit it to the PR, so the reviewer can see the state.
3. Post the outcome comment (see [Final report](#final-report)), with the `blob/<sha>` image permalink.
4. Run `agent-harness notify failure` (or `waiting`).
5. Stop. To resume: `agent-harness ship-init --adopt <pr>`, or read the registry file in
   `<git-common-dir>/agent-harness/goals/`.

## Final report

After teardown or escalation, post one PR comment with the outcome:

- Merged or blocked, and the reason when blocked.
- The teardown lines (merged path) or the kept items (blocked path).
- The report image link, always the commit-SHA permalink of the commit that holds the PNG (it survives branch
  deletion, merged or blocked): `https://github.com/<owner>/<repo>/blob/<sha>/docs/agent-reports/<file>.png?raw=true`

Then open the show-me HTML locally for the user. Do not create throwaway screenshot branches.

## Hard limits

- Merge only through `agent-harness ship-merge`. Never `gh pr merge`, never a push to the base branch.
- Never a push to the base branch, with or without force. Never `git push --mirror` or `--all`, never `--no-verify`.
  Never weaken a check: disabling or skipping a test, job or required check, `continue-on-error`, deleting a check, or lowering thresholds. Force pushes on the PR branch are allowed.
- Worktree removal: `agent-harness worktree-rm <path> --confirmed` when the worktree is clean and its branch is merged
  into the default branch (tip reachable, trees equal, or `gh pr view --json state` is `MERGED` for that branch or its
  upstream and HEAD is that pull request's head). It refuses a dirty worktree, unmerged work, the main checkout, and a path that is not a worktree of the
  repo. `agent-harness teardown-merged-worktree <pr>` remains the path that also deletes the registered goal's branches
  and registry after that PR is MERGED. Raw `git worktree remove` stays forbidden in every mode (see the worktree
  destruction rule, the `worktree-destruction-safety` skill). No deny-list commands (see the autonomy rule).
- Branches are deleted only by `agent-harness teardown-merged-worktree` or `agent-harness cleanup`, never by raw
  `git branch -D`, `git push --delete`, or the API.
- A PR that matches `protectedPaths` is refused by `ship-merge` in autonomous mode. A human merges it with `--confirmed`.
- Never add a label, post a comment, or create a status to get past a refusal. Gates read only what the host and
  the workflows wrote.
- Stop-condition notifications are the only way the run speaks outside the session. Builds and releases are never
  triggered automatically. Do not notify for progress.

## Output

Report the PR URL, the goal status from `agent-harness goal status`, the loop iteration count, the verification output
tails, and any assumptions that the user should check. Report what teardown removed or kept: the worktree, the remote
and local head branch, the registry file, the backups, and the base checkout. Keep it short.
