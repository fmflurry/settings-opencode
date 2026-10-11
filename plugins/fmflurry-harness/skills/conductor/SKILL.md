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

- Every `Task` dispatch MUST pass `model` = the slug for the target agent's tier. Subagents carry no model of their own.
- Read the tier slugs from the `fmflurry-harness-models` rule if present. Otherwise use the defaults (coding `grok-4.7-xhigh`, smart `claude-opus-5-5-high`, cheap `composer-2.5`).
- When a tier value is `inherit` or `auto`, omit `model` from the `Task` call.
- If `Task` rejects a slug, retry with the tier default and say so. If the default is rejected too, use the closest valid slug of the same family from the error message, preferring the highest effort.
- Escalation: you may dispatch a cheap- or coding-tier agent with the smart slug when a task proves harder than expected; say so.
- The primary agent's model is chosen by the user in Cursor's model picker (Grok 4.7 xhigh recommended); a plugin can't set it.
- Cloud agents and grokbot may not receive user rules, in which case the defaults apply.
- Suggest running `/setup-harness` once after install to detect available models and write the tier rule.

| Tier | Default slug | Use | Agents |
| --- | --- | --- | --- |
| coding | `grok-4.7-xhigh` | implementation, tests, build fixes | coder, tdd-guide, build-error-resolver, refactor-cleaner, e2e-runner, api-spec-architect, gaudi |
| smart | `claude-opus-5-5-high` | planning, architecture, review, security; expensive, so dispatch it only when needed | planner, architect, code-reviewer, security-reviewer, angular-cop, dotnet-cop, database-reviewer, postgres-dba, gdpr-specialist, ecosystem-auditor, why-synthesizer |
| cheap | `composer-2.5` | git, codebase search, docs, comment triage | git-specialist, scout, writer, doc-updater, why-investigator, comment-judge, haruspex-commentorum |
