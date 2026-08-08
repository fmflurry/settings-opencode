/**
 * Tool Budget Plugin — OpenCode parity port of
 * `.claude/hooks/tool-budget.sh` (Claude Code PreToolUse hook).
 *
 * Classifies each `bash` command per rules/common/tool-budget.md
 * (VERIFICATION vs EXPLORATORY — authoritative there) and counts
 * `write`/`edit`/`patch` calls as edits. Steers via the system prompt
 * (`experimental.chat.system.transform`), mirroring the pending-nudge drain
 * pattern already used by code-memory.ts. NEVER throws / blocks a tool call
 * — L3 deny is deliberately NOT implemented, this plugin only nudges.
 *
 *   L1 — 3rd exploratory bash call with 0 edits so far.
 *   L2 — exploratory:edit ratio > 3 once >=5 edits have happened.
 *
 * Allowlist-first: unknown bash commands default to NOT counted (under-
 * enforce rather than block real work).
 */
import type { PluginInput } from "@opencode-ai/plugin";

import { formatNumber } from "./llm-metrics-lib/format.ts";

type Category = "exploratory" | "edit" | null;

interface BudgetState {
  exploratory: number;
  edits: number;
  pendingNudge: string | null;
}

// --- VERIFICATION (uncapped, never counted, never nudged) ---
const VERIFICATION_RE =
  /(^|[|&;\s])(tsc|npm\s+run|pnpm\s+run|bun\s+run|yarn\s+run|cargo|go\s+build|mypy|pyright|mvn|gradlew|dotnet\s+(build|test|format)|eslint|ruff|clippy)(\s|$)/;
const GIT_STATE_RE = /(^|[|&;\s])git\s+(status|diff|log|stash|show)(\s|$)/;
const PROCESS_RE = /(^|[|&;\s])(lsof|netstat|ps)(\s|$)/;

// --- EXPLORATORY (counted): directory listing / content search / file inspection ---
const EXPLORATORY_RE =
  /(^|[|&;\s])(ls|find|tree|grep|rg|ag|cat|head|tail|wc|file|stat)(\s|$)/;
const RTK_EXPLORATORY_RE = /rtk\s+(ls|find|grep)(\s|$)/;

const EDIT_TOOLS: ReadonlySet<string> = new Set(["write", "edit", "patch"]);

function isVerification(cmd: string): boolean {
  return VERIFICATION_RE.test(cmd) || GIT_STATE_RE.test(cmd) || PROCESS_RE.test(cmd);
}

function isExploratory(cmd: string): boolean {
  return RTK_EXPLORATORY_RE.test(cmd) || EXPLORATORY_RE.test(cmd);
}

/** Allowlist-first: unknown/unrecognized commands stay uncounted (null). */
function classifyBash(command: string): Category {
  if (!command) return null;
  if (isVerification(command)) return null;
  if (isExploratory(command)) return "exploratory";
  return null;
}

function stringArg(args: unknown, key: string): string {
  if (!args || typeof args !== "object") return "";
  const value = (args as Record<string, unknown>)[key];
  return typeof value === "string" ? value : "";
}

function stateFor(states: Map<string, BudgetState>, sessionID: string): BudgetState {
  let state = states.get(sessionID);
  if (!state) {
    state = { exploratory: 0, edits: 0, pendingNudge: null };
    states.set(sessionID, state);
  }
  return state;
}

export const ToolBudgetPlugin = async (_input: PluginInput) => {
  const states = new Map<string, BudgetState>();

  return {
    "tool.execute.before": async (
      input: { tool: string; sessionID: string; callID: string },
      output: { args: unknown },
    ) => {
      const tool = (input.tool ?? "").toLowerCase();
      const state = stateFor(states, input.sessionID);

      let category: Category = null;
      if (tool === "bash") {
        category = classifyBash(stringArg(output.args, "command"));
      } else if (EDIT_TOOLS.has(tool)) {
        category = "edit";
      }

      if (category === "exploratory") state.exploratory += 1;
      if (category === "edit") state.edits += 1;

      if (category === "exploratory" && state.exploratory === 3 && state.edits === 0) {
        state.pendingNudge =
          "Exploratory budget hit (3, 0 edits). Next call must be code-memory, Glob, or an Edit. " +
          "If the repo is not indexed, say so explicitly and continue.";
        return;
      }

      if (state.edits >= 5 && state.exploratory > state.edits * 3) {
        state.pendingNudge =
          `Exploratory:edit ratio exceeds 3 at ${formatNumber(state.edits)} edits ` +
          `(${formatNumber(state.exploratory)} exploratory calls). Your next assistant message ` +
          "must contain one line: bash-budget: <why exploratory shell is still necessary>";
      }
    },

    "experimental.chat.system.transform": async (
      input: { sessionID?: string },
      output: { system: string[] },
    ) => {
      if (!input.sessionID) return;
      const state = states.get(input.sessionID);
      if (!state?.pendingNudge) return;
      output.system.push(state.pendingNudge);
      state.pendingNudge = null;
    },
  };
};

export default ToolBudgetPlugin;
