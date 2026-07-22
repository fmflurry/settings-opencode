/**
 * Contract tests for the llm-metrics transport helpers.
 *
 * RED phase: `./transport.ts` does not exist yet — these tests fail with
 * "Cannot find module" until the implementer creates it.
 *
 * Pinned API (all functions are SYNCHRONOUS):
 *   resolveOutPath(): string
 *     - process.env.LLM_METRICS_OUT when set and non-empty (used as-is);
 *       otherwise join(homedir(), "data", "llm-metrics.jsonl").
 *   appendRecords(path: string, records: readonly MetricRecord[]): void
 *     - NDJSONL: one JSON.stringify(record) per line, every line "\n"-terminated;
 *       creates missing parent directories; empty array is a no-op.
 *   readTail(path: string, fromOffset: number): { records: MetricRecord[]; nextOffset: number }
 *     - parses only "\n"-terminated lines at/after the BYTE offset fromOffset;
 *       a trailing unterminated or incomplete-JSON line is skipped (never
 *       throws, never returns a partial record); nextOffset = byte offset
 *       just past the last complete line (=== file size for well-formed
 *       files). Missing file => { records: [], nextOffset: 0 }.
 *   rollingAvg(records: readonly MetricRecord[], k: number): number | null
 *     - mean of tokensPerSec over the last k records (call OR message) with
 *       non-null tokensPerSec; null-records do not consume k slots;
 *       null when no qualifying record or k <= 0.
 *
 * All filesystem tests run in a per-test temp dir; nothing touches ~/data.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { appendRecords, readTail, resolveOutPath, rollingAvg } from "./transport.ts";
import type { CallMetric, MessageMetric, MetricRecord } from "./types.ts";

const ENV_KEY = "LLM_METRICS_OUT";

let tmp = "";
let savedEnv: string | undefined;

beforeEach(() => {
  savedEnv = process.env[ENV_KEY];
  tmp = mkdtempSync(join(tmpdir(), "llm-metrics-test-"));
});

afterEach(() => {
  if (savedEnv === undefined) delete process.env[ENV_KEY];
  else process.env[ENV_KEY] = savedEnv;
  rmSync(tmp, { recursive: true, force: true });
});

// ── Record builders (full literals — no `any`) ──────────────────────────────

function callRec(tokensPerSec: number | null, at = 1): CallMetric {
  return {
    kind: "call",
    partID: "part_1",
    finishReason: "stop",
    sessionID: "ses_1",
    messageID: "msg_1",
    providerID: "anthropic",
    modelID: "claude-sonnet-4-6",
    mode: "build",
    tokens: { input: 10, output: 20, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
    cost: 0.001,
    ttftMs: null,
    durationMs: tokensPerSec === null ? null : 1000,
    tokensPerSec,
    at,
  };
}

function messageRec(tokensPerSec: number | null, at = 2, responseText = "ok"): MessageMetric {
  return {
    kind: "message",
    finish: "stop",
    steps: 1,
    responseText,
    sessionID: "ses_1",
    messageID: "msg_1",
    providerID: "anthropic",
    modelID: "claude-sonnet-4-6",
    mode: "build",
    tokens: { input: 10, output: 20, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
    cost: 0.002,
    ttftMs: null,
    durationMs: tokensPerSec === null ? null : 1000,
    tokensPerSec,
    at,
  };
}

// ── resolveOutPath ───────────────────────────────────────────────────────────

describe("resolveOutPath", () => {
  test("honors LLM_METRICS_OUT when set", () => {
    const custom = join(tmp, "custom.jsonl");
    process.env[ENV_KEY] = custom;
    expect(resolveOutPath()).toBe(custom);
  });

  test("defaults to ~/data/llm-metrics.jsonl (home-expanded) when unset", () => {
    delete process.env[ENV_KEY];
    expect(resolveOutPath()).toBe(join(homedir(), "data", "llm-metrics.jsonl"));
  });

  test("treats an empty-string LLM_METRICS_OUT as unset", () => {
    process.env[ENV_KEY] = "";
    expect(resolveOutPath()).toBe(join(homedir(), "data", "llm-metrics.jsonl"));
  });
});

// ── appendRecords ────────────────────────────────────────────────────────────

describe("appendRecords", () => {
  test("creates parent dirs and writes one newline-terminated JSON line per record", () => {
    const p = join(tmp, "nested", "deeper", "out.jsonl");
    const a = callRec(10, 1);
    const b = messageRec(20, 2);

    appendRecords(p, [a, b]);

    const content = readFileSync(p, "utf8");
    expect(content.endsWith("\n")).toBe(true);
    const lines = content.split("\n").filter((l) => l.length > 0);
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]) as unknown).toEqual(a);
    expect(JSON.parse(lines[1]) as unknown).toEqual(b);
  });

  test("appending twice preserves all records in order", () => {
    const p = join(tmp, "append.jsonl");
    appendRecords(p, [callRec(10, 1)]);
    appendRecords(p, [callRec(20, 2), messageRec(30, 3)]);

    const lines = readFileSync(p, "utf8")
      .split("\n")
      .filter((l) => l.length > 0);
    expect(lines).toHaveLength(3);
    const parsed = lines.map((l) => JSON.parse(l) as MetricRecord);
    expect(parsed.map((r) => r.at)).toEqual([1, 2, 3]);
    expect(parsed.map((r) => r.tokensPerSec)).toEqual([10, 20, 30]);
    expect(parsed.map((r) => r.kind)).toEqual(["call", "call", "message"]);
  });

  test("empty records array is a no-op that does not throw", () => {
    const p = join(tmp, "noop.jsonl");
    appendRecords(p, [callRec(10, 1)]);
    const before = readFileSync(p, "utf8");
    expect(() => appendRecords(p, [])).not.toThrow();
    expect(readFileSync(p, "utf8")).toBe(before);
  });
});

// ── readTail ─────────────────────────────────────────────────────────────────

describe("readTail", () => {
  test("reads all records from offset 0; nextOffset === file size in bytes", () => {
    const p = join(tmp, "tail.jsonl");
    const recs: MetricRecord[] = [callRec(10, 1), messageRec(20, 2), callRec(null, 3)];
    appendRecords(p, recs);

    const { records, nextOffset } = readTail(p, 0);
    expect(records).toEqual(recs);
    expect(nextOffset).toBe(statSync(p).size);
  });

  test("reading from a returned nextOffset yields no new records", () => {
    const p = join(tmp, "tail2.jsonl");
    appendRecords(p, [callRec(10, 1)]);
    const first = readTail(p, 0);

    const second = readTail(p, first.nextOffset);
    expect(second.records).toEqual([]);
    expect(second.nextOffset).toBe(first.nextOffset);
  });

  test("tolerates a trailing partial line and resumes once it completes", () => {
    const p = join(tmp, "partial.jsonl");
    const r1 = callRec(10, 1);
    const r2 = callRec(20, 2);
    const r3 = callRec(30, 3);
    const complete = `${JSON.stringify(r1)}\n${JSON.stringify(r2)}\n`;

    // Simulate a crashed/in-flight write: last line is incomplete JSON.
    writeFileSync(p, `${complete}{"kind":"cal`);
    const first = readTail(p, 0);
    expect(first.records).toEqual([r1, r2]); // partial line skipped, no throw
    expect(first.nextOffset).toBe(Buffer.byteLength(complete));

    // The writer finishes the line; tailing resumes exactly there.
    writeFileSync(p, `${complete}${JSON.stringify(r3)}\n`);
    const second = readTail(p, first.nextOffset);
    expect(second.records).toEqual([r3]);
  });

  test("an unterminated last line (no trailing newline) is treated as incomplete", () => {
    const p = join(tmp, "unterminated.jsonl");
    writeFileSync(p, JSON.stringify(callRec(10, 1))); // complete JSON, no "\n"

    const res = readTail(p, 0);
    expect(res.records).toEqual([]);
    expect(res.nextOffset).toBe(0);
  });

  test("missing file => empty records and nextOffset 0, no throw", () => {
    const res = readTail(join(tmp, "missing.jsonl"), 0);
    expect(res.records).toEqual([]);
    expect(res.nextOffset).toBe(0);
  });

  test("nextOffset is byte-accurate for multi-byte UTF-8 content", () => {
    const p = join(tmp, "utf8.jsonl");
    const rec = messageRec(42, 7, "café 🚀"); // é = 2 bytes, 🚀 = 4 bytes
    appendRecords(p, [rec]);

    const res = readTail(p, 0);
    expect(res.records).toEqual([rec]);
    expect(res.nextOffset).toBe(statSync(p).size);
    // Bytes strictly exceed UTF-16 char count for this content — a
    // char-based offset would corrupt the next tail read.
    expect(res.nextOffset).toBeGreaterThan(JSON.stringify(rec).length + 1);
    expect(readTail(p, res.nextOffset).records).toEqual([]);
  });
});

// ── rollingAvg ───────────────────────────────────────────────────────────────

describe("rollingAvg", () => {
  test("averages tokensPerSec over the last k non-null records", () => {
    const recs: MetricRecord[] = [
      callRec(10),
      callRec(null),
      callRec(20),
      messageRec(30),
    ];
    expect(rollingAvg(recs, 2)).toBeCloseTo(25, 6); // (20 + 30) / 2
  });

  test("null tokensPerSec records do not consume k slots", () => {
    const recs: MetricRecord[] = [callRec(10), callRec(null), callRec(20)];
    expect(rollingAvg(recs, 2)).toBeCloseTo(15, 6); // (10 + 20) / 2
  });

  test("k larger than available non-null records averages all of them", () => {
    expect(rollingAvg([callRec(10), messageRec(20)], 5)).toBeCloseTo(15, 6);
  });

  test("returns null for empty input or all-null tokensPerSec", () => {
    expect(rollingAvg([], 3)).toBeNull();
    expect(rollingAvg([callRec(null), messageRec(null)], 3)).toBeNull();
  });

  test("returns null for k <= 0", () => {
    expect(rollingAvg([callRec(10)], 0)).toBeNull();
    expect(rollingAvg([callRec(10)], -1)).toBeNull();
  });

  test("includes both call and message records", () => {
    expect(rollingAvg([callRec(10), messageRec(30)], 2)).toBeCloseTo(20, 6);
  });
});
