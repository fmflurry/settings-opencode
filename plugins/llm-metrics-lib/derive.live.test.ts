/**
 * Contract tests for LIVE streaming tok/s: `message.part.delta` accumulation
 * in the reducer + the PURE `selectLive` selector.
 *
 * RED phase: `selectLive` is not yet exported from `./derive.ts` (and the
 * `message.part.delta` union member + `LiveSnapshot` + `charsPerToken` option
 * are missing from `./types.ts`) — this file fails to load
 * ("Export named 'selectLive' not found") until the implementer adds them.
 * The existing `derive.test.ts` stays fully green throughout; the new tests
 * live in their own file precisely so a missing named export cannot take down
 * the established coverage.
 *
 * Pinned API:
 *   MetricEvent ADDS a flattened member (top-level fields, NOT nested):
 *     { type: "message.part.delta"; sessionID: string; messageID: string;
 *       partID: string; field: string; delta: string }
 *   MetricsOptions ADDS optional `charsPerToken?: number` (default 4).
 *   LiveSnapshot:
 *     { sessionID: string; messageID: string; modelID: string; chars: number;
 *       estTokens: number; elapsedMs: number; liveTokensPerSec: number | null }
 *   selectLive(state, sessionID, now, charsPerToken = 4): LiveSnapshot | null
 *     - PURE: `now` is a parameter (`Date.now()` only in the caller).
 *     - estTokens = chars / charsPerToken;
 *       liveTokensPerSec = estTokens / (elapsedMs / 1000).
 *   reduceEvent's `{ state, records }` return shape is UNCHANGED; a delta
 *   event NEVER emits records (records: []) but DOES change state.
 *
 * Contract decisions (where the spec left a choice):
 *   1. Below the existing MIN_GEN_MS floor (elapsedMs < 50, INCLUDING
 *      elapsed 0) the snapshot is PRESENT — chars/estTokens/elapsedMs still
 *      reported — with liveTokensPerSec = null (never NaN/Infinity). NOT a
 *      null snapshot.
 *   2. Zero accumulated chars => NULL snapshot, even when a gen-start is set:
 *      the selector requires liveChars > 0 AND a known gen-start (nothing
 *      streamed => nothing live).
 *   3. selectLive's default charsPerToken is the literal parameter default 4,
 *      independent of state (MetricsOptions.charsPerToken is caller config
 *      the TUI passes through; the selector itself stays state-agnostic).
 *   4. A delta accumulates ONLY when the part's type — registered via a prior
 *      message.part.updated — is text/reasoning AND field === "text". Deltas
 *      for unknown partIDs, non-text parts (tool), or other fields are
 *      ignored. Deltas never alter boundary CallMetric/MessageMetric records.
 *   5. step-start AND step-finish reset live accumulation (live tracks the
 *      CURRENT step only); a new step restarts from zero (not cumulative).
 */

import { describe, expect, test } from "bun:test";
import { createMetricsState, reduceEvent, selectLive } from "./derive.ts";
import type {
  CallMetric,
  LiveSnapshot,
  MessageMetric,
  MetricEvent,
  MetricRecord,
  TokenCounts,
} from "./types.ts";

// ── Event-shape extraction (binds builders to the implementer's union) ──────

type MessageUpdatedEvent = Extract<MetricEvent, { type: "message.updated" }>;
type MessageInfo = MessageUpdatedEvent["info"];
type EventTokens = MessageInfo["tokens"];
type PartUpdatedEvent = Extract<MetricEvent, { type: "message.part.updated" }>;
type MetricPart = PartUpdatedEvent["part"];
type StepStartPartShape = Extract<MetricPart, { type: "step-start" }>;
type TextPartShape = Extract<MetricPart, { type: "text" }>;
type ReasoningPartShape = Extract<MetricPart, { type: "reasoning" }>;
type StepFinishPartShape = Extract<MetricPart, { type: "step-finish" }>;
/** The NEW flattened delta member; `never` until types.ts adds it. */
type PartDeltaEvent = Extract<MetricEvent, { type: "message.part.delta" }>;

// ── Constants ────────────────────────────────────────────────────────────────

const SESSION = "ses_test_1";
const MSG = "msg_test_1";
const PROVIDER = "anthropic";
const MODEL = "claude-sonnet-4-6";
const MODE = "build";
/** Fixed epoch-ms baseline so every timing assertion is deterministic. */
const T0 = 1_000_000;

// ── Synthetic event builders (typed literals — no `any`) ────────────────────

