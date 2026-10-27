# KPI event schema

Local JSONL log at `~/.agent-harness/kpi/events.jsonl`. `AGENT_HARNESS_KPI_LOG` changes the path. `AGENT_HARNESS_KPI=0` writes nothing. A missing `jq` exits 0 and writes nothing. Hooks never block the tool.

One JSON object per line. Unknown fields are ignored by `agent-harness kpi report`. The report counts `tool_call` only; `tool_result` does not add a tool call.

The log has no prompts, tool arguments, secrets, or absolute paths. `skill` and `agent` are the only free-text fields, and both must match the patterns below or they are dropped.

## Fields on every line

| Field | Type | Meaning |
| --- | --- | --- |
| `ts` | string | UTC time `YYYY-MM-DDTHH:MM:SSZ` |
| `kind` | string | One of the kinds below |
| `variant` | string | `conductor`, `monolith`, or `unknown`. `orchestration` is stored as `conductor` |
| `harness_version` | string | Plugin version, currently stamped from `AGENT_HARNESS_VERSION` |
| `tool` | string | `opencode`, `claude`, or `cursor` |
| `repo` | string | `owner/name` when the origin remote matches, otherwise the repo directory name or a short hash |
| `branch` | string | Current branch, or `unknown` |
| `session_id` | string | Host session id, or a short hash when the raw id is not a safe token. `unknown` when absent |
| `tokens` | number or null | Input tokens plus output tokens. Cache and reasoning are not included. Null when unknown |

## Optional fields

| Field | Type | When |
| --- | --- | --- |
| `tool_name` | string | Tool call or tool result. `^[A-Za-z0-9._:-]{1,64}$` |
| `skill` | string | Tool name is Skill, `skill`, `use_skill`, or `load_skill`. `^[a-z0-9:-]{1,64}$` after lowercasing and stripping a leading `/` |
| `agent` | string | `subagent_type` on Task/Agent (OpenCode: `task`) and on `subagent_spawn` / `subagent_stop`. `^[A-Za-z0-9._:-]{1,64}$` |
| `duration_ms` | number or null | On `tool_result`. Null when the host did not send a duration. Non-negative and below 24 hours |
| `ok` | boolean | On `tool_result`. False when the host reports an error; otherwise true |
| `guard` | string | `git`, `ask`, `secret`, or `budget` |
| `outcome` | string | `merged`, `blocked`, `escalated`, or `open` |
| `pr` | number | Pull request number |
| `review` | string | `code` or `security` |
| `verdict` | string | `pass` or `fail` |
| `important` | number | Important review findings |
| `nit` | number | Nit findings |
| `pre_existing` | number | Pre-existing findings |
| `fix_iterations` | number | Fix rounds |
| `task` | string | Eval task id |
| `task_kind` | string | Eval task kind |
| `pass` | boolean | Eval checker passed |
| `mode` | string | `checker` or `model` |
| `tool_calls` | number | Eval tool-call count |
| `wall_ms` | number | Eval wall time |
| `source` | string | Session start source: `startup`, `resume`, `clear`, or `compact` |
| `ci_first_pass` | boolean | PR outcome |
| `review_rounds` | number | PR outcome |
| `time_to_merge_ms` | number | PR outcome |
| `reverted_within_7d` | boolean | PR outcome |

## Kinds

`session_start`, `session_end`, `tool_call`, `tool_result`, `subagent_spawn`, `subagent_stop`, `guard_block`, `review_round`, `fix_round`, `ship`, `pr_open`, `eval_result`, `pr_outcome`.

## Where each host writes

Claude Code:

- `PreToolUse` in `.claude/hooks/pre-tool-use.sh` writes `tool_call`. Skill adds `skill`. Task or Agent also writes `subagent_spawn` with `agent`.
- `PostToolUse` runs `.claude/hooks/kpi-emit.sh` and writes `tool_result`.
- `Stop` pipes the hook payload to `kpi-emit.sh`. Kind `session_end`. When `transcript_path` is a readable file of at most 8 MiB, `tokens` is the sum of `input_tokens` and `output_tokens` (or `input` and `output`) across records, and that sum replaces a number on the payload. A missing, unreadable, or larger file leaves the payload total when that total is a sanitised number; otherwise `tokens` is null.
- `SubagentStop` pipes to `kpi-emit.sh`. `agent` comes from `subagent_type` or `agent_type` when that value matches the pattern. Otherwise the hook reads the agent name from `agent_transcript_path` (first 64 KiB) or `transcript_path` (last 256 KiB, then the first 64 KiB). The path is not written.

Cursor:

- `preToolUse` goes through `cursor-adapter.sh` to `pre-tool-use.sh` (`tool_call`, `skill`, `agent`).
- `postToolUse` goes through `cursor-adapter.sh` to `kpi-emit.sh` (`tool_result`). The adapter stdout is `{}`. Tool output and shell commands are not forwarded.
- `sessionStart`, `sessionEnd`, and `subagentStop` are registered. `subagent_type` becomes `agent`. `tokens` is null. Payload usage and transcripts are ignored.
- `scripts/cursor-plugin/lib.mjs` builds `postToolUse` from the Claude `PostToolUse` hook, for both the Monolith and Conductor plugin builds.

OpenCode (`plugins/kpi.ts`):

- `tool.execute.before` writes `tool_call`. A `skill` tool adds `skill`. A `task` or `agent` tool also writes `subagent_spawn` with `agent`.
- `tool.execute.after` writes `tool_result` with `ok` and `duration_ms` measured in the plugin. Arguments and outputs are not forwarded.
- `session.created` writes `session_start`, or `subagent_spawn` with `agent` when `parentID` is set.
- `message.updated` stores the latest input+output total per message id. It does not write a line.
- `session.idle` and `session.deleted` write `session_end` for a root session, or `subagent_stop` with `agent` for a child session. `tokens` is the sum of the stored message totals.

`install.sh` merges `SessionStart` and `PostToolUse` commands for `kpi-emit.sh` into Claude settings. Global installs use `~/.claude/hooks`. Project installs (`--local`) use `./.claude/hooks`. Conductor and Monolith share that merge.
