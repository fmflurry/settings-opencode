/**
 * Contract tests for SESSION-HIERARCHY tracking (subagents = OpenCode child
 * sessions via `Session.parentID`): `session.created` / `session.deleted`
 * reducer handling, the `rootSessionID` stamped on every emitted record, and
 * the PURE subtree selectors the sidebar uses to aggregate a session AND its
 * descendant (subagent) sessions.
 *
 * RED phase: `rootSessionID`, `sessionSubtree`, `selectRecordsForSession`, and
 * `selectLiveForSubtree` are not yet exported from `./derive.ts` (and the
 * `session.created` / `session.deleted` union members + the `rootSessionID`
 * record field + the `sessions` state field are missing from `./types.ts`) —
 * this file fails to load ("Export named 'rootSessionID' not found") until the
 * implementer adds them. The existing suites stay fully green throughout; the
 * new tests live in their own file precisely so a missing named export cannot
 * take down the established coverage.
 *
 * Pinned API:
 *   MetricEvent ADDS flattened members (top-level fields, NOT nested):
 *     { type: "session.created"; sessionID: string; parentID: string | null;
 *       title: string }
 *     { type: "session.deleted"; sessionID: string }
 *   CallMetric AND MessageMetric ADD `rootSessionID: string`.
 *   MetricsState ADDS
 *     `sessions: Record<string, { parentID: string | null; title: string }>`.
 *   createMetricsState() initializes `sessions: {}`.
 *   reduceEvent "session.created": immutably sets
 *     sessions[sessionID] = { parentID, title }; emits ZERO records; the input
 *     state is NOT mutated.
 *   reduceEvent "session.deleted": RETAINS the hierarchy entry (records
 *     outlive sessions); emits zero records.
 *   BOTH emission sites stamp rootSessionID = rootSessionID(state, tracked.sessionID)
 *     (step-finish CallMetric AND final MessageMetric).
 *   reduceEvent's `{ state, records }` return shape is UNCHANGED for the new
 *     variants.
 *
 *   rootSessionID(state, sessionID): string
 *     - walks the parentID chain to the top; CYCLE-GUARDED (terminates on
 *       cycles); an unknown session returns itself.
 *   sessionSubtree(state, sessionID): Set<string>
 *     - session + ALL descendants (any depth); excludes siblings/other trees.
 *   selectRecordsForSession(records, state, sessionID,
 *                          opts?: { includeSubagents?: boolean }): MetricRecord[]
 *     - includeSubagents defaults to TRUE: records whose sessionID ∈ subtree;
 *       false: only records with the exact sessionID.
 *   selectLiveForSubtree(state, sessionID, now, charsPerToken = 4): LiveSnapshot | null
 *     - like selectLive but matches a streaming message whose sessionID ∈
 *       subtree; when several stream concurrently, the GREATEST liveGenStartMs
 *       (most-recently-started) wins; null when none.
 *
 * Contract decisions (where the spec left a choice):
 *   1. Cycle return value: rootSessionID on a cycle returns SOME member of the
 *      cycle — WHICH one is the implementer's choice — but it must TERMINATE
 *      (no hang), NOT throw, and be STABLE across repeated calls. sessionSubtree
 *      on a cycle must also terminate (and still contain the cycle members).
 *   2. session.deleted RETAINS the entry (per spec): the deleted session keeps
 *      resolving via rootSessionID/sessionSubtree afterwards.
 *   3. session.deleted for an unknown ID => zero records, no throw (defensive,
 *      mirrors message.removed).
 *   4. sessionSubtree of an unknown session = the singleton {sessionID}
 *      (mirrors rootSessionID's unknown => self).
 *   5. selectLiveForSubtree's snapshot reports the ACTUAL streaming session's
 *      sessionID/messageID (NOT the queried root), with chars/estTokens/
 *      elapsedMs/liveTokensPerSec computed from that message's own gen-start —
 *      same LiveSnapshot shape/semantics as selectLive (incl. MIN_GEN_MS floor).
 *   6. The greatest-liveGenStartMs tiebreak is independent of LRU iteration
 *      order (pinned with three concurrent streams where the winner sits in the
 *      MIDDLE of state.order, so neither "first match" nor "last match" passes).
 */

import { describe, expect, test } from "bun:test";
import {
  createMetricsState,
  reduceEvent,
  rootSessionID,
  selectLiveForSubtree,
  selectRecordsForSession,
  sessionSubtree,
} from "./derive.ts";
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
type StepFinishPartShape = Extract<MetricPart, { type: "step-finish" }>;
type PartDeltaEvent = Extract<MetricEvent, { type: "message.part.delta" }>;
/** The NEW flattened session-lifecycle members; `never` until types.ts adds them. */
type SessionCreatedEvent = Extract<MetricEvent, { type: "session.created" }>;
type SessionDeletedEvent = Extract<MetricEvent, { type: "session.deleted" }>;

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

/** Part builders take an explicit sessionID/messageID so multi-session
 *  hierarchies never share a tracked message by accident. */
interface PartOpts {
  sessionID?: string;
  messageID?: string;
}

