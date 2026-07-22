/**
 * Pure derivation reducer for llm-metrics.
 *
 * `reduceEvent(state, event)` folds one structural `MetricEvent` into a NEW
 * state and returns any records that should be emitted as a result:
 *   - every `step-finish` emits exactly one `CallMetric` (FIFO pairing with a
 *     preceding `step-start`; an orphan step-finish still emits with null
 *     timing);
 *   - a final `message.updated` (finish != null AND time.completed present)
 *     emits exactly one `MessageMetric`, at most once per messageID.
 *   - a `message.part.delta` accumulates streamed chars into per-message live
 *     fields (read via the pure `selectLive` selector) and NEVER emits records.
 *
 * The reducer is PURE: it never mutates the input state and has no side
 * effects beyond `Date.now()` for the `at` timestamp. All timing math guards
 * against NaN/Infinity: an invalid/<=0 duration yields `durationMs = null`
 * AND `tokensPerSec = null`; zero output over a valid duration yields 0.
 */

import type {
  CallMetric,
  EventTokens,
  LiveSnapshot,
  MessageInfo,
  MessageMetric,
  MetricEvent,
  MetricPart,
  MetricRecord,
  MetricsOptions,
  MetricsState,
  PartTime,
  TokenCounts,
  TrackedMessage,
} from "./types.ts";

/** Hard cap on concurrently tracked messages (LRU). */
const LRU_CAP = 200;

/**
 * Floor for the generation window (ms). Windows shorter than this are treated
 * as degenerate (1-2ms part-window outliers) and yield a null genTokensPerSec
 * rather than a huge/Infinity figure.
 */
const MIN_GEN_MS = 50;

const DEFAULT_CAPTURE_TEXT = true;
const DEFAULT_MAX_TEXT = 4000;
/** Default chars-per-token ratio for the live tok/s estimate. */
const DEFAULT_CHARS_PER_TOKEN = 4;

const ZERO_TOKENS: TokenCounts = {
  input: 0,
  output: 0,
  reasoning: 0,
  cacheRead: 0,
  cacheWrite: 0,
};

export function createMetricsState(options?: MetricsOptions): MetricsState {
  return {
    options: {
      captureText: options?.captureText ?? DEFAULT_CAPTURE_TEXT,
      maxText: options?.maxText ?? DEFAULT_MAX_TEXT,
      charsPerToken: options?.charsPerToken ?? DEFAULT_CHARS_PER_TOKEN,
    },
    order: [],
    messages: {},
    tombstones: new Set<string>(),
    sessions: {},
  };
}

export function reduceEvent(
  state: MetricsState,
  event: MetricEvent,
): { state: MetricsState; records: MetricRecord[] } {
  switch (event.type) {
    case "message.updated":
      return handleMessageUpdated(state, event.info);
    case "message.part.updated":
      return handlePartUpdated(state, event.part);
    case "message.part.delta":
      return handlePartDelta(state, event);
    case "message.removed":
      return handleRemoved(state, event.messageID);
    case "session.created":
      return handleSessionCreated(state, event.sessionID, event.parentID, event.title);
    case "session.deleted":
      // Retain the hierarchy entry (records outlive sessions); zero records.
      // An unknown ID is a no-op (no throw), mirroring message.removed.
      return { state, records: [] };
    default:
      // Unknown event type (defensive): ignore without throwing.
      return { state, records: [] };
  }
}

// ── Event handlers ───────────────────────────────────────────────────────────

