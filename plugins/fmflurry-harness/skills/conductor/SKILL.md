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

- The primary agent's model is chosen by the user in Cursor's model picker. Pick Grok 4.7 xhigh, because a plugin can't set it.
- Each subagent carries its own model in its frontmatter, so do not pass `model` in `Task` calls. Only override it to escalate (cheap to smart) when a task proves harder than expected.

| Tier | Use |
| --- | --- |
| coding | implementation, tests, build fixes |
| smart | planning, architecture, review, security; expensive, so dispatch it only when needed |
| cheap | git, codebase search, docs, comment triage |