function stepStartEv(partID: string, opts: PartOpts = {}): MetricEvent {
  const part: StepStartPartShape = {
    id: partID,
    sessionID: opts.sessionID ?? SESSION,
    messageID: opts.messageID ?? MSG,
    type: "step-start",
  };
  return { type: "message.part.updated", part };
}

interface TextOpts extends PartOpts {
  start?: number;
  end?: number;
}

function textEv(partID: string, text: string, opts: TextOpts = {}): MetricEvent {
  const part: TextPartShape = {
    id: partID,
    sessionID: opts.sessionID ?? SESSION,
    messageID: opts.messageID ?? MSG,
    type: "text",
    text,
  };
  if (opts.start !== undefined) {
    part.time =
      opts.end !== undefined ? { start: opts.start, end: opts.end } : { start: opts.start };
  }
  return { type: "message.part.updated", part };
}

interface StepFinishOpts extends PartOpts {
  reason?: string;
  cost?: number;
  tokens?: StepFinishPartShape["tokens"];
}

function stepFinishEv(partID: string, opts: StepFinishOpts = {}): MetricEvent {
  const part: StepFinishPartShape = {
    id: partID,
    sessionID: opts.sessionID ?? SESSION,
    messageID: opts.messageID ?? MSG,
    type: "step-finish",
    reason: opts.reason ?? "stop",
    cost: opts.cost ?? 0,
    tokens: opts.tokens ?? eventTokens(),
  };
  return { type: "message.part.updated", part };
}

interface DeltaOpts {
  sessionID?: string;
  messageID?: string;
  field?: string;
}

/** Flattened `message.part.delta` event (top-level fields — NOT nested). */
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

/** Flattened `session.created` (top-level sessionID/parentID/title). */
function sessionCreatedEv(
  sessionID: string,
  parentID: string | null,
  title: string,
): MetricEvent {
  const ev: SessionCreatedEvent = {
    type: "session.created",
    sessionID,
    parentID,
    title,
  };
  return ev;
}

/** Flattened `session.deleted` (top-level sessionID). */
function sessionDeletedEv(sessionID: string): MetricEvent {
  const ev: SessionDeletedEvent = { type: "session.deleted", sessionID };
  return ev;
}

// ── Test helpers ─────────────────────────────────────────────────────────────

/** Threads state through reduceEvent calls; `current()` exposes it for the
 *  pure selectors (selectors read state; they never advance it). */
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

// ── Hierarchy tracking ───────────────────────────────────────────────────────

describe("hierarchy tracking (session.created / session.deleted)", () => {
  test("session.created (root): stores the hierarchy entry; zero records; input NOT mutated", () => {
    const s0 = createMetricsState();
    // createMetricsState initializes sessions: {}.
    expect(s0.sessions).toEqual({});

    const before = structuredClone(s0);
    const result = reduceEvent(s0, sessionCreatedEv("ses_root", null, "Root Task"));

    expect(result.records).toEqual([]);
    expect(result.state.sessions["ses_root"]).toEqual({
      parentID: null,
      title: "Root Task",
    });
    expect(rootSessionID(result.state, "ses_root")).toBe("ses_root");
    expect(sessionSubtree(result.state, "ses_root")).toEqual(new Set(["ses_root"]));
    // Input state untouched (deep snapshot before/after).
    expect(s0).toEqual(before);
  });

  test("session.created (child): rootSessionID(child) === rootSessionID(parent); subtree includes child, excludes unrelated", () => {
    const { push, current } = feeder();
    push(sessionCreatedEv("ses_root", null, "Root"));
    push(sessionCreatedEv("ses_child", "ses_root", "Child"));
    push(sessionCreatedEv("ses_other", null, "Unrelated"));

    expect(rootSessionID(current(), "ses_child")).toBe("ses_root");
    expect(rootSessionID(current(), "ses_child")).toBe(
      rootSessionID(current(), "ses_root"),
    );

    const subtree = sessionSubtree(current(), "ses_root");
    expect(subtree.has("ses_root")).toBe(true);
    expect(subtree.has("ses_child")).toBe(true);
    expect(subtree.has("ses_other")).toBe(false);
  });

  test("deep chain A→B→C: rootSessionID(C) === 'A'; subtree(A) = {A,B,C}", () => {
    const { push, current } = feeder();
    push(sessionCreatedEv("A", null, "root"));
    push(sessionCreatedEv("B", "A", "mid"));
    push(sessionCreatedEv("C", "B", "leaf"));

    expect(rootSessionID(current(), "C")).toBe("A");
    expect(rootSessionID(current(), "B")).toBe("A");
    expect(sessionSubtree(current(), "A")).toEqual(new Set(["A", "B", "C"]));
  });

  test("cycle A→B→A: rootSessionID TERMINATES (no hang), returns a stable member, no throw", () => {
    const { push, current } = feeder();
    push(sessionCreatedEv("A", "B", "A"));
    push(sessionCreatedEv("B", "A", "B"));

    const rA = rootSessionID(current(), "A");
    expect(["A", "B"]).toContain(rA);
    // Stable across repeated calls.
    expect(rootSessionID(current(), "A")).toBe(rA);
    const rB = rootSessionID(current(), "B");
    expect(["A", "B"]).toContain(rB);

    // Subtree traversal over a cycle must ALSO terminate (hang safety) and
    // still contain the cycle members.
    const sub = sessionSubtree(current(), "A");
    expect(sub.has("A")).toBe(true);
    expect(sub.has("B")).toBe(true);
  });

  test("rootSessionID on an UNKNOWN session returns that sessionID itself", () => {
    const { push, current } = feeder();
    push(sessionCreatedEv("ses_known", null, "Known"));

    expect(rootSessionID(current(), "ses_never_seen")).toBe("ses_never_seen");
    // Subtree of an unknown session = just itself (no descendants).
    expect(sessionSubtree(current(), "ses_never_seen")).toEqual(
      new Set(["ses_never_seen"]),
    );
  });

  test("session.deleted RETAINS the hierarchy entry (records outlive sessions); zero records", () => {
    const { push, current } = feeder();
    push(sessionCreatedEv("ses_root", null, "Root"));
    push(sessionCreatedEv("ses_child", "ses_root", "Child"));

    const result = reduceEvent(current(), sessionDeletedEv("ses_child"));
    expect(result.records).toEqual([]);
    // Entry retained verbatim.
    expect(result.state.sessions["ses_child"]).toEqual({
      parentID: "ses_root",
      title: "Child",
    });
    // Selectors still resolve the deleted session.
    expect(rootSessionID(result.state, "ses_child")).toBe("ses_root");
    expect(sessionSubtree(result.state, "ses_root").has("ses_child")).toBe(true);
  });

  test("session.deleted for an unknown ID => no records, no throw", () => {
    const result = reduceEvent(createMetricsState(), sessionDeletedEv("ses_never_seen"));
    expect(result.records).toEqual([]);
  });
});