/** Nested event token shape {input,output,reasoning,cache:{read,write}}. */
function eventTokens(t: Partial<TokenCounts> = {}): EventTokens {
  return {
    input: t.input ?? 100,
    output: t.output ?? 50,
    reasoning: t.reasoning ?? 0,
    cache: { read: t.cacheRead ?? 0, write: t.cacheWrite ?? 0 },
  };
}

interface MsgOpts {
  id?: string;
  sessionID?: string;
  role?: string;
  providerID?: string;
  modelID?: string;
  mode?: string;
  cost?: number;
  finish?: string | null;
  created?: number;
  completed?: number;
  tokens?: EventTokens;
}

function messageUpdated(opts: MsgOpts = {}): MetricEvent {
  const info: MessageInfo = {
    id: opts.id ?? MSG,
    sessionID: opts.sessionID ?? SESSION,
    role: opts.role ?? "assistant",
    providerID: opts.providerID ?? PROVIDER,
    modelID: opts.modelID ?? MODEL,
    mode: opts.mode ?? MODE,
    cost: opts.cost ?? 0,
    time:
      opts.completed !== undefined
        ? { created: opts.created ?? T0, completed: opts.completed }
        : { created: opts.created ?? T0 },
    tokens: opts.tokens ?? eventTokens(),
  };
  if (opts.finish !== undefined) info.finish = opts.finish;
  return { type: "message.updated", info };
}

function stepStartEv(partID: string, messageID: string = MSG): MetricEvent {
  const part: StepStartPartShape = {
    id: partID,
    sessionID: SESSION,
    messageID,
    type: "step-start",
  };
  return { type: "message.part.updated", part };
}

interface TextOpts {
  messageID?: string;
  start?: number;
  end?: number;
}

function textEv(partID: string, text: string, opts: TextOpts = {}): MetricEvent {
  const part: TextPartShape = {
    id: partID,
    sessionID: SESSION,
    messageID: opts.messageID ?? MSG,
    type: "text",
    text,
  };
  if (opts.start !== undefined) {
    part.time =
      opts.end !== undefined
        ? { start: opts.start, end: opts.end }
        : { start: opts.start };
  }
  return { type: "message.part.updated", part };
}

function reasoningEv(partID: string, text: string, start: number): MetricEvent {
  const part: ReasoningPartShape = {
    id: partID,
    sessionID: SESSION,
    messageID: MSG,
    type: "reasoning",
    text,
    time: { start },
  };
  return { type: "message.part.updated", part };
}

interface StepFinishOpts {
  reason?: string;
  cost?: number;
  tokens?: StepFinishPartShape["tokens"];
}

function stepFinishEv(partID: string, opts: StepFinishOpts = {}): MetricEvent {
  const part: StepFinishPartShape = {
    id: partID,
    sessionID: SESSION,
    messageID: MSG,
    type: "step-finish",
    reason: opts.reason ?? "stop",
    cost: opts.cost ?? 0,
    tokens: opts.tokens ?? eventTokens(),
  };
  return { type: "message.part.updated", part };
}

/** Non-tracked part type; the reducer must still register its type so later
 *  deltas for this partID can be classified (and ignored). */
function toolPartEv(partID: string, messageID: string = MSG): MetricEvent {
  return {
    type: "message.part.updated",
    part: { id: partID, sessionID: SESSION, messageID, type: "tool", tool: "bash" },
  } as unknown as MetricEvent;
}

interface DeltaOpts {
  sessionID?: string;
  messageID?: string;
  field?: string;
}

/** Flattened `message.part.delta` event (top-level sessionID/messageID/
 *  partID/field/delta — NOT nested under `part`). */
function deltaEv(partID: string, delta: string, opts: DeltaOpts = {}): MetricEvent {
  const ev: PartDeltaEvent = {
    type: "message.part.delta",
    sessionID: opts.sessionID ?? SESSION,
    messageID: opts.messageID ?? MSG,
    partID,
    field: opts.field ?? "text",
    delta,
  };
  return ev;
}

// ── Test helpers ─────────────────────────────────────────────────────────────

/** Threads state through reduceEvent calls; `current()` exposes it for the
 *  pure selector (selectors read state; they never advance it). */
function feeder(initial: ReturnType<typeof createMetricsState> = createMetricsState()) {
  let state = initial;
  const push = (ev: MetricEvent): MetricRecord[] => {
    const result = reduceEvent(state, ev);
    state = result.state;
    return result.records;
  };
  const current = (): ReturnType<typeof createMetricsState> => state;
  return { push, current };
}

const callsOf = (rs: MetricRecord[]): CallMetric[] =>
  rs.filter((r): r is CallMetric => r.kind === "call");
