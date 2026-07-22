# LLM metrics: real-time LLM-behavior monitor

`llm-metrics` is a real-time monitor for OpenCode's LLM calls. It folds the
OpenCode bus event stream into per-call metrics — tokens, time-to-first-token,
duration, cost, model/provider, finish reason, and tokens-per-second — and
surfaces them on three independent surfaces backed by one shared pure core.
Captured response text is persisted to a local NDJSONL file
(`~/data/llm-metrics.jsonl` by default). The feature is local-only with no
network egress; its boundary is one single-user local profile on the owner's
machine.

## Three surfaces, one pure core

- **Server plugin (`plugins/llm-metrics.ts`)** — hooks the OpenCode `event`
  bus, narrows each raw SDK event into a structural `MetricEvent`, feeds it
  through the pure reducer, and appends any emitted records to the NDJSONL file
  via the transport. The event hook never throws: raw events are defensively
  unwrapped and narrowed from `unknown` (no `any`), and any failure is logged
  through `client.app.log` and swallowed so OpenCode keeps running.
- **TUI sidebar (`tui-plugins/llm-metrics.tsx`)** — a SolidJS component
  registered in the `sidebar_content` slot. It keeps its own in-memory reducer
  state fed from the TUI event bus and renders the current session's live
  mid-stream `~tok/s (est)`, latest-call generation and end-to-end tok/s, tokens
  in/out, model, cost, finish reason, TTFT, and a rolling-average tok/s. The
  component is presentation only; all derivation lives in the shared lib.
- **CLI dashboard (`scripts/llm-metrics-dashboard.ts`)** — a dependency-free
  `bun` script that tails the NDJSONL file and renders a live ANSI terminal
  dashboard: a header (source path + clock), a summary line (rolling-average
  generation tok/s with the end-to-end average shown secondary, plus total
  tokens and total cost), and a color-graded table of the last N records. Run it
  with `bun run metrics`.
- **Shared pure core (`plugins/llm-metrics-lib/`)** — the single source of
  truth. `types.ts` (data model), `derive.ts` (the pure reducer + selectors),
  `transport.ts` (synchronous NDJSONL append/tail, `node:fs` only), and
  `stats.ts` (node-free rolling averages). The reducer is pure — it never
  mutates its input state and has no side effects beyond `Date.now()` for the
  emission timestamp — so the same derivation drives all three surfaces. Covered
  by 110 unit tests.

## Installation and registration

The server plugin and the TUI plugin are registered separately, and the CLI
dashboard is a `package.json` script:

- `opencode.jsonc › plugin[]` includes `./plugins/llm-metrics.ts`.
- `tui.json › plugin[]` includes `./tui-plugins/llm-metrics.tsx`, with
  `plugin_enabled: { "llm-metrics": true }`.
- `package.json` declares a `metrics` script (`bun scripts/llm-metrics-dashboard.ts`)
  and a `test:metrics` script that runs the lib's unit tests.

`install.sh` propagates the lib, the server plugin, the TUI plugin, and the
dashboard script as part of its whole-repo sync, but it **excludes** test files
(`*.test.*`, `*.spec.*`, `__tests__`, `__mocks__`). The tests therefore stay
in-repo and are run from the repository directly:

```sh
bun test plugins/llm-metrics-lib
```

Config is loaded once at startup and is not hot-reloaded. After changing
`opencode.jsonc` or `tui.json`, quit and restart OpenCode for the plugins to
load.

## Environment knobs

All knobs are read from the environment. The kill-switch is checked per event,
so it can be toggled without a restart; the capture options are baked into the
reducer state once at init.

| Variable                   | Default                    | Purpose                                                                  |
| -------------------------- | -------------------------- | ------------------------------------------------------------------------ |
| `LLM_METRICS_ENABLED`      | on                         | Kill-switch. `false`/`0` disables all event processing.                  |
| `LLM_METRICS_OUT`          | `~/data/llm-metrics.jsonl` | Output NDJSONL file.                                                     |
| `LLM_METRICS_CAPTURE_TEXT` | `true`                     | Capture assistant response text on `message` records.                    |
| `LLM_METRICS_MAX_TEXT`     | `4000`                     | Truncate captured response text beyond this many characters.             |

## Metrics tracked

The reducer emits two record kinds into the NDJSONL file:

- **`call`** — one per `step-finish` part (FIFO-paired with a preceding
  `step-start`; an orphan step-finish still emits with null timing).
- **`message`** — one per completed assistant message (finish present and
  `time.completed` set), at most once per message ID. Carries the step count and
  the bounded `responseText`.

Each record carries:

- **Tokens** (flat shape): `input`, `output`, `reasoning`, `cacheRead`,
  `cacheWrite`.
- **TTFT** (`ttftMs`): earliest text/reasoning part start minus
  `message.time.created`; null when either side is unknown.
- **Duration** (`durationMs`): `time.completed − time.created` for a message;
  `max(end) − min(start)` over the timed parts in a step window for a call. Null
  when not strictly positive.
- **Cost**, **model/provider** (`modelID`, `providerID`), **mode**, and **finish
  reason** (`finishReason` on a `call`, `finish` on a `message`).
- **Bounded response text** (`responseText`, `message` records only): captured
  non-synthetic text parts joined in first-seen order and truncated to
  `LLM_METRICS_MAX_TEXT`.