// ── rootSessionID stamping on emitted records ────────────────────────────────

describe("rootSessionID stamping on emitted records", () => {
  test("step-finish in a CHILD session stamps CallMetric.rootSessionID === root", () => {
    const { push } = feeder();
    // Hierarchy known BEFORE the flow (child → root created first).
    push(sessionCreatedEv("ses_root", null, "Root"));
    push(sessionCreatedEv("ses_child", "ses_root", "Child"));

    push(messageUpdated({ id: "msg_child", sessionID: "ses_child", created: T0 }));
    push(stepStartEv("s1", { sessionID: "ses_child", messageID: "msg_child" }));
    push(
      textEv("t1", "x", {
        sessionID: "ses_child",
        messageID: "msg_child",
        start: T0 + 100,
        end: T0 + 1100,
      }),
    );
    const recs = push(
      stepFinishEv("s1", {
        sessionID: "ses_child",
        messageID: "msg_child",
        tokens: eventTokens({ output: 100 }),
      }),
    );

    const call = callsOf(recs)[0];
    expect(call).toBeDefined();
    expect(call.sessionID).toBe("ses_child");
    expect(call.rootSessionID).toBe("ses_root");
  });

  test("step-finish in a session whose session.created was NOT seen stamps its OWN sessionID (best-effort)", () => {
    const { push } = feeder();
    push(stepStartEv("s1", { sessionID: "ses_orphan", messageID: "msg_orphan" }));
    const recs = push(
      stepFinishEv("s1", { sessionID: "ses_orphan", messageID: "msg_orphan" }),
    );

    const call = callsOf(recs)[0];
    expect(call).toBeDefined();
    expect(call.rootSessionID).toBe("ses_orphan");
  });

  test("final message.updated in a CHILD stamps MessageMetric.rootSessionID === root", () => {
    const { push } = feeder();
    push(sessionCreatedEv("ses_root", null, "Root"));
    push(sessionCreatedEv("ses_child", "ses_root", "Child"));

    push(messageUpdated({ id: "msg_child", sessionID: "ses_child", created: T0 }));
    const recs = push(
      messageUpdated({
        id: "msg_child",
        sessionID: "ses_child",
        created: T0,
        completed: T0 + 1000,
        finish: "stop",
      }),
    );

    const msg = messagesOf(recs)[0];
    expect(msg).toBeDefined();
    expect(msg.sessionID).toBe("ses_child");
    expect(msg.rootSessionID).toBe("ses_root");
  });

  test("a ROOT session's own records stamp rootSessionID === its sessionID", () => {
    const { push } = feeder();
    push(sessionCreatedEv("ses_root", null, "Root"));

    push(messageUpdated({ id: "msg_r", sessionID: "ses_root", created: T0 }));
    push(stepStartEv("s1", { sessionID: "ses_root", messageID: "msg_r" }));
    push(
      textEv("t1", "x", {
        sessionID: "ses_root",
        messageID: "msg_r",
        start: T0 + 100,
        end: T0 + 600,
      }),
    );
    const callRecs = push(
      stepFinishEv("s1", {
        sessionID: "ses_root",
        messageID: "msg_r",
        tokens: eventTokens({ output: 50 }),
      }),
    );
    const msgRecs = push(
      messageUpdated({
        id: "msg_r",
        sessionID: "ses_root",
        created: T0,
        completed: T0 + 1000,
        finish: "stop",
        tokens: eventTokens({ output: 50 }),
      }),
    );

    expect(callsOf(callRecs)[0]!.rootSessionID).toBe("ses_root");
    expect(messagesOf(msgRecs)[0]!.rootSessionID).toBe("ses_root");
  });
});

