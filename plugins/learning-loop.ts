/**
 * learning-loop OpenCode plugin
 *
 * Hermes-style per-turn background learning review. After every assistant
 * message that completes (stop or tool-calls), this plugin spawns a child
 * session that runs the `learning-reviewer` subagent.
 *
 * The reviewer analyzes the conversation and persists learnings:
 *   - Project memories → calls `codememory_assert_claim` directly
 *   - Self-improvement  → writes pending files for user approval
 *
 * Fire-and-forget: never blocks the main session.
 */

import type { Plugin } from "@opencode-ai/plugin";

// ─── Types ───────────────────────────────────────────────────────────────────

interface EventEnvelope {
  type?: string;
  properties?: {
    info?: Record<string, unknown>;
  };
}

interface MessageInfo {
  id?: string;
  sessionID?: string;
  role?: string;
  mode?: string;
  modelID?: string;
  providerID?: string;
  finish?: string;
}

interface MessagePart {
  type?: string;
  text?: string;
  synthetic?: boolean;
}

interface MessageEntry {
  info?: MessageInfo;
  parts?: MessagePart[];
}

interface SessionResponse {
  data?: {
    id: string;
  };
}

interface MessagesResponse {
  data?: MessageEntry[];
}

// ─── Constants ───────────────────────────────────────────────────────────────

const SERVICE = "learning-loop";

/** Agents whose completed messages trigger a learning review.
 *  Excludes "learning-reviewer" to prevent infinite loops. */
const REVIEWABLE_AGENTS: ReadonlySet<string> = new Set([
  "conductor",
  "planner",
  "architect",
  "coder",
  "writer",
  "code-reviewer",
  "security-reviewer",
  "tdd-guide",
  "build-error-resolver",
  "e2e-runner",
  "doc-updater",
  "refactor-cleaner",
  "database-reviewer",
  "git-specialist",
  "angular-cop",
  "dotnet-cop",
]);

// ─── Plugin ──────────────────────────────────────────────────────────────────

const LearningLoopPlugin: Plugin = async ({ client }) => {
  // Dedup: never review the same message twice (per process lifetime).
  const reviewedMessageIds = new Set<string>();

  // Per-session budget: max reviews per session to prevent runaway.
  const reviewCountBySession = new Map<string, number>();

  const envProc = (
    globalThis as { process?: { env?: Record<string, string | undefined> } }
  ).process;
  const BUDGET = Number(envProc?.env?.LEARNING_LOOP_BUDGET ?? 20);

  const log = (level: string, message: string): void => {
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

  return {
    event: async ({ event }: { event: EventEnvelope }): Promise<void> => {
      // ── Pre-gate: only message.updated events ────────────────────────
      if (event?.type !== "message.updated") return;

      const info = (event.properties?.info ?? {}) as MessageInfo;

      // Must be an assistant message that reached a terminal state.
      if (info.role !== "assistant") return;
      if (info.finish !== "stop" && info.finish !== "tool-calls") return;

      // Only review known agents (excludes learning-reviewer itself).
      if (!info.mode || !REVIEWABLE_AGENTS.has(info.mode)) return;
      if (!info.id || !info.sessionID) return;

      // Dedup.
      if (reviewedMessageIds.has(info.id)) return;
      reviewedMessageIds.add(info.id);

      // Session budget.
      const usedBudget = reviewCountBySession.get(info.sessionID) ?? 0;
      if (usedBudget >= BUDGET) {
        log(
          "warn",
          `session ${info.sessionID.slice(0, 8)} exhausted learning review budget (${BUDGET})`,
        );
        return;
      }
      reviewCountBySession.set(info.sessionID, usedBudget + 1);

      log(
        "info",
        `triggering review for ${info.mode} msg ${info.id.slice(0, 8)} (budget ${usedBudget + 1}/${BUDGET})`,
      );

      // ── Fire-and-forget: fetch context → spawn review session ──────
      void (async () => {
        try {
          // 1. Fetch last 10 messages for conversation context.
          const msgsRes = await client.session.messages({
            path: { id: info.sessionID as string },
            query: { limit: 10 },
          });
          const msgs = (
            (msgsRes as MessagesResponse)?.data ?? []
          ).slice(-10);

          // 2. Format conversation context.
          const contextParts: string[] = [];
          for (const msg of msgs) {
            const role = msg.info?.role ?? "unknown";
            const mode = msg.info?.mode
              ? ` (${msg.info.mode})`
              : "";
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
          // learning-reviewer.txt already has the rules and instructions).
          const reviewPrompt = [
            "## Conversation Context (last 10 messages)",
            "",
            contextText,
          ].join("\n");

          // 4. Create a child session for the review.
          const createRes = await client.session.create({
            body: {
              parentID: info.sessionID as string,
              title: `learning-review-${info.id.slice(0, 8)}`,
            },
          });
          const childId = (createRes as SessionResponse)?.data?.id;
          if (!childId) {
            log("warn", "failed to create review session (no id in response)");
            return;
          }

          // 5. Dispatch the review (fire-and-forget via promptAsync).
          await client.session.promptAsync({
            path: { id: childId },
            body: {
              agent: "learning-reviewer",
              parts: [{ type: "text" as const, text: reviewPrompt }],
            },
          } as Parameters<typeof client.session.promptAsync>[0]);

          log(
            "info",
            `review dispatched msg=${info.id?.slice(0, 8)} session=${childId.slice(0, 8)}`,
          );
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          log("error", `review execution failed: ${msg}`);
        }
      })();
    },
  };
};

export default LearningLoopPlugin;
