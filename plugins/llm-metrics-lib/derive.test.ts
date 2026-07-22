/**
 * Contract tests for the llm-metrics derivation reducer.
 *
 * RED phase: `./derive.ts` and `./types.ts` do not exist yet — these tests
 * fail with "Cannot find module" until the implementer creates them.
 *
 * Pinned API:
 *   createMetricsState(options?: { captureText?: boolean; maxText?: number }): MetricsState
 *     - defaults: captureText = true, maxText = 4000
 *   reduceEvent(state, event: MetricEvent): { state: MetricsState; records: MetricRecord[] }
 *     - PURE: returns a new state, never mutates the input; no side effects.
 *
 * Contract decisions (where the spec left a choice):
 *   1. Options are baked into state creation; reduceEvent is 2-arg.
 *   2. Zero output tokens with a valid duration => tokensPerSec = 0 (never
 *      NaN/Infinity). Missing/invalid duration (no timed parts, zero, or
 *      negative) => durationMs = null AND tokensPerSec = null.
 *   3. Truncation: full.length > maxText => responseText = full.slice(0, maxText) + "...".
 *      Text parts are joined with "\n" in first-seen order; synthetic parts skipped.
 *      Re-updates of the same part ID REPLACE the stored text (latest `text`
 *      wins; `delta` is ignored — `part.text` is authoritative).
 *   4. Emission timing: one CallMetric in the step-finish reduction result
 *      (every step-finish emits exactly one, even without a matching
 *      step-start — duration/tok/s null then); one MessageMetric in the
 *      final message.updated reduction result.
 *   5. MessageMetric emits only when finish != null AND time.completed is a
 *      number; at most once per messageID (repeated finals => no records).
 *   6. CallMetric.ttftMs carries the message-level TTFT (earliest part
 *      time.start seen so far for the message - message.time.created); null
 *      when either side is unknown. CallMetric providerID/modelID/mode come
 *      from the latest message.updated info for that message; "" when none.
 *   7. Step window = text/reasoning parts after the matching step-start up
 *      to this step-finish (FIFO pairing). stepDurationMs =
 *      max(part.time.end) - min(part.time.start) over timed parts in window.
 *   8. LRU cap = exactly 200 tracked messages; any event for a tracked
 *      message refreshes its recency. Eviction FORGETS state (no tombstone):
 *      a later self-contained final still emits, with empty accumulation.
 *      message.removed TOMBSTONES the ID: later events never emit.
 *   9. `at` = epoch ms at emission; asserted > 0 and <= Date.now().
 */

import { describe, expect, test } from "bun:test";
import { createMetricsState, reduceEvent } from "./derive.ts";
import type {
  CallMetric,
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
  synthetic?: boolean;
  start?: number;
  end?: number;
  delta?: string;
}

function textEv(partID: string, text: string, opts: TextOpts = {}): MetricEvent {
  const part: TextPartShape = {
    id: partID,
    sessionID: SESSION,
    messageID: opts.messageID ?? MSG,
    type: "text",
    text,
  };
  if (opts.synthetic === true) part.synthetic = true;
  if (opts.start !== undefined) {
    part.time =
      opts.end !== undefined
        ? { start: opts.start, end: opts.end }
        : { start: opts.start };
  }
  const event: PartUpdatedEvent = { type: "message.part.updated", part };
  if (opts.delta !== undefined) event.delta = opts.delta;
  return event;
}

interface ReasoningOpts {
  messageID?: string;
  end?: number;
}

function reasoningEv(
  partID: string,
  text: string,
  start: number,
  opts: ReasoningOpts = {},
): MetricEvent {
  const part: ReasoningPartShape = {
    id: partID,
    sessionID: SESSION,
    messageID: opts.messageID ?? MSG,
    type: "reasoning",
    text,
    time: opts.end !== undefined ? { start, end: opts.end } : { start },
  };
  return { type: "message.part.updated", part };
}

interface StepFinishOpts {
  messageID?: string;
  reason?: string;
  cost?: number;
  tokens?: StepFinishPartShape["tokens"];
}

function stepFinishEv(partID: string, opts: StepFinishOpts = {}): MetricEvent {
  const part: StepFinishPartShape = {
    id: partID,
    sessionID: SESSION,
    messageID: opts.messageID ?? MSG,
    type: "step-finish",
    reason: opts.reason ?? "stop",
    cost: opts.cost ?? 0,
    tokens: opts.tokens ?? eventTokens(),
  };
  return { type: "message.part.updated", part };
}

function removedEv(messageID: string): MetricEvent {
  return { type: "message.removed", messageID };
}

// ── Test helpers ─────────────────────────────────────────────────────────────

/** Threads state through a sequence of reduceEvent calls. */
function feeder(initial: ReturnType<typeof createMetricsState> = createMetricsState()) {
  let state = initial;
  const push = (ev: MetricEvent): MetricRecord[] => {
    const result = reduceEvent(state, ev);
    state = result.state;
    return result.records;
  };
  return { push };
}

const callsOf = (rs: MetricRecord[]): CallMetric[] =>
  rs.filter((r): r is CallMetric => r.kind === "call");
const messagesOf = (rs: MetricRecord[]): MessageMetric[] =>
  rs.filter((r): r is MessageMetric => r.kind === "message");

// ── Message-level metrics ────────────────────────────────────────────────────

