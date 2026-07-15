/**
 * learning-loop OpenCode plugin
 *
 * Triggers one learning review per idle window, not per message.
 * After the session goes idle, a debounced timer fires after
 * LEARNING_LOOP_IDLE_MS (default 5 min). If the session becomes active
 * again before the timer fires, the timer is reset. Once the timer fires,
 * exactly one review is dispatched for that idle window and the session is
 * marked "reviewed" until it goes active again.
 *
 * Guards:
 *   - Daily cap (LEARNING_LOOP_DAILY_CAP, default 50) across all sessions.
 *   - Per-idle-window budget (LEARNING_LOOP_BUDGET, default 1) per session.
 *   - Circuit breaker: any Insufficient Balance / auth / quota error disables
 *     all further dispatches for the process lifetime.
 *   - Dedup: the same session is never reviewed twice in the same idle window.
 *
 * The review is dispatched as a fire-and-forget child session running the
 * `learning-reviewer` agent. The model is NOT hardcoded here — it comes from
 * the learning-reviewer agent configuration.
 *
 * NOTE: The SDK emits `session.idle` (EventSessionIdle) when a session
 * transitions to idle. This replaces the previous per-`message.updated`
 * trigger that caused ~7,000 spurious dispatches in 46 minutes.
 */

import type { Plugin } from "@opencode-ai/plugin";
import type { Event } from "@opencode-ai/sdk";

// ─── Types ───────────────────────────────────────────────────────────────────

interface SessionResponse {
  data?: {
    id: string;
  };
}

interface MessagePart {
  type?: string;
  text?: string;
  synthetic?: boolean;
}

interface MessageEntry {
  info?: {
    role?: string;
    mode?: string;
  };
  parts?: MessagePart[];
}

interface MessagesResponse {
  data?: MessageEntry[];
}

// ─── Constants ───────────────────────────────────────────────────────────────

const SERVICE = "learning-loop";

const QUOTA_ERROR_PATTERNS: ReadonlyArray<string> = [
  "insufficient balance",
  "insufficient_balance",
  "quota exceeded",
  "rate limit",
  "unauthorized",
  "forbidden",
  "payment required",
];

// ─── Env helpers ─────────────────────────────────────────────────────────────

const envProc = (
  globalThis as { process?: { env?: Record<string, string | undefined> } }
).process;

