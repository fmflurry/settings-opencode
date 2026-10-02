---
name: loop-on-ci
description: Monitor PR checks until green. Watch required checks, fix failures via [[fix-ci]], and iterate until all pass. Cap at 5 iterations.
---

# Loop on CI

If the current project has `.claude/skills/loop-on-ci/SKILL.md` or `.opencode/skills/loop-on-ci/SKILL.md`, read it and its `references/`; project specifics override this generic version.

## Trigger

Need to watch a branch or PR and iterate on CI failures until all required checks are green.

## Workflow

### 1. Resolve the PR

Extract metadata for the active branch:

```bash
gh pr view --json number,url,headRefName,baseRefName
```

### 2. Inspect Current Checks

List all PR-attached checks:

```bash
gh pr checks --json name,bucket,state,workflow,link
```

**If checks already failed**, diagnose those failures first using [[fix-ci]], then re-check after each fix.

**If checks are pending**, proceed to step 3 (watch mode).

### 3. Watch Required Checks

Use the `gh pr checks` command to watch and fail fast on the first failure:

```bash
gh pr checks --required --watch --fail-fast
```

This polls required checks and exits immediately when any fails or all pass.

### 4. On Failure: Fix and Repeat

1. When `--watch --fail-fast` exits with a failure, run `gh pr checks --json …` again to see the current state.
2. Dispatch [[fix-ci]] to diagnose and fix the failure (fix-ci derives routing from the workflow files).
3. After the fix is merged and pushed, re-run `gh pr checks --required --watch --fail-fast` to re-check.
4. Repeat until all required checks are green, or cap is reached (see Limits below).

### 5. On Green

Once all required checks pass, report:
- Final PR URL
- Iteration count
- Any flaky checks detected (see Flaky Checks below)

## Iteration Cap

Hard limit: **5 iterations** of watch-fix-recheck. If required checks are still not green after 5 iterations:

1. Report the current state: failing check names, last error excerpt, and iteration count.
2. Stop and surface to the human; do not loop further.
3. Note any pattern (e.g., the same check fails repeatedly) and flag as likely infrastructure issue or environmental flake.

## Flaky Checks

If a check fails and then passes without code changes (common for timeouts, race conditions, or external service hiccups):

1. Record the check name and evidence (logs, timestamps).
2. Retry once: `gh run rerun <run-id> --failed`.
3. Report the flake incident with evidence; flag for investigation in a separate ticket if it persists.
4. Do not retry more than once per check; use the iteration cap to avoid infinite loops.

## Long Wait Times

When watching PR checks (`--watch`), runs may take several minutes to complete. In such cases:

- **Claude Code (main session):** The watch runs in the background; you can check status manually with `gh pr checks` if needed.
- **OpenCode (conductor with bash: deny):** Git-specialist delegates the watch command and polls for completion periodically.

## Optional: Show-Your-Work Trail

Optionally, record one row per iteration with:
- Iteration number
- Failing check name (if any)
- Fix applied (if any)
- Result (green, still-failing, or cap reached)

This creates an audit trail for complex multi-step CI fixes.

## Output

Report on completion or cap:
- Final CI status (all green or capped at iteration N)
- Failure summary (if any checks are still failing)
- Flaky check evidence (if detected)
- PR URL once all required checks pass
