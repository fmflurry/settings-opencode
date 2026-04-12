Project: local OpenCode configuration/workspace at `~/.config/opencode`.

Purpose:
- Configure OpenCode agents, commands, plugins, prompts, and reusable skills.
- Provide subagent-based workflows for planning, TDD, code review, security review, build fixing, docs, refactors, DB review, and git operations.

Tech stack:
- TypeScript-oriented config/workspace.
- Node.js package management with `npm` and lockfiles present (`package-lock.json`, `bun.lock`).
- JSON/JSONC config files (`opencode.jsonc`, `tui.json`, `ocx.jsonc`, `dcp.jsonc`).
- Dependencies include `@opencode-ai/plugin`, `@ai-sdk/openai`, `@ai-sdk/openai-compatible`, `opencode-cursor-auth`, `zod`, `jsonc-parser`.

Rough structure:
- `commands/`: slash-command templates like `git`, `plan`, `tdd`, `verify`, `code-review`, `security`.
- `skills/`: reusable skill instructions, including caveman, coding standards, security, flurryx, TDD.
- `prompts/`: agent prompts.
- `plugins/`: local plugin entrypoints.
- `scripts/`: helper scripts such as package-manager setup.
- `agents/`: extra agent markdown definitions.
- `contexts/`, `instructions/`, `profiles/`, `tools/`: OpenCode support files.

Notes:
- This directory itself is not a git repo.
- `.gitignore` excludes `node_modules`, local package files, and some account/log artifacts.
