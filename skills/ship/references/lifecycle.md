# Ship lifecycle: stage detail

Read this when you run a stage and need the exact command. The stage order, the blockers and the stop conditions are in
[SKILL.md](../SKILL.md).

Placeholders: `<base>` is the `base` key in `.claude/agent-harness.json`, or the repo default branch when the key is
absent. `<slug>` is a short kebab-case name from the goal. `<wt>` is the goal worktree path from the registry.
`<type>/<scope>-<short-description>` is the branch convention from the git-workflow skill (Branch Convention).

Keep the orchestrator's shell in the main checkout. Pass `<wt>` to every subagent brief and use `git -C <wt> ...` or
absolute paths. Never `cd` into the worktree in the persistent shell.

## 0. Init

Init is the first action of the run, before the clarify round.

```bash
agent-harness ship-init <type> <scope> <desc> --goal "<goal text>"   # new goal
agent-harness ship-init --adopt <pr>                                  # resume an existing PR
```

- It creates a dedicated worktree and branch from the latest `origin/<base>`.
  - Orca-managed repo (`orca` on PATH and the repo is listed): created through `orca worktree create`.
  - Anywhere else: a sibling directory `<main>-wt/<slug>`.
- It writes the registry `<git-common-dir>/agent-harness/goals/<slug>.json` with `{v, goal, slug, branch, path, base,
  via, pr, head_oid, status, reason, report, created_at}`. The file is local only, never tracked, one per goal, and
  survives the worktree. `slug` is the registry file name: `ship-init` prints `slug=<slug>` on stderr (the worktree path
  is the only thing on stdout), and `agent-harness report` accepts the slug or the branch.
- It writes `branch` and `slug` into `goal.json` (created or merged). The state lives in one place, the main checkout:
  `<main>/.claude/state/{goal.json,autonomy.on}`. Scripts and hooks resolve it from the first entry of
  `git worktree list --porcelain`, so `goal pr|sha|escalate` and `ship-merge` behave the same from the main checkout
  and from inside the worktree. The registry mirror is keyed on the `slug` in `goal.json`, not on the cwd's HEAD. One
  `goal.json` tracks one goal at a time: a second `ship-init` repoints it and prints a note.
- The stop gate mirrors `status` and `reason` (escalated or done) into the registry as well.
- Read the registry for `path` before dispatching any subagent. Do not infer the path from the branch name.
- Never reuse a branch that already has an open PR you did not create. Use `--adopt` for an existing PR of this goal. After `--adopt` on a draft PR, run `gh pr ready <pr>` before `ship-merge`.

Worktree creation is allowed while the autonomy flag is on (autonomy rule, rule d). Removing a worktree is never done
by this stage.

## 1. Clarify

- Ask one AskUserQuestion round. Ask only load-bearing questions: the ones whose answer changes which files
  get touched or which path gets taken. Each question gets 2 to 3 options, with the recommended one first.
- Questions must not depend on each other. If one answer would change whether another is needed, fold them
  into one question.
- Answer from the repo first (CodeMemory when it is on, then Read). When CodeMemory is off, skip it and use Read. Ask only what the repo cannot answer.
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

Before planning, check the open PRs with the `open-pr-check` skill (`skills/open-pr-check/SKILL.md`) and record
each overlapping PR's decision. A `Wait or cancel` outcome escalates.

## 3. Plan

If the `planner` agent is installed, dispatch to that agent with the goal, the clarified answers, the assumptions and `<wt>`. Otherwise the main agent loads the `planner` skill and writes the plan inline. Ask for an ordered list of phases,
each with one verifiable check. Keep the plan in the decision log, not in chat.

## 4. Implement