describe("message-level metrics", () => {
  test("final message.updated emits a fully-populated MessageMetric + per-step CallMetric", () => {
    const { push } = feeder();

    // Non-final update and part events accumulate silently.
    expect(push(messageUpdated({ created: T0 }))).toHaveLength(0);
    expect(push(stepStartEv("part_s1"))).toHaveLength(0);
    expect(
      push(textEv("part_t1", "Hello world", { start: T0 + 500, end: T0 + 2500 })),
    ).toHaveLength(0);

    // step-finish emits exactly one CallMetric.
    const callRecs = push(
      stepFinishEv("part_s1", {
        reason: "stop",
        cost: 0.001,
        tokens: eventTokens({ output: 100 }),
      }),
    );
    expect(callsOf(callRecs)).toHaveLength(1);
    expect(messagesOf(callRecs)).toHaveLength(0);

    // Final message.updated emits exactly one MessageMetric.
    const msgRecs = push(
      messageUpdated({
        created: T0,
        completed: T0 + 3000,
        finish: "stop",
        cost: 0.003,
        tokens: eventTokens({
          input: 1000,
          output: 300,
          reasoning: 50,
          cacheRead: 200,
          cacheWrite: 25,
        }),
      }),
    );
    expect(messagesOf(msgRecs)).toHaveLength(1);
    expect(callsOf(msgRecs)).toHaveLength(0);

    const call = callsOf(callRecs)[0];
    expect(call.kind).toBe("call");
    expect(call.partID).toBe("part_s1");
    expect(call.finishReason).toBe("stop");
    expect(call.sessionID).toBe(SESSION);
    expect(call.messageID).toBe(MSG);
    expect(call.providerID).toBe(PROVIDER);
    expect(call.modelID).toBe(MODEL);
    expect(call.mode).toBe(MODE);
    expect(call.tokens).toEqual({
      input: 100,
      output: 100,
      reasoning: 0,
      cacheRead: 0,
      cacheWrite: 0,
    });
    expect(call.cost).toBe(0.001);
    expect(call.durationMs).toBe(2000); // 2500 - 500
    expect(call.tokensPerSec).toBeCloseTo(50, 6); // 100 / 2s
    expect(call.ttftMs).toBe(500); // message-level TTFT
    expect(call.at).toBeGreaterThan(0);
    expect(call.at).toBeLessThanOrEqual(Date.now());

    const msg = messagesOf(msgRecs)[0];
    expect(msg.kind).toBe("message");
    expect(msg.finish).toBe("stop");
    expect(msg.steps).toBe(1);
    expect(msg.responseText).toBe("Hello world");
    expect(msg.sessionID).toBe(SESSION);
    expect(msg.messageID).toBe(MSG);
    expect(msg.providerID).toBe(PROVIDER);
    expect(msg.modelID).toBe(MODEL);
    expect(msg.mode).toBe(MODE);
    expect(msg.tokens).toEqual({
      input: 1000,
      output: 300,
      reasoning: 50,
      cacheRead: 200,
      cacheWrite: 25,
    });
    expect(msg.cost).toBe(0.003);
    expect(msg.durationMs).toBe(3000); // completed - created (NOT part times)
    expect(msg.tokensPerSec).toBeCloseTo(100, 6); // 300 / 3s
    expect(msg.ttftMs).toBe(500);
    expect(msg.at).toBeGreaterThan(0);
    expect(msg.at).toBeLessThanOrEqual(Date.now());
  });

  test("non-final message.updated (no finish) emits no records", () => {
    const { push } = feeder();
    expect(push(messageUpdated({ created: T0 }))).toHaveLength(0);
  });

  test("finish without time.completed emits no MessageMetric", () => {
    const { push } = feeder();
    push(messageUpdated({ created: T0 }));
    expect(push(messageUpdated({ created: T0, finish: "stop" }))).toHaveLength(0);
  });

  test("emits for any non-null finish reason (e.g. 'length')", () => {
    const { push } = feeder();
    push(messageUpdated({ created: T0 }));
    const recs = push(
      messageUpdated({
        created: T0,
        completed: T0 + 1000,
        finish: "length",
        tokens: eventTokens({ output: 100 }),
      }),
    );
    const msg = messagesOf(recs)[0];
    expect(msg).toBeDefined();
    expect(msg!.finish).toBe("length");
    expect(msg!.tokensPerSec).toBeCloseTo(100, 6);
  });

  test("zero output tokens with valid duration => tokensPerSec = 0 (not NaN)", () => {
    const { push } = feeder();
    push(messageUpdated({ created: T0 }));
    const recs = push(
      messageUpdated({
        created: T0,
        completed: T0 + 1000,
        finish: "stop",
        tokens: eventTokens({ output: 0 }),
      }),
    );
    const msg = messagesOf(recs)[0];
    expect(msg).toBeDefined();
    expect(msg!.durationMs).toBe(1000);
    expect(msg!.tokensPerSec).toBe(0);
  });

  test("zero or negative message duration => durationMs and tokensPerSec null", () => {
    const { push } = feeder();
    push(messageUpdated({ id: "msg_zero", created: T0 }));
    const zero = push(
      messageUpdated({ id: "msg_zero", created: T0, completed: T0, finish: "stop" }),
    );
    expect(messagesOf(zero)[0]!.durationMs).toBeNull();
    expect(messagesOf(zero)[0]!.tokensPerSec).toBeNull();

    push(messageUpdated({ id: "msg_neg", created: T0 }));
    const neg = push(
      messageUpdated({ id: "msg_neg", created: T0, completed: T0 - 100, finish: "stop" }),
    );
    expect(messagesOf(neg)[0]!.durationMs).toBeNull();
    expect(messagesOf(neg)[0]!.tokensPerSec).toBeNull();
  });

  test("ttftMs null when no part carries timing", () => {
    const { push } = feeder();
    push(messageUpdated({ created: T0 }));
    push(stepStartEv("s1"));
    push(textEv("t1", "Hi")); // text without time
    const callRecs = push(stepFinishEv("s1"));
    const recs = push(
      messageUpdated({ created: T0, completed: T0 + 1000, finish: "stop" }),
    );
    expect(messagesOf(recs)[0]!.ttftMs).toBeNull();
    expect(messagesOf(recs)[0]!.responseText).toBe("Hi"); // untimed text still captured
    expect(callsOf(callRecs)[0]!.durationMs).toBeNull();
    expect(callsOf(callRecs)[0]!.tokensPerSec).toBeNull();
  });

  test("ttftMs uses the earliest start across text AND reasoning parts", () => {
    const { push } = feeder();
    push(messageUpdated({ created: T0 }));
    push(stepStartEv("s1"));
    push(reasoningEv("r1", "thinking", T0 + 200, { end: T0 + 300 }));
    push(textEv("t1", "answer", { start: T0 + 500, end: T0 + 900 }));
    push(stepFinishEv("s1"));
    const recs = push(
      messageUpdated({ created: T0, completed: T0 + 1000, finish: "stop" }),
    );
    expect(messagesOf(recs)[0]!.ttftMs).toBe(200);
  });

  test("message with no parts => steps 0, empty responseText, null ttft", () => {
    const { push } = feeder();
    push(messageUpdated({ created: T0 }));
    const recs = push(
      messageUpdated({ created: T0, completed: T0 + 1000, finish: "stop" }),
    );
    const msg = messagesOf(recs)[0];
    expect(msg).toBeDefined();
    expect(msg!.steps).toBe(0);
    expect(msg!.responseText).toBe("");
    expect(msg!.ttftMs).toBeNull();
    expect(msg!.durationMs).toBe(1000);
  });
});