function handleMessageUpdated(
  state: MetricsState,
  info: MessageInfo,
): { state: MetricsState; records: MetricRecord[] } {
  // Only assistant messages carry LLM-call metrics.
  if (info.role !== "assistant") return { state, records: [] };

  const id = info.id;
  if (state.tombstones.has(id)) return { state, records: [] };

  const prev = state.messages[id] ?? emptyTracked(info.sessionID);
  const completed =
    typeof info.time.completed === "number" ? info.time.completed : prev.timeCompleted;

  let tracked: TrackedMessage = {
    ...prev,
    sessionID: info.sessionID,
    providerID: info.providerID,
    modelID: info.modelID,
    mode: info.mode,
    cost: info.cost,
    timeCreated: info.time.created,
    timeCompleted: completed,
    tokens: flattenTokens(info.tokens),
    finish: info.finish ?? null,
  };

  const records: MetricRecord[] = [];
  const finish = info.finish;
  if (finish != null && typeof completed === "number" && !tracked.emitted) {
    const durationMs = positiveDuration(completed, info.time.created);
    const tokens = tracked.tokens ?? ZERO_TOKENS;
    const ttftMs = messageTtft(tracked);
    // Generation window excludes TTFT; null when either side is unknown or the
    // window is non-positive (durationMs <= ttftMs).
    const genDurationMs =
      durationMs != null && ttftMs != null && durationMs > ttftMs
        ? durationMs - ttftMs
        : null;
    records.push({
      kind: "message",
      finish,
      steps: tracked.stepCount,
      responseText: buildResponseText(tracked, state.options),
      sessionID: tracked.sessionID,
      rootSessionID: rootSessionID(state, tracked.sessionID),
      messageID: id,
      providerID: tracked.providerID,
      modelID: tracked.modelID,
      mode: tracked.mode,
      tokens,
      cost: tracked.cost,
      ttftMs,
      durationMs,
      tokensPerSec: tokensPerSec(tokens.output, durationMs),
      genTokensPerSec: genTokensPerSec(tokens.output, tokens.reasoning, genDurationMs),
      genDurationMs,
      at: Date.now(),
    } satisfies MessageMetric);
    tracked = { ...tracked, emitted: true };
  }

  return { state: commit(state, id, tracked), records };
}

function handlePartUpdated(
  state: MetricsState,
  part: MetricPart,
): { state: MetricsState; records: MetricRecord[] } {
  const messageID = part.messageID;
  if (state.tombstones.has(messageID)) return { state, records: [] };

  switch (part.type) {
    case "step-start": {
      const tracked = state.messages[messageID] ?? emptyTracked(part.sessionID);
      // A new step restarts live accumulation from zero (not cumulative).
      const next: TrackedMessage = {
        ...tracked,
        stepWindows: [...tracked.stepWindows, {}],
        liveChars: 0,
        liveGenStartMs: null,
      };
      return { state: commit(state, messageID, next), records: [] };
    }

    case "text": {
      let tracked = state.messages[messageID] ?? emptyTracked(part.sessionID);
      tracked = applyTimedPart(tracked, part.id, part.time);
      tracked = registerLivePart(tracked, part.id, part.type, part.time?.start);
      if (part.synthetic !== true && typeof part.text === "string") {
        tracked = captureText(tracked, part.id, part.text);
      }
      return { state: commit(state, messageID, tracked), records: [] };
    }

    case "reasoning": {
      let tracked = state.messages[messageID] ?? emptyTracked(part.sessionID);
      tracked = applyTimedPart(tracked, part.id, part.time);
      tracked = registerLivePart(tracked, part.id, part.type, part.time.start);
      return { state: commit(state, messageID, tracked), records: [] };
    }

    case "step-finish": {
      const prev = state.messages[messageID] ?? emptyTracked(part.sessionID);
      // FIFO pairing: this step-finish closes the OLDEST open window. An
      // orphan (no step-start) closes an empty window => null timing.
      const [head, ...rest] = prev.stepWindows;
      const window = head ?? {};
      // The step boundary clears live accumulation (the exact CallMetric
      // below supersedes the estimate).
      const tracked: TrackedMessage = {
        ...prev,
        stepWindows: rest,
        stepCount: prev.stepCount + 1,
        liveChars: 0,
        liveGenStartMs: null,
      };
      const durationMs = stepDuration(window);
      const tokens = flattenTokens(part.tokens);
      const call: CallMetric = {
        kind: "call",
        partID: part.id,
        finishReason: part.reason,
        sessionID: part.sessionID,
        rootSessionID: rootSessionID(state, tracked.sessionID),
        messageID: part.messageID,
        providerID: tracked.providerID,
        modelID: tracked.modelID,
        mode: tracked.mode,
        tokens,
        cost: part.cost,
        ttftMs: messageTtft(tracked),
        durationMs,
        tokensPerSec: tokensPerSec(tokens.output, durationMs),
        // Generation window == the raw step window (different origin from the
        // message-level TTFT, so NOT durationMs - ttftMs).
        genTokensPerSec: genTokensPerSec(tokens.output, tokens.reasoning, durationMs),
        genDurationMs: durationMs,
        at: Date.now(),
      };
      return { state: commit(state, messageID, tracked), records: [call] };
    }

    default: {
      // Untracked part type (tool, file, ...): no timing/text tracking, but
      // register the type so later deltas for this partID can be classified
      // (and ignored). Only for already-tracked messages (no entry creation).
      const untracked = part as { id: string; type: string };
      const tracked = state.messages[messageID];
      if (tracked === undefined) return { state, records: [] };
      const next: TrackedMessage = {
        ...tracked,
        partTypeById: { ...tracked.partTypeById, [untracked.id]: untracked.type },
      };
      return { state: commit(state, messageID, next), records: [] };
    }
  }
}

