/**
 * llm-metrics OpenCode server plugin
 *
 * Turns bus events into per-LLM-call metrics by feeding them through the pure
 * reducer in `./llm-metrics-lib/derive.ts` and appending any emitted records
 * to an NDJSONL file via `./llm-metrics-lib/transport.ts`.
 *
 * Env config (read with the same helper style as the other plugins):
 *   - LLM_METRICS_ENABLED      kill-switch; "false"/"0" disables (default on)
 *   - LLM_METRICS_OUT          output file (default ~/data/llm-metrics.jsonl)
 *   - LLM_METRICS_CAPTURE_TEXT capture response text (default true)
 *   - LLM_METRICS_MAX_TEXT     response-text truncation length (default 4000)
 *
 * The event hook NEVER throws: raw SDK events are defensively unwrapped and
 * narrowed from `unknown` (no `any`), reduced, and persisted best-effort. Any
 * failure is logged via client.app.log and swallowed so OpenCode keeps running.
 */

import type { Plugin, PluginInput } from "@opencode-ai/plugin";

import { createMetricsState, reduceEvent } from "./llm-metrics-lib/derive.ts";
import { appendHeaderSnapshot } from "./llm-metrics-lib/header-store.ts";
import {
  mergeSanitizedHeaders,
  sanitizeHeaderMap,
  type SanitizedHeader,
} from "./llm-metrics-lib/headers.ts";
import { appendRecords, resolveOutPath } from "./llm-metrics-lib/transport.ts";
import type {
  MessageInfo,
  MetricEvent,
  MetricPart,
  MetricsState,
} from "./llm-metrics-lib/types.ts";

const SERVICE = "llm-metrics";

// ─── Env helpers (mirrors learning-loop.ts) ──────────────────────────────────

const envProc = (
  globalThis as { process?: { env?: Record<string, string | undefined> } }
).process;

function readEnvStr(key: string): string | undefined {
  return envProc?.env?.[key];
}

function readEnvBool(key: string, fallback: boolean): boolean {
  const raw = readEnvStr(key);
  if (raw === "false" || raw === "0") return false;
  if (raw === "true" || raw === "1") return true;
  return fallback;
}

