/**
 * Contract tests for the node-free stats helpers (`./stats.ts`).
 *
 * `rollingAvg` (end-to-end, output-only `tokensPerSec`) is already pinned by
 * `transport.test.ts`; it is re-asserted here ONLY to prove the new
 * `rollingGenAvg` does not disturb it and that the two read different fields.
 *
 * Pinned API:
 *   rollingGenAvg(records: readonly MetricRecord[], k: number): number | null
 *     - mean of `genTokensPerSec` over the last `k` records (call OR message)
 *       that have a non-null `genTokensPerSec`; null records do NOT consume k
 *       slots; null when there is no qualifying record or k <= 0.
 *
 * RED phase: `rollingGenAvg` does not exist yet — this file fails to load with
 * "does not provide an export named 'rollingGenAvg'" until it is implemented.
 */

import { describe, expect, test } from "bun:test";
import { rollingAvg, rollingGenAvg } from "./stats.ts";
import type { CallMetric, MessageMetric, MetricRecord } from "./types.ts";

// ── Record builders (full literals — no `any`) ──────────────────────────────
//
// `genTokensPerSec` is the primary knob (mirrors how `transport.test.ts` keys
// `callRec`/`messageRec` off `tokensPerSec`). `tokensPerSec` is independently
// controllable so the independence test can drive the two fields apart.

function callRec(
  genTokensPerSec: number | null,
  at = 1,
  tokensPerSec: number | null = 10,
): CallMetric {
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
    durationMs: 1000,
    tokensPerSec,
    genDurationMs: genTokensPerSec === null ? null : 1000,
    genTokensPerSec,
    at,
  };
}

function messageRec(
  genTokensPerSec: number | null,
  at = 2,
  tokensPerSec: number | null = 10,
): MessageMetric {
  return {
    kind: "message",
    finish: "stop",
    steps: 1,
    responseText: "ok",
    sessionID: "ses_1",
    messageID: "msg_1",
    providerID: "anthropic",
    modelID: "claude-sonnet-4-6",
    mode: "build",
    tokens: { input: 10, output: 20, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
    cost: 0.002,
    ttftMs: null,
    durationMs: 1000,
    tokensPerSec,
    genDurationMs: genTokensPerSec === null ? null : 1000,
    genTokensPerSec,
    at,
  };
}

// ── rollingGenAvg ────────────────────────────────────────────────────────────

describe("rollingGenAvg", () => {
  test("averages genTokensPerSec over the last k non-null records", () => {
    const recs: MetricRecord[] = [
      callRec(10),
      callRec(null),
      callRec(20),
      messageRec(30),
    ];
    expect(rollingGenAvg(recs, 2)).toBeCloseTo(25, 6); // (20 + 30) / 2
  });

  test("null genTokensPerSec records do not consume k slots", () => {
    const recs: MetricRecord[] = [callRec(10), callRec(null), callRec(20)];
    expect(rollingGenAvg(recs, 2)).toBeCloseTo(15, 6); // (10 + 20) / 2
  });

  test("k larger than available non-null records averages all of them", () => {
    expect(rollingGenAvg([callRec(10), messageRec(20)], 5)).toBeCloseTo(15, 6);
  });

  test("returns null for empty input or all-null genTokensPerSec", () => {
    expect(rollingGenAvg([], 3)).toBeNull();
    expect(rollingGenAvg([callRec(null), messageRec(null)], 3)).toBeNull();
  });

  test("returns null for k <= 0", () => {
    expect(rollingGenAvg([callRec(10)], 0)).toBeNull();
    expect(rollingGenAvg([callRec(10)], -1)).toBeNull();
  });

  test("includes both call and message records", () => {
    expect(rollingGenAvg([callRec(10), messageRec(30)], 2)).toBeCloseTo(20, 6);
  });

  test("reads genTokensPerSec independently of tokensPerSec; rollingAvg unchanged", () => {
    // A: tokensPerSec=10, genTokensPerSec=null. B: tokensPerSec=null, genTokensPerSec=100.
    const a = callRec(null, 1, 10);
    const b = messageRec(100, 2, null);
    const recs: MetricRecord[] = [a, b];
    expect(rollingGenAvg(recs, 2)).toBeCloseTo(100, 6); // only B qualifies
    expect(rollingAvg(recs, 2)).toBeCloseTo(10, 6); // only A qualifies (back-compat)
  });
});