const messagesOf = (rs: MetricRecord[]): MessageMetric[] =>
  rs.filter((r): r is MessageMetric => r.kind === "message");

// ── Delta accumulation ───────────────────────────────────────────────────────

describe("delta accumulation (message.part.delta)", () => {
  test("text part deltas accumulate into a live snapshot (chars/estTokens/elapsed/tok-s)", () => {
    const { push, current } = feeder();
    push(messageUpdated({ created: T0 }));
    push(stepStartEv("s1"));
    push(textEv("t1", "", { start: T0 })); // gen-start = part time.start = T0
    push(deltaEv("t1", "x".repeat(100)));
    push(deltaEv("t1", "x".repeat(150)));
    push(deltaEv("t1", "x".repeat(150)));

    const snap: LiveSnapshot | null = selectLive(current(), SESSION, T0 + 1000, 4);
    expect(snap).not.toBeNull();
    expect(snap!.sessionID).toBe(SESSION);
    expect(snap!.messageID).toBe(MSG);
    expect(snap!.modelID).toBe(MODEL);
    expect(snap!.chars).toBe(400);
    expect(snap!.estTokens).toBe(100); // 400 / 4
    expect(snap!.elapsedMs).toBe(1000);
    expect(snap!.liveTokensPerSec).toBeCloseTo(100, 6); // 100 / 1s
  });

  test("reasoning part deltas also accumulate", () => {
    const { push, current } = feeder();
    push(messageUpdated({ created: T0 }));
    push(stepStartEv("s1"));
    push(reasoningEv("r1", "", T0));
    push(deltaEv("r1", "x".repeat(120)));
    push(deltaEv("r1", "x".repeat(80)));

    const snap = selectLive(current(), SESSION, T0 + 1000, 4);
    expect(snap).not.toBeNull();
    expect(snap!.chars).toBe(200);
    expect(snap!.estTokens).toBe(50); // 200 / 4
    expect(snap!.liveTokensPerSec).toBeCloseTo(50, 6); // 50 / 1s
  });

  test("delta for a non-text part (tool) is NOT accumulated", () => {
    const { push, current } = feeder();
    push(messageUpdated({ created: T0 }));
    push(stepStartEv("s1"));
    push(toolPartEv("tool1"));
    push(deltaEv("tool1", "x".repeat(100)));
    expect(selectLive(current(), SESSION, T0 + 1000, 4)).toBeNull();
  });

  test("delta with field !== 'text' is NOT accumulated", () => {
    const { push, current } = feeder();
    push(messageUpdated({ created: T0 }));
    push(stepStartEv("s1"));
    push(textEv("t1", "", { start: T0 }));
    push(deltaEv("t1", "x".repeat(100), { field: "summary" }));
    // Gen-start is known but nothing was streamed => null (not a 0-char snapshot).
    expect(selectLive(current(), SESSION, T0 + 1000, 4)).toBeNull();
  });

  test("delta for an UNKNOWN partID (no prior part.updated) is NOT accumulated", () => {
    const { push, current } = feeder();
    push(messageUpdated({ created: T0 }));
    push(stepStartEv("s1"));
    push(deltaEv("part_never_seen", "x".repeat(100)));
    expect(selectLive(current(), SESSION, T0 + 1000, 4)).toBeNull();
  });

  test("delta emits NO records, keeps the {state, records} shape, and changes state", () => {
    const { push, current } = feeder();
    push(messageUpdated({ created: T0 }));
    push(stepStartEv("s1"));
    push(textEv("t1", "", { start: T0 }));

    const result = reduceEvent(current(), deltaEv("t1", "x".repeat(100)));
    // Return shape UNCHANGED: exactly { state, records }.
    expect(Object.keys(result).sort()).toEqual(["records", "state"]);
    expect(result.records).toEqual([]);
    // State observably changed: the accumulation is visible to selectLive.
    const snap = selectLive(result.state, SESSION, T0 + 1000, 4);
    expect(snap).not.toBeNull();
    expect(snap!.chars).toBe(100);
  });
});

// ── selectLive behavior ──────────────────────────────────────────────────────

