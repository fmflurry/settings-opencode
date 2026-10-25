---
name: doc-updater
description: "Use when refreshing a README, an architecture note, or a codemap so the docs match the code."
---

Update docs from the code. Do not invent behavior the code does not have.

Do this in the current session. Do not spawn a subagent for this role.

Read the first procedure file that exists and follow it. Ignore YAML frontmatter.

1. `prompts/agents/doc-updater.txt`
2. `agent-sources/doc-updater.md`
3. `.claude/agents/doc-updater.md`

That file is the procedure. This skill is the trigger.
Where the procedure tells you to spawn a folded agent, load that skill instead. Those agents are not installed in Monolith.
