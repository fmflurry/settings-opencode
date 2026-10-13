# Ship lifecycle: stage detail

Read this when you run a stage and need the exact command. The stage order and stop conditions are in
[SKILL.md](../SKILL.md).

Placeholders: `<base>` is the `base` key in `.claude/agent-harness.json`, or the repo default branch when the key is
absent. `<slug>` is a short kebab-case name from the goal.

## 1. Clarify

- Ask one AskUserQuestion round. Ask only load-bearing questions: the ones whose answer changes which files
  get touched or which path gets taken. Each question gets 2 to 3 options, with the recommended one first.
- Questions must not depend on each other. If one answer would change whether another is needed, fold them
  into one question.
- Answer from the repo first (CodeMemory, `codememory_claims`, then Read). Ask only what the repo cannot answer.
- Autonomous mode: skip the round. For each assumption, log a row with the `show-your-work` helper and pin it
  in the PR under `## Locked decisions`.

## 2. Set the goal

```bash
agent-harness goal set "<goal text>" \
  "PR merged to <base>" \
  "every requiredChecks entry green" \
  "verify commands green" \
  "reviewStatus success on the head" \
  "zero unresolved review threads"
```

Drop the `reviewStatus` criterion when the config does not set it. `set` replaces any earlier goal. Run
`agent-harness goal status` to confirm it is active.

## 3. Plan

Dispatch `planner` with the goal, the clarified answers, and the assumptions. Ask for an ordered list of phases,
each with one verifiable check. Keep the plan in the decision log, not in chat.

## 4. Branch or worktree

The branch name follows the branch convention `<type>/<scope>-<short-description>` from the git-workflow skill (Branch Convention) in every case:

