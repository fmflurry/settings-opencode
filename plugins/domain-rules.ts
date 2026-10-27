// OpenCode side of the domain-rules hook. Off unless the project opts in.
import type { PluginInput } from "@opencode-ai/plugin";
import { decideDomainRules, executeDomainRules } from "./lib/domain-rules.ts";

const EDIT_TOOLS = new Set(["write", "edit", "patch", "multiedit"]);

export const DomainRulesPlugin = async ({ directory }: PluginInput) => {
  return {
    "tool.execute.before": async (
      input: { tool: string },
      output: { args: unknown },
    ) => {
      const tool = (input.tool ?? "").toLowerCase();
      if (!EDIT_TOOLS.has(tool)) return;
      const result = executeDomainRules(decideDomainRules(directory), {
        input: JSON.stringify({ tool, args: output.args ?? {} }),
      });
      if (result.code !== 0) {
        throw new Error(`[domain-rules] ${result.stderr.trim() || "project script failed"}`);
      }
    },
  };
};

export default DomainRulesPlugin;