// ── Selectors ────────────────────────────────────────────────────────────────

describe("subtree selectors", () => {
  test("sessionSubtree = session + descendants ONLY (two trees, no cross-contamination)", () => {
    const { push, current } = feeder();
    // Tree 1: R1 → C1 → GC1, R1 → C2.
    push(sessionCreatedEv("R1", null, "R1"));
    push(sessionCreatedEv("C1", "R1", "C1"));
    push(sessionCreatedEv("GC1", "C1", "GC1"));
    push(sessionCreatedEv("C2", "R1", "C2"));
    // Tree 2: R2 → C3.
    push(sessionCreatedEv("R2", null, "R2"));
    push(sessionCreatedEv("C3", "R2", "C3"));

    expect(sessionSubtree(current(), "R1")).toEqual(new Set(["R1", "C1", "GC1", "C2"]));
    expect(sessionSubtree(current(), "R2")).toEqual(new Set(["R2", "C3"]));
    // A mid-tree node: itself + its descendants; NOT its parent or siblings.
    expect(sessionSubtree(current(), "C1")).toEqual(new Set(["C1", "GC1"]));
  });

  test("selectRecordsForSession: includeSubagents true / false / default", () => {
    const { push, current } = feeder();
    push(sessionCreatedEv("P", null, "parent"));
    push(sessionCreatedEv("C", "P", "child"));

    // A CallMetric in P.
    push(stepStartEv("sp", { sessionID: "P", messageID: "msg_p" }));
    const recP = push(
      stepFinishEv("sp", {
        sessionID: "P",
        messageID: "msg_p",
        tokens: eventTokens({ output: 10 }),
      }),
    );
    // A MessageMetric in the child C.
    push(messageUpdated({ id: "msg_c", sessionID: "C", created: T0 }));
    const recC = push(
      messageUpdated({
        id: "msg_c",
        sessionID: "C",
        created: T0,
        completed: T0 + 1000,
        finish: "stop",
      }),
    );
    // A CallMetric in an unrelated session X.
    push(stepStartEv("sx", { sessionID: "X", messageID: "msg_x" }));
    const recX = push(
      stepFinishEv("sx", {
        sessionID: "X",
        messageID: "msg_x",
        tokens: eventTokens({ output: 30 }),
      }),
    );

    const all: MetricRecord[] = [...recP, ...recC, ...recX];
    expect(all).toHaveLength(3);

    const withSub = selectRecordsForSession(all, current(), "P", {
      includeSubagents: true,
    });
    expect(withSub.map((r) => r.sessionID).sort()).toEqual(["C", "P"]);

    const onlyP = selectRecordsForSession(all, current(), "P", {
      includeSubagents: false,
    });
    expect(onlyP).toHaveLength(1);
    expect(onlyP.map((r) => r.sessionID)).toEqual(["P"]);

    // Default (no opts) === include subagents.
    const def = selectRecordsForSession(all, current(), "P");
    expect(def.map((r) => r.sessionID).sort()).toEqual(["C", "P"]);
  });

  test("selectLiveForSubtree: a streaming CHILD is found when queried by the PARENT sessionID", () => {
    const { push, current } = feeder();
    push(sessionCreatedEv("P", null, "parent"));
    push(sessionCreatedEv("C", "P", "child"));

    push(messageUpdated({ id: "msg_c", sessionID: "C", created: T0 }));
    push(stepStartEv("sc", { sessionID: "C", messageID: "msg_c" }));
    push(textEv("tc", "", { sessionID: "C", messageID: "msg_c", start: T0 }));
    push(deltaEv("tc", "x".repeat(100), { sessionID: "C", messageID: "msg_c" }));

    const snap: LiveSnapshot | null = selectLiveForSubtree(current(), "P", T0 + 1000, 4);
    expect(snap).not.toBeNull();
    // The snapshot reports the ACTUAL streaming session, not the queried root.
    expect(snap!.sessionID).toBe("C");
    expect(snap!.messageID).toBe("msg_c");
    expect(snap!.chars).toBe(100);
    expect(snap!.estTokens).toBe(25); // 100 / 4
    expect(snap!.elapsedMs).toBe(1000);
    expect(snap!.liveTokensPerSec).toBeCloseTo(25, 6); // 25 / 1s
  });

  test("selectLiveForSubtree: the session's OWN stream is found too (subtree includes self)", () => {
    const { push, current } = feeder();
    push(sessionCreatedEv("P", null, "parent"));

    push(messageUpdated({ id: "msg_p", sessionID: "P", created: T0 }));
    push(stepStartEv("sp", { sessionID: "P", messageID: "msg_p" }));
    push(textEv("tp", "", { sessionID: "P", messageID: "msg_p", start: T0 }));
    push(deltaEv("tp", "x".repeat(80), { sessionID: "P", messageID: "msg_p" }));

    const snap = selectLiveForSubtree(current(), "P", T0 + 1000, 4);
    expect(snap).not.toBeNull();
    expect(snap!.sessionID).toBe("P");
    expect(snap!.chars).toBe(80);
  });

  test("selectLiveForSubtree: multiple streaming => greatest liveGenStartMs wins (LRU-order independent)", () => {
    const { push, current } = feeder();
    push(sessionCreatedEv("P", null, "parent"));
    push(sessionCreatedEv("C1", "P", "c1"));
    push(sessionCreatedEv("C2", "P", "c2"));
    push(sessionCreatedEv("C3", "P", "c3"));

    const T1 = T0 + 2000;
    const T2 = T0 + 5000;

    // C1 starts FIRST (genStart T0).
    push(messageUpdated({ id: "msg_c1", sessionID: "C1", created: T0 }));
    push(stepStartEv("s1", { sessionID: "C1", messageID: "msg_c1" }));
    push(textEv("t1", "", { sessionID: "C1", messageID: "msg_c1", start: T0 }));
    push(deltaEv("t1", "x".repeat(100), { sessionID: "C1", messageID: "msg_c1" }));

    // C3 starts NEXT (genStart T1).
    push(messageUpdated({ id: "msg_c3", sessionID: "C3", created: T1 }));
    push(stepStartEv("s3", { sessionID: "C3", messageID: "msg_c3" }));
    push(textEv("t3", "", { sessionID: "C3", messageID: "msg_c3", start: T1 }));
    push(deltaEv("t3", "x".repeat(60), { sessionID: "C3", messageID: "msg_c3" }));

    // C2 starts LAST (genStart T2) — the expected winner.
    push(messageUpdated({ id: "msg_c2", sessionID: "C2", created: T2 }));
    push(stepStartEv("s2", { sessionID: "C2", messageID: "msg_c2" }));
    push(textEv("t2", "", { sessionID: "C2", messageID: "msg_c2", start: T2 }));
    push(deltaEv("t2", "x".repeat(40), { sessionID: "C2", messageID: "msg_c2" }));

    // Touch msg_c1 again (deltas never change liveGenStartMs) so LRU order
    // becomes [msg_c3, msg_c2, msg_c1]: the winner sits in the MIDDLE — neither
    // a "first match" nor a "last match" iteration strategy can pass.
    push(deltaEv("t1", "x".repeat(4), { sessionID: "C1", messageID: "msg_c1" }));

    const snap = selectLiveForSubtree(current(), "P", T2 + 1000, 4);
    expect(snap).not.toBeNull();
    expect(snap!.messageID).toBe("msg_c2");
    expect(snap!.sessionID).toBe("C2");
    expect(snap!.chars).toBe(40);
    expect(snap!.elapsedMs).toBe(1000); // from C2's OWN genStart (T2)
    expect(snap!.liveTokensPerSec).toBeCloseTo(10, 6); // (40 / 4) / 1s
  });

  test("selectLiveForSubtree: streaming OUTSIDE the subtree (sibling tree) is NOT selected", () => {
    const { push, current } = feeder();
    push(sessionCreatedEv("P", null, "parent"));
    push(sessionCreatedEv("S", null, "sibling"));

    // The sibling streams; P's subtree has nothing live.
    push(messageUpdated({ id: "msg_s", sessionID: "S", created: T0 }));
    push(stepStartEv("ss", { sessionID: "S", messageID: "msg_s" }));
    push(textEv("ts", "", { sessionID: "S", messageID: "msg_s", start: T0 }));
    push(deltaEv("ts", "x".repeat(100), { sessionID: "S", messageID: "msg_s" }));

    expect(selectLiveForSubtree(current(), "P", T0 + 1000, 4)).toBeNull();
  });

  test("selectLiveForSubtree: nothing streaming in the subtree => null", () => {
    expect(selectLiveForSubtree(createMetricsState(), "P", T0 + 1000, 4)).toBeNull();

    const { push, current } = feeder();
    push(sessionCreatedEv("P", null, "parent"));
    push(sessionCreatedEv("C", "P", "child"));
    push(messageUpdated({ id: "msg_c", sessionID: "C", created: T0 }));
    push(stepStartEv("sc", { sessionID: "C", messageID: "msg_c" }));
    // Gen-start known but no deltas => not streaming (same rule as selectLive).
    push(textEv("tc", "", { sessionID: "C", messageID: "msg_c", start: T0 }));
    expect(selectLiveForSubtree(current(), "P", T0 + 1000, 4)).toBeNull();
  });
});