// ── Per-call (step) metrics ──────────────────────────────────────────────────

describe("per-call (step) metrics", () => {
  test("step with no timed parts => durationMs/tokensPerSec null (not NaN/Infinity/0)", () => {
    const { push } = feeder();
    push(messageUpdated({ created: T0 }));
    push(stepStartEv("s1"));
    const recs = push(stepFinishEv("s1", { tokens: eventTokens({ output: 100 }) }));
    const call = callsOf(recs)[0];
    expect(callsOf(recs)).toHaveLength(1);
    expect(call!.durationMs).toBeNull();
    expect(call!.tokensPerSec).toBeNull();
  });

  test("parts with start but no end => duration null", () => {
    const { push } = feeder();
    push(messageUpdated({ created: T0 }));
    push(stepStartEv("s1"));
    push(textEv("t1", "streaming…", { start: T0 + 100 })); // no end yet
    const recs = push(stepFinishEv("s1"));
    expect(callsOf(recs)[0]!.durationMs).toBeNull();
    expect(callsOf(recs)[0]!.tokensPerSec).toBeNull();
  });

  test("zero-length step (end === start) => duration null", () => {
    const { push } = feeder();
    push(messageUpdated({ created: T0 }));
    push(stepStartEv("s1"));
    push(textEv("t1", "x", { start: T0 + 500, end: T0 + 500 }));
    const recs = push(stepFinishEv("s1"));
    expect(callsOf(recs)[0]!.durationMs).toBeNull();
    expect(callsOf(recs)[0]!.tokensPerSec).toBeNull();
  });

  test("negative step duration (end < start) => duration null", () => {
    const { push } = feeder();
    push(messageUpdated({ created: T0 }));
    push(stepStartEv("s1"));
    push(textEv("t1", "x", { start: T0 + 900, end: T0 + 500 }));
    const recs = push(stepFinishEv("s1"));
    expect(callsOf(recs)[0]!.durationMs).toBeNull();
    expect(callsOf(recs)[0]!.tokensPerSec).toBeNull();
  });

  test("zero output tokens with valid step duration => tokensPerSec = 0", () => {
    const { push } = feeder();
    push(messageUpdated({ created: T0 }));
    push(stepStartEv("s1"));
    push(textEv("t1", "x", { start: T0 + 100, end: T0 + 600 }));
    const recs = push(stepFinishEv("s1", { tokens: eventTokens({ output: 0 }) }));
    const call = callsOf(recs)[0];
    expect(call!.durationMs).toBe(500);
    expect(call!.tokensPerSec).toBe(0);
  });

  test("step-finish without step-start still emits a CallMetric with nulls", () => {
    const { push } = feeder();
    const recs = push(stepFinishEv("s1"));
    const call = callsOf(recs)[0];
    expect(callsOf(recs)).toHaveLength(1);
    expect(call!.partID).toBe("s1");
    expect(call!.durationMs).toBeNull();
    expect(call!.tokensPerSec).toBeNull();
    expect(call!.ttftMs).toBeNull();
  });

  test("step before any message.updated => timing computed, identity fields empty", () => {
    const { push } = feeder();
    push(stepStartEv("s1"));
    push(textEv("t1", "x", { start: T0 + 100, end: T0 + 300 }));
    const recs = push(stepFinishEv("s1", { tokens: eventTokens({ output: 40 }) }));
    const call = callsOf(recs)[0];
    expect(call!.durationMs).toBe(200);
    expect(call!.tokensPerSec).toBeCloseTo(200, 6); // 40 / 0.2s
    expect(call!.providerID).toBe("");
    expect(call!.modelID).toBe("");
    expect(call!.mode).toBe("");
    expect(call!.ttftMs).toBeNull(); // message.time.created unknown
    expect(call!.sessionID).toBe(SESSION);
    expect(call!.messageID).toBe(MSG);
  });

  test("reasoning parts count toward step duration and message TTFT", () => {
    const { push } = feeder();
    push(messageUpdated({ created: T0 }));
    push(stepStartEv("s1"));
    push(reasoningEv("r1", "hmm", T0 + 100, { end: T0 + 400 }));
    push(textEv("t1", "ok", { start: T0 + 500, end: T0 + 700 }));
    const callRecs = push(stepFinishEv("s1", { tokens: eventTokens({ output: 60 }) }));
    const call = callsOf(callRecs)[0];
    expect(call!.durationMs).toBe(600); // max(400,700) - min(100,500)
    expect(call!.tokensPerSec).toBeCloseTo(100, 6); // 60 / 0.6s
    expect(call!.ttftMs).toBe(100);

    const recs = push(
      messageUpdated({ created: T0, completed: T0 + 1000, finish: "stop" }),
    );
    expect(messagesOf(recs)[0]!.ttftMs).toBe(100);
  });
});

