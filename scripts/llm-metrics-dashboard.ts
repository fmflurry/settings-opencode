#!/usr/bin/env bun
/**
 * llm-metrics live dashboard (bun script, plain ANSI — no dependencies).
 *
 * Tails the llm-metrics NDJSONL file and renders a live terminal dashboard:
 *   - header: source path + live clock
 *   - summary: rolling-avg gen tok/s (last K records) with the end-to-end avg
 *     shown secondary, plus total tokens and total cost (totals are summed over
 *     completed `message` records to avoid double-counting per-step `call`s)
 *   - table of the last N records: time | model | kind | gen/s | e2e/s | out |
 *     in | reason | ttft | cost, with both tok/s columns color-graded
 *     green/amber/red.
 *
 * Data path: seed history with readTail(path, 0), then fs.watch + a 1s poll
 * both read from the last byte offset via readTail/nextOffset. The poll is the
 * reliable backbone (also drives the clock and handles the file appearing);
 * fs.watch adds sub-second responsiveness when the file already exists.
 *
 * Flags:
 *   --lines <n>    rows in the table (default 15)
 *   --path <file>  source file (default resolveOutPath())
 *   --no-color     disable ANSI colors
 */

import { watch } from "node:fs";

import { rollingAvg, rollingGenAvg } from "../plugins/llm-metrics-lib/stats.ts";
import { readTail, resolveOutPath } from "../plugins/llm-metrics-lib/transport.ts";
import type { MetricRecord } from "../plugins/llm-metrics-lib/types.ts";

// ─── Config ──────────────────────────────────────────────────────────────────

const ROLLING_K = 10; // window for rolling-avg tok/s
const POLL_MS = 1000; // render loop / fallback poll interval
const DEFAULT_LINES = 15;

// tok/s color thresholds (records/sec).
const TPS_GREEN = 50;
const TPS_AMBER = 20;

interface Options {
  lines: number;
  path: string;
  color: boolean;
}

function parseArgs(argv: readonly string[]): Options {
  const opts: Options = { lines: DEFAULT_LINES, path: resolveOutPath(), color: true };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--lines") {
      const n = parseInt(argv[++i] ?? "", 10);
      if (Number.isFinite(n) && n > 0) opts.lines = n;
    } else if (arg === "--path") {
      const p = argv[++i];
      if (p !== undefined && p.length > 0) opts.path = p;
    } else if (arg === "--no-color") {
      opts.color = false;
    }
  }
  return opts;
}

const opts = parseArgs(process.argv.slice(2));

// ─── ANSI helpers (no-op when --no-color) ────────────────────────────────────

const wrap = (code: number) => (s: string): string =>
  opts.color ? `\x1b[${code}m${s}\x1b[0m` : s;

const bold = wrap(1);
const dim = wrap(2);
const red = wrap(31);
const green = wrap(32);
const amber = wrap(33);
const cyan = wrap(36);

function gradeTps(tps: number | null): string {
  if (tps === null) return dim("-");
  const text = tps.toFixed(1);
  if (tps >= TPS_GREEN) return green(text);
  if (tps >= TPS_AMBER) return amber(text);
  return red(text);
}

/** Right-align tok/s to `width` on the PLAIN text, then colorize (keeps columns aligned). */
function tpsCell(tps: number | null, width: number): string {
  if (tps === null) return dim(padStart("-", width));
  const padded = padStart(tps.toFixed(1), width);
  if (tps >= TPS_GREEN) return green(padded);
  if (tps >= TPS_AMBER) return amber(padded);
  return red(padded);
}

// ─── Formatting ──────────────────────────────────────────────────────────────

function clock(): string {
  return new Date().toLocaleTimeString("en-GB", { hour12: false });
}

function fmtTime(at: number): string {
  return new Date(at).toLocaleTimeString("en-GB", { hour12: false });
}

function fmtNum(n: number): string {
  return n.toLocaleString("en-US");
}

function fmtCost(n: number): string {
  return `$${n.toFixed(4)}`;
}

function fmtMs(ms: number | null): string {
  return ms === null ? "-" : `${ms}ms`;
}

function reasonOf(r: MetricRecord): string {
  return r.kind === "call" ? r.finishReason : r.finish;
}

/**
 * Narrow session column: last 6 chars of sessionID, suffixed "*" when the
 * record belongs to a subagent (sessionID !== rootSessionID). Old JSONL lines
 * predate rootSessionID (absent at runtime) and are treated as their own root.
 */
