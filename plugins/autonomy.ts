import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { PluginInput } from "@opencode-ai/plugin";

const AUTONOMY_FLAG = ".claude/state/autonomy.on";
const NOTIFY_SCRIPT = path.join(os.homedir(), ".config/opencode/scripts/agent-harness/notify.sh");
const ASK_DENIED =
  "Autonomous mode: decide yourself, log the assumption to .claude/state/decisions.tsv, continue.";

export const AutonomyPlugin = async ({ $, directory }: PluginInput) => {
  const autonomyOn = (): boolean => fs.existsSync(path.join(directory, AUTONOMY_FLAG));

  return {
    "tool.execute.before": async (input: { tool: string }) => {
      if (input.tool?.toLowerCase() === "question" && autonomyOn()) {
        throw new Error(ASK_DENIED);
      }
    },

    event: async (eventOrPayload: { event?: unknown } | unknown) => {
      const event = (eventOrPayload as { event?: unknown }).event ?? eventOrPayload;
      if ((event as { type?: string })?.type !== "session.idle") return;
      await $`bash ${NOTIFY_SCRIPT} waiting "OpenCode session idle"`
        .cwd(directory)
        .quiet()
        .nothrow();
    },
  };
};

export default AutonomyPlugin;