/**
 * Accumulate a streaming delta into the live snapshot. Only parts registered
 * as text/reasoning (via a prior message.part.updated) with field === "text"
 * accumulate; unknown partIDs, tool parts, and other fields are ignored. A
 * delta NEVER emits records.
 */
function handlePartDelta(
  state: MetricsState,
  event: Extract<MetricEvent, { type: "message.part.delta" }>,
): { state: MetricsState; records: MetricRecord[] } {
  const messageID = event.messageID;
  if (state.tombstones.has(messageID)) return { state, records: [] };
  const tracked = state.messages[messageID];
  if (tracked === undefined) return { state, records: [] };
  const partType = tracked.partTypeById[event.partID];
  if ((partType !== "text" && partType !== "reasoning") || event.field !== "text") {
    return { state, records: [] };
  }
  const next: TrackedMessage = {
    ...tracked,
    liveChars: tracked.liveChars + event.delta.length,
  };
  return { state: commit(state, messageID, next), records: [] };
}

function handleRemoved(
  state: MetricsState,
  messageID: string,
): { state: MetricsState; records: MetricRecord[] } {
  const tombstones = new Set(state.tombstones);
  tombstones.add(messageID);
  return {
    state: {
      ...state,
      tombstones,
      order: state.order.filter((id) => id !== messageID),
      messages: omit(state.messages, messageID),
    },
    records: [],
  };
}

/**
 * Track a session's place in the hierarchy (subagents = child sessions via
 * `parentID`). Immutable: returns a NEW state with the entry set; emits ZERO
 * records and never mutates the input.
 */
function handleSessionCreated(
  state: MetricsState,
  sessionID: string,
  parentID: string | null,
  title: string,
): { state: MetricsState; records: MetricRecord[] } {
  return {
    state: {
      ...state,
      sessions: { ...state.sessions, [sessionID]: { parentID, title } },
    },
    records: [],
  };
}

// ── Selectors ────────────────────────────────────────────────────────────────

/**
 * Live mid-stream snapshot for a session: the tracked message currently
 * accumulating deltas (liveChars > 0 AND a known gen-start), or null when
 * nothing is streaming. PURE: `now` is a parameter (`Date.now()` only in the
 * caller). The tok/s is an ESTIMATE — (chars / charsPerToken) over elapsed —
 * guarded by MIN_GEN_MS: below the floor the snapshot is still present (with
 * chars/estTokens/elapsedMs) but liveTokensPerSec is null. Never NaN/Infinity.
 */
export function selectLive(
  state: MetricsState,
  sessionID: string,
  now: number,
  charsPerToken = DEFAULT_CHARS_PER_TOKEN,
): LiveSnapshot | null {
  for (const id of state.order) {
    const tracked = state.messages[id];
    if (tracked === undefined) continue;
    if (tracked.sessionID !== sessionID) continue;
    if (tracked.liveChars <= 0 || tracked.liveGenStartMs === null) continue;
    const elapsedMs = now - tracked.liveGenStartMs;
    const estTokens = tracked.liveChars / charsPerToken;
    return {
      sessionID: tracked.sessionID,
      messageID: id,
      modelID: tracked.modelID,
      chars: tracked.liveChars,
      estTokens,
      elapsedMs,
      liveTokensPerSec:
        elapsedMs >= MIN_GEN_MS ? estTokens / (elapsedMs / 1000) : null,
    };
  }
  return null;
}