// ── Back-compat ──────────────────────────────────────────────────────────────

describe("hierarchy — back-compat", () => {
  test("session.created / session.deleted results have exactly the keys {state, records}", () => {
    const created = reduceEvent(createMetricsState(), sessionCreatedEv("ses_x", null, "X"));
    expect(Object.keys(created).sort()).toEqual(["records", "state"]);
    expect(created.records).toEqual([]);

    const deleted = reduceEvent(created.state, sessionDeletedEv("ses_x"));
    expect(Object.keys(deleted).sort()).toEqual(["records", "state"]);
    expect(deleted.records).toEqual([]);
  });

  test("full flow in a ROOT session emits the same metrics as before (rates unaffected; rootSessionID === sessionID)", () => {
    const { push } = feeder();
    push(sessionCreatedEv(SESSION, null, "Main"));

    push(messageUpdated({ created: T0 }));
    push(stepStartEv("s1"));
    push(textEv("t1", "Hello world", { start: T0 + 500, end: T0 + 2500 }));
    const callRecs = push(
      stepFinishEv("s1", {
        reason: "stop",
        cost: 0.001,
        tokens: eventTokens({ output: 100 }),
      }),
    );
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

    const call = callsOf(callRecs)[0];
    expect(call).toBeDefined();
    // Headline + generation rates UNCHANGED by hierarchy tracking.
    expect(call.durationMs).toBe(2000); // 2500 - 500
    expect(call.tokensPerSec).toBeCloseTo(50, 6); // 100 / 2s
    expect(call.genDurationMs).toBe(2000);
    expect(call.genTokensPerSec).toBeCloseTo(50, 6); // (100 + 0) / 2s
    expect(call.ttftMs).toBe(500);
    expect(call.rootSessionID).toBe(SESSION);

    const msg = messagesOf(msgRecs)[0];
    expect(msg).toBeDefined();
    expect(msg.durationMs).toBe(3000);
    expect(msg.tokensPerSec).toBeCloseTo(100, 6); // 300 / 3s
    expect(msg.ttftMs).toBe(500);
    expect(msg.genDurationMs).toBe(2500); // 3000 - 500
    expect(msg.genTokensPerSec).toBeCloseTo(140, 6); // (300 + 50) / 2.5s
    expect(msg.rootSessionID).toBe(SESSION);
  });
});