// ── Multi-step aggregation ───────────────────────────────────────────────────

describe("multi-step aggregation", () => {
  test("3-step message emits 3 CallMetrics + 1 MessageMetric with steps === 3", () => {
    const { push } = feeder();
    const all: MetricRecord[] = [];

    all.push(...push(messageUpdated({ created: T0 })));

    // Step 1: text, timed.
    all.push(...push(stepStartEv("s1")));
    all.push(...push(textEv("t1", "First", { start: T0 + 100, end: T0 + 200 })));
    const sf1 = push(stepFinishEv("s1", { reason: "tool-use", tokens: eventTokens({ output: 10 }) }));
    expect(callsOf(sf1)).toHaveLength(1);
    all.push(...sf1);

    // Step 2: no timed parts (tool-only step).
    all.push(...push(stepStartEv("s2")));
    const sf2 = push(stepFinishEv("s2", { reason: "tool-use", tokens: eventTokens({ output: 20 }) }));
    expect(callsOf(sf2)).toHaveLength(1);
    all.push(...sf2);

    // Step 3: text, timed.
    all.push(...push(stepStartEv("s3")));
    all.push(...push(textEv("t2", "Second", { start: T0 + 500, end: T0 + 900 })));
    const sf3 = push(stepFinishEv("s3", { reason: "stop", tokens: eventTokens({ output: 40 }) }));
    expect(callsOf(sf3)).toHaveLength(1);
    all.push(...sf3);

    // Final aggregate.
    const fin = push(
      messageUpdated({
        created: T0,
        completed: T0 + 1000,
        finish: "stop",
        tokens: eventTokens({ output: 70 }),
      }),
    );
    expect(messagesOf(fin)).toHaveLength(1);
    all.push(...fin);

    const calls = callsOf(all);
    expect(calls).toHaveLength(3);

    // Per-step timing is scoped to each step's own parts.
    expect(calls[0].durationMs).toBe(100);
    expect(calls[0].tokensPerSec).toBeCloseTo(100, 6); // 10 / 0.1s
    expect(calls[0].finishReason).toBe("tool-use");
    expect(calls[1].durationMs).toBeNull();
    expect(calls[1].tokensPerSec).toBeNull();
    expect(calls[1].finishReason).toBe("tool-use");
    expect(calls[2].durationMs).toBe(400);
    expect(calls[2].tokensPerSec).toBeCloseTo(100, 6); // 40 / 0.4s
    expect(calls[2].finishReason).toBe("stop");

    const msg = messagesOf(all)[0];
    expect(messagesOf(all)).toHaveLength(1);
    expect(msg.steps).toBe(3);
    expect(msg.responseText).toBe("First\nSecond");
    expect(msg.ttftMs).toBe(100);
    expect(msg.durationMs).toBe(1000);
    expect(msg.tokensPerSec).toBeCloseTo(70, 6); // 70 / 1s
    expect(msg.finish).toBe("stop");
  });
});

// ── Response text capture ────────────────────────────────────────────────────

