---
name: pr-visual-report
description: "Use when opening or updating a pull request from the harness (Conductor or Monolith, /pr, /create-pull-request, /ship, or git-specialist). Produces the show-me visual report and the ## Visual report section."
---

# Visual report for a pull request

why-not-tooled: the diagram's content is a judgment about this diff. The section's presence is tooled. `.claude/hooks/pr-visual-report.sh` blocks a `gh` or `az` pull-request body that lacks it, and `agent-harness pr-report-check` checks a body before a host PR tool.

Every pull request the harness opens or updates includes one show-me report, unless the skip below applies. Conductor and Monolith share this skill. OpenCode runs the hook before bash. Claude Code runs it as a PreToolUse hook. Cursor runs the plugin copy.

## Produce it

1. Write one self-contained HTML file. Follow the `show-me` skill: no network assets, real names from this change, at least one `@media` breakpoint, and the smallest diagram or infographic that explains the change. Cover the before/after or the flow, the main files, the test results, and the risks.
2. Run `agent-harness pr-report <html>`. It writes `docs/pr-reports/<branch-slug>.html` and `.png`, replacing `/` in the branch name with `-`. When `/opt/cursor/artifacts` is writable, or `PR_REPORT_ARTIFACT_DIR` is set, it also copies both files to `<artifacts>/pr-reports/`.
3. Commit both files on the PR branch before opening or updating the PR. Commit them before the local review when a review gate is on: `docs/pr-reports/` is part of the reviewed diff. The outcome PNG under `docs/agent-reports/` is a different file and stays exempt.
4. Put `## Visual report` in the body. Check the report line. Embed the PNG and link the HTML. The link must contain `docs/pr-reports/<branch-slug>.html`. On a cloud agent, also embed `<img alt="Visual report" src="/opt/cursor/artifacts/pr-reports/<branch-slug>.png">` so the host uploads the artifact.

```markdown
## Visual report

- [x] Report: HTML and PNG committed, PNG embedded, HTML linked.

![Visual report](docs/pr-reports/feat-example.png)

[HTML report](docs/pr-reports/feat-example.html)
```

## Skip

A docs typo or a version bump only may skip the files. Check the skip line and write the reason after `Reason:`. Any other change needs the report. The hook allows the skip once the reason is at least a short phrase. It does not decide whether the diff is trivial.

```markdown
## Visual report

- [x] Skip — trivial PR (docs typo or version bump only). Reason: version bump only, changelog heading.
```

## Check

Before `gh pr create`, `gh pr edit` or `gh pr new` with a body, `az repos pr create`, `az repos pr update` with a description, or a host PR tool, run:

```bash
agent-harness pr-report-check --body-file <body.md>
```

Pass the body with `--body-file` or one quoted `--body` / `--description`. A command substitution in that argument is blocked. The hook reads the same rules and denies the command when the section is missing or incomplete. A title-only `gh pr edit` is left alone.