function readEnvInt(key: string, fallback: number): number {
  const raw = envProc?.env?.[key];
  const parsed = raw !== undefined ? parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const IDLE_MS = readEnvInt("LEARNING_LOOP_IDLE_MS", 300_000); // 5 min
const DAILY_CAP = readEnvInt("LEARNING_LOOP_DAILY_CAP", 50);
const IDLE_WINDOW_BUDGET = readEnvInt("LEARNING_LOOP_BUDGET", 1);

// ─── Plugin ──────────────────────────────────────────────────────────────────

const LearningLoopPlugin: Plugin = async ({ client }) => {
  // Circuit breaker: set to true on any quota/auth error; never cleared.
  let balanceExhausted = false;

  // Daily dispatch counter (process-lifetime; resets on restart).
  let dailyCount = 0;

  // Per-session debounce handles: cleared+reset on each idle event.
  const debounceHandles = new Map<string, ReturnType<typeof setTimeout>>();

  // Per-session dispatch count for the current idle window.
  // Reset to 0 when the session goes active again (session.status busy).
  const windowDispatchCount = new Map<string, number>();

  const log = (level: "debug" | "info" | "warn" | "error", message: string): void => {
    client.app
      .log({ body: { service: SERVICE, level, message } })
      .catch(() => {});
  };

  const extractText = (parts: MessagePart[] | undefined): string => {
    if (!Array.isArray(parts)) return "";
    return parts
      .filter(
        (p): p is { type?: string; text: string; synthetic?: boolean } =>
          p.type === "text" && typeof p.text === "string" && !p.synthetic,
      )
      .map((p) => p.text)
      .join("\n")
      .trim();
  };

  const isQuotaError = (message: string): boolean =>
    QUOTA_ERROR_PATTERNS.some((pattern) =>
      message.toLowerCase().includes(pattern),
    );

  /** Dispatch a review for the given session (fire-and-forget). */
  const dispatchReview = (sessionID: string): void => {
    void (async () => {
      try {
        // 1. Fetch last 10 messages for conversation context.
        const msgsRes = await client.session.messages({
          path: { id: sessionID },
          query: { limit: 10 },
        });
        const msgs = ((msgsRes as MessagesResponse)?.data ?? []).slice(-10);

        // 2. Format conversation context.
        const contextParts: string[] = [];
        for (const msg of msgs) {
          const role = msg.info?.role ?? "unknown";
          const mode = msg.info?.mode ? ` (${msg.info.mode})` : "";
          const text = extractText(msg.parts);
          if (text) {
            contextParts.push(`[${role}${mode}]\n${text}\n`);
          }
        }
        const contextText =
          contextParts.length > 0
            ? contextParts.join("---\n")
            : "(no conversation text available)";

        // 3. Build the review prompt (task context only — system prompt
        //    learning-reviewer.txt already has the rules and instructions).
        const reviewPrompt = [
          "## Conversation Context (last 10 messages)",
          "",
          contextText,
        ].join("\n");

        // 4. Create a child session for the review.
        const createRes = await client.session.create({
          body: {
            parentID: sessionID,
            title: `learning-review-${sessionID.slice(0, 8)}-${Date.now()}`,
          },
        });
        const childId = (createRes as SessionResponse)?.data?.id;
        if (!childId) {
          log("warn", "failed to create review session (no id in response)");
          return;
        }

        // 5. Dispatch the review (fire-and-forget via promptAsync).
        //    Model is NOT specified here; comes from learning-reviewer agent config.
        await client.session.promptAsync({
          path: { id: childId },
          body: {
            agent: "learning-reviewer",
            parts: [{ type: "text" as const, text: reviewPrompt }],
          },
        } as Parameters<typeof client.session.promptAsync>[0]);

        dailyCount += 1;
        log(
          "info",
          `review dispatched for session=${sessionID.slice(0, 8)} child=${childId.slice(0, 8)} (daily ${dailyCount}/${DAILY_CAP})`,
        );
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);

        if (isQuotaError(msg)) {
          if (!balanceExhausted) {
            balanceExhausted = true;
            log(
              "error",
              `circuit breaker tripped — balance/quota error, all further reviews disabled for this process: ${msg}`,
            );
          }
          return;
        }

        log("error", `review execution failed: ${msg}`);
      }
    })();
  };

  /** Schedule a debounced review for a session after it goes idle. */
  const scheduleReview = (sessionID: string): void => {
    // Clear any existing timer for this session.
    const existing = debounceHandles.get(sessionID);
    if (existing !== undefined) {
      clearTimeout(existing);
    }

    const handle = setTimeout(() => {
      debounceHandles.delete(sessionID);

      // All guards run inside the timer callback so they reflect state at
      // the moment the timer fires, not when the idle event arrived.

      if (balanceExhausted) return;

      if (dailyCount >= DAILY_CAP) {
        log(
          "warn",
          `daily cap reached (${DAILY_CAP}), skipping review for session=${sessionID.slice(0, 8)}`,
        );
        return;
      }

      const windowCount = windowDispatchCount.get(sessionID) ?? 0;
      if (windowCount >= IDLE_WINDOW_BUDGET) {
        // Already at the per-idle-window budget for this session.
        return;
      }

      windowDispatchCount.set(sessionID, windowCount + 1);
      dispatchReview(sessionID);
    }, IDLE_MS);

    debounceHandles.set(sessionID, handle);
  };

  return {
    event: async ({ event }: { event: Event }): Promise<void> => {
      // ── session.idle: schedule a debounced review ────────────────────
      if (event.type === "session.idle") {
        const { sessionID } = event.properties;
        scheduleReview(sessionID);
        return;
      }

      // ── session.status busy: reset the "reviewed this window" flag ───
      // When the user sends a new message the session becomes busy again,
      // which means a future idle can trigger another review.
      if (event.type === "session.status") {
        const { sessionID, status } = event.properties;
        if (status.type === "busy") {
          windowDispatchCount.delete(sessionID);
          // Also cancel any pending timer — the session is active again.
          const handle = debounceHandles.get(sessionID);
          if (handle !== undefined) {
            clearTimeout(handle);
            debounceHandles.delete(sessionID);
          }
        }
        return;
      }
    },
  };
};

export default LearningLoopPlugin;
