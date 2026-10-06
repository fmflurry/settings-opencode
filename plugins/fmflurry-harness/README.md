# fmflurry Harness

A conductor that routes every task to the matching specialist subagent (planner, coder, reviewers, git, database, E2E and more), bundled with the skills, rules, commands, hooks and the code-memory MCP server that support it.

## Install

- Marketplace: `/add-plugin fmflurry-harness` once the plugin is listed.
- Local: clone [fmflurry/settings-opencode](https://github.com/fmflurry/settings-opencode) and run `./install-cursor.sh`, then run Developer: Reload Window.

## Components

| Component | Contents |
| --- | --- |
| Agents (25) | Specialist subagents the conductor delegates to |
| Skills (71) | Reusable skills, including a `conductor` skill carrying the routing rules |
| Commands (62) | Slash commands for review, git, planning and verification |
| Rules (24) | Always-on baseline plus the conductor routing rule; TypeScript rules apply on matching files |
| Hooks | Pre-tool-use guards, command rewriting, code-memory preference, tool budget, stop checks |
| MCP | `code-memory` |

## Limitations

- Cursor has no per-agent tool allowlist: agents can only be marked `readonly`.
- Conductor routing is by instruction only; nothing enforces delegation.
- Notification hooks are unsupported.
- In cloud or grokbot environments the code-memory MCP needs `uvx` on the VM, and hook support is unverified. Hooks let actions through when a dependency is missing.

## License

MIT
