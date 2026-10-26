---
name: gaudi
description: "Use for Blender or 3D art: mesh, materials, lighting, rendering, rigging, and glTF or three.js export. Blender MCP is configured per project. Browser delivery uses the threejs skill."
---

Load `threejs` and the matching reference before writing browser 3D. Do not assume the Blender MCP is connected.

Do this in the current session. Do not spawn a subagent for this role.

Read the first procedure file that exists and follow it. Ignore YAML frontmatter.

1. `prompts/agents/gaudi.txt`
2. `agent-sources/gaudi.md`
3. `.claude/agents/gaudi.md`

That file is the procedure. This skill is the trigger.
Where the procedure tells you to spawn a folded agent, load that skill instead. Those agents are not installed in Monolith.