- Write the failing tests first. If `tdd-guide` is installed, dispatch to that agent with the brief contract. Otherwise the main agent loads the `tdd` skill and writes the tests inline. FILES are absolute paths under `<wt>`.
- Then make them pass. If `coder` is installed, dispatch to that agent. Otherwise the main agent loads the `coder` skill and implements inline. One brief per coherent unit. Parallel dispatches need disjoint FILES.
- Commit with `<wt>` as the working tree, following the git workflow rule. If `git-specialist` is installed, dispatch to that agent. Otherwise the main agent loads the `git-workflow` skill and commits inline. Stage by explicit
  path. Commit messages are in English.

## 5. Verify

Run these yourself, in `<wt>`. Paste the last ~15 lines of each output, or state `n/a — <reason>`.

| Case | What to run |
|---|---|
| `verify` key set in `.claude/agent-harness.json` | Run each listed command, in order, from `<wt>` |
| No `verify` key | Use the verification-gate detection for the project type (`.claude/rules/common/verification-gate.md`) |
| Docs only | `n/a — docs only` |

Lint and format failures block the same way build failures do. Fix the diff, then re-run. Two failed passes that do
not reduce the error count: stop and escalate.

## 6. Thorough review and fix (local, before any push)

Nothing is pushed yet. The push guard denies `git push` and `gh pr create` while the active goal lacks a passing code
review and a passing security review for the exact diff being pushed (the diff against `origin/<base>`, ignoring
`docs/agent-reports/`).

- Dispatch in one message, so they run in parallel, each on `git -C <wt> diff <base>...HEAD`:
  - `code-reviewer`: correctness, regressions, tests.
  - `security-reviewer`: auth, secrets, input, CI workflows, permissions.
  - If `angular-cop` is installed, dispatch to that agent when Angular or TypeScript changed. Otherwise dispatch to `cop` when that agent is installed (it loads the `angular-cop` skill). If `dotnet-cop` is installed, dispatch to that agent when .NET changed. Otherwise dispatch to `cop` when that agent is installed (it loads the `dotnet-cop` skill). If neither cop agent is installed, the main agent loads the matching skill and reviews inline.
  - `database-reviewer` when SQL changed.
  - `/code-review` is optional, if available.
- Verify each finding against the code. Drop the findings you cannot confirm.
- Record each verdict from `<wt>`: `agent-harness goal review code pass|fail` and
  `agent-harness goal review security pass|fail`. The command computes the diff key itself; the latest verdict per kind
  wins. Any change to the diff (a new commit, a rebase whose conflict resolution changes the diff) needs a new review.
- Fix every confirmed Important finding locally, re-run the local checks, and review the new diff. Repeat until no
  confirmed Important finding remains. Nit and Pre-existing findings do not block. Before each fix round pipe the
  confirmed findings (`<reviewer>:<path>` or `ci:<check>`, one per line) to `agent-harness goal bump`. Line numbers,
  case and order do not matter. It exits 3 and escalates when the same findings come back after a fix round, or at the
  safety ceiling of 10 rounds. Then stop and tell the user the remaining Important findings. Do not start another fix
  round.

## 7. Push and open the PR

If `git-specialist` is installed, dispatch to that agent with `<wt>`, the branch name, the base (`<base>`), an English conventional-commit title, and a body file. Otherwise the main agent loads the `git-workflow` skill and runs these commands from `<wt>`:

```bash
git -C <wt> push -u origin <type>/<scope>-<short-description>
gh pr create --base <base> --title "<type>: <description>" --body-file <body-file>
```

The PR is created ready, not draft. `gh pr create --head` and `-H` are denied while a goal is active.

The body file has those sections plus `## Visual report`. The visual report files are already committed at
`docs/pr-reports/<branch-slug>.html` and `.png` (see the `pr-visual-report` skill). Run
`agent-harness pr-report-check --body-file <body-file>` before `gh pr create`. Write `None.` under any section that
is empty:

```markdown
## Content
<what changed and why, short>

## QA tests
<the verification commands and their result>

## Locked decisions
<every assumption, one bullet each>

## Non-blocking follow-ups
<Nit and Pre-existing findings not fixed, and other follow-ups>

## Visual report
- [x] Report: HTML and PNG committed, PNG embedded, HTML linked.

![Visual report](docs/pr-reports/<branch-slug>.png)

[HTML report](docs/pr-reports/<branch-slug>.html)
```

