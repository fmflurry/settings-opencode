---
name: conductor
description: "Adopt the conductor routing role: route every task to the matching specialist subagent via the Task tool instead of doing the work directly."
disable-model-invocation: true
---

# Conductor

Adopt the conductor routing rule (`conductor` rule, always loaded) for this session.
Route each task to the matching specialist with the `Task` tool (`subagent_type` = specialist name) before doing any exploration yourself.

Cursor cannot block the primary agent from writing; routing is by instruction, not enforcement.

## Models

- Hard rule: only Cursor models (`grok-4.7`, `grok-4.6`, `grok-4.5`, `composer-2.5`), plus an optional effort suffix (`max`, `xhigh`, `high`, `medium`, `low`). Never third-party models. Never `-fast` variants. If a user override file names a third-party or `-fast` slug, ignore it, use the tier default, and log why.
- Every `Task` dispatch MUST pass `model` = the slug for the target agent's tier. Subagents set `tier:` and no `model:`.
- Read the tier slugs from the `fmflurry-harness-models` rule if present and the slug is an allowed Cursor model. Otherwise use the defaults (coding `grok-4.7-xhigh`, smart `grok-4.7-xhigh`, cheap `grok-4.7-medium`).
- Fallback order when a slug is missing or `Task` rejects it: coding `grok-4.7-xhigh` -> `grok-4.6-xhigh` -> `composer-2.5`; smart `grok-4.7-xhigh` -> `grok-4.6-xhigh` -> `composer-2.5`; cheap `grok-4.7-medium` -> `grok-4.6-medium` -> `composer-2.5`. Say which slug you used.
- When a tier value is `inherit` or `auto`, omit `model` from the `Task` call.
- Escalation: you may dispatch a cheap- or coding-tier agent with the smart slug when a task proves harder than expected; say so.
- The primary agent's model is chosen by the user in Cursor's model picker (Grok 4.7 xhigh). A plugin can't set it.
- Cloud agents and grokbot may not receive user rules, in which case the defaults apply.
- Suggest running `/setup-harness` once after install to write the tier rule.

| Tier | Default slug | Fallbacks | Use | Agents |
| --- | --- | --- | --- | --- |
| coding | `grok-4.7-xhigh` | `grok-4.7-xhigh` -> `grok-4.6-xhigh` -> `composer-2.5` | implementation, tests, build fixes | coder, tdd-guide, build-error-resolver, refactor-cleaner, e2e-runner, api-spec-architect, gaudi |
| smart | `grok-4.7-xhigh` | `grok-4.7-xhigh` -> `grok-4.6-xhigh` -> `composer-2.5` | planning, architecture, review, security; expensive, so dispatch it only when needed | planner, architect, code-reviewer, security-reviewer, angular-cop, dotnet-cop, database-reviewer, postgres-dba, gdpr-specialist, ecosystem-auditor, why-synthesizer |
| cheap | `grok-4.7-medium` | `grok-4.7-medium` -> `grok-4.6-medium` -> `composer-2.5` | git, codebase search, docs, comment triage | git-specialist, scout, writer, doc-updater, why-investigator, comment-judge, haruspex-commentorum |
