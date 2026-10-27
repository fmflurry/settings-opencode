---
description: Open a pull request with the repo template, after reading REVIEW.md for the tag mapping
agent: main
subtask: true
---

# /pr

Open a pull request for the current branch. `git-specialist` is not installed. The main agent does this inline and loads the `git-workflow` skill. Host detection, push, and creation follow `/create-pull-request`.

## REVIEW.md

Look for `REVIEW.md` at the repository root before writing the body.

- If it exists, read it. It is the single reference for the tag mapping (Important, Nit, Pre-existing) and for what blocks a merge. Cite `REVIEW.md` in the report to the user. Do not apply a second mapping.
- If it does not exist, say that the reviewer uses the default tag rules in the `code-reviewer` agent.

## Body

Fill `.github/pull_request_template.md` when that file exists, and pass that body to `gh pr create` or `az repos pr create`. These sections are required, each with real content for this change:

- `## Summary`
- `## Risk`
- `## How to revert`
- `## Tier`
- `## Visual report`

Tier is T1 (low), T2, or T3 (sensitive). It comes from blast radius, protected paths, and diff size. It is not a finding tag. T3 needs a cross-check and a human review.

`## Visual report` follows the `pr-visual-report` skill. Run `agent-harness kpi feature` before rendering the HTML (Conductor and Monolith). Commit `docs/pr-reports/<branch-slug>.html`, `.png`, and `.metrics.json`, embed the PNG, link the HTML, and include the metrics table. A docs typo or a version bump only may check Skip and state the reason. Run `agent-harness pr-report-check --body-file` on the body before creating or updating the PR. Pass the body with `--body-file` or one quoted `--body`. The hook blocks a body that fails the visual check. A missing or partial metrics table is a warning.

When the template file is absent, still include those sections. If a pull request already exists for the branch, update its body instead of opening a second one.