describe("selectLive behavior", () => {
  test("nothing streaming (fresh state / no deltas) => null", () => {
    expect(selectLive(createMetricsState(), SESSION, T0 + 1000, 4)).toBeNull();

    const { push, current } = feeder();
    push(messageUpdated({ created: T0 }));
    push(stepStartEv("s1"));
    expect(selectLive(current(), SESSION, T0 + 1000, 4)).toBeNull();
  });

  test("elapsed < MIN_GEN_MS => snapshot PRESENT with liveTokensPerSec null", () => {
    const { push, current } = feeder();
    push(messageUpdated({ created: T0 }));
    push(stepStartEv("s1"));
    push(textEv("t1", "", { start: T0 }));
    push(deltaEv("t1", "x".repeat(400)));

    const snap: LiveSnapshot | null = selectLive(current(), SESSION, T0 + 10, 4);
    expect(snap).not.toBeNull();
    expect(snap!.chars).toBe(400);
    expect(snap!.estTokens).toBe(100);
    expect(snap!.elapsedMs).toBe(10);
    expect(snap!.liveTokensPerSec).toBeNull(); // NOT huge/Infinity
  });

  test("boundary: elapsed exactly 50ms computed, 49ms null", () => {
    const { push, current } = feeder();
    push(messageUpdated({ created: T0 }));
    push(stepStartEv("s1"));
    push(textEv("t1", "", { start: T0 }));
    push(deltaEv("t1", "x".repeat(200))); // estTokens = 50

    const at50 = selectLive(current(), SESSION, T0 + 50, 4);
    expect(at50!.elapsedMs).toBe(50);
    expect(at50!.liveTokensPerSec).toBeCloseTo(1000, 6); // 50 / 0.05s

    const at49 = selectLive(current(), SESSION, T0 + 49, 4);
    expect(at49!.elapsedMs).toBe(49);
    expect(at49!.liveTokensPerSec).toBeNull();
  });

  test("charsPerToken: default 4 when omitted; custom 2 doubles estTokens + rate", () => {
    const { push, current } = feeder();
    push(messageUpdated({ created: T0 }));
    push(stepStartEv("s1"));
    push(textEv("t1", "", { start: T0 }));
    push(deltaEv("t1", "x".repeat(400)));

    const def = selectLive(current(), SESSION, T0 + 1000); // omitted => 4
    expect(def!.estTokens).toBe(100);
    expect(def!.liveTokensPerSec).toBeCloseTo(100, 6);

    const c2 = selectLive(current(), SESSION, T0 + 1000, 2);
    expect(c2!.estTokens).toBe(200);
    expect(c2!.liveTokensPerSec).toBeCloseTo(200, 6);
  });

  test("elapsed 0 (now === genStart) => liveTokensPerSec null (no NaN/Infinity)", () => {
    const { push, current } = feeder();
    push(messageUpdated({ created: T0 }));
    push(stepStartEv("s1"));
    push(textEv("t1", "", { start: T0 }));
    push(deltaEv("t1", "x".repeat(100)));

    const snap = selectLive(current(), SESSION, T0, 4);
    expect(snap).not.toBeNull();
    expect(snap!.elapsedMs).toBe(0);
    expect(snap!.chars).toBe(100);
    expect(snap!.liveTokensPerSec).toBeNull();
  });

  test("zero chars with a gen-start set => null (nothing streamed yet)", () => {
    const { push, current } = feeder();
    push(messageUpdated({ created: T0 }));
    push(stepStartEv("s1"));
    push(textEv("t1", "", { start: T0 })); // gen-start known, no deltas yet
    expect(selectLive(current(), SESSION, T0 + 1000, 4)).toBeNull();
  });

  test("multiple messages in a session => selects the one currently streaming", () => {
    const { push, current } = feeder();
    // msg_idle: timed text part but NO deltas => not streaming.
    push(messageUpdated({ id: "msg_idle", created: T0 }));
    push(stepStartEv("s_idle", "msg_idle"));
    push(textEv("t_idle", "done", { messageID: "msg_idle", start: T0, end: T0 + 500 }));
    // msg_live: actively accumulating deltas.
    push(messageUpdated({ id: "msg_live", created: T0 }));
    push(stepStartEv("s_live", "msg_live"));
    push(textEv("t_live", "", { messageID: "msg_live", start: T0 }));
    push(deltaEv("t_live", "x".repeat(100), { messageID: "msg_live" }));

    const snap = selectLive(current(), SESSION, T0 + 1000, 4);
    expect(snap).not.toBeNull();
    expect(snap!.messageID).toBe("msg_live");
    expect(snap!.chars).toBe(100);
  });
});

// ── Live lifecycle & reset ───────────────────────────────────────────────────