Then record the PR and the head: `agent-harness goal pr <n>`, `agent-harness goal sha <sha>`.

Right after `gh pr create`, post the review summary as one PR comment in the format of
[review-format.md](review-format.md):

```bash
gh pr comment <n> --body-file <body-file>
```

The comment is an audit trail for a human. It is not a GitHub status. Nothing in the merge path reads it.

## 8. Re-review before every later push

The gate applies to every push after the PR exists. Nothing after the push changes: CI wait, `loop-on-ci` and `fix-ci`,
PR comments, the report, `agent-harness ship-merge` and teardown all stay. Every CI or comment fix is:

1. Fix locally.
2. Re-run the local checks.
3. Review the new diff locally and record `agent-harness goal review code|security pass`. The reviewers may review
   only `git diff <last-reviewed-sha>..HEAD`.
4. Push, then `agent-harness goal sha <sha>`.
5. Wait for CI again, then retry `ship-merge`.

The report commit (stage 11) is exempt: it changes only `docs/agent-reports/`, which the review key ignores.

## 9. CI and optional review status

- Watch until every check finishes: `gh pr checks <n> --watch`.
- Read the `reviewStatus` status for the head SHA. Skip this when the config does not set `reviewStatus`, which is the default:

  ```bash
  gh api repos/{owner}/{repo}/commits/<head-sha>/statuses \
    --jq '[.[] | select(.context == "<reviewStatus>")] | first | {state, description, creator: .creator.login}'
  ```

- CI: use the `loop-on-ci` skill. It watches the required checks with `gh pr checks --required --watch --fail-fast`.
  Minimal manual loop, if the skill is unavailable: for a failed run, `gh run view <run-id> --log-failed`. Fix the
  cause, review it locally (stage 8), push, then `agent-harness goal sha`. Route each failure through the `fix-ci` skill.
- Review status failure (`reviewStatus` configured and not `success`): read the status description and the repo's
  check logs, fix the cause, review it locally (stage 8), push, then `agent-harness goal sha`. Nit and Pre-existing findings go under
  `## Non-blocking follow-ups`.
- Before each fix round pipe the failing checks (`ci:<check>`) to `agent-harness goal bump`. Exit 3 means the same failures repeated or the ceiling of 10 is hit: stop and tell the user the remaining findings. `goal bump` already escalates and notifies. Do not start another fix round.
- Flaky check: re-run the failed job once with `gh run rerun <run-id> --failed`. A second failure is real.
- Blocker classification (which CI failures the agent fixes, and which are human-only) is in the SKILL.md "Blockers"
  section. A CI failure caused by repo code or repo config, including workflow files, is fixed by the agent. A missing
  secret, a billing or quota limit, or an outage is escalated.

## 10. Comments

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

## 11. Report

The report is a show-me HTML summary, committed in the PR and embedded in the PR body. Do it on the success path and on
the blocked path.

1. Generate the HTML with the `show-me` skill: what changed, why, the checks and their results, and screenshots when
   the change touches the UI. Write it outside the tracked tree (for example `/tmp/<slug>-report.html`).
2. Render it into the worktree. The command renders a temp copy of the HTML and writes only inside the registered
   worktree (`<slug>` may also be the branch name):

   ```bash
   agent-harness report <slug> /tmp/<slug>-report.html
   # writes <wt>/docs/agent-reports/<yyyy-mm-dd>-<slug>.png
   ```

