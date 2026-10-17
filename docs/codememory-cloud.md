# CodeMemory in cloud and remote agents

CodeMemory stays on for a normal local macOS session. In a cloud or remote agent it is inert: rules do not ask for it, hooks and plugins exit without a nudge, and skills say to skip it. Nothing in that path errors or blocks the turn.

`FMFLURRY_CODEMEMORY` always wins.

| Value | Result |
| --- | --- |
| `on` | CodeMemory stays on, including in the cloud |
| `off` | CodeMemory stays off, including on a laptop |
| unset or `auto` | Detect, using the table below |
| anything else | Same as `auto` |

Detection order: override, then a cloud signal, then macOS (local, endpoint not required), then the local services. If the signals are inconclusive and those services are unreachable, CodeMemory is off.

The harness does not dial a CodeMemory socket of its own. MCP is stdio (`uvx --from flurryx-code-memory@latest code-memory-mcp`). The fallback probe is the two local services `code-memory health` checks: FalkorDB `127.0.0.1:6379` and Qdrant `127.0.0.1:6333`. Both must accept a TCP connection. A failed probe is "down", not an error.

Shared logic: `plugins/code-memory-lib/mode.ts` and `.claude/hooks/codememory-mode.sh`. The Cursor plugin copies the shell file next to its hooks.

## Signals

| Signal | Harness | Effect when `auto` | Status |
| --- | --- | --- | --- |
| `FMFLURRY_CODEMEMORY=on\|off\|auto` | Claude, OpenCode, Cursor | Override | VERIFIED: read by the helper; tests cover on, off, and auto |
| `CLAUDE_CODE_REMOTE=true` | Claude (any host that inherits the env, including OpenCode inside a Claude cloud session) | Off | VERIFIED: [Claude Code env vars](https://code.claude.com/docs/en/env-vars) and [cloud environments](https://code.claude.com/docs/en/cloud-environments) say the cloud VM sets it to `true` and it is never `true` locally. Unset in this Cursor cloud VM |
| `CLAUDE_CODE_REMOTE_SESSION_ID` non-empty | Claude | Off | VERIFIED: same Claude docs; set automatically in cloud sessions. Unset here |
| Cursor metadata `agent/runtime=managed` via `CURSOR_AGENT_SOCKET` (default `/run/cursor/api.sock`) `GET /v1/meta-data/agent/runtime` | Cursor (any host that can read the socket) | Off | VERIFIED: this Cursor cloud VM returned `managed` for agent `bc-24a76c69-3bf6-5925-baea-ed44944cc223` on 2026-10-17. [Cloud agent metadata](https://cursor.com/docs/cloud-agent/metadata) says `agent/runtime` is `managed` on Cursor-managed VMs and that self-hosted workers do not serve the API |
| `CURSOR_AGENT` | Cursor | Ignored | VERIFIED: set to `1` on this VM, and [Cursor terminal docs](https://cursor.com/docs/agent/tools/terminal) use it for local agent shells too. Not a cloud signal |
| `GITHUB_ACTIONS`, `GITLAB_CI`, `CIRCLECI`, `BUILDKITE` truthy; `TF_BUILD` or `JENKINS_URL` set | All three, when the process is CI | Off | ASSUMED for GitLab, Circle, Buildkite, Azure (`TF_BUILD`), and Jenkins. `GITHUB_ACTIONS=true` is the documented GitHub Actions env. None of these were set in this VM |
| `CI=true` alone | All three | Ignored | VERIFIED: `.claude/settings.json` sets `CI` to `true` for every Claude Code session, including a local Mac. Treating it as cloud would turn CodeMemory off on the laptop |
| macOS (`uname` Darwin / `process.platform === "darwin"`) and no cloud signal above | All three | On | ASSUMED as the local-Mac default. This VM is Linux (`hostname` `cursor`, user `ubuntu`, workspace `/workspace`), so the branch was not observed here. Endpoint reachability is not required, which keeps a Mac session unchanged when Docker is down |
| FalkorDB `127.0.0.1:6379` and Qdrant `127.0.0.1:6333` both open | All three, only when the rows above are inconclusive | On if both open, otherwise off | VERIFIED from the [code-memory README](https://github.com/fmflurry/code-memory): those are the default FalkorDB and Qdrant ports, and `code-memory health` checks them. On this VM both ports were closed. Not used on macOS or after a cloud hit |
| OpenCode remote/cloud env var | OpenCode | None | VERIFIED by absence: [OpenCode's env var list](https://opencode.ai/docs/cli/) has no cloud-session flag (`OPENCODE_CLIENT` defaults to `cli`; `OPENCODE_SERVER_PASSWORD` only enables basic auth). OpenCode uses the same process signals as the other harnesses |

`CURSOR_WORKLOAD_CGROUP` on this VM contained `cursor-agent` under a pod cgroup. That was observed, not used: it is not in Cursor's public metadata contract.

Hooks (`prefer-code-memory.sh`, the code-memory sentence in `tool-budget.sh`) and the OpenCode plugins (`plugins/code-memory.ts`, the code-memory sentence in `plugins/tool-budget.ts`, `createMemoryClient`) no-op when the decision is off. `plugins/code-memory-lib/claim-intent.ts` already returns no claim. Rules and skills tell the agent to skip rather than call CodeMemory.
