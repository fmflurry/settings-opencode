/**
 * Shared types for the llm-metrics feature.
 *
 * Two token shapes exist on purpose:
 *   - `EventTokens` is the NESTED shape carried by SDK message/part events
 *     (`{ input, output, reasoning, cache: { read, write } }`).
 *   - `TokenCounts` is the FLAT shape emitted on records
 *     (`{ input, output, reasoning, cacheRead, cacheWrite }`).
 *
 * `MetricEvent` is a structural, SDK-independent event union so the pure
 * reducer (`derive.ts`) never depends on the SDK and stays trivially testable.
 * The server plugin and the TUI plugin each convert raw SDK events into this
 * shape before calling `reduceEvent`.
 */

/** Flat token counts used on emitted records. */
export interface TokenCounts {
  input: number;
  output: number;
  reasoning: number;
  cacheRead: number;
  cacheWrite: number;
}

/** Nested token shape carried by SDK message/part events. */
export interface EventTokens {
  input: number;
  output: number;
  reasoning: number;
  cache: {
    read: number;
    write: number;
  };
}

/** Options baked into metrics state at creation time. */
export interface MetricsOptions {
  /** Capture assistant response text on MessageMetric records (default true). */
  captureText?: boolean;
  /** Truncate captured text beyond this many chars (default 4000). */
  maxText?: number;
  /** Chars-per-token ratio for the live tok/s ESTIMATE (default 4). */
  charsPerToken?: number;
}

/** Message info carried by a `message.updated` event. */
export interface MessageInfo {
  id: string;
  sessionID: string;
  role: string;
  providerID: string;
  modelID: string;
  mode: string;
  cost: number;
  time: {
    created: number;
    completed?: number;
  };
  tokens: EventTokens;
  finish?: string | null;
}

/** A `step-start` part opens a per-call timing window. */
export interface StepStartPart {
  id: string;
  sessionID: string;
  messageID: string;
  type: "step-start";
}

/** A streaming `text` part; contributes to response text and timing. */
export interface TextPart {
  id: string;
  sessionID: string;
  messageID: string;
  type: "text";
  text: string;
  synthetic?: boolean;
  time?: {
    start: number;
    end?: number;
  };
}

/** A `reasoning` part; contributes to timing only (never to response text). */
export interface ReasoningPart {
  id: string;
  sessionID: string;
  messageID: string;
  type: "reasoning";
  text: string;
  time: {
    start: number;
    end?: number;
  };
}

/** A `step-finish` part closes a window and emits one CallMetric. */
export interface StepFinishPart {
  id: string;
  sessionID: string;
  messageID: string;
  type: "step-finish";
  reason: string;
  cost: number;
  tokens: EventTokens;
}

/** The part variants the reducer tracks; any other part type is ignored. */
export type MetricPart =
  | StepStartPart
  | TextPart
  | ReasoningPart
  | StepFinishPart;

/** Structural event union consumed by `reduceEvent`. */
export type MetricEvent =
  | { type: "message.updated"; info: MessageInfo }
  | { type: "message.part.updated"; part: MetricPart; delta?: string }
  | {
      /**
       * High-frequency streaming text chunk (flattened, NOT nested under
       * `part`). Accumulates into the live snapshot only; NEVER emits a
       * metric record.
       */
      type: "message.part.delta";
      sessionID: string;
      messageID: string;
      partID: string;
      field: string;
      delta: string;
    }
  | { type: "message.removed"; messageID: string }
  | {
      /**
       * Session lifecycle (flattened, NOT nested under `info`). Tracks the
       * session hierarchy (subagents = child sessions via `parentID`) so the
       * reducer can stamp `rootSessionID` on emitted records. NEVER emits a
       * metric record.
       */
      type: "session.created";
      sessionID: string;
      parentID: string | null;
      title: string;
    }
  | {
      /**
       * Session deletion. RETAINS the hierarchy entry (records outlive
       * sessions); NEVER emits a metric record.
       */
      type: "session.deleted";
      sessionID: string;
    };

/** Per-call (step) metric record. */
export interface CallMetric {
  kind: "call";
  partID: string;
  finishReason: string;
  sessionID: string;
  /**
   * Top-most ancestor session (root of the subagent tree this call belongs
   * to); equals `sessionID` for a root session or when the hierarchy is
   * unknown at emission time.
   */
  rootSessionID: string;
  messageID: string;
  providerID: string;
  modelID: string;
  mode: string;
  tokens: TokenCounts;
  cost: number;
  ttftMs: number | null;
  durationMs: number | null;
  tokensPerSec: number | null;
  /**
   * Generation speed (output + reasoning tokens over the generation window),
   * excluding TTFT. Null when the window is unknown or degenerate (< MIN_GEN_MS).
   */
  genTokensPerSec: number | null;
  /** Generation window in ms (the raw step window for a call). */
  genDurationMs: number | null;
  /** Epoch ms at emission. */
  at: number;
}

