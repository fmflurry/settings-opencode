---
name: pr-visual-report
description: "Use when opening or updating a pull request from the harness (Conductor or Monolith, /pr, /create-pull-request, /ship, or git-specialist). Produces the show-me visual report and the ## Visual report section."
---

# Visual report for a pull request

why-not-tooled: the diagram's content is a judgment about this diff. The section's presence is tooled. `.claude/hooks/pr-visual-report.sh` blocks a `gh` or `az` pull-request body that lacks it, and `agent-harness pr-report-check` checks a body before a host PR tool.

Every pull request the harness opens or updates includes one show-me report, unless the skip below applies. Conductor and Monolith share this skill. OpenCode runs the hook before bash. Claude Code runs it as a PreToolUse hook. Cursor runs the plugin copy.

## Produce it

1. Run `agent-harness kpi feature` before rendering the HTML. Conductor and Monolith both do this. Add `--branch` or `--pr` when the report is not for the current branch. The command writes a sanitised `docs/pr-reports/<branch-slug>.metrics.json` (repo, branch, and the PR number once known). It has wall time, active time, sessions per host, tools, skills, calls per agent, tool failures and durations, guard blocks, review and fix rounds, and tokens. Tokens are `n/a` when the host did not send them. The file has no prompts, arguments, or absolute paths.
2. Write one self-contained HTML file. Follow the `show-me` skill: no network assets, the cream default (`#FAF6EE`, soft cards, system serif) unless the change is about that product's own colors, real names from this change, at least one `@media` breakpoint, and the smallest diagram, infographic, or statechart that explains the change. Cover the before/after or the flow, the main files, the test results, and the risks.
3. Run `agent-harness pr-report <html>`. It reads the metrics file when present, inserts a Metrics panel into the HTML, and writes `docs/pr-reports/<branch-slug>.html`, `.png`, and `.metrics.json`, replacing `/` in the branch name with `-`. When `/opt/cursor/artifacts` is writable, or `PR_REPORT_ARTIFACT_DIR` is set, it also copies the files to `<artifacts>/pr-reports/`.
4. Commit the HTML, the PNG, and the metrics JSON on the PR branch before opening or updating the PR. Commit them before the local review when a review gate is on: `docs/pr-reports/` is part of the reviewed diff. The outcome PNG under `docs/agent-reports/` is a different file and stays exempt.
5. Put `## Visual report` in the body. Check the report line. Embed the PNG and link the HTML. The link must contain `docs/pr-reports/<branch-slug>.html`. On a cloud agent, also embed `<img alt="Visual report" src="/opt/cursor/artifacts/pr-reports/<branch-slug>.png">` so the host uploads the artifact. Under that section, or as `## Metrics`, paste the small table `pr-report` prints.

```markdown
## Visual report

- [x] Report: HTML and PNG committed, PNG embedded, HTML linked.

![Visual report](docs/pr-reports/feat-example.png)

[HTML report](docs/pr-reports/feat-example.html)

## Metrics

| Metric | Value |
| --- | --- |
| Wall | 12m |
| Active | 9m (gaps over 5m excluded) |
| Sessions | cursor 1, claude 0, opencode 0 |
| Tokens | n/a |
| Tool failures | 0 |
| Guard blocks | 0 |
| Review rounds | 1 |
| Fix rounds | 0 |

Status: complete
```

The numbers in the example are the shape. Paste the table from `kpi feature` or from `pr-report`, not these sample numbers.

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

`pr-report-check` warns on stderr when `## Metrics` is missing, or when wall or active time is `n/a` or the table is partial. Tokens may be `n/a`. The warning does not fail the check. A checked Skip line does not warn.
