/**
 * code-memory OpenCode plugin.
 *
 * Retrieval remains an explicit agent action. This plugin only reminds agents
 * to use that explicit action before broad filesystem exploration.
 */

import type { Plugin } from "@opencode-ai/plugin";

const GATED_READ_TOOLS: ReadonlySet<string> = new Set(["read", "bash", "grep", "glob"]);
const MEMORY_TOOL_PREFIXES: readonly string[] = ["codememory_", "code-memory_", "code_memory_", "mcp__code-memory__"];

interface ToolInput {
  readonly tool?: string;
  readonly sessionID?: string;
}

interface ToolDefinitionOutput {
  description: string;
  parameters: unknown;
}

function isMemoryTool(tool: string): boolean {
  const lower = tool.toLowerCase();
  return MEMORY_TOOL_PREFIXES.some((prefix) => lower.includes(prefix));
}

const CodeMemoryPlugin: Plugin = async ({ client }) => {
  const explicitBySession = new Set<string>();
  return {
    "tool.execute.after": async (input: ToolInput): Promise<void> => {
      if (input.sessionID && isMemoryTool(input.tool ?? "")) explicitBySession.add(input.sessionID);
    },
    "tool.execute.before": async (input: ToolInput): Promise<void> => {
      const tool = (input.tool ?? "").toLowerCase();
      if (!GATED_READ_TOOLS.has(tool) || !input.sessionID || explicitBySession.has(input.sessionID)) return;
      await client.app.log({
        body: {
          service: "code-memory",
          level: "warn",
          message: `gate: ${tool} called without explicit code-memory retrieval`,
        },
      }).catch(() => undefined);
    },
    "tool.definition": async (
      input: { readonly toolID: string },
      output: ToolDefinitionOutput,
    ): Promise<void> => {
      if (!GATED_READ_TOOLS.has(input.toolID.toLowerCase())) return;
      const prefix = "For repo/code/docs orientation, call code-memory MCP first: use codememory_retrieve before grep/glob/read/bash, then verify exhaustively. ";
      if (!output.description.startsWith(prefix)) output.description = `${prefix}${output.description}`;
    },
  };
};

export default CodeMemoryPlugin;
