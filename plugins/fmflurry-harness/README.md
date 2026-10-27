# fmflurry Harness

Monolith for Cursor. The primary agent reads, writes, plans, and implements in this session. Nothing has to run before the first edit. Load a skill for the work, and spawn a subagent only for isolated review, parallel investigation, or noisy output. `/orchestrate` is optional.

This build is Monolith. `./install-cursor.sh --variant conductor` (or `HARNESS_VARIANT=conductor`) builds the conductor-led plugin instead.

## Install

- Marketplace: `/add-plugin fmflurry-harness` once the plugin is listed.
- Local: clone [fmflurry/settings-opencode](https://github.com/fmflurry/settings-opencode) and run `./install-cursor.sh`, then run Developer: Reload Window. The installer also puts `agent-harness` on `~/.local/bin` (scripts under `~/.local/share/fmflurry-harness`).

## Components

| Component | Contents |
| --- | --- |
| Agents (9) | Review and noisy-output subagents. Folded roles load as skills. The primary agent writes |
| Skills (82) | Reusable skills, including the `threejs` and `openspec` umbrellas and an optional `conductor` skill for `/orchestrate` |
| Commands (65) | Slash commands for review, git, planning and verification |
| Rules (16) | Always-on Monolith baseline. The primary agent may write. There is no first-tool gate. TypeScript rules apply on matching files |
| Hooks | Pre-tool-use guards, command rewriting, code-memory preference, tool budget, stop checks |
| MCP | `code-memory` |

## Models

Subagents carry `tier:` and no `model:` in their frontmatter. The primary agent passes the tier's Cursor model on every `Task` call.

Only Cursor models (`grok-4.7`, `grok-4.6`, `grok-4.5`, `composer-2.5`). Never third-party models. Never `-fast` variants. If an override names a third-party or `-fast` slug, ignore it, use the tier default, and log why.

After install, run `/setup-harness`. It writes `~/.cursor/rules/fmflurry-harness-models.mdc` and `~/.agents/fmflurry-harness-models.md` with the defaults below. They apply to new chats. Without those files the same defaults are used.

| Tier | Default slug | Fallbacks | Use | Agents |
| --- | --- | --- | --- | --- |
| coding | `grok-4.7-xhigh` | `grok-4.7-xhigh` -> `grok-4.6-xhigh` -> `composer-2.5` | implementation, tests, build fixes | build-error-resolver, e2e-runner |
| smart | `grok-4.7-xhigh` | `grok-4.7-xhigh` -> `grok-4.6-xhigh` -> `composer-2.5` | planning, architecture, review, security; expensive, so dispatch it only when needed | code-reviewer, security-reviewer, cop, database-reviewer, ecosystem-auditor |
| cheap | `grok-4.7-medium` | `grok-4.7-medium` -> `grok-4.6-medium` -> `composer-2.5` | git, codebase search, docs, comment triage | why-investigator, comment-judge |

- Walk the fallback list when a slug is missing or rejected, and say which slug you used.
- A tier value of `inherit` or `auto` runs on the parent model.
- Pick Grok 4.7 xhigh in the model picker for the main chat; a plugin cannot set it.
- Cloud agents and grokbot may not receive user rules, so they fall back to the defaults.

## Limitations

- Cursor has no per-agent tool allowlist: agents can only be marked `readonly`.
- The primary agent is allowed to write. Delegation is by instruction only.
- Notification hooks are unsupported.
- In cloud or grokbot environments CodeMemory is skipped. Set `FMFLURRY_CODEMEMORY=on` to force it. Hooks no-op quietly when it is off, and they let actions through when a dependency is missing.

## Versioning

Manifest version 0.4.19. The build reads it from `scripts/cursor-plugin/config.json` and writes `.cursor-plugin/plugin.json`. History is in `CHANGELOG.md`.

bump the plugin version + changelog in any PR touching plugin sources.

## License

MIT
