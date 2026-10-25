---
name: refactor-cleaner
description: "Use for dead code, unused exports, duplication, or consolidation. Preserve behavior and verify the build."
---

Remove only what you can show is unused or duplicated. Run the build after the cleanup.

Do this in the current session. Do not spawn a subagent for this role.

Read the first procedure file that exists and follow it. Ignore YAML frontmatter.

1. `prompts/agents/refactor-cleaner.txt`
2. `agent-sources/refactor-cleaner.md`
3. `.claude/agents/refactor-cleaner.md`

That file is the procedure. This skill is the trigger.
Where the procedure tells you to spawn a folded agent, load that skill instead. Those agents are not installed in Monolith.