function readEnvInt(key: string, fallback: number): number {
  const raw = readEnvStr(key);
  const parsed = raw !== undefined ? parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function isEnabled(): boolean {
  return readEnvBool("LLM_METRICS_ENABLED", true);
}

// ─── Raw SDK event -> structural MetricEvent (narrow from unknown, no any) ──

function asObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

interface MessageModelRef {
  providerID: string;
  modelID: string;
}

interface MessageRef {
  id: string;
  model: MessageModelRef;
}

interface LatestTurnState {
  userMessageID: string | null;
  assistantMessageID: string | null;
  providerID: string;
  modelID: string;
  requestHeaders: readonly SanitizedHeader[];
}

function hasMessageRef(value: unknown): value is MessageRef {
  const obj = asObject(value);
  if (obj === null) return false;
  if (typeof obj["id"] !== "string") return false;

  const model = asObject(obj["model"]);
  if (model === null) return false;

  return typeof model["providerID"] === "string" && typeof model["modelID"] === "string";
}

function hasApiErrorResponseHeaders(value: unknown): value is {
  data: { responseHeaders: Record<string, unknown> };
} {
  const obj = asObject(value);
  if (obj === null || obj["name"] !== "APIError") return false;

  const data = asObject(obj["data"]);
  if (data === null) return false;

  const responseHeaders = asObject(data["responseHeaders"]);
  return responseHeaders !== null;
}

/**
 * Defensively unwrap the `{ event }` envelope OpenCode passes to the hook and
 * narrow the raw SDK event into the structural `MetricEvent` the reducer
 * consumes. Returns null for anything we do not track.
 */
function toMetricEvent(raw: unknown): MetricEvent | null {
  const obj = asObject(raw);
  if (obj === null) return null;
  const type = obj["type"];
  if (typeof type !== "string") return null;
  const props = asObject(obj["properties"]);
  if (props === null) return null;

  if (type === "message.updated") {
    const info = asObject(props["info"]);
    if (info === null) return null;
    return { type: "message.updated", info: info as unknown as MessageInfo };
  }

  if (type === "message.part.updated") {
    const part = asObject(props["part"]);
    if (part === null) return null;
    const delta = typeof props["delta"] === "string" ? props["delta"] : undefined;
    return {
      type: "message.part.updated",
      part: part as unknown as MetricPart,
      delta,
    };
  }

  if (type === "message.removed") {
    const messageID = props["messageID"];
    if (typeof messageID !== "string") return null;
    return { type: "message.removed", messageID };
  }

  if (type === "session.created") {
    const sessionID = props["sessionID"];
    if (typeof sessionID !== "string") return null;
    const info = asObject(props["info"]);
    if (info === null) return null;
    // `Session.parentID` is optional (absent for root sessions) => null.
    const parentID = typeof info["parentID"] === "string" ? info["parentID"] : null;
    const title = typeof info["title"] === "string" ? info["title"] : "";
    return { type: "session.created", sessionID, parentID, title };
  }

  if (type === "session.deleted") {
    const sessionID = props["sessionID"];
    if (typeof sessionID !== "string") return null;
    return { type: "session.deleted", sessionID };
  }

  return null;
}

// ─── Plugin ──────────────────────────────────────────────────────────────────

export default (async ({ client }: PluginInput) => {
  // Capture/response options are baked into state once at init.
  const captureText = readEnvBool("LLM_METRICS_CAPTURE_TEXT", true);
  const maxText = readEnvInt("LLM_METRICS_MAX_TEXT", 4000);
  let state: MetricsState = createMetricsState({ captureText, maxText });
  const latestTurnBySession = new Map<string, LatestTurnState>();

  const logError = (message: string): void => {
    // A synchronous throw from the logging client must never escape the hook.
    try {
      client.app
        .log({ body: { service: SERVICE, level: "error", message } })
        .catch(() => {});
    } catch {
      // Swallow: the event hook must never throw, even when logging itself fails.
    }
  };

  const rememberUserTurn = (sessionID: string, message: MessageRef): LatestTurnState => {
    const existing = latestTurnBySession.get(sessionID);
    const sameUser = existing?.userMessageID === message.id;

    const next: LatestTurnState = {
      userMessageID: message.id,
      assistantMessageID: sameUser ? existing?.assistantMessageID ?? null : null,
      providerID: message.model.providerID,
      modelID: message.model.modelID,
      requestHeaders: sameUser ? existing?.requestHeaders ?? [] : [],
    };

    latestTurnBySession.set(sessionID, next);
    return next;
  };

  const rememberRequestHeaders = (
    sessionID: string,
    message: MessageRef,
    requestHeaders: readonly SanitizedHeader[],
  ): LatestTurnState => {
    const existing = latestTurnBySession.get(sessionID);
    const sameUser = existing?.userMessageID === message.id;

    const next: LatestTurnState = {
      userMessageID: message.id,
      assistantMessageID: sameUser ? existing?.assistantMessageID ?? null : null,
      providerID: message.model.providerID,
      modelID: message.model.modelID,
      requestHeaders: [...requestHeaders],
    };

    latestTurnBySession.set(sessionID, next);
    return next;
  };

  const appendRequestSnapshotForSession = (
    sessionID: string,
    turn: LatestTurnState,
  ): void => {
    if (turn.requestHeaders.length === 0) return;

    appendHeaderSnapshot({
      sessionID,
      userMessageID: turn.userMessageID,
      assistantMessageID: turn.assistantMessageID,
      providerID: turn.providerID,
      modelID: turn.modelID,
      createdAt: Date.now(),
      requestHeaders: turn.requestHeaders,
      responseHeaders: [],
      responseHeadersSource: "none",
    });
  };

  const captureAssistantMessage = (raw: unknown): void => {
    const obj = asObject(raw);
    if (obj === null || obj["type"] !== "message.updated") return;

    const props = asObject(obj["properties"]);
    const info = props === null ? null : asObject(props["info"]);
    if (info === null || info["role"] !== "assistant") return;

    const sessionID = info["sessionID"];
    const assistantMessageID = info["id"];
    const userMessageID = info["parentID"];
    const providerID = info["providerID"];
    const modelID = info["modelID"];

    if (
      typeof sessionID !== "string" ||
      typeof assistantMessageID !== "string" ||
      typeof providerID !== "string" ||
      typeof modelID !== "string"
    ) {
      return;
    }

    const existing = latestTurnBySession.get(sessionID);
    if (existing !== undefined) {
      if (typeof userMessageID === "string" && existing.userMessageID !== userMessageID) return;
      latestTurnBySession.set(sessionID, {
        ...existing,
        assistantMessageID,
        providerID,
        modelID,
      });
      return;
    }

    latestTurnBySession.set(sessionID, {
      userMessageID: typeof userMessageID === "string" ? userMessageID : null,
      assistantMessageID,
      providerID,
      modelID,
      requestHeaders: [],
    });
  };

  const captureErrorResponseHeaders = (raw: unknown): void => {
    const obj = asObject(raw);
    if (obj === null || obj["type"] !== "session.error") return;

    const props = asObject(obj["properties"]);
    if (props === null) return;

    const sessionID = props["sessionID"];
    if (typeof sessionID !== "string") return;

    const latestTurn = latestTurnBySession.get(sessionID);
    if (latestTurn === undefined) return;

    const error = props["error"];
    if (!hasApiErrorResponseHeaders(error)) return;

    const responseHeaders = sanitizeHeaderMap(error.data.responseHeaders, "error-response");
    if (responseHeaders.length === 0) return;

    appendHeaderSnapshot({
      sessionID,
      userMessageID: latestTurn.userMessageID,
      assistantMessageID: latestTurn.assistantMessageID,
      providerID: latestTurn.providerID,
      modelID: latestTurn.modelID,
      createdAt: Date.now(),
      requestHeaders: latestTurn.requestHeaders,
      responseHeaders,
      responseHeadersSource: "error",
    });
  };

  return {
    "chat.message": async (
      input: { sessionID: string },
      output: { message: unknown; parts: unknown[] },
    ): Promise<void> => {
      if (!isEnabled()) return;

      try {
        if (hasMessageRef(output.message)) {
          rememberUserTurn(input.sessionID, output.message);
        }
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        logError(`chat.message header tracking failed: ${message}`);
      }
    },

    "chat.params": async (
      input: {
        sessionID: string;
        model: { headers: Record<string, string> };
        message: unknown;
      },
      _output: {
        temperature: number;
        topP: number;
        topK: number;
        maxOutputTokens: number | undefined;
        options: Record<string, unknown>;
      },
    ): Promise<void> => {
      if (!isEnabled()) return;

      try {
        if (!hasMessageRef(input.message)) return;

        const existing = latestTurnBySession.get(input.sessionID);
        const requestHeaders = mergeSanitizedHeaders(
          existing?.userMessageID === input.message.id ? existing.requestHeaders : [],
          sanitizeHeaderMap(input.model.headers, "model"),
        );
        const turn = rememberRequestHeaders(input.sessionID, input.message, requestHeaders);
        appendRequestSnapshotForSession(input.sessionID, turn);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        logError(`chat.params header capture failed: ${message}`);
      }
    },

    "chat.headers": async (
      input: {
        sessionID: string;
        model: { headers: Record<string, string> };
        message: unknown;
      },
      output: { headers: Record<string, string> },
    ): Promise<void> => {
      if (!isEnabled()) return;

      try {
        if (!hasMessageRef(input.message)) return;

        const existing = latestTurnBySession.get(input.sessionID);
        const requestHeaders = mergeSanitizedHeaders(
          existing?.userMessageID === input.message.id ? existing.requestHeaders : [],
          sanitizeHeaderMap(input.model.headers, "model"),
          sanitizeHeaderMap(output.headers, "plugin"),
        );
        const turn = rememberRequestHeaders(input.sessionID, input.message, requestHeaders);
        appendRequestSnapshotForSession(input.sessionID, turn);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        logError(`chat.headers capture failed: ${message}`);
      }
    },

    event: async (input: { event?: unknown } | unknown): Promise<void> => {
      // Kill-switch checked per event so it can be toggled without a restart.
      if (!isEnabled()) return;

      try {
        // Defensively unwrap the { event } wrapper (handles both shapes).
        const raw = (input as { event?: unknown }).event ?? input;
        captureAssistantMessage(raw);
        captureErrorResponseHeaders(raw);
        const metricEvent = toMetricEvent(raw);
        if (metricEvent === null) return;

        const result = reduceEvent(state, metricEvent);
        state = result.state;
        if (result.records.length > 0) {
          appendRecords(resolveOutPath(), result.records);
        }
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        logError(`event processing failed: ${message}`);
      }
    },
  };
}) satisfies Plugin;