// ── Visibility selectors (show/hide subagents) ───────────────────────────────
//
// Pinned API (ADDS to ./derive.ts):
//   visibleSubtree(state: MetricsState, sessionID: string,
//                  hidden: ReadonlySet<string>): Set<string>
//     - sessionSubtree(state, sessionID) MINUS `hidden`, BUT the queried root
//       `sessionID` is ALWAYS kept (never removed even when sessionID ∈ hidden).
//       An unknown session yields the singleton {sessionID} (still kept).
//   selectRecordsForVisible(records: readonly MetricRecord[],
//                           visible: ReadonlySet<string>): MetricRecord[]
//     - the records whose sessionID ∈ visible (order preserved).
//
// RED phase: `visibleSubtree` and `selectRecordsForVisible` are NOT yet exported
// from `./derive.ts`. They are pulled via a DYNAMIC import inside each new test
// (rather than added to the static import block at the top) so THIS file still
// LOADS during RED — the established hierarchy tests above stay green and ONLY
// the new tests below go red (failing with "visibleSubtree is not a function"
// until the exports land). This honors the file's stated principle (header above)
// that a missing named export must not take down established coverage, while
// still extending THIS file per the contract.
//
// Contract decisions (where the spec left a choice):
//   1. The root `sessionID` is kept unconditionally — even when it is a member
//      of `hidden` (pinned with root ∈ hidden and with hidden = the whole tree).
//   2. An unknown session yields the singleton {sessionID} (mirrors
//      sessionSubtree's unknown => self) and that singleton root is kept even if
//      it appears in `hidden`.
//   3. selectRecordsForVisible preserves input order (only membership filters).