describe("response text capture", () => {
  test("joins non-synthetic text parts in first-seen order with '\\n'", () => {
    const { push } = feeder();
    push(messageUpdated({ created: T0 }));
    push(textEv("ta", "Alpha"));
    push(textEv("tb", "SYS-NOISE", { synthetic: true }));
    push(textEv("tc", "Beta"));
    const recs = push(
      messageUpdated({ created: T0, completed: T0 + 1000, finish: "stop" }),
    );
    expect(messagesOf(recs)[0]!.responseText).toBe("Alpha\nBeta");
  });

  test("part re-update replaces stored text (latest wins, delta ignored)", () => {
    const { push } = feeder();
    push(messageUpdated({ created: T0 }));
    push(textEv("t1", "Hello", { start: T0 + 100, delta: "Hello" }));
    push(textEv("t1", "Hello world", { start: T0 + 100, end: T0 + 500, delta: " world" }));
    const recs = push(
      messageUpdated({ created: T0, completed: T0 + 1000, finish: "stop" }),
    );
    expect(messagesOf(recs)[0]!.responseText).toBe("Hello world");
  });

  test("respects maxText: truncates to slice(0, maxText) + '...'", () => {
    const { push } = feeder(createMetricsState({ maxText: 10 }));
    push(messageUpdated({ created: T0 }));
    push(textEv("t1", "abcdefghijklmnopqrstuvwxyz"));
    const recs = push(
      messageUpdated({ created: T0, completed: T0 + 1000, finish: "stop" }),
    );
    expect(messagesOf(recs)[0]!.responseText).toBe("abcdefghij...");
  });

  test("text exactly at maxText is NOT truncated", () => {
    const { push } = feeder(createMetricsState({ maxText: 10 }));
    push(messageUpdated({ created: T0 }));
    push(textEv("t1", "abcdefghij"));
    const recs = push(
      messageUpdated({ created: T0, completed: T0 + 1000, finish: "stop" }),
    );
    expect(messagesOf(recs)[0]!.responseText).toBe("abcdefghij");
  });

  test("default maxText is 4000", () => {
    const { push } = feeder();
    push(messageUpdated({ created: T0 }));
    push(textEv("t1", "x".repeat(4500)));
    const recs = push(
      messageUpdated({ created: T0, completed: T0 + 1000, finish: "stop" }),
    );
    const text = messagesOf(recs)[0]!.responseText;
    expect(text).toBe("x".repeat(4000) + "...");
    expect(text.length).toBe(4003);
  });

  test("captureText: false => responseText is always empty", () => {
    const { push } = feeder(createMetricsState({ captureText: false }));
    push(messageUpdated({ created: T0 }));
    push(textEv("t1", "Hello", { start: T0 + 100, end: T0 + 200 }));
    const recs = push(
      messageUpdated({ created: T0, completed: T0 + 1000, finish: "stop" }),
    );
    expect(messagesOf(recs)[0]!.responseText).toBe("");
  });
});

// ── Lifecycle & defensive handling ───────────────────────────────────────────

describe("lifecycle & defensive handling", () => {
  test("message.updated with role !== 'assistant' is ignored", () => {
    const { push } = feeder();
    expect(push(messageUpdated({ role: "user" }))).toHaveLength(0);
  });

  test("unknown event type => no records, no throw", () => {
    const { push } = feeder();
    const ev = {
      type: "session.idle",
      properties: { sessionID: SESSION },
    } as unknown as MetricEvent;
    expect(push(ev)).toHaveLength(0);
  });

  test("untracked part type (tool) is ignored without throwing", () => {
    const { push } = feeder();
    push(messageUpdated({ created: T0 }));
    const ev = {
      type: "message.part.updated",
      part: { id: "tool1", sessionID: SESSION, messageID: MSG, type: "tool", tool: "bash" },
    } as unknown as MetricEvent;
    expect(push(ev)).toHaveLength(0);
  });

  test("repeated final message.updated emits the MessageMetric only once", () => {
    const { push } = feeder();
    push(messageUpdated({ created: T0 }));
    const final = messageUpdated({
      created: T0,
      completed: T0 + 1000,
      finish: "stop",
    });
    const first = push(final);
    const second = push(final);
    expect(messagesOf(first)).toHaveLength(1);
    expect(second).toHaveLength(0);
  });

  test("message.removed tombstones the ID: later events never emit", () => {
    const { push } = feeder();
    push(messageUpdated({ created: T0 }));
    push(textEv("t1", "x", { start: T0 + 100, end: T0 + 200 }));
    expect(push(removedEv(MSG))).toHaveLength(0);

    // Neither parts nor a self-contained final emit after removal.
    push(stepStartEv("s1"));
    expect(push(stepFinishEv("s1"))).toHaveLength(0);
    expect(
      push(messageUpdated({ created: T0, completed: T0 + 1000, finish: "stop" })),
    ).toHaveLength(0);
  });

  test("message.removed for an unknown ID => no records, no throw", () => {
    const { push } = feeder();
    expect(push(removedEv("msg_never_seen"))).toHaveLength(0);
  });
});

// ── LRU cap ──────────────────────────────────────────────────────────────────

describe("LRU cap (200 tracked messages)", () => {
  test("keeps all 200 tracked messages (cap >= 200)", () => {
    const { push } = feeder();
    push(messageUpdated({ id: "msg_1", created: T0 }));
    push(textEv("t1", "remembered?", { messageID: "msg_1", start: T0 + 10 }));
    for (let i = 2; i <= 200; i++) {
      push(messageUpdated({ id: `msg_${i}`, created: T0 }));
    }
    const recs = push(
      messageUpdated({ id: "msg_1", created: T0, completed: T0 + 1000, finish: "stop" }),
    );
    const msg = messagesOf(recs)[0];
    expect(msg).toBeDefined();
    expect(msg!.responseText).toBe("remembered?");
    expect(msg!.ttftMs).toBe(10);
  });

  test("201st distinct message evicts the oldest (cap <= 200)", () => {
    const { push } = feeder();
    push(messageUpdated({ id: "msg_1", created: T0 }));
    push(textEv("t1", "remembered?", { messageID: "msg_1", start: T0 + 10 }));
    for (let i = 2; i <= 201; i++) {
      push(messageUpdated({ id: `msg_${i}`, created: T0 }));
    }
    // Eviction forgets state (no tombstone): the self-contained final still
    // emits, but the pre-eviction accumulation is gone.
    const recs = push(
      messageUpdated({ id: "msg_1", created: T0, completed: T0 + 1000, finish: "stop" }),
    );
    const msg = messagesOf(recs)[0];
    expect(msg).toBeDefined();
    expect(msg!.responseText).toBe("");
    expect(msg!.ttftMs).toBeNull();
    expect(msg!.steps).toBe(0);
  });

  test("touching a message refreshes its LRU recency", () => {
    const { push } = feeder();
    push(messageUpdated({ id: "msg_1", created: T0 }));
    push(textEv("t1", "remembered?", { messageID: "msg_1", start: T0 + 10 }));
    push(messageUpdated({ id: "msg_2", created: T0 }));
    push(textEv("t2", "second", { messageID: "msg_2", start: T0 + 20 }));
    for (let i = 3; i <= 200; i++) {
      push(messageUpdated({ id: `msg_${i}`, created: T0 }));
    }
    // Touch msg_1 => most recently used; msg_2 is now the oldest.
    push(textEv("t1b", "more", { messageID: "msg_1", start: T0 + 30 }));
    // 201st distinct message => evicts msg_2, not msg_1.
    push(messageUpdated({ id: "msg_201", created: T0 }));

    const evictedRecs = push(
      messageUpdated({ id: "msg_2", created: T0, completed: T0 + 1000, finish: "stop" }),
    );
    const evicted = messagesOf(evictedRecs)[0];
    expect(evicted).toBeDefined();
    expect(evicted!.responseText).toBe("");
    expect(evicted!.ttftMs).toBeNull();

    const aliveRecs = push(
      messageUpdated({ id: "msg_1", created: T0, completed: T0 + 1000, finish: "stop" }),
    );
    const alive = messagesOf(aliveRecs)[0];
    expect(alive).toBeDefined();
    expect(alive!.responseText).toBe("remembered?\nmore");
    expect(alive!.ttftMs).toBe(10);
  });
});

