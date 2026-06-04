# Vibe setup — opencode harness, ported to Mistral Vibe CLI

Replicates the opencode conductor/subagent harness in this repo onto
[Mistral Vibe CLI](https://github.com/mistralai/mistral-vibe) primitives.

## Install

```bash
./vibe/install-vibe.sh           # -> ~/.vibe
VIBE_HOME=/tmp/x ./vibe/install-vibe.sh   # custom home
```

Then: `export MISTRAL_API_KEY=...` (or `vibe --setup`), and run `vibe`.

## Mapping (opencode → Vibe)

| opencode | Vibe |
|---|---|
| `opencode.jsonc` `agent{}` | `~/.vibe/agents/*.toml` — conductor = `agent_type="agent"` (default), 14 subagents = `agent_type="subagent"` |
| `prompt: {...txt}` | `system_prompt_id` → `~/.vibe/prompts/<id>.md` |
| `instructions[]` (global) | `~/.vibe/AGENTS.md` (user-level) + project `./.vibe/AGENTS.md` |
| `tools` / `permission` | per-agent `enabled_tools` / `disabled_tools` + `[tools.X] permission` |
| `mcp{}` (code-memory) | global `[[mcp_servers]]` in `config.toml` (gated per-agent via `enabled_tools`) |
| `provider`/model env | `[[providers]]` (mistral) + `[[models]]` declared in `config.toml`; `active_model`/agent `active_model` reference a model **alias** |
| `command{}` | user-invocable skills `~/.vibe/skills/cmd-*/SKILL.md` (delegate via `task`) |
| `skills/*` | `~/.vibe/skills/*` (Agent Skills spec — same format) |

### Model tiers (mirrors opencode tiers, Mistral-native)

| opencode tier | agents | Vibe `active_model` |
|---|---|---|
| CONDUCTOR | conductor | `mistral-medium-latest` |
| PLANNER | planner | `mistral-large-latest` |
| WORKER | architect, coder, writer, reviewers, tdd, build, e2e, docs, refactor, db | `mistral-medium-latest` |
| MINI | git-specialist | `mistral-small-latest` |

### Tool name mapping

`read`→`read_file`, `write`→`write_file`, `edit`→`search_replace`,
`bash`/`grep`/`glob`/`task` unchanged. `reasoningEffort` is **dropped** —
the Mistral provider rejects `reasoning_effort`.

## Gotchas (learned the hard way)

- **Models must be declared.** No model named/aliased in `[[models]]` ⇒
  `Active model '...' not found`. `active_model` matches an **alias**.
- **`thinking = "off"` on plain `mistral-*` models.** `thinking = "max"` makes
  Vibe send `reasoning_effort`, which `mistral-medium/large-latest` reject
  (`400 reasoning_effort is not enabled for this model`).
- **`[tools.task]` allowlist gates delegation.** Vibe's default allows only the
  `explore` subagent — every harness subagent must be added or the conductor
  can't delegate to it.
- **MCP is global-only.** Agents can't carry their own `[[mcp_servers]]`; gate
  access per-agent via `enabled_tools` wildcards.
- **Installer is non-destructive.** If `~/.vibe/config.toml` already exists it is
  kept; the harness base is dropped as `config.harness-example.toml` to merge
  by hand (Vibe generates a rich default config on first launch — don't clobber).
- **Command skills are Agent-Skills bodies, not opencode commands.** A
  `cmd-*/SKILL.md` body is injected verbatim as a user message to the conductor.
  So (a) `$ARGUMENTS` is **never** substituted — leaving it literal makes the
  subagent receive a placeholder and ask "what do you want me to do?" (the
  classic `/push-changes` failure); (b) the opencode `agent:`/`subtask:`
  frontmatter is meaningless and must be stripped from the body; (c)
  `allowed-tools` must be a YAML list (`[task, read_file, ...]`), not a
  space-joined string. The installer now strips frontmatter, neutralises
  `$ARGUMENTS`, lifts the real `description`, and tells the conductor to build
  the `task` brief from the full workflow it has in context (no placeholder).
- **No retry-guard for tool-call hallucination.** opencode's `ecc-hooks`
  retry-guard has no Vibe counterpart (see *Not ported*). On opencode it catches
  Mistral typing a tool call as plain text — XML `<read>{...}</read>` or, more
  often, brace form `read{"filePath":...}` / `grep{"pattern":...}` — and
  force-retries. On Vibe nothing intercepts it: the brace text fires no tool, the
  turn ends (`finish=stop`), and the conductor appears to stall mid-task. There is
  no automatic recovery — re-prompt manually ("emit that as a real tool call, not
  text"). This is a `mistral-medium`/`large` failure, so the Mistral-native Vibe
  port is the most exposed surface for it.

## Orchestration model

Conductor (`agent_type="agent"`, write/edit disabled) routes every task to a
subagent via the `task` tool. Subagents run independently, return text-only,
and cannot prompt the user — same contract as the opencode conductor. Writes
happen inside `coder`/`writer`/etc. subagents whose `enabled_tools` permit them.

## Not ported (no Vibe equivalent)

opencode TypeScript **plugins** have no Vibe runtime counterpart and were
skipped: `ecc-hooks` (conductor retry-guard, bash-write guards, console.log
audit), instinct learning (`instinct-*`, `evolve`), worktree manager,
caveman TUI plugin, auto-compact, notification. Slash skills for `learn`,
`checkpoint`, `verify`, `eval`, `skill-create` are installed but their
plugin-backed behavior is inert.

## Verify after install

Inside `vibe`: `/mcp` (confirm code-memory tools + exact prefix), `Shift+Tab`
(cycle to conductor), `/help` (see `cmd-*` slash commands). If MCP tools are
`code_memory_*`, update `enabled_tools` in `~/.vibe/agents/*.toml`.
