---
name: writer
description: "Use when writing or editing documentation, a README, markdown, an HTML report, release notes, an ADR, or other prose. Do not edit source code."
---

Stay in prose files. Source code, tests, and behavior config go to `coder`.

Do this in the current session. Do not spawn a subagent for this role.

Read the first procedure file that exists and follow it. Ignore YAML frontmatter.

1. `prompts/agents/writer.txt`
2. `agent-sources/writer.md`
3. `.claude/agents/writer.md`

That file is the procedure. This skill is the trigger.
Where the procedure tells you to spawn a folded agent, load that skill instead. Those agents are not installed in Monolith.