function sessCell(r: MetricRecord): string {
  const short = r.sessionID.slice(-6);
  const root: string | undefined = r.rootSessionID;
  return root !== undefined && root !== r.sessionID ? `${short}*` : short;
}

function pad(s: string, width: number): string {
  return s.length > width ? s.slice(0, width) : s.padEnd(width, " ");
}

function padStart(s: string, width: number): string {
  return s.length > width ? s.slice(0, width) : s.padStart(width, " ");
}

// ─── State + tailing ─────────────────────────────────────────────────────────

/** Bounded tail of records retained in memory (table + rolling window + totals). */
const MAX_HISTORY = Math.max(opts.lines * 4, 200);

let history: MetricRecord[] = [];
let offset = 0;

/** Read any complete lines since `offset`, append them, and re-render. */
function poll(): void {
  const res = readTail(opts.path, offset);
  if (res.records.length > 0) {
    history = history.concat(res.records);
    if (history.length > MAX_HISTORY) history = history.slice(-MAX_HISTORY);
    offset = res.nextOffset;
  }
  render();
}

// ─── Rendering ───────────────────────────────────────────────────────────────

function render(): void {
  const out: string[] = [];
  out.push("\x1b[2J\x1b[H"); // clear screen + cursor home

  out.push(bold("┌─ llm-metrics ─────────────────────────────────────────"));
  out.push(`  source: ${cyan(opts.path)}`);
  out.push(`  time:   ${clock()}`);

  if (history.length === 0) {
    out.push("");
    out.push(dim("  waiting for data…"));
    process.stdout.write(out.join("\n") + "\n");
    return;
  }

  // Summary over completed message records (avoids double-counting calls).
  const messages = history.filter((r) => r.kind === "message");
  let totalTokens = 0;
  let totalCost = 0;
  for (const m of messages) {
    totalTokens += m.tokens.input + m.tokens.output;
    totalCost += m.cost;
  }
  const genAvg = rollingGenAvg(history, ROLLING_K);
  const e2eAvg = rollingAvg(history, ROLLING_K);
  out.push(
    `  ${bold("avg gen tok/s")} (last ${ROLLING_K}): ${gradeTps(genAvg)}   ` +
      `${dim("e2e")}: ${gradeTps(e2eAvg)}   ` +
      `${bold("total tokens")}: ${fmtNum(totalTokens)}   ` +
      `${bold("total cost")}: ${fmtCost(totalCost)}`,
  );
  out.push("");

  // Table header.
  const header =
    `${pad("time", 8)}  ${pad("sess", 7)}  ${pad("model", 24)}  ${pad("kind", 7)}  ` +
    `${padStart("gen/s", 7)}  ${padStart("e2e/s", 7)}  ${padStart("out", 8)}  ${padStart("in", 8)}  ` +
    `${pad("reason", 10)}  ${padStart("ttft", 8)}  ${padStart("cost", 9)}`;
  out.push(dim(header));
  out.push(dim("─".repeat(122)));

  // Last N rows.
  const rows = history.slice(-opts.lines);
  for (const r of rows) {
    out.push(
      `${pad(fmtTime(r.at), 8)}  ` +
        `${pad(sessCell(r), 7)}  ` +
        `${pad(r.modelID === "" ? "-" : r.modelID, 24)}  ` +
        `${pad(r.kind, 7)}  ` +
        `${tpsCell(r.genTokensPerSec, 7)}  ` +
        `${tpsCell(r.tokensPerSec, 7)}  ` +
        `${padStart(fmtNum(r.tokens.output), 8)}  ` +
        `${padStart(fmtNum(r.tokens.input), 8)}  ` +
        `${pad(reasonOf(r), 10)}  ` +
        `${padStart(fmtMs(r.ttftMs), 8)}  ` +
        `${padStart(fmtCost(r.cost), 9)}`,
    );
  }

  process.stdout.write(out.join("\n") + "\n");
}

// ─── Bootstrap ───────────────────────────────────────────────────────────────

poll(); // seed history + first render (handles a missing file gracefully)

// Render loop / reliable fallback (drives the clock; catches a file that
// appears after startup and any change fs.watch misses).
setInterval(poll, POLL_MS);

// fs.watch for sub-second updates when the file already exists. Best-effort:
// if the file is absent at startup the poll loop still picks it up.
try {
  const watcher = watch(opts.path, () => poll());
  watcher.on("error", () => {
    // Ignore watch errors; the poll loop remains the backbone.
  });
} catch {
  // File missing — polling handles it.
}