/**
 * Walk the parentID chain to the top-most (root) session. CYCLE-GUARDED:
 * terminates on the first revisited session (returning it), never throws, and
 * is stable across repeated calls. An unknown session returns itself. PURE:
 * reads `state.sessions` only.
 */
export function rootSessionID(state: MetricsState, sessionID: string): string {
  let current = sessionID;
  const seen = new Set<string>();
  for (;;) {
    const entry = state.sessions[current];
    if (entry === undefined) return current; // unknown session => itself
    if (entry.parentID === null) return current; // root reached
    if (seen.has(current)) return current; // cycle guard: stop on first revisit
    seen.add(current);
    current = entry.parentID;
  }
}

/**
 * The session plus ALL its descendants (any depth) — its subagent subtree.
 * Cycle-safe (a revisited session is skipped, so traversal terminates). An
 * unknown session yields the singleton {sessionID}. PURE: reads
 * `state.sessions` only.
 */
export function sessionSubtree(state: MetricsState, sessionID: string): Set<string> {
  // Build a parent -> children index once, then descend from sessionID.
  const children: Record<string, string[]> = {};
  for (const id of Object.keys(state.sessions)) {
    const parent = state.sessions[id].parentID;
    if (parent === null) continue;
    const siblings = children[parent];
    if (siblings === undefined) children[parent] = [id];
    else siblings.push(id);
  }
  const subtree = new Set<string>([sessionID]);
  const stack: string[] = [sessionID];
  while (stack.length > 0) {
    const node = stack.pop();
    if (node === undefined) break;
    const kids = children[node];
    if (kids === undefined) continue;
    for (const kid of kids) {
      if (subtree.has(kid)) continue; // cycle-safe + dedupe
      subtree.add(kid);
      stack.push(kid);
    }
  }
  return subtree;
}

/**
 * Records belonging to a session, optionally including its subagent subtree.
 * `includeSubagents` defaults to TRUE (records whose sessionID ∈ subtree);
 * FALSE selects only the exact sessionID. PURE.
 */
export function selectRecordsForSession(
  records: readonly MetricRecord[],
  state: MetricsState,
  sessionID: string,
  opts?: { includeSubagents?: boolean },
): MetricRecord[] {
  const includeSubagents = opts?.includeSubagents ?? true;
  if (!includeSubagents) {
    return records.filter((r) => r.sessionID === sessionID);
  }
  const subtree = sessionSubtree(state, sessionID);
  return records.filter((r) => subtree.has(r.sessionID));
}

/**
 * Live mid-stream snapshot for a session's SUBTREE: like `selectLive`, but
 * matches a streaming message whose sessionID ∈ subtree (so a parent surfaces
 * a streaming subagent). When several stream concurrently, the GREATEST
 * liveGenStartMs (most-recently-started) wins — independent of LRU iteration
 * order. The snapshot reports the ACTUAL streaming session's IDs and timings
 * (same shape/semantics as `selectLive`, incl. the MIN_GEN_MS floor). Null
 * when nothing in the subtree is streaming. PURE: `now` is a parameter.
 */
export function selectLiveForSubtree(
  state: MetricsState,
  sessionID: string,
  now: number,
  charsPerToken = DEFAULT_CHARS_PER_TOKEN,
): LiveSnapshot | null {
  const subtree = sessionSubtree(state, sessionID);
  let bestID: string | null = null;
  let bestTracked: TrackedMessage | null = null;
  let bestGenStart = Number.NEGATIVE_INFINITY;
  for (const id of state.order) {
    const tracked = state.messages[id];
    if (tracked === undefined) continue;
    if (!subtree.has(tracked.sessionID)) continue;
    if (tracked.liveChars <= 0 || tracked.liveGenStartMs === null) continue;
    if (tracked.liveGenStartMs > bestGenStart) {
      bestID = id;
      bestTracked = tracked;
      bestGenStart = tracked.liveGenStartMs;
    }
  }
  if (bestTracked === null || bestID === null) return null;
  const elapsedMs = now - bestGenStart;
  const estTokens = bestTracked.liveChars / charsPerToken;
  return {
    sessionID: bestTracked.sessionID,
    messageID: bestID,
    modelID: bestTracked.modelID,
    chars: bestTracked.liveChars,
    estTokens,
    elapsedMs,
    liveTokensPerSec:
      elapsedMs >= MIN_GEN_MS ? estTokens / (elapsedMs / 1000) : null,
  };
}

