import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { PluginInput } from "@opencode-ai/plugin";
import { GATE_TIMEOUT_MS, bashGuardRejection, blockReason, runHook, runHookText, visualReportRejection } from "./lib/autonomy-hooks.ts";
import { emitKpi } from "./lib/kpi-emit.ts";

const AUTONOMY_FLAG = ".claude/state/autonomy.on";
const NOTIFY_SCRIPT = path.join(os.homedir(), ".config/opencode/scripts/agent-harness/notify.sh");
const ASK_DENIED =
  "Autonomous mode: decide yourself, log the assumption to .claude/state/decisions.tsv, continue.";

export const AutonomyPlugin = async ({ $, client, directory }: PluginInput) => {
  const autonomyOn = (): boolean => fs.existsSync(path.join(directory, AUTONOMY_FLAG));
  const opts = { directory };

  const isSubagentSession = async (sessionID: string): Promise<boolean> => {
    try {
      const session = await client.session.get({ path: { id: sessionID } });
      return Boolean(session.data?.parentID);
    } catch {
      return true;
    }
  };

  const aborted = new Set<string>();
  const inFlight = new Set<string>();

  const runGate = async (sessionID: string): Promise<boolean> => {
    if (inFlight.has(sessionID)) return true;
    inFlight.add(sessionID);
    try {
      const reason = blockReason(await runHook("ship-stop-gate.sh", { session_id: sessionID }, { ...opts, timeoutMs: GATE_TIMEOUT_MS }));
      if (!reason) return false;
      await client.session.promptAsync({
        path: { id: sessionID },
        body: { parts: [{ type: "text", text: reason }] },
      });
      return true;
    } catch {
      return false;
    } finally {
      inFlight.delete(sessionID);
    }
  };

  return {
    "experimental.chat.system.transform": async (_input: unknown, output: { system: string[] }) => {
      if (!autonomyOn()) return;
      const context = await runHookText("autonomy-context.sh", {}, opts);
      if (context) output.system.push(context);
    },

    // ship-init binds the goal to this id, and the stop gate later receives the same id from the idle event.
    "shell.env": async (input: { sessionID?: string }, output: { env: Record<string, string> }) => {
      if (input.sessionID) output.env.AGENT_HARNESS_SESSION = input.sessionID;
    },

    "tool.execute.before": async (input: { tool: string }, output: { args: unknown }) => {
      const tool = input.tool?.toLowerCase();
      if (tool === "question" && autonomyOn()) {
        emitKpi(directory, ["guard_block", "guard=ask"]);
        throw new Error(ASK_DENIED);
      }
      if (tool !== "bash") return;
      const args = output.args as { command?: unknown } | null;
      if (typeof args?.command !== "string") return;
      const reason = await bashGuardRejection(
        { tool_input: { command: args.command }, cwd: directory },
        opts,
      );
      if (reason) throw new Error(reason);
      const visual = await visualReportRejection(
        { tool_input: { command: args.command }, cwd: directory },
        opts,
      );
      if (visual) throw new Error(visual);
    },

    "chat.message": async (input: { sessionID?: string }) => {
      if (input.sessionID) aborted.delete(input.sessionID);
    },

    event: async (eventOrPayload: { event?: unknown } | unknown) => {
      const event = ((eventOrPayload as { event?: unknown }).event ?? eventOrPayload) as {
        type?: string;
        properties?: { sessionID?: string; error?: { name?: string }; status?: { type?: string } };
      };
      const sessionID = event?.properties?.sessionID;

      if (event?.type === "session.error") {
        if (sessionID && event.properties?.error?.name === "MessageAbortedError") aborted.add(sessionID);
        return;
      }
      if (event?.type === "session.status") {
        if (sessionID && event.properties?.status?.type === "busy") aborted.delete(sessionID);
        return;
      }
      if (event?.type !== "session.idle") return;

      if (sessionID && !aborted.has(sessionID) && autonomyOn() && !(await isSubagentSession(sessionID))) {
        if (await runGate(sessionID)) return;
      }

      await $`bash ${NOTIFY_SCRIPT} waiting "OpenCode session idle"`
        .cwd(directory)
        .quiet()
        .nothrow();
    },
  };
};

export default AutonomyPlugin;
