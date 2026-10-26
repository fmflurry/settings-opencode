import type { PluginInput } from "@opencode-ai/plugin";
import { emitKpi } from "./lib/kpi-emit.ts";

const ID = /^[A-Za-z0-9._:-]{1,200}$/;
const TOOL = /^[A-Za-z0-9._:-]{1,64}$/;

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function sessionId(props: Record<string, unknown>): string {
  const direct = props.sessionID;
  if (typeof direct === "string" && ID.test(direct)) return direct;
  const info = asRecord(props.info);
  const nested = info?.id;
  if (typeof nested === "string" && ID.test(nested)) return nested;
  return "";
}

function parentId(props: Record<string, unknown>): string {
  const info = asRecord(props.info);
  const parent = info?.parentID ?? props.parentID;
  return typeof parent === "string" ? parent : "";
}

/**
 * OpenCode side of the harness KPI log. Independent of llm-metrics.
 * Records session boundaries, tool names, and subagent spawns. Tokens stay
 * null unless a later hook is given a numeric usage field by the host.
 */
export const KpiPlugin = async ({ directory }: PluginInput) => {
  return {
    "tool.execute.before": async (input: { tool?: string; sessionID?: string }) => {
      const tool = input.tool ?? "";
      if (!TOOL.test(tool)) return;
      const args = ["tool_call", `tool_name=${tool}`];
      if (input.sessionID && ID.test(input.sessionID)) args.push(`session=${input.sessionID}`);
      emitKpi(directory, args);
    },

    event: async (eventOrPayload: { event?: unknown } | unknown) => {
      const raw = (eventOrPayload as { event?: unknown }).event ?? eventOrPayload;
      const event = asRecord(raw);
      if (!event || typeof event.type !== "string") return;
      const props = asRecord(event.properties) ?? {};
      const sid = sessionId(props);
      const sessionArg = sid ? [`session=${sid}`] : [];
      if (event.type === "session.created") {
        if (parentId(props)) emitKpi(directory, ["subagent_spawn", ...sessionArg]);
        else emitKpi(directory, ["session_start", ...sessionArg]);
        return;
      }
      if (event.type === "session.idle" || event.type === "session.deleted") {
        emitKpi(directory, ["session_end", ...sessionArg]);
      }
    },
  };
};

export default KpiPlugin;