/**
 * The visible portion of a session's subagent subtree: `sessionSubtree` MINUS
 * `hidden`, BUT the queried root `sessionID` is ALWAYS kept (never removed even
 * when it appears in `hidden`). An unknown session yields the singleton
 * {sessionID} (still kept). PURE: reads `state.sessions` only.
 */
export function visibleSubtree(
  state: MetricsState,
  sessionID: string,
  hidden: ReadonlySet<string>,
): Set<string> {
  const subtree = sessionSubtree(state, sessionID);
  const visible = new Set<string>();
  for (const id of subtree) {
    if (id === sessionID || !hidden.has(id)) visible.add(id);
  }
  return visible;
}

/**
 * The records whose sessionID ∈ `visible` (input order preserved; membership is
 * the only filter). PURE.
 */
export function selectRecordsForVisible(
  records: readonly MetricRecord[],
  visible: ReadonlySet<string>,
): MetricRecord[] {
  return records.filter((r) => visible.has(r.sessionID));
}

/**
 * Whether a session is currently working. TRUE if `sessionID` ∈
 * `liveSessionIDs` (actively streaming — live wins regardless of records);
 * else TRUE when lifecycle says busy/retry; else FALSE when lifecycle says
 * idle;
 * else TRUE if the session's most-recent record (greatest `at`, NOT array
 * position) is a "call" (a step finished but the turn hasn't completed =>
 * mid-turn); else FALSE (no records for the session, OR the latest record is a
 * "message" => turn complete/done). Equal-`at` ties prefer a "message" over a
 * "call". Records for OTHER sessionIDs are ignored. PURE.
 */