- **Both tok/s figures** (see below): end-to-end `tokensPerSec` and generation
  `genTokensPerSec`, plus the generation window `genDurationMs`.

Records also carry `sessionID` and `rootSessionID` (see [Subagent
aggregation](#subagent-aggregation)) and an `at` epoch-ms emission timestamp.
All timing math guards against NaN/Infinity: an invalid or non-positive duration
yields `durationMs = null` **and** `tokensPerSec = null`; zero output over a
valid duration yields `0`.

## Tokens-per-second definitions

Two distinct speeds are tracked, because "tokens per second" is ambiguous around
TTFT and reasoning:

- **End-to-end (`tokensPerSec`)** — `output ÷ total duration`, where the
  duration includes TTFT. This is the wall-clock throughput of the whole call.
- **Generation (`genTokensPerSec`)** — `(output + reasoning) ÷ generation
  window`, with TTFT **excluded**. For a `message` the generation window is
  `durationMs − ttftMs`; for a `call` it is the raw step window. It is null when
  the window is unknown or degenerate (below `MIN_GEN_MS`, 50ms) — a 1–2ms
  part-window outlier would otherwise produce a huge or infinite figure. It is
  never NaN/Infinity.

The TUI headline shows generation speed (a tool-calls step has no meaningful
generation window and renders `n/a (tool/wait)` rather than a misleading
near-zero fallback), with the end-to-end figure shown secondary.

### Live `~tok/s (est)` during streaming

While a step is streaming, the TUI shows a live **estimate** computed by the
pure `selectLive` selector:

```
(streamed chars ÷ charsPerToken) ÷ elapsed since generation start
```

- `charsPerToken` defaults to **4** (prose is roughly 4 characters per token).
- It is labeled `(est)` in the sidebar to mark it as an estimate.
- It is null below the `MIN_GEN_MS` floor (50ms) — the sidebar shows `…` while
  warming up — and is never NaN/Infinity.
- At step-finish the step boundary clears the live accumulation and the headline
  **snaps to the exact `gen tok/s`** from the emitted `CallMetric`, which
  supersedes the estimate.

Because the estimate divides streamed characters by a fixed ratio, it is most
accurate on prose (±15–25%) and less accurate on code or CJK text, where the
characters-per-token ratio differs. The exact figure replaces it as soon as the
step completes.

## Subagent aggregation

OpenCode subagents are child sessions: a session created with a non-null
`Session.parentID` is a subagent of its parent. The reducer tracks this
hierarchy from `session.created` events (retained on `session.deleted`, because
records outlive sessions) and stamps every emitted record with `rootSessionID` —
the top-most ancestor of the subagent tree the record belongs to (equal to
`sessionID` for a root session, or when the hierarchy is unknown at emission
time; the parent-chain walk is cycle-guarded).

- **TUI:** the sidebar aggregates the whole subagent subtree of the current
  session. When subagents are present it shows an aggregate headline (Σ in/out,
  Σ cost, rolling-average generation tok/s — summed over completed `message`
  records to avoid double-counting per-step `call`s) plus one compact row per
  session in the subtree. The root is marked `main` and listed first; subagents
  are labeled by their session title (falling back to the last 6 chars of the
  session ID).
- **CLI:** the dashboard's narrow session column shows the last 6 chars of the
  session ID, suffixed `*` when the record belongs to a subagent
  (`sessionID !== rootSessionID`). Old JSONL lines that predate `rootSessionID`
  are treated as their own root.

## Privacy and data boundary

When `LLM_METRICS_CAPTURE_TEXT` is on (the default), assistant **response text**
is persisted to the output file. The transport creates the file owner-only
(mode `0600`, parent directories `0700`) and appends locally; there is no
network egress. Captured text is bounded by `LLM_METRICS_MAX_TEXT`. To stop
capturing response text, set `LLM_METRICS_CAPTURE_TEXT=false` (records still
carry tokens, timing, cost, and metadata; `responseText` becomes empty).

## CLI dashboard

```sh
bun run metrics                 # tail the default output file
bun run metrics -- --lines 30   # more table rows
bun run metrics -- --path /custom/file.jsonl
bun run metrics -- --no-color   # disable ANSI colors
```

| Flag           | Default                | Purpose                              |
| -------------- | ---------------------- | ------------------------------------ |
| `--lines <n>`  | `15`                   | Rows in the table.                   |
| `--path <file>` | `LLM_METRICS_OUT` path | Source NDJSONL file.                 |
| `--no-color`   | colors on              | Disable ANSI colors.                 |

The dashboard seeds history from the file, then uses `fs.watch` for sub-second
responsiveness with a 1s poll as the reliable backbone (the poll also drives the
clock and handles a file that appears after startup). tok/s columns are
color-graded: green ≥ 50, amber ≥ 20, red below.

## Requirements

- **bun** — runs the CLI dashboard (`#!/usr/bin/env bun`) and the unit tests.
- **`@opencode-ai/plugin@1.4.6`** — the plugin/TUI SDK (declared in
  `package.json`).
- **No build step** — OpenCode loads the server plugin (`plugins/llm-metrics.ts`)
  and the TUI plugin (`tui-plugins/llm-metrics.tsx`) directly from source.