// ── Purity ───────────────────────────────────────────────────────────────────

describe("purity", () => {
  test("same state + same event => identical records (excluding at)", () => {
    const s0 = createMetricsState();
    const ev = stepFinishEv("s1", { tokens: eventTokens({ output: 10 }) });
    const r1 = reduceEvent(s0, ev);
    const r2 = reduceEvent(s0, ev);
    expect(r1.records.length).toBeGreaterThan(0);
    const strip = (rs: MetricRecord[]): MetricRecord[] =>
      rs.map((r) => ({ ...r, at: 0 }));
    expect(strip(r2.records)).toEqual(strip(r1.records));
  });

  test("input state is never mutated (replaying a full flow is deterministic)", () => {
    const s0 = createMetricsState();
    const events: MetricEvent[] = [
      messageUpdated({ created: T0 }),
      stepStartEv("s1"),
      textEv("t1", "Hello", { start: T0 + 100, end: T0 + 600 }),
      stepFinishEv("s1", { tokens: eventTokens({ output: 10 }) }),
      messageUpdated({
        created: T0,
        completed: T0 + 1000,
        finish: "stop",
        tokens: eventTokens({ output: 10 }),
      }),
    ];
    const run = (): MetricRecord[] => {
      let st = s0;
      let out: MetricRecord[] = [];
      for (const ev of events) {
        const r = reduceEvent(st, ev);
        st = r.state;
        out = out.concat(r.records);
      }
      return out;
    };
    const run1 = run();
    const run2 = run();
    expect(messagesOf(run1)).toHaveLength(1);
    expect(messagesOf(run2)).toHaveLength(1);
    expect(messagesOf(run1)[0]!.responseText).toBe("Hello");
    // If s0 were mutated, run2 would double the text or double-emit.
    expect(messagesOf(run2)[0]!.responseText).toBe("Hello");
    const strip = (rs: MetricRecord[]): MetricRecord[] =>
      rs.map((r) => ({ ...r, at: 0 }));
    expect(strip(run2)).toEqual(strip(run1));
  });
});

// ── Generation-speed metric (genTokensPerSec / genDurationMs) ────────────────
//
// The headline `tokensPerSec` is END-TO-END and output-only; it understates
// true generation speed (TTFT in the denominator, reasoning excluded). These
// tests pin an ADDITIONAL generation-speed metric, leaving `tokensPerSec`,
// `durationMs`, and `ttftMs` unchanged.
//
// Pinned contract:
//   MIN_GEN_MS = 50 (floor; suppresses degenerate 1-2ms part-window outliers).
//   Internal genTokensPerSec(output, reasoning, genMs):
//     genMs === null || genMs < MIN_GEN_MS  => null
//     otherwise                              => (output + reasoning) / (genMs/1000)
//     never NaN/Infinity.
//   CallMetric:
//     genDurationMs  = durationMs (the step generation window — NOT durationMs -
//                      ttftMs; the two have different origins).
//     genTokensPerSec = genTokensPerSec(output, reasoning, durationMs).
//   MessageMetric:
//     genDurationMs  = (durationMs!=null && ttftMs!=null && durationMs > ttftMs)
//                        ? durationMs - ttftMs : null.
//     genTokensPerSec = genTokensPerSec(output, reasoning, genDurationMs).
//
// Contract decision where the spec left a choice:
//   On a degenerate (< MIN_GEN_MS) step window, CallMetric.genDurationMs keeps
//   the RAW step durationMs (transparency) while genTokensPerSec is null.