- `<type>`: the conventional commit type (`feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `perf`, `ci`).
- `<scope>`: one lowercase alphanumeric token.
- `<short-description>`: short kebab-case.

Example: `fix/ship-branch-naming`. `git-specialist` names the branch. Never reuse a branch that already has an open PR you did not create.

| Situation | Command |
|---|---|
| Repo managed by Orca (`orca` on PATH) | `orca worktree create --name <slug> --base-branch origin/<base>`, then check the branch |
| Anywhere else | `git switch -c <type>/<scope>-<short-description>` |

The installed `orca worktree create` may have no `--branch` flag (run `orca worktree create --help` to confirm for
your version). After creating the worktree, run `git branch --show-current`. If it does not match `<type>/<scope>-<short-description>`, rename it with `git branch -m <type>/<scope>-<short-description>`. This is safe because the branch is local and not pushed yet.

Worktree creation is allowed while the autonomy flag is on (see the autonomy rule, rule d). Removing a worktree is
never allowed.

## 5. Implement

- Write the failing tests first: dispatch `tdd-guide` with the brief contract.
- Then dispatch `coder` to make them pass. One brief per coherent unit. Parallel dispatches need disjoint FILES.
- Commit through `git-specialist`, following the git workflow rule. Stage by explicit path. Commit messages are in
  English.

## 6. Verify

Run these yourself. Paste the last ~15 lines of each output, or state `n/a — <reason>`.

| Case | What to run |
|---|---|
| `verify` key set in `.claude/agent-harness.json` | Run each listed command, in order |
| No `verify` key | Use the verification-gate detection for the project type (`.claude/rules/common/verification-gate.md`) |
| Docs only | `n/a — docs only` |

Lint and format failures block the same way build failures do. Fix the diff, then re-run. Two failed passes that do
not reduce the error count: stop and escalate.

## 7. Draft the PR

Dispatch `git-specialist` with the branch name, the base (`<base>`), an English conventional-commit title, and
a body file. It runs these commands:

```bash
git push -u origin <type>/<scope>-<short-description>
gh pr create --draft --base <base> --title "<type>: <description>" --body-file <body-file>
```

The body file has four sections. Write `None.` under any section that is empty:

```markdown
## Content
<what changed and why, short>

## QA tests
<the verification commands and their result>

## Locked decisions
<every assumption, one bullet each>

## Non-blocking follow-ups
<MEDIUM findings not fixed, and other follow-ups>
```

Then record the PR: `agent-harness goal pr <n>`.

## 8. Thorough review (local, still draft)

- Dispatch in one message, so they run in parallel, each on `git diff <base>...HEAD`:
  - `code-reviewer`: correctness, regressions, tests.
  - `security-reviewer`: auth, secrets, input, CI workflows, permissions.
  - `angular-cop` when Angular or TypeScript changed; `dotnet-cop` when .NET changed.
  - `database-reviewer` when SQL changed.
  - `/code-review high` is optional, if available.
- Verify each finding against the code. Drop the findings you cannot confirm.
- Fix every confirmed CRITICAL and HIGH finding, push through `git-specialist`, run
  `agent-harness goal sha <new-sha>`, and re-run the review on the new diff. Repeat until no confirmed CRITICAL or
  HIGH finding remains. There is no round cap. Escalate only on the no-progress rule in SKILL.md (the same finding
  survives a full loop iteration).
- When the review ends, post one summary PR comment in the format of [review-format.md](review-format.md):

  ```bash
  gh pr comment <n> --body-file <body-file>
  ```

- The comment is an audit trail for a human. It is not a GitHub status. Nothing in the merge path reads it.

## 9. Mark ready

```bash
gh pr ready <n>
```

`ship-merge` refuses drafts and does not mark a PR ready, so run this step yourself.

## 10. CI and optional review status

- Watch until every check finishes: `gh pr checks <n> --watch`.
- Read the `reviewStatus` status for the head SHA. Skip this when the config does not set `reviewStatus`, which is the default:

  ```bash
  gh api repos/{owner}/{repo}/commits/<head-sha>/statuses \
    --jq '[.[] | select(.context == "<reviewStatus>")] | first | {state, description, creator: .creator.login}'
  ```

- CI: use the `loop-on-ci` skill. It watches the required checks with `gh pr checks --required --watch --fail-fast`.
  Minimal manual loop, if the skill is unavailable: for a failed run, `gh run view <run-id> --log-failed`. Fix the
  cause, push, then `agent-harness goal sha`. Route each failure through the `fix-ci` skill.
- Review status failure (`reviewStatus` configured and not `success`): read the status description and the repo's
  check logs, fix the cause, push, then `agent-harness goal sha`. MEDIUM findings go under
  `## Non-blocking follow-ups`.
- Before each fix round: `agent-harness goal bump`. Exit 3 means escalate. Run `agent-harness notify failure`.
- Flaky check: re-run the failed job once with `gh run rerun <run-id> --failed`. A second failure is real.
- Blocker classification (which CI failures the agent fixes, and which are human-only) is in the SKILL.md "Blockers"
  section. A CI failure caused by repo code or repo config, including workflow files, is fixed by the agent. A missing
  secret, a billing or quota limit, or an outage is escalated.

## 11. Comments

- Run the `get-pr-comments` skill to list open threads and their node IDs.
- Per thread you addressed: a code fix with a commit, or a reply that explains the decision. Then resolve it.
- **Replying and resolving are in scope for /ship in both modes.** The run treats its own addressed threads as
  its to close.
- Reply on the thread (REST):

  ```bash
  gh api repos/{owner}/{repo}/pulls/<n>/comments/<comment-id>/replies -f body="<reply>"
  ```

- Resolve the thread (GraphQL):

  ```bash
  gh api graphql -f query='mutation($id: ID!) { resolveReviewThread(input: {threadId: $id}) { thread { isResolved } } }' -f id=<thread-node-id>
  ```

- Interactive mode: show the user the reply text before posting. Autonomous mode: post directly.
- Never touch a thread you did not address. Bot threads: reply only if the bot's finding is real.

## 12. Merge

```bash
agent-harness ship-merge <n>              # autonomous mode
agent-harness ship-merge <n> --confirmed  # interactive mode, after the user says yes
agent-harness notify done "<msg>" <n>
agent-harness goal status
```

`ship-merge` is the only merge path. It refuses unless all of these hold (the full rail list is in the
"Autonomous mode" section of this repo's README):

- the autonomy flag is on, or `--confirmed` is passed
- the PR targets `<base>` and is not a draft
- every `requiredChecks` entry passed on the head
- zero unresolved review threads, and fewer than 100 threads
- the branch is up to date with `<base>` (`behind_by` is 0)
- no changed path matches `protectedPaths`, unless `--confirmed` is passed (a human merges such a PR)
- only when `reviewStatus` is configured: the newest status with that context on the head is `success`, created by
  `reviewStatusCreator` when that key is set

It merges pinned to the head SHA (method: `--method`, else `mergeMethod` in the config, else the repo's first allowed of squash, rebase, merge), then deletes the branch.

If it refuses, the refusal is input to the loop. Read the reason, fix the cause (rebase or update the branch, resolve a
thread, fix a check, re-review), push, and retry the merge. The run only stops when the PR merges or a human-only
blocker stops it. Do not add labels, post comments or create statuses to get past a refusal you did not earn.
