---
name: open-pr-check
description: "Use before implementing a change or opening a pull request, to see whether an open PR already covers the same files or topic."
---

# Open PR check (mandatory)

why-not-tooled: overlap with an open PR is a judgment about topic and files, not a linter check.

Why: an implementation once duplicated an open PR from another maintainer or co-owner (a license proposal) because nobody looked at open PRs first.

Before implementing a change, and before opening a new PR, check the open PRs. This applies to a `/ship` goal and to any `coder`, `tdd-guide` or `writer` dispatch that changes repo files.

1. **List open PRs.**
   `gh pr list --state open --limit 100 --json number,title,author,headRefName,isDraft,updatedAt,files`
2. **Find overlap** with the planned change:
   - the same files or directories,
   - the same topic in the title or body (search with keywords from the goal),
   - the same issue.
   Read the body and diff of every candidate: `gh pr view <n>` and `gh pr diff <n>`.
3. **Decide one outcome per overlapping PR:**
   - **Build on it.** The PR already does part or all of the work and is sound. Base the work on its branch, or reuse its content (cherry-pick or copy, crediting the PR). Do not redo it.
   - **Supersede.** The new work replaces the PR. Proceed, link the PR from the new PR, and say what was reused and what was dropped. Never close, edit or push to someone else's PR. Propose closure in a comment only with the owner's agreement.
   - **Wait or cancel.** The PR covers the goal, or it asks for sign-off before anything is applied (for example "do not merge" or "to validate"). Do not implement. Interactive: ask the user. Autonomous: escalate as a human-only blocker with `agent-harness goal escalate "<reason>"`.
   - **Unrelated.** The overlap is incidental. Proceed.
4. **Record the decision.**
   - One row per PR in `.claude/state/decisions.tsv` (see the `show-your-work` skill).
   - A `## Related open PRs` list in the new PR body: number, decision, one-line reason. If the PR template has no such section, put the list under `## Locked decisions`.

**Shared ownership.** A PR authored by another maintainer or co-owner that touches shared ownership, licensing or legal text always needs that person's sign-off before conflicting work is merged. This holds in autonomous mode too: it is a human-only blocker.
