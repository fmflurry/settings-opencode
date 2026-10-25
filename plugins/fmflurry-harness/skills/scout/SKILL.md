---
name: scout
description: "Use when a task needs a file list and the paths are not known yet. Emit a manifest only. Stop at 8 tool calls."
---

Manifest, paths ruled out, and unresolved items. No analysis and no recommendations.

Do this in the current session. Do not spawn a subagent for this role.

Read the first procedure file that exists and follow it. Ignore YAML frontmatter.

1. `prompts/agents/scout.txt`
2. `agent-sources/scout.md`
3. `.claude/agents/scout.md`

That file is the procedure. This skill is the trigger.
Where the procedure tells you to spawn a folded agent, load that skill instead. Those agents are not installed in Monolith.
