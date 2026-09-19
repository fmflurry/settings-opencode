---
description: Dependabot Friday triage — inventory open Dependabot PRs, check CI and ignore guardrails, produce a report-only merge plan (no merge without explicit user OK)
argument-hint: "[optional] focus: one multi-ecosystem group (app|infra)"
agent: git-specialist
---

# Dependabot Friday Command

Delegate to the `git-specialist` agent for a **report-only** triage of all open Dependabot PRs. This command never merges, closes, rebases, or comments — every mutation is emitted as a `⚠️ HUMAN CONFIRMATION REQUIRED` block and executed only after explicit user approval.

## Task

1. **Inventory** — `gh pr list --author "app/dependabot" --state open --json number,title,headRefName,createdAt`. If empty, report "no open Dependabot PRs" and stop.
2. **Per-PR status** — for each PR: CI verdict (`gh pr checks <n>`), multi-ecosystem group (from the commit prefix: `chore(deps-app)` = npm + nuget + pip, `chore(deps-infra)` = docker + docker-compose + github-actions; the ecosystems actually touched are listed in the PR body), semver level of each bump (patch/minor/major, from the PR title/body), and mergeability (`gh pr view <n> --json mergeable,mergeStateStatus`).
3. **Guardrail cross-check** — read `.github/dependabot.yml` and verify against its `ignore` rules:
   - **Exactly two version-update PRs are expected** (`app-deps`, `infra-deps`). A `chore(deps-*)` PR outside those two prefixes is either a security update (not grouped by `multi-ecosystem-groups`, expected to arrive on its own and bypass cooldown) or a config regression — say which. A nuget "Pinned <pkg>" twin PR or a stale unsuperseded pair is the known nuget-updater noise documented in the config, not a grouping bug: list it under NEEDS-INVESTIGATION with the close command.
   - **Paired pins move together or not at all.** Currently: the langfuse SDK (`/litellm` pip entry) and the `langfuse/langfuse` + `langfuse/langfuse-worker` server images (docker-compose entry) are the two halves of one pin — a PR bumping one half across a major is a REJECT (this is exactly how PR #59/#69/#81 recurred). Since the two-group layout they land in DIFFERENT PRs (SDK in `app-deps`, images in `infra-deps`), so check both PRs together before clearing either.
   - **Ignored majors must not appear** (typescript major in `/frontend`, postgres major, langfuse major). If one shows up anyway, the ignore rules are broken — flag it as a config bug, do not plan a merge.
4. **Classify** each PR into a tier:
   - **MERGE-READY** — CI green, patch/minor only, no guardrail hit.
   - **NEEDS-INVESTIGATION** — CI red, or `mergeStateStatus` dirty/behind: include the failing job names and a one-line diagnosis.
   - **MAJOR / DEFERRED** — any semver-major bump: each needs its own migration decision; never merged in the Friday batch. Exception: `github-actions` majors may stay MERGE-READY when CI is green (actions are SHA-pinned and single-purpose), but call the major out explicitly in the report.
5. **Merge plan** — order the MERGE-READY PRs sequentially (the two grouped PRs do not share files, but any security PR conflicts with its group PR on lockfiles; after each merge Dependabot rebases the remaining ones, so note the expected rebase wait between merges). Emit the exact commands in one confirmation block:

   > ⚠️ HUMAN CONFIRMATION REQUIRED — run only after user OK, one at a time:
   > `gh pr merge <n> --squash --delete-branch`

6. **Local measurements** — if any check requires installing npm deps locally, `npm ci --ignore-scripts` is the only allowed form. Never `npm install`.

## Scope

- If `$ARGUMENTS` is provided (`/dependabot-friday app` or `/dependabot-friday infra`): restrict the triage to that multi-ecosystem group.
- If `$ARGUMENTS` is empty: triage all open Dependabot PRs.

$ARGUMENTS

## Output Format

- **Summary table**: PR #, group, bumps (with semver level), CI verdict, tier.
- **Tier sections** with per-PR evidence (checks output, guardrail verdict).
- **Ordered merge plan** in a single `⚠️ HUMAN CONFIRMATION REQUIRED` block.
- **Deferred majors**: one line each — what blocks it and what would unblock it.
