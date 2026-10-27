import type { PluginInput } from "@opencode-ai/plugin";
import { emitKpi } from "./lib/kpi-emit.ts";
import {
  createKpiState,
  onOpenCodeEvent,
  onToolAfter,
  onToolBefore,
} from "./lib/kpi-capture.ts";

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * OpenCode side of the harness KPI log. Independent of llm-metrics.
 * Records session boundaries, skill names, subagent types, and tool results.
 * message.updated usage is summed onto the later session_end or subagent_stop.
 * Cursor is not this plugin; its hook leaves tokens null.
 */
export const KpiPlugin = async ({ directory }: PluginInput) => {
  const state = createKpiState();
  const emit = (batches: string[][]): void => {
    for (const args of batches) {
      if (args.length > 0) emitKpi(directory, args);
    }
  };
  return {
    "tool.execute.before": async (
      input: { tool?: string; sessionID?: string; callID?: string },
      output?: { args?: unknown },
    ) => {
      try {
        emit(onToolBefore(state, input, output?.args));
      } catch {
        /* fail open */
      }
    },

    "tool.execute.after": async (
      input: { tool?: string; sessionID?: string; callID?: string; args?: unknown },
      output?: unknown,
    ) => {
      try {
        const args = onToolAfter(state, input, output);
        if (args.length > 0) emitKpi(directory, args);
      } catch {
        /* fail open */
      }
    },

    event: async (eventOrPayload: { event?: unknown } | unknown) => {
      try {
        const raw = (eventOrPayload as { event?: unknown }).event ?? eventOrPayload;
        const event = asRecord(raw);
        if (!event) return;
        emit(onOpenCodeEvent(state, event));
      } catch {
        /* fail open */
      }
    },
  };
};

export default KpiPlugin;
