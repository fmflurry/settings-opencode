/**
 * OpenCode minimal autonomous auto-compaction plugin
 *
 * - Hardens compaction summary (resume-ready checkpoint) via experimental.session.compacting
 * - Arms compaction after N tool calls
 * - Triggers compaction only when session is idle (safe, non-interrupting)
 *
 * Config:
 *   OC_COMPACT_THRESHOLD=60
 */

export const AutoCompactMin = async ({ client }) => {
  const THRESHOLD =
    Number.parseInt(process.env.OC_COMPACT_THRESHOLD ?? "60", 10) || 60;

  let sessionId = null;
  let toolCountSinceLastCompact = 0;
  let shouldCompact = false;
  let isCompacting = false;

  async function log(level, message, extra) {
    try {
      await client.app.log({
        body: { service: "auto-compact-min", level, message, extra },
      });
    } catch {
      // ignore logging failures
    }
  }

  async function maybeCompact() {
    if (!sessionId || !shouldCompact || isCompacting) return;

    // reset flag before calling summarize to avoid loops
    shouldCompact = false;
    isCompacting = true;

    try {
      await log("info", `Auto-compacting (threshold=${THRESHOLD})`);
      await client.session.summarize({ path: { id: sessionId }, body: {} });
      toolCountSinceLastCompact = 0;

      // optional toast (non-blocking)
      await client.tui.showToast({
        body: {
          message: "Session compacted automatically (strategic-compact).",
          variant: "success",
        },
      });
    } catch (err) {
      await log("error", "Auto-compaction failed", {
        error: err?.message ?? String(err),
      });
    } finally {
      isCompacting = false;
    }
  }

  return {
    /**
     * Compaction hook: replace compaction prompt for a resume-ready checkpoint
     * Setting output.prompt replaces the default prompt entirely.
     */
    "experimental.session.compacting": async (_input, output) => {
      output.prompt = `
You are generating a continuation checkpoint for an autonomous long-running coding session.
The agent must be able to continue without user input.

Return a concise, resume-ready checkpoint including:
- Goal
- Current phase (research/plan/implement/test/debug)
- Current state (done vs in-progress)
- Decisions & constraints
- Evidence (file paths, commands run, results)
- ✅ What worked
- ❌ What didn’t work
- 🧩 Remaining / not attempted
- ⏭️ Next steps (short checklist)

Be factual. If unknown, write "unknown".
`;
    },

    /**
     * Count tool calls (hook-style, not via event wrapper)
     */
    "tool.execute.after": async () => {
      toolCountSinceLastCompact += 1;
      if (toolCountSinceLastCompact >= THRESHOLD) {
        shouldCompact = true;
      }
    },

    /**
     * Use the generic event stream to:
     * - capture session id
     * - run compaction only when session becomes idle
     */
    event: async ({ event }) => {
      if (event.type === "session.created") {
        // payload shapes can vary slightly; keep it defensive
        sessionId =
          event?.session?.id ??
          event?.body?.session?.id ??
          event?.properties?.session?.id ??
          event?.properties?.id ??
          sessionId;

        if (sessionId) await log("info", `Attached to session ${sessionId}`);
        return;
      }

      if (event.type === "session.idle") {
        await maybeCompact();
      }
    },
  };
};