describe("generation-speed metric — CallMetric", () => {
  test("valid window: genDurationMs === step durationMs, reasoning counted", () => {
    const { push } = feeder();
    push(messageUpdated({ created: T0 }));
    push(stepStartEv("s1"));
    push(textEv("t1", "x", { start: T0 + 100, end: T0 + 1100 })); // 1000ms window
    const recs = push(
      stepFinishEv("s1", { tokens: eventTokens({ output: 100, reasoning: 400 }) }),
    );
    const call = callsOf(recs)[0];
    expect(call!.durationMs).toBe(1000);
    expect(call!.genDurationMs).toBe(1000);
    expect(call!.genTokensPerSec).toBeCloseTo(500, 6); // (100 + 400) / 1s
  });

  test("reasoning alone counts (output 0)", () => {
    const { push } = feeder();
    push(messageUpdated({ created: T0 }));
    push(stepStartEv("s1"));
    push(textEv("t1", "x", { start: T0 + 100, end: T0 + 1100 })); // 1000ms window
    const recs = push(
      stepFinishEv("s1", { tokens: eventTokens({ output: 0, reasoning: 250 }) }),
    );
    const call = callsOf(recs)[0];
    expect(call!.genDurationMs).toBe(1000);
    expect(call!.genTokensPerSec).toBeCloseTo(250, 6); // (0 + 250) / 1s
  });

  test("degenerate window < MIN_GEN_MS => genTokensPerSec null (raw genDurationMs kept)", () => {
    const { push } = feeder();
    push(messageUpdated({ created: T0 }));
    push(stepStartEv("s1"));
    push(textEv("t1", "x", { start: T0 + 100, end: T0 + 102 })); // 2ms window
    const recs = push(
      stepFinishEv("s1", { tokens: eventTokens({ output: 100 }) }),
    );
    const call = callsOf(recs)[0];
    expect(call!.durationMs).toBe(2);
    expect(call!.genDurationMs).toBe(2); // raw window retained for transparency
    expect(call!.genTokensPerSec).toBeNull(); // NOT huge/Infinity
  });

  test("boundary: window exactly 50ms computed, 49ms null", () => {
    const f50 = feeder();
    f50.push(messageUpdated({ id: "msg_50", created: T0 }));
    f50.push(stepStartEv("s1", "msg_50"));
    f50.push(textEv("t1", "x", { messageID: "msg_50", start: T0 + 100, end: T0 + 150 }));
    const recs50 = f50.push(
      stepFinishEv("s1", { messageID: "msg_50", tokens: eventTokens({ output: 50 }) }),
    );
    const c50 = callsOf(recs50)[0];
    expect(c50!.genDurationMs).toBe(50);
    expect(c50!.genTokensPerSec).toBeCloseTo(1000, 6); // 50 / 0.05s

    const f49 = feeder();
    f49.push(messageUpdated({ id: "msg_49", created: T0 }));
    f49.push(stepStartEv("s1", "msg_49"));
    f49.push(textEv("t1", "x", { messageID: "msg_49", start: T0 + 100, end: T0 + 149 }));
    const recs49 = f49.push(
      stepFinishEv("s1", { messageID: "msg_49", tokens: eventTokens({ output: 50 }) }),
    );
    const c49 = callsOf(recs49)[0];
    expect(c49!.genDurationMs).toBe(49);
    expect(c49!.genTokensPerSec).toBeNull();
  });

  test("null step durationMs (no timed parts) => gen fields null", () => {
    const { push } = feeder();
    push(messageUpdated({ created: T0 }));
    push(stepStartEv("s1"));
    const recs = push(stepFinishEv("s1", { tokens: eventTokens({ output: 100 }) }));
    const call = callsOf(recs)[0];
    expect(call!.durationMs).toBeNull();
    expect(call!.genDurationMs).toBeNull();
    expect(call!.genTokensPerSec).toBeNull();
  });

  test("genDurationMs EQUALS step durationMs even when ttftMs is large (NOT durationMs - ttftMs)", () => {
    const { push } = feeder();
    push(messageUpdated({ created: T0 }));
    push(stepStartEv("s1"));
    // Part starts 5s after message creation => large TTFT; window itself is 1s.
    push(textEv("t1", "x", { start: T0 + 5000, end: T0 + 6000 }));
    const recs = push(
      stepFinishEv("s1", { tokens: eventTokens({ output: 100 }) }),
    );
    const call = callsOf(recs)[0];
    expect(call!.ttftMs).toBe(5000);
    expect(call!.durationMs).toBe(1000);
    expect(call!.genDurationMs).toBe(call!.durationMs);
    expect(call!.genDurationMs).toBe(1000);
    // A wrong (durationMs - ttftMs) would be -4000.
    expect(call!.genDurationMs).not.toBe(call!.durationMs! - call!.ttftMs!);
    expect(call!.genTokensPerSec).toBeCloseTo(100, 6); // 100 / 1s
  });

  test("zero output+reasoning over a valid window => genTokensPerSec 0 (not NaN)", () => {
    const { push } = feeder();
    push(messageUpdated({ created: T0 }));
    push(stepStartEv("s1"));
    push(textEv("t1", "x", { start: T0 + 100, end: T0 + 1100 })); // 1000ms window
    const recs = push(
      stepFinishEv("s1", { tokens: eventTokens({ output: 0, reasoning: 0 }) }),
    );
    const call = callsOf(recs)[0];
    expect(call!.genDurationMs).toBe(1000);
    expect(call!.genTokensPerSec).toBe(0);
  });
});