export function isSessionWorking(
  records: readonly MetricRecord[],
  liveSessionIDs: ReadonlySet<string>,
  sessionID: string,
  lifecycleState?: "busy" | "retry" | "idle" | null,
): boolean {
  if (liveSessionIDs.has(sessionID)) return true;
  if (lifecycleState === "busy" || lifecycleState === "retry") return true;
  if (lifecycleState === "idle") return false;

  let latest: MetricRecord | null = null;
  for (const r of records) {
    if (r.sessionID !== sessionID) continue;
    if (
      latest === null ||
      r.at > latest.at ||
      (r.at === latest.at && latest.kind === "call" && r.kind === "message")
    ) {
      latest = r;
    }
  }
  return latest !== null && latest.kind === "call";
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function emptyTracked(sessionID: string): TrackedMessage {
  return {
    sessionID,
    providerID: "",
    modelID: "",
    mode: "",
    cost: 0,
    timeCreated: null,
    timeCompleted: null,
    tokens: null,
    finish: null,
    emitted: false,
    stepCount: 0,
    earliestPartStart: null,
    textOrder: [],
    textById: {},
    stepWindows: [],
    liveChars: 0,
    liveGenStartMs: null,
    partTypeById: {},
  };
}

function flattenTokens(t: EventTokens): TokenCounts {
  return {
    input: t.input,
    output: t.output,
    reasoning: t.reasoning,
    cacheRead: t.cache.read,
    cacheWrite: t.cache.write,
  };
}

/** end - start when strictly positive, else null (invalid/<=0 => null). */
function positiveDuration(end: number, start: number): number | null {
  const d = end - start;
  return d > 0 ? d : null;
}

/** tokens/sec; null when duration unknown; 0 output over a valid duration => 0. */
function tokensPerSec(output: number, durationMs: number | null): number | null {
  if (durationMs === null) return null;
  return output / (durationMs / 1000);
}

/**
 * Generation speed: (output + reasoning) tokens over the generation window.
 * Null when the window is unknown or degenerate (< MIN_GEN_MS); never
 * NaN/Infinity (a valid window is always >= MIN_GEN_MS > 0).
 */
function genTokensPerSec(
  output: number,
  reasoning: number,
  genMs: number | null,
): number | null {
  if (genMs === null || genMs < MIN_GEN_MS) return null;
  return (output + reasoning) / (genMs / 1000);
}

/** Message-level TTFT: earliest part start - message.time.created; null if either unknown. */
function messageTtft(tracked: TrackedMessage): number | null {
  if (tracked.earliestPartStart === null || tracked.timeCreated === null) return null;
  return tracked.earliestPartStart - tracked.timeCreated;
}

/** max(end) - min(start) over timed parts in a window; null when none or <= 0. */
function stepDuration(window: Record<string, PartTime>): number | null {
  let minStart: number | null = null;
  let maxEnd: number | null = null;
  for (const key of Object.keys(window)) {
    const p = window[key];
    if (typeof p.start === "number" && typeof p.end === "number") {
      if (minStart === null || p.start < minStart) minStart = p.start;
      if (maxEnd === null || p.end > maxEnd) maxEnd = p.end;
    }
  }
  if (minStart === null || maxEnd === null) return null;
  const d = maxEnd - minStart;
  return d > 0 ? d : null;
}

/**
 * Register a part's type for delta classification and latch the generation
 * start (first text/reasoning part.time.start this step; later parts keep it).
 */
function registerLivePart(
  tracked: TrackedMessage,
  partID: string,
  partType: string,
  start: number | undefined,
): TrackedMessage {
  return {
    ...tracked,
    partTypeById: { ...tracked.partTypeById, [partID]: partType },
    liveGenStartMs:
      tracked.liveGenStartMs === null && typeof start === "number"
        ? start
        : tracked.liveGenStartMs,
  };
}

/** Record a part's timing into message TTFT and every open step window. */
function applyTimedPart(
  tracked: TrackedMessage,
  partID: string,
  time: { start: number; end?: number } | undefined,
): TrackedMessage {
  if (time === undefined || typeof time.start !== "number") return tracked;
  const start = time.start;
  const partTime: PartTime =
    typeof time.end === "number" ? { start, end: time.end } : { start };

  const earliestPartStart =
    tracked.earliestPartStart === null || start < tracked.earliestPartStart
      ? start
      : tracked.earliestPartStart;

  const stepWindows =
    tracked.stepWindows.length === 0
      ? tracked.stepWindows
      : tracked.stepWindows.map((w) => ({ ...w, [partID]: partTime }));

  return { ...tracked, earliestPartStart, stepWindows };
}

/** Store/replace a text part's content, preserving first-seen order. */
function captureText(tracked: TrackedMessage, partID: string, text: string): TrackedMessage {
  return {
    ...tracked,
    textById: { ...tracked.textById, [partID]: text },
    textOrder: tracked.textOrder.includes(partID)
      ? tracked.textOrder
      : [...tracked.textOrder, partID],
  };
}

/** Join captured text in first-seen order and truncate per options. */
function buildResponseText(tracked: TrackedMessage, opts: Required<MetricsOptions>): string {
  if (!opts.captureText) return "";
  const full = tracked.textOrder.map((id) => tracked.textById[id] ?? "").join("\n");
  return full.length > opts.maxText ? full.slice(0, opts.maxText) + "..." : full;
}

/** Touch a message to most-recent and evict the oldest beyond the cap (forget). */
function commit(state: MetricsState, messageID: string, tracked: TrackedMessage): MetricsState {
  const order = state.order.filter((id) => id !== messageID);
  order.push(messageID);
  let messages: Record<string, TrackedMessage> = { ...state.messages, [messageID]: tracked };
  while (order.length > LRU_CAP) {
    const oldest = order.shift();
    if (oldest === undefined) break;
    messages = omit(messages, oldest);
  }
  return { ...state, order, messages };
}

/** Return a copy of `record` without `key` (immutable delete). */
function omit(record: Record<string, TrackedMessage>, key: string): Record<string, TrackedMessage> {
  const rest: Record<string, TrackedMessage> = {};
  for (const k of Object.keys(record)) {
    if (k !== key) rest[k] = record[k];
  }
  return rest;
}
