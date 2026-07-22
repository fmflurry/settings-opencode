/**
 * Synchronous NDJSONL transport for llm-metrics records (node:fs only).
 *
 * The output file is an append-only newline-delimited JSON log. Readers tail
 * it by BYTE offset so multi-byte UTF-8 content never corrupts a resume. Only
 * `\n`-terminated lines are considered complete; a trailing partial line
 * (crashed/in-flight write) is skipped until it is finished.
 */

import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import type { MetricRecord } from "./types.ts";

const ENV_OUT = "LLM_METRICS_OUT";
const DEFAULT_FILE = "llm-metrics.jsonl";

// Mirror the plugin env-helper convention: read through globalThis so this
// module also works if `process` is not a bare global in some host context.
const envProc = (
  globalThis as { process?: { env?: Record<string, string | undefined> } }
).process;

function readEnvStr(key: string): string | undefined {
  return envProc?.env?.[key];
}

/** LLM_METRICS_OUT when set and non-empty, else ~/data/llm-metrics.jsonl. */
export function resolveOutPath(): string {
  const fromEnv = readEnvStr(ENV_OUT);
  if (fromEnv !== undefined && fromEnv.length > 0) return fromEnv;
  return join(homedir(), "data", DEFAULT_FILE);
}

/** Append records as one newline-terminated JSON line each; empty is a no-op. */
export function appendRecords(path: string, records: readonly MetricRecord[]): void {
  if (records.length === 0) return;
  // The file holds captured model output: create it (and any new parent dirs)
  // owner-only. `mode` applies at creation; an existing file keeps its perms.
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  let payload = "";
  for (const record of records) {
    payload += JSON.stringify(record) + "\n";
  }
  appendFileSync(path, payload, { encoding: "utf8", mode: 0o600 });
}

/**
 * Parse only `\n`-terminated lines at/after the BYTE offset `fromOffset`.
 * A trailing unterminated/incomplete line is skipped (never throws, never
 * returns a partial record). `nextOffset` is the byte offset just past the
 * last complete line (=== file size for well-formed files). A missing file
 * yields `{ records: [], nextOffset: 0 }`.
 */
export function readTail(
  path: string,
  fromOffset: number,
): { records: MetricRecord[]; nextOffset: number } {
  let buf: Buffer;
  try {
    buf = readFileSync(path);
  } catch {
    return { records: [], nextOffset: 0 };
  }

  const records: MetricRecord[] = [];
  let offset = fromOffset;
  for (;;) {
    const nl = buf.indexOf(0x0a, offset); // "\n" byte; -1 when no complete line remains
    if (nl === -1) break;
    const line = buf.subarray(offset, nl).toString("utf8");
    offset = nl + 1;
    if (line.length === 0) continue; // blank line: complete but not a record
    try {
      records.push(JSON.parse(line) as MetricRecord);
    } catch {
      // Malformed line: skip it rather than return a partial/corrupt record.
    }
  }
  return { records, nextOffset: offset };
}

// Pure stats helper re-exported so existing `./transport.ts` importers (e.g.
// transport.test.ts) keep working; the implementation lives in the node-free
// `./stats.ts` so the TUI can import it without pulling in node builtins.
export { rollingAvg } from "./stats.ts";
