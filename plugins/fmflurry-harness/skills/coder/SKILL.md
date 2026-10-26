---
name: coder
description: "Use when implementing non-test source: new code, a spec, a scaffold, a port, or a fix. Planning and review stay with the caller. Do the edit in this session."
---

Before the first edit of a change, load `open-pr-check`. Before source edits, load `coding-style`, `code-comments`, and `security`. C# also loads `dotnet-clean-architecture` and `dotnet-ddd`. Angular also loads `angular-clean-architecture`. Load `coding-standards` for TypeScript. Verify the build before calling the work done.

Do this in the current session. Do not spawn a subagent for this role.

Read the first procedure file that exists and follow it. Ignore YAML frontmatter.

1. `prompts/agents/coder.txt`
2. `agent-sources/coder.md`
3. `.claude/agents/coder.md`

That file is the procedure. This skill is the trigger.
Where the procedure tells you to spawn a folded agent, load that skill instead. Those agents are not installed in Monolith.
