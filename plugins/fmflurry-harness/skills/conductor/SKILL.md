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

Every `Task` dispatch MUST pass `model` = the slug for the target agent's tier. Agents declare their tier via the `tier:` frontmatter field. Model selection is deterministic using the resolution chain below.

### Resolution order (first match wins)

1. **Cursor user rule**: `~/.cursor/rules/fmflurry-harness-models.mdc` (Cursor desktop only)
2. **Plain-file fallback**: `~/.agents/fmflurry-harness-models.md` (all environments, including cloud agents)
3. **Inline defaults**: the hardcoded fallback list per tier (see table below)

Both file formats use the same simple key-value syntax:

```
coding: <slug>
smart: <slug>
cheap: <slug>
```

When a tier value is `inherit` or `auto`, omit `model` from the `Task` call (runs on parent model).

### Fallback lists per tier

Each tier defines an **ordered fallback list**. If the configured slug is rejected by `Task`, try the next slug in the list. If the list is exhausted, **stop and report the failure to the user** — do not guess or improvise.

| Tier | Primary default | Fallback order | Use |
| --- | --- | --- | --- |
| coding | `grok-4.7-xhigh` | `grok-4.7-high`, `claude-opus-5-5-high`, `gpt-5.6-sol-high` | implementation, tests, build fixes |
| smart | `claude-opus-5-5-high` | `gpt-5.6-sol-high`, `claude-opus-5-5-medium`, `grok-4.7-xhigh` | planning, architecture, review, security; expensive |
| cheap | `composer-2.5` | `claude-sonnet-5-5-medium`, `grok-4.7-medium` | git, codebase search, docs, comment triage |

No `-fast` variants are used. Families: `claude-*`, `gpt-*`, `grok-*`, `composer-*`, `muse-*`, `gemini-*`.

### Deterministic escalation

After **two consecutive failed attempts** on the same task using the agent's assigned tier, escalate to the smart tier for the next attempt. Log the escalation in the decision trail: `Escalating <agent> from <tier> to smart after 2 failures on <task>`.

### Decision trail logging

For every `Task` dispatch, include in the existing show-your-work trail:
- Agent name and tier
- Model slug used (or `inherit`)
- Source of slug (rule / plain-file / inline-default / escalation)

Example: `[Task → coder (coding: grok-4.7-xhigh from rule)]`

### Notes

- The primary agent's model is chosen by the user in Cursor's model picker (Grok 4.7 xhigh recommended); a plugin can't set it.
- Suggest running `/setup-harness` once after install to detect available models and write both config files.
- Each agent's tier is self-declared in its frontmatter (`tier: coding|smart|cheap`), eliminating the need for a separate tier table.