/** Minimal CallMetric literal (INCLUDES rootSessionID) for selector filtering. */
function visibleRec(sessionID: string, rootSessionID: string, at: number): CallMetric {
  return {
    kind: "call",
    partID: `part_${at}`,
    finishReason: "stop",
    sessionID,
    rootSessionID,
    messageID: `msg_${at}`,
    providerID: PROVIDER,
    modelID: MODEL,
    mode: MODE,
    tokens: { input: 1, output: 1, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
    cost: 0,
    ttftMs: null,
    durationMs: null,
    tokensPerSec: null,
    genTokensPerSec: null,
    genDurationMs: null,
    at,
  };
}

describe("visibility selectors (visibleSubtree / selectRecordsForVisible)", () => {
  test("visibleSubtree with an EMPTY hidden set === sessionSubtree", async () => {
    const { visibleSubtree } = await import("./derive.ts");
    const { push, current } = feeder();
    push(sessionCreatedEv("P", null, "parent"));
    push(sessionCreatedEv("C1", "P", "c1"));
    push(sessionCreatedEv("C2", "P", "c2"));

    const empty: ReadonlySet<string> = new Set<string>();
    expect(visibleSubtree(current(), "P", empty)).toEqual(sessionSubtree(current(), "P"));
    expect(visibleSubtree(current(), "P", empty)).toEqual(new Set(["P", "C1", "C2"]));
  });

  test("visibleSubtree removes a hidden subagent but ALWAYS keeps the root (even when root ∈ hidden)", async () => {
    const { visibleSubtree } = await import("./derive.ts");
    const { push, current } = feeder();
    push(sessionCreatedEv("P", null, "parent"));
    push(sessionCreatedEv("C1", "P", "c1"));
    push(sessionCreatedEv("C2", "P", "c2"));

    // Hide one subagent.
    expect(visibleSubtree(current(), "P", new Set(["C1"]))).toEqual(new Set(["P", "C2"]));
    // Hide the root too — the root is STILL kept.
    expect(visibleSubtree(current(), "P", new Set(["P", "C1"]))).toEqual(
      new Set(["P", "C2"]),
    );
    // Hide the whole tree — only the root survives.
    expect(visibleSubtree(current(), "P", new Set(["P", "C1", "C2"]))).toEqual(
      new Set(["P"]),
    );
  });

  test("visibleSubtree of an UNKNOWN session => the {sessionID} singleton (kept even if 'hidden')", async () => {
    const { visibleSubtree } = await import("./derive.ts");
    const { push, current } = feeder();
    push(sessionCreatedEv("P", null, "parent"));

    expect(visibleSubtree(current(), "ses_never_seen", new Set<string>())).toEqual(
      new Set(["ses_never_seen"]),
    );
    // The queried session is the root of its (singleton) subtree => always kept.
    expect(
      visibleSubtree(current(), "ses_never_seen", new Set(["ses_never_seen"])),
    ).toEqual(new Set(["ses_never_seen"]));
  });

  test("selectRecordsForVisible keeps only records whose sessionID ∈ visible", async () => {
    const { selectRecordsForVisible } = await import("./derive.ts");
    const records: MetricRecord[] = [
      visibleRec("P", "P", 1),
      visibleRec("C1", "P", 2),
      visibleRec("C2", "P", 3),
      visibleRec("X", "X", 4),
    ];

    const kept = selectRecordsForVisible(records, new Set(["P", "C2"]));
    expect(kept.map((r) => r.sessionID).sort()).toEqual(["C2", "P"]);

    // Empty visible set => nothing kept.
    expect(selectRecordsForVisible(records, new Set<string>())).toEqual([]);
  });
});

// ── Working-state detection (isSessionWorking) ───────────────────────────────
//
// Pinned API (ADDS to ./derive.ts):
//   isSessionWorking(records: readonly MetricRecord[],
//                    liveSessionIDs: ReadonlySet<string>,
//                    sessionID: string): boolean
//     - TRUE  if sessionID ∈ liveSessionIDs (actively streaming) — REGARDLESS of
//       records (live wins).
//     - ELSE TRUE  if the session's most-recent record (greatest `at`) is a
//       "call" (a step finished but the turn hasn't completed => mid-turn).
//     - ELSE FALSE (no records for the session, OR the most-recent record is a
//       "message" => turn complete/done).
//     - Records for OTHER sessionIDs are IGNORED.
//
// RED phase: `isSessionWorking` is NOT yet exported from `./derive.ts`. It is
// pulled via a DYNAMIC import inside each new test (the SAME trick the visibility
// selectors above use) so THIS file still LOADS during RED — a static import of a
// missing named export fails the WHOLE module in Bun ("Export named
// 'isSessionWorking' not found"), which would red the established hierarchy /
// visibility tests above. The dynamic import confines the RED to ONLY the new
// tests below (failing with "isSessionWorking is not a function") until the
// export lands.
//
// Contract decisions (where the spec left a choice):
//   1. "Most-recent record" is by GREATEST `at` (epoch ms), NOT by array position.
//      Pinned by feeding records whose array order is the REVERSE of their `at`
//      order, so a naive "last array element wins" implementation fails.
//   2. liveSessionIDs membership is checked for the QUERIED sessionID only —
//      another session's live membership never leaks into the result.
//   3. Records are filtered to the queried sessionID BEFORE picking the latest, so
//      a recent call in an OTHER session never marks the queried session working.

/** Minimal MessageMetric literal (INCLUDES rootSessionID + `at`) for working-state detection. */
function messageRec(sessionID: string, rootSessionID: string, at: number): MessageMetric {
  return {
    kind: "message",
    finish: "stop",
    steps: 1,
    responseText: "",
    sessionID,
    rootSessionID,
    messageID: `msg_${at}`,
    providerID: PROVIDER,
    modelID: MODEL,
    mode: MODE,
    tokens: { input: 1, output: 1, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
    cost: 0,
    ttftMs: null,
    durationMs: null,
    tokensPerSec: null,
    genTokensPerSec: null,
    genDurationMs: null,
    at,
  };
}

describe("isSessionWorking", () => {
  const ROOT = "ses_root";
  const A = "ses_a";

  type LifecycleState = "busy" | "retry" | "idle" | null;
  type IsSessionWorkingWithLifecycle = (
    records: readonly MetricRecord[],
    liveSessionIDs: ReadonlySet<string>,
    sessionID: string,
    lifecycleState?: LifecycleState,
  ) => boolean;

  test("session ∈ liveSessionIDs, no records => true", async () => {
    const { isSessionWorking } = await import("./derive.ts");
    const live = new Set([A]);
    expect(isSessionWorking([], live, A)).toBe(true);
  });

  test("session ∈ liveSessionIDs with a latest 'message' record => true (live wins)", async () => {
    const { isSessionWorking } = await import("./derive.ts");
    const records: MetricRecord[] = [messageRec(A, ROOT, 5)];
    const live = new Set([A]);
    expect(isSessionWorking(records, live, A)).toBe(true);
  });

  test("not live, latest record (by at) is a CallMetric => true (mid-turn)", async () => {
    const { isSessionWorking } = await import("./derive.ts");
    const records: MetricRecord[] = [visibleRec(A, ROOT, 5)];
    const live = new Set<string>();
    expect(isSessionWorking(records, live, A)).toBe(true);
  });

  test("not live, latest record is a MessageMetric => false (done)", async () => {
    const { isSessionWorking } = await import("./derive.ts");
    const records: MetricRecord[] = [messageRec(A, ROOT, 5)];
    const live = new Set<string>();
    expect(isSessionWorking(records, live, A)).toBe(false);
  });

  test("not live, no records for the session => false", async () => {
    const { isSessionWorking } = await import("./derive.ts");
    const live = new Set<string>();
    expect(isSessionWorking([], live, A)).toBe(false);
  });

  test("ordering: call(at=1) + message(at=2) => latest is message => false (at-order, not array-order)", async () => {
    const { isSessionWorking } = await import("./derive.ts");
    // Array order is the REVERSE of `at` order: message(at=2) is FIRST in the
    // array but is the latest by `at`; call(at=1) is LAST in the array. A naive
    // "last array element wins" would return true (call) — the correct answer is
    // false (message at=2 is the latest).
    const records: MetricRecord[] = [
      messageRec(A, ROOT, 2), // latest by `at` (message) — FIRST in array
      visibleRec(A, ROOT, 1), // call — LAST in array
    ];
    const live = new Set<string>();
    expect(isSessionWorking(records, live, A)).toBe(false);
  });

  test("ordering: message(at=1) + call(at=2) => latest is call => true (at-order, not array-order)", async () => {
    const { isSessionWorking } = await import("./derive.ts");
    // Array order is the REVERSE of `at` order: call(at=2) is FIRST in the array
    // but is the latest by `at`; message(at=1) is LAST in the array. A naive
    // "last array element wins" would return false (message) — the correct answer
    // is true (call at=2 is the latest).
    const records: MetricRecord[] = [
      visibleRec(A, ROOT, 2), // latest by `at` (call) — FIRST in array
      messageRec(A, ROOT, 1), // message — LAST in array
    ];
    const live = new Set<string>();
    expect(isSessionWorking(records, live, A)).toBe(true);
  });

  test("records for OTHER sessions only => false for the queried session", async () => {
    const { isSessionWorking } = await import("./derive.ts");
    // Recent calls exist, but ONLY for other sessions; the queried session has none.
    const records: MetricRecord[] = [
      visibleRec("ses_other", ROOT, 5),
      messageRec("ses_other2", ROOT, 6),
    ];
    const live = new Set<string>();
    expect(isSessionWorking(records, live, A)).toBe(false);
  });

  test("call + message at the same 'at' => false (message wins the tie)", async () => {
    const mod = await import("./derive.ts");
    const isSessionWorking = mod.isSessionWorking as IsSessionWorkingWithLifecycle;
    const records: MetricRecord[] = [visibleRec(A, ROOT, 7), messageRec(A, ROOT, 7)];

    expect(isSessionWorking(records, new Set<string>(), A)).toBe(false);
  });

  test("explicit idle overrides a stale latest 'call' => false", async () => {
    const mod = await import("./derive.ts");
    const isSessionWorking = mod.isSessionWorking as IsSessionWorkingWithLifecycle;
    const records: MetricRecord[] = [visibleRec(A, ROOT, 7)];

    expect(isSessionWorking(records, new Set<string>(), A, "idle")).toBe(false);
  });

  test("explicit busy overrides a stale latest 'message' => true", async () => {
    const mod = await import("./derive.ts");
    const isSessionWorking = mod.isSessionWorking as IsSessionWorkingWithLifecycle;
    const records: MetricRecord[] = [messageRec(A, ROOT, 7)];

    expect(isSessionWorking(records, new Set<string>(), A, "busy")).toBe(true);
  });

  test("explicit retry counts as true", async () => {
    const mod = await import("./derive.ts");
    const isSessionWorking = mod.isSessionWorking as IsSessionWorkingWithLifecycle;

    expect(isSessionWorking([], new Set<string>(), A, "retry")).toBe(true);
  });

  test("live set still wins even when lifecycle says idle", async () => {
    const mod = await import("./derive.ts");
    const isSessionWorking = mod.isSessionWorking as IsSessionWorkingWithLifecycle;

    expect(isSessionWorking([], new Set([A]), A, "idle")).toBe(true);
  });
});