describe("generation-speed metric — MessageMetric", () => {
  test("genDurationMs = durationMs - ttftMs; reasoning counted", () => {
    const { push } = feeder();
    push(messageUpdated({ created: T0 }));
    push(textEv("t1", "x", { start: T0 + 4000, end: T0 + 9000 })); // ttftMs = 4000
    const recs = push(
      messageUpdated({
        created: T0,
        completed: T0 + 10000,
        finish: "stop",
        tokens: eventTokens({ output: 300, reasoning: 300 }),
      }),
    );
    const msg = messagesOf(recs)[0];
    expect(msg!.durationMs).toBe(10000);
    expect(msg!.ttftMs).toBe(4000);
    expect(msg!.genDurationMs).toBe(6000); // 10000 - 4000
    expect(msg!.genTokensPerSec).toBeCloseTo(100, 6); // (300 + 300) / 6s
  });

  test("null ttftMs (no parts) => gen fields null (UI falls back to e2e)", () => {
    const { push } = feeder();
    push(messageUpdated({ created: T0 }));
    const recs = push(
      messageUpdated({
        created: T0,
        completed: T0 + 1000,
        finish: "stop",
        tokens: eventTokens({ output: 300, reasoning: 300 }),
      }),
    );
    const msg = messagesOf(recs)[0];
    expect(msg!.durationMs).toBe(1000);
    expect(msg!.ttftMs).toBeNull();
    expect(msg!.genDurationMs).toBeNull();
    expect(msg!.genTokensPerSec).toBeNull();
  });

  test("durationMs <= ttftMs (equal or ttft > duration) => gen fields null", () => {
    // Equal: durationMs === ttftMs.
    const fEq = feeder();
    fEq.push(messageUpdated({ id: "msg_eq", created: T0 }));
    fEq.push(textEv("t1", "x", { messageID: "msg_eq", start: T0 + 1000 })); // ttftMs = 1000
    const recsEq = fEq.push(
      messageUpdated({
        id: "msg_eq",
        created: T0,
        completed: T0 + 1000, // durationMs = 1000 === ttftMs
        finish: "stop",
        tokens: eventTokens({ output: 300 }),
      }),
    );
    const eq = messagesOf(recsEq)[0];
    expect(eq!.durationMs).toBe(1000);
    expect(eq!.ttftMs).toBe(1000);
    expect(eq!.genDurationMs).toBeNull();
    expect(eq!.genTokensPerSec).toBeNull();

    // ttft > duration.
    const fGt = feeder();
    fGt.push(messageUpdated({ id: "msg_gt", created: T0 }));
    fGt.push(textEv("t1", "x", { messageID: "msg_gt", start: T0 + 2000 })); // ttftMs = 2000
    const recsGt = fGt.push(
      messageUpdated({
        id: "msg_gt",
        created: T0,
        completed: T0 + 1000, // durationMs = 1000 < ttftMs
        finish: "stop",
        tokens: eventTokens({ output: 300 }),
      }),
    );
    const gt = messagesOf(recsGt)[0];
    expect(gt!.durationMs).toBe(1000);
    expect(gt!.ttftMs).toBe(2000);
    expect(gt!.genDurationMs).toBeNull();
    expect(gt!.genTokensPerSec).toBeNull();
  });

  test("null durationMs => gen fields null even with a ttftMs", () => {
    const { push } = feeder();
    push(messageUpdated({ created: T0 }));
    push(textEv("t1", "x", { start: T0 + 100 })); // ttftMs = 100
    const recs = push(
      messageUpdated({
        created: T0,
        completed: T0, // zero duration => durationMs null
        finish: "stop",
        tokens: eventTokens({ output: 300 }),
      }),
    );
    const msg = messagesOf(recs)[0];
    expect(msg!.durationMs).toBeNull();
    expect(msg!.ttftMs).toBe(100);
    expect(msg!.genDurationMs).toBeNull();
    expect(msg!.genTokensPerSec).toBeNull();
  });

  test("reasoning counted at message level too (output 0)", () => {
    const { push } = feeder();
    push(messageUpdated({ created: T0 }));
    push(textEv("t1", "x", { start: T0 + 1000, end: T0 + 5000 })); // ttftMs = 1000
    const recs = push(
      messageUpdated({
        created: T0,
        completed: T0 + 7000,
        finish: "stop",
        tokens: eventTokens({ output: 0, reasoning: 600 }),
      }),
    );
    const msg = messagesOf(recs)[0];
    expect(msg!.durationMs).toBe(7000);
    expect(msg!.ttftMs).toBe(1000);
    expect(msg!.genDurationMs).toBe(6000); // 7000 - 1000
    expect(msg!.genTokensPerSec).toBeCloseTo(100, 6); // (0 + 600) / 6s
  });
});

describe("generation-speed metric — back-compat", () => {
  test("existing tokensPerSec (output-only, end-to-end) is unchanged by the new fields", () => {
    const { push } = feeder();
    push(messageUpdated({ created: T0 }));
    push(textEv("t1", "x", { start: T0 + 2000, end: T0 + 9000 })); // ttftMs = 2000
    const recs = push(
      messageUpdated({
        created: T0,
        completed: T0 + 10000,
        finish: "stop",
        // Large reasoning + a TTFT: neither may leak into the e2e headline.
        tokens: eventTokens({ output: 300, reasoning: 999 }),
      }),
    );
    const msg = messagesOf(recs)[0];
    // UNCHANGED: output-only over the full end-to-end window.
    expect(msg!.durationMs).toBe(10000);
    expect(msg!.tokensPerSec).toBeCloseTo(30, 6); // 300 / 10s (reasoning & ttft ignored)

    // The NEW metric diverges (TTFT excluded, reasoning counted) — proving the
    // headline was untouched while the generation-speed view is added alongside.
    expect(msg!.genDurationMs).toBe(8000); // 10000 - 2000
    expect(msg!.genTokensPerSec).toBeCloseTo(162.375, 6); // (300 + 999) / 8s
  });
});
