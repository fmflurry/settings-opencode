# fmflurry Harness

A conductor that routes every task to the matching specialist subagent (planner, coder, reviewers, git, database, E2E and more), bundled with the skills, rules, commands, hooks and the code-memory MCP server that support it.

## Install

- Marketplace: `/add-plugin fmflurry-harness` once the plugin is listed.
- Local: clone [fmflurry/settings-opencode](https://github.com/fmflurry/settings-opencode) and run `./install-cursor.sh`, then run Developer: Reload Window.

## Components

| Component | Contents |
| --- | --- |
| Agents ({{agents}}) | Specialist subagents the conductor delegates to |
| Skills ({{skills}}) | Reusable skills, including a `conductor` skill carrying the routing rules |
| Commands ({{commands}}) | Slash commands for review, git, planning and verification |
| Rules ({{rules}}) | Always-on baseline plus the conductor routing rule; TypeScript rules apply on matching files |
| Hooks | Pre-tool-use guards, command rewriting, code-memory preference, tool budget, stop checks |
| MCP | `code-memory` |

## Models

Subagents carry `tier:` and no `model:` in their frontmatter. The conductor passes the tier's Cursor model on every `Task` call.

Only Cursor models (`grok-4.7`, `grok-4.6`, `grok-4.5`, `composer-2.5`). Never third-party models. Never `-fast` variants. If an override names a third-party or `-fast` slug, ignore it, use the tier default, and log why.

After install, run `/setup-harness`. It writes `~/.cursor/rules/fmflurry-harness-models.mdc` and `~/.agents/fmflurry-harness-models.md` with the defaults below. They apply to new chats. Without those files the same defaults are used.

{{tierTable}}

- Walk the fallback list when a slug is missing or rejected, and say which slug you used.
- A tier value of `inherit` or `auto` runs on the parent model.
- Pick Grok 4.7 xhigh in the model picker for the main chat; a plugin cannot set it.
- Cloud agents and grokbot may not receive user rules, so they fall back to the defaults.

## Limitations

- Cursor has no per-agent tool allowlist: agents can only be marked `readonly`.
- Conductor routing is by instruction only; nothing enforces delegation.
- Notification hooks are unsupported.
- In cloud or grokbot environments CodeMemory is skipped. Set `FMFLURRY_CODEMEMORY=on` to force it. Hooks no-op quietly when it is off, and they let actions through when a dependency is missing.

## Versioning

Manifest version {{version}}. The build reads it from `scripts/cursor-plugin/config.json` and writes `.cursor-plugin/plugin.json`. History is in `CHANGELOG.md`.

bump the plugin version + changelog in any PR touching plugin sources.

## License

MIT