3. Commit the PNG (explicit path, `docs(report): ...` or the goal's type, per the git workflow skill). If `git-specialist` is installed, dispatch to that agent. Otherwise the main agent loads the `git-workflow` skill and commits inline. Push it, then `agent-harness goal sha <sha>`.
4. Because the push changes the head, wait for CI on the new head (`gh pr checks <n> --watch`). A docs-only change may
   skip some checks; that is expected, and only the required checks that ran must be green.
5. Embed the image in the PR body with a commit-SHA permalink, where `<sha>` is the commit that holds the PNG
   (`git -C <wt> rev-parse HEAD` right after the report commit). It survives branch deletion after the merge:

   ```markdown
   ![<slug> report](https://github.com/<owner>/<repo>/blob/<sha>/docs/agent-reports/<yyyy-mm-dd>-<slug>.png?raw=true)
   ```

   Update the body with `gh pr edit <n> --body-file <body-file>`.

## 12. Merge

```bash
agent-harness ship-merge <n>              # autonomous mode
agent-harness ship-merge <n> --confirmed  # interactive mode, after the user says yes
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

It merges pinned to the head SHA (method: `--method`, else `mergeMethod` in the config, else the repo's first allowed of squash, rebase, merge). Then it runs stage 13 for a registered goal, or `agent-harness cleanup <n>` for an unregistered PR. `--keep-branch` keeps the head branch.

If it refuses, the refusal is input to the loop. Read the reason, fix the cause (rebase or update the branch, resolve a
thread, fix a check, re-review), push, and retry the merge. The run only stops when the PR merges or a human-only
blocker stops it. Do not add labels, post comments or create statuses to get past a refusal you did not earn.

## 13. Teardown

`ship-merge` runs this after a successful merge for a registered goal:

```bash
agent-harness teardown-merged-worktree <n>
```

It removes, in order: the worktree, the remote head branch (already deleted counts as ok), the local head branch, and
the registry file. The local branch is checked against the PR head commit, which survives squash merges.

It acts only when every check passes, and re-runs the checks right before removal:

- the PR is MERGED;
- the worktree HEAD and the branch equal the PR head;
- the path is a listed, real (non-symlink) worktree, and not the main checkout;
- the tree is clean, including untracked files;
- when Orca-managed, there is no Orca activity within `worktreeIdleMinutes` (default 60);
- the registry file name equals the slug of the PR head branch, the path has the ship-init layout (`<main>-wt/<slug>`,
  or an Orca workspace path ending in `/<slug>`), and `status` is not `escalated` or `blocked`;
- Orca detection fails closed: a target under `*/orca/workspaces/*` while the repo is not Orca-managed, or an `orca`
  binary whose repo list fails, is a STOP.

The main checkout is not touched: teardown runs `cleanup` with `--no-checkout` (no fetch, switch or pull; a dirty main
does not block it). Once the worktree is gone the local branch is checked out nowhere and is deleted. A GitHub error
other than HTTP 404 leaves the remote state unknown, so the registry is kept and the rerun command is printed.

Before removing, it lists the ignored files in the worktree, because they are lost. It never uses `--force`. With Orca,
a refusal keeps the worktree, and there is no git fallback.

Anything partial keeps the registry (`status` merged) and prints the rerun command. Rerun it with
`agent-harness teardown-merged-worktree <n>` once the cause is fixed. A rerun is the normal fix, not an escalation.

For an unregistered PR, `ship-merge` runs `agent-harness cleanup <n>` instead. Its lines start with `cleanup:` and name
one item: `remote`, `local` (deleted only when fully merged), `checkout`, `backup` (a backup branch recorded in
`goal.json`), or `worktree` (reported only, never removed). Never delete branches with `git branch -D`,
`git push --delete`, or the GitHub API.

After teardown: post the outcome comment (see SKILL.md "Final report"), open the show-me HTML locally, then
`agent-harness notify done "<msg>" <n>` and `agent-harness goal status`.

## Blocked path

For a blocked or escalated goal, follow SKILL.md "Blocked path": keep the worktree, the branch and the registry
(`status` escalated, with the reason). Generate and commit the report (stage 11), post the outcome comment with the
`blob/<sha>` permalink, notify failure, and stop. Teardown never runs. Resume with
`agent-harness ship-init --adopt <pr>`, or read the registry file.
