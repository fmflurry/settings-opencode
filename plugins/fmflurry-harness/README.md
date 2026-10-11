# fmflurry Harness

A conductor that routes every task to the matching specialist subagent (planner, coder, reviewers, git, database, E2E and more), bundled with the skills, rules, commands, hooks and the code-memory MCP server that support it.

## Install

- Marketplace: `/add-plugin fmflurry-harness` once the plugin is listed.
- Local: clone [fmflurry/settings-opencode](https://github.com/fmflurry/settings-opencode) and run `./install-cursor.sh`, then run Developer: Reload Window.

## Components

| Component | Contents |
| --- | --- |
| Agents (25) | Specialist subagents the conductor delegates to |
| Skills (72) | Reusable skills, including a `conductor` skill carrying the routing rules |
| Commands (62) | Slash commands for review, git, planning and verification |
| Rules (24) | Always-on baseline plus the conductor routing rule; TypeScript rules apply on matching files |
| Hooks | Pre-tool-use guards, command rewriting, code-memory preference, tool budget, stop checks |
| MCP | `code-memory` |

## Models

Model selection is deterministic. Subagents declare their tier via `tier:` frontmatter (`coding`, `smart`, or `cheap`). The conductor passes the appropriate model on every `Task` call.

### Configuration

After install, run `/setup-harness`. It detects available model slugs, proposes one per tier, and writes **two config files** for maximum compatibility:

1. **Cursor rule**: `~/.cursor/rules/fmflurry-harness-models.mdc` (Cursor desktop only)
2. **Plain-file fallback**: `~/.agents/fmflurry-harness-models.md` (all environments, including cloud agents)

The conductor reads from the first file that exists (rule wins, then plain-file, then inline defaults). Config applies to new chats.

### Tiers & Fallbacks

Each tier has a primary default and an **ordered fallback list**. If the configured slug is rejected by `Task`, the conductor tries the next fallback. If the list is exhausted, the task fails with a clear error — no guessing.

| Tier | Primary default | Fallback order | Use |
| --- | --- | --- | --- |
| coding | `grok-4.7-xhigh` | `grok-4.7-high`, `claude-opus-5-5-high` | implementation, tests, build fixes |
| smart | `claude-opus-5-5-high` | `claude-opus-5-5-medium`, `grok-4.7-xhigh` | planning, architecture, review, security; expensive |
| cheap | `composer-2.5` | `claude-sonnet-5-5-medium`, `grok-4.7-medium` | git, codebase search, docs, comment triage |

No `-fast` variants are used (they cost 2x–6x more).

### Escalation

After **two consecutive failed attempts** on the same task, the conductor escalates to the smart tier for the next attempt. This is deterministic and logged in the decision trail.

### Notes

- A tier value of `inherit` or `auto` runs on the parent model.
- Pick Grok 4.7 xhigh in the model picker for the main chat; a plugin cannot set it.
- Cloud agents and grokbot environments use the plain-file fallback, ensuring consistent behavior everywhere.

## Limitations

- Cursor has no per-agent tool allowlist: agents can only be marked `readonly`.
- Conductor routing is by instruction only; nothing enforces delegation.
- Notification hooks are unsupported.
- In cloud or grokbot environments the code-memory MCP needs `uvx` on the VM, and hook support is unverified. Hooks let actions through when a dependency is missing.

## License

MIT