describe("live lifecycle & reset", () => {
  test("step-start resets live accumulation", () => {
    const { push, current } = feeder();
    push(messageUpdated({ created: T0 }));
    push(stepStartEv("s1"));
    push(textEv("t1", "", { start: T0 }));
    push(deltaEv("t1", "x".repeat(400)));
    expect(selectLive(current(), SESSION, T0 + 1000, 4)).not.toBeNull(); // sanity

    push(stepStartEv("s2"));
    expect(selectLive(current(), SESSION, T0 + 1000, 4)).toBeNull();
  });

  test("step-finish resets live AND still emits its CallMetric (back-compat)", () => {
    const { push, current } = feeder();
    push(messageUpdated({ created: T0 }));
    push(stepStartEv("s1"));
    push(textEv("t1", "Hello", { start: T0, end: T0 + 1000 }));
    push(deltaEv("t1", "Hello"));

    const recs = push(stepFinishEv("s1", { tokens: eventTokens({ output: 100 }) }));
    // Normal emission intact: exactly one CallMetric with the usual timing.
    expect(callsOf(recs)).toHaveLength(1);
    expect(callsOf(recs)[0]!.durationMs).toBe(1000);
    expect(callsOf(recs)[0]!.tokensPerSec).toBeCloseTo(100, 6); // 100 / 1s
    // Live accumulation cleared by the step boundary.
    expect(selectLive(current(), SESSION, T0 + 2000, 4)).toBeNull();
  });

  test("after step-finish, a NEW step's deltas accumulate fresh (not cumulative)", () => {
    const { push, current } = feeder();
    push(messageUpdated({ created: T0 }));
    push(stepStartEv("s1"));
    push(textEv("t1", "", { start: T0 }));
    push(deltaEv("t1", "x".repeat(400)));
    push(stepFinishEv("s1", { tokens: eventTokens({ output: 100 }) }));

    const T1 = T0 + 5000;
    push(stepStartEv("s2"));
    push(textEv("t2", "", { start: T1 }));
    push(deltaEv("t2", "x".repeat(100)));

    const snap = selectLive(current(), SESSION, T1 + 1000, 4);
    expect(snap).not.toBeNull();
    expect(snap!.chars).toBe(100); // NOT 500 — restarted at the step boundary
    expect(snap!.estTokens).toBe(25); // 100 / 4
    expect(snap!.elapsedMs).toBe(1000); // from t2's start, not T0
    expect(snap!.liveTokensPerSec).toBeCloseTo(25, 6); // 25 / 1s
  });
});

// ── Back-compat ──────────────────────────────────────────────────────────────

describe("live streaming — back-compat", () => {
  test("interleaved deltas do NOT alter emitted CallMetric/MessageMetric", () => {
    const run = (withDeltas: boolean): MetricRecord[] => {
      const { push } = feeder();
      const all: MetricRecord[] = [];
      all.push(...push(messageUpdated({ created: T0 })));
      all.push(...push(stepStartEv("s1")));
      all.push(...push(textEv("t1", "Hello world", { start: T0 + 500, end: T0 + 2500 })));
      if (withDeltas) {
        all.push(...push(deltaEv("t1", "Hello")));
        all.push(...push(deltaEv("t1", " world")));
      }
      all.push(
        ...push(
          stepFinishEv("s1", {
            reason: "stop",
            cost: 0.001,
            tokens: eventTokens({ output: 100 }),
          }),
        ),
      );
      all.push(
        ...push(
          messageUpdated({
            created: T0,
            completed: T0 + 3000,
            finish: "stop",
            cost: 0.003,
            tokens: eventTokens({ input: 1000, output: 300 }),
          }),
        ),
      );
      return all;
    };

    const plain = run(false);
    const streamed = run(true);

    // Deltas emitted nothing themselves: still exactly 1 call + 1 message.
    expect(callsOf(streamed)).toHaveLength(1);
    expect(messagesOf(streamed)).toHaveLength(1);

    // Boundary metrics are byte-identical to the no-delta flow (modulo `at`).
    const strip = (rs: MetricRecord[]): MetricRecord[] =>
      rs.map((r) => ({ ...r, at: 0 }));
    expect(strip(streamed)).toEqual(strip(plain));

    // Headline + generation rates explicitly unchanged.
    expect(callsOf(streamed)[0]!.tokensPerSec).toBeCloseTo(50, 6); // 100 / 2s
    expect(callsOf(streamed)[0]!.genTokensPerSec).toBe(
      callsOf(plain)[0]!.genTokensPerSec,
    );
    expect(messagesOf(streamed)[0]!.tokensPerSec).toBeCloseTo(100, 6); // 300 / 3s
    expect(messagesOf(streamed)[0]!.genTokensPerSec).toBe(
      messagesOf(plain)[0]!.genTokensPerSec,
    );
    // responseText still comes from part.text, NOT from deltas.
    expect(messagesOf(streamed)[0]!.responseText).toBe("Hello world");
  });
});
