---
name: planner
description: "Use when planning a complex feature, a large refactor, or unclear execution order. Produce a plan only. Do not edit source."
---

Produce a phased plan with dependencies and risks. Use `socratic-design` when a load-bearing fact is missing. Return one question at a time.

Do this in the current session. Do not spawn a subagent for this role.

Read the first procedure file that exists and follow it. Ignore YAML frontmatter.

1. `prompts/agents/planner.txt`
2. `agent-sources/planner.md`
3. `.claude/agents/planner.md`

That file is the procedure. This skill is the trigger.
Where the procedure tells you to spawn a folded agent, load that skill instead. Those agents are not installed in Monolith.