/** Per-message (aggregate) metric record. */
export interface MessageMetric {
  kind: "message";
  finish: string;
  steps: number;
  responseText: string;
  sessionID: string;
  /**
   * Top-most ancestor session (root of the subagent tree this message belongs
   * to); equals `sessionID` for a root session or when the hierarchy is
   * unknown at emission time.
   */
  rootSessionID: string;
  messageID: string;
  providerID: string;
  modelID: string;
  mode: string;
  tokens: TokenCounts;
  cost: number;
  ttftMs: number | null;
  durationMs: number | null;
  tokensPerSec: number | null;
  /**
   * Generation speed (output + reasoning tokens over the generation window),
   * excluding TTFT. Null when the window is unknown or degenerate (< MIN_GEN_MS).
   */
  genTokensPerSec: number | null;
  /** Generation window in ms (durationMs - ttftMs for a message). */
  genDurationMs: number | null;
  /** Epoch ms at emission. */
  at: number;
}

/** A single emitted metric line (NDJSONL). */
export type MetricRecord = CallMetric | MessageMetric;

/**
 * Live mid-stream snapshot for one session (from `selectLive`). The tok/s is
 * an ESTIMATE: (chars / charsPerToken) over elapsed since generation started.
 * `liveTokensPerSec` is null below the MIN_GEN_MS floor (warming up); never
 * NaN/Infinity.
 */
export interface LiveSnapshot {
  sessionID: string;
  messageID: string;
  modelID: string;
  /** Accumulated streamed chars this step (text + reasoning parts). */
  chars: number;
  /** chars / charsPerToken. */
  estTokens: number;
  /** now - generation start (ms). */
  elapsedMs: number;
  /** estTokens / (elapsedMs / 1000); null when elapsedMs < MIN_GEN_MS. */
  liveTokensPerSec: number | null;
}

/** A part's timing window entry (end present only once the part completes). */
export interface PartTime {
  start: number;
  end?: number;
}

/**
 * Hierarchy entry for a session (subagents = OpenCode child sessions via
 * `parentID`). Tracked by the reducer from `session.created` events and
 * retained on `session.deleted` (records outlive sessions).
 */
export interface SessionHierarchyEntry {
  /** Parent session ID; null for a root session. */
  parentID: string | null;
  /** Session title (carries the agent/"subagent" name). */
  title: string;
}

/** Per-message accumulation held inside the reducer state. */
export interface TrackedMessage {
  sessionID: string;
  providerID: string;
  modelID: string;
  mode: string;
  cost: number;
  timeCreated: number | null;
  timeCompleted: number | null;
  tokens: TokenCounts | null;
  finish: string | null;
  /** True once the MessageMetric has been emitted (at-most-once guard). */
  emitted: boolean;
  /** Number of step-finish parts seen (== MessageMetric.steps). */
  stepCount: number;
  /** Earliest text/reasoning part start seen (for message-level TTFT). */
  earliestPartStart: number | null;
  /** Non-synthetic text part IDs in first-seen order. */
  textOrder: string[];
  /** part ID -> latest text (re-updates replace). */
  textById: Record<string, string>;
  /** Open step timing windows, FIFO (step-start pushes, step-finish shifts). */
  stepWindows: Array<Record<string, PartTime>>;
  /** Live: streamed chars accumulated in the CURRENT step (reset per step). */
  liveChars: number;
  /** Live: generation start (first text/reasoning part.time.start) this step. */
  liveGenStartMs: number | null;
  /** Live: part ID -> part type, so deltas can be classified (text vs tool). */
  partTypeById: Record<string, string>;
}

/** Immutable reducer state. */
export interface MetricsState {
  options: Required<MetricsOptions>;
  /** Tracked message IDs in LRU order (oldest first, most-recent last). */
  order: string[];
  /** message ID -> accumulated state. */
  messages: Record<string, TrackedMessage>;
  /** Removed message IDs; suppressed forever (tombstones). */
  tombstones: ReadonlySet<string>;
  /** Session hierarchy: sessionID -> { parentID, title } (subagent tree). */
  sessions: Record<string, SessionHierarchyEntry>;
}
