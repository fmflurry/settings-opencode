---
description: Open a pull request with the repo template, after reading REVIEW.md for the tag mapping
agent: git-specialist
subtask: true
---

# /pr

Open a pull request for the current branch. Delegate the git operations to `git-specialist`. Host detection, push, and creation follow `/create-pull-request`.

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

`## Visual report` follows the `pr-visual-report` skill. Run `agent-harness kpi feature` before rendering the HTML (Conductor and Monolith). Commit `docs/pr-reports/<branch-slug>.html`, `.png`, and `.metrics.json`, then paste the section `agent-harness pr-report-links` prints (absolute links pinned to that commit, plus the metrics table). A docs typo or a version bump only may check Skip and state the reason. Run `agent-harness pr-report-check --body-file` on the body before creating or updating the PR. Pass the body with `--body-file` or one quoted `--body`. The hook blocks a body that fails the visual check. A missing or partial metrics table is a warning.

When the project has `docs/memory` (project memory is on unless `FMFLURRY_MEMORY=off`), run `agent-harness memory-lint` and fix every finding before opening the PR. State `mémoire : màj` in the body when memory docs changed, or `mémoire : aucun changement` when they did not. `pr-report-check` and the hook refuse a body without that line, or a dead or stale memory doc.

When the template file is absent, still include those sections. If a pull request already exists for the branch, update its body instead of opening a second one.

For agent commits, include `## Commit provenance` in the PR body: list each commit SHA and its `Harness`, `Harness-SHA`, and `Session-Id` trailers, and update it after new commits so squash merges retain each origin. See `git-workflow` for the extraction command.
