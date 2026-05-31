/**
 * Everything Claude Code (ECC) Plugin Hooks for OpenCode
 *
 * This plugin translates Claude Code hooks to OpenCode's plugin system.
 * OpenCode's plugin system is MORE sophisticated than Claude Code with 20+ events
 * compared to Claude Code's 3 phases (PreToolUse, PostToolUse, Stop).
 *
 * Hook Event Mapping:
 * - PreToolUse → tool.execute.before
 * - PostToolUse → tool.execute.after
 * - Stop → session.idle / session.status
 * - SessionStart → session.created
 * - SessionEnd → session.deleted
 */

import type { PluginInput } from "@opencode-ai/plugin";

export const ECCHooksPlugin = async ({
  client,
  $,
  directory,
  worktree,
}: PluginInput) => {
  // Track files edited in current session for console.log audit
  const editedFiles = new Set<string>();

  // Track conductor messages we've already force-retried so we never
  // loop on the same message twice. Per-process Set is fine — OpenCode
  // restarts get a fresh state.
  const retriedMessageIds = new Set<string>();

  // Banned narration openers for the Mistral conductor retry-guard.
  // Mirrors the conductor.txt hard rule + experimental.chat.system.transform
  // reminder. Case-insensitive match at start of message.
  const BANNED_OPENER =
    /^(?:now\b|first\b|next\b|then\b|so\b|need to\b|let me\b|i will\b|let's\b|good\b|ok\b|okay\b|understanding\b|based on\b)/i;

  // Helper to call the SDK's log API with correct signature
  const log = (level: "debug" | "info" | "warn" | "error", message: string) =>
    client.app.log({ body: { service: "ecc", level, message } });

  // Returns true if the provider/model is in the Mistral family.
  // Mirrors the scope of the experimental.chat.system.transform hook.
  const isMistralModel = (providerID: string, modelID: string): boolean => {
    if (providerID === "myMistral") return true;
    const m = modelID.toLowerCase();
    return (
      m.includes("mistral") ||
      m.includes("codestral") ||
      m.includes("magistral") ||
      m.includes("ministral")
    );
  };

  return {
    /**
     * Prettier Auto-Format Hook
     * Equivalent to Claude Code PostToolUse hook for prettier
     *
     * Triggers: After any JS/TS/JSX/TSX file is edited
     * Action: Runs prettier --write on the file
     */
    "file.edited": async (event: { path: string }) => {
      // Track edited files for console.log audit
      editedFiles.add(event.path);

      // Auto-format JS/TS files
      if (event.path.match(/\.(ts|tsx|js|jsx)$/)) {
        try {
          await $`prettier --write ${event.path} 2>/dev/null`;
          log("info", `[ECC] Formatted: ${event.path}`);
        } catch {
          // Prettier not installed or failed - silently continue
        }
      }

      // Console.log warning check
      if (event.path.match(/\.(ts|tsx|js|jsx)$/)) {
        try {
          const result =
            await $`grep -n "console\\.log" ${event.path} 2>/dev/null`.text();
          if (result.trim()) {
            const lines = result.trim().split("\n").length;
            log(
              "warn",
              `[ECC] console.log found in ${event.path} (${lines} occurrence${lines > 1 ? "s" : ""})`,
            );
          }
        } catch {
          // No console.log found (grep returns non-zero) - this is good
        }
      }
    },

    /**
     * Post-Tool Hook
     *
     * Triggers: After tool execution
     * Action: PR creation logging. Repo-wide tsc-on-edit removed:
     *   produced TUI flood + crashed on Buffer.split. Use editor LSP
     *   or run `tsc` manually / via verify skill.
     */
    "tool.execute.after": async (
      input: { tool: string; args?: { filePath?: string } },
      output: unknown,
    ) => {
      if (
        input.tool === "bash" &&
        input.args?.toString().includes("gh pr create")
      ) {
        log("info", "[ECC] PR created - check GitHub Actions status");
      }
    },

    /**
     * Pre-Tool Security Check
     * Equivalent to Claude Code PreToolUse hook
     *
     * Triggers: Before tool execution
     * Action: Warns about potential security issues
     */
    "tool.execute.before": async (input: {
      tool: string;
      args?: Record<string, unknown>;
    }) => {
      // === HARD STOP: block conductor self-delegation ===
      // Defense in depth on top of permission "conductor: deny" in opencode.jsonc.
      // Weak open-weight models sometimes hallucinate task(subagent="conductor")
      // because the conductor prompt references the name. That would loop forever.
      // Check both arg names since the OpenCode task tool field is not in the
      // public plugin SDK types.
      if (input.tool === "task") {
        const args = (input.args ?? {}) as {
          subagent_type?: string;
          agent?: string;
          subagent?: string;
        };
        const target = args.subagent_type ?? args.agent ?? args.subagent;
        if (target === "conductor") {
          const msg =
            "[ECC] BLOCKED: conductor cannot delegate to itself (infinite loop guard). Pick a specialist subagent.";
          log("error", msg);
          throw new Error(msg);
        }
      }

      // === HARD STOP: block bash writes to source/code files ===
      // Defense in depth on top of conductor's edit/write deny perm.
      // Catches attempts to bypass via shell redirects, heredocs, sed -i,
      // tee, or python -c open().write(). Applies globally — no subagent
      // should be writing code through bash either.
      if (input.tool === "bash") {
        const cmd = String(
          (input.args as { command?: string })?.command ?? input.args ?? "",
        );

        const CODE_EXT =
          "(?:ts|tsx|js|jsx|mjs|cjs|py|go|rs|kt|java|swift|php|rb|cs|cpp|cc|hpp|h|c|sql|sh|bash|zsh|fish)";

        const blockingPatterns: { re: RegExp; reason: string }[] = [
          {
            re: new RegExp(`>\\s*\\S+\\.${CODE_EXT}\\b`),
            reason: "shell redirect (>) to source file",
          },
          {
            re: new RegExp(`>>\\s*\\S+\\.${CODE_EXT}\\b`),
            reason: "shell append (>>) to source file",
          },
          {
            re: new RegExp(`\\btee\\s+(?:-a\\s+)?\\S+\\.${CODE_EXT}\\b`),
            reason: "tee writing to source file",
          },
          {
            re: new RegExp(`\\bsed\\s+-i\\b[^|;]*\\.${CODE_EXT}\\b`),
            reason: "sed -i editing source file",
          },
          {
            re: /<<\s*['"]?EOF['"]?[\s\S]*>\s*\S+\.(?:ts|tsx|js|py|go|rs)\b/,
            reason: "heredoc writing to source file",
          },
          {
            re: /python[0-9.]*\s+-c\s+["'][^"']*open\([^)]*\)\.write/,
            reason: "python -c open().write bypass",
          },
        ];

        for (const { re, reason } of blockingPatterns) {
          if (re.test(cmd)) {
            const msg = `[ECC] BLOCKED bash write to source code: ${reason}. Delegate to coder/writer/tdd-guide subagent instead. Command: ${cmd.slice(0, 200)}`;
            log("error", msg);
            throw new Error(msg);
          }
        }
      }

      // Git push review reminder
      if (
        input.tool === "bash" &&
        input.args?.toString().includes("git push")
      ) {
        log(
          "info",
          "[ECC] Remember to review changes before pushing: git diff origin/main...HEAD",
        );
      }

      // Block creation of unnecessary documentation files
      if (
        input.tool === "write" &&
        input.args?.filePath &&
        typeof input.args.filePath === "string"
      ) {
        const filePath = input.args.filePath;
        if (
          filePath.match(/\.(md|txt)$/i) &&
          !filePath.includes("README") &&
          !filePath.includes("CHANGELOG") &&
          !filePath.includes("LICENSE") &&
          !filePath.includes("CONTRIBUTING")
        ) {
          log(
            "warn",
            `[ECC] Creating ${filePath} - consider if this documentation is necessary`,
          );
        }
      }

      // Long-running command reminder
      if (input.tool === "bash") {
        const cmd = String(input.args?.command || input.args || "");
        if (
          cmd.match(/^(npm|pnpm|yarn|bun)\s+(install|build|test|run)/) ||
          cmd.match(/^cargo\s+(build|test|run)/) ||
          cmd.match(/^go\s+(build|test|run)/)
        ) {
          log(
            "info",
            "[ECC] Long-running command detected - consider using background execution",
          );
        }
      }
    },

    /**
     * Session Idle Hook
     * Equivalent to Claude Code Stop hook
     *
     * Triggers: When session becomes idle (task completed)
     * Action: Runs console.log audit on all edited files
     */
    "session.idle": async () => {
      if (editedFiles.size === 0) return;

      log("info", "[ECC] Session idle - running console.log audit");

      let totalConsoleLogCount = 0;
      const filesWithConsoleLogs: string[] = [];

      for (const file of editedFiles) {
        if (!file.match(/\.(ts|tsx|js|jsx)$/)) continue;

        try {
          const result =
            await $`grep -c "console\\.log" ${file} 2>/dev/null`.text();
          const count = parseInt(result.trim(), 10);
          if (count > 0) {
            totalConsoleLogCount += count;
            filesWithConsoleLogs.push(file);
          }
        } catch {
          // No console.log found
        }
      }

      if (totalConsoleLogCount > 0) {
        log(
          "warn",
          `[ECC] Audit: ${totalConsoleLogCount} console.log statement(s) in ${filesWithConsoleLogs.length} file(s)`,
        );
        filesWithConsoleLogs.forEach((f) => log("warn", `  - ${f}`));
        log("warn", "[ECC] Remove console.log statements before committing");
      } else {
        log("info", "[ECC] Audit passed: No console.log statements found");
      }

      // Clear tracked files for next task
      editedFiles.clear();
    },

    /**
     * Session Deleted Hook
     * Equivalent to Claude Code SessionEnd hook
     *
     * Triggers: When session ends
     * Action: Final cleanup and state saving
     */
    "session.deleted": async () => {
      log("info", "[ECC] Session ended - cleaning up");
      editedFiles.clear();
    },

    /**
     * File Watcher Hook
     * OpenCode-only feature
     *
     * Triggers: When file system changes are detected
     * Action: Updates tracking
     */
    "file.watcher.updated": async (event: { path: string; type: string }) => {
      if (event.type === "change" && event.path.match(/\.(ts|tsx|js|jsx)$/)) {
        editedFiles.add(event.path);
      }
    },

    /**
     * Permission Asked Hook
     * OpenCode-only feature
     *
     * Triggers: When permission is requested
     * Action: Logs for audit trail
     */
    "permission.asked": async (event: { tool: string; args: unknown }) => {
      log("info", `[ECC] Permission requested for: ${event.tool}`);
    },

    /**
     * Todo Updated Hook
     * OpenCode-only feature
     *
     * Triggers: When todo list is updated
     * Action: Logs progress
     */
    "todo.updated": async (event: {
      todos: Array<{ text: string; done: boolean }>;
    }) => {
      const completed = event.todos.filter((t) => t.done).length;
      const total = event.todos.length;
      if (total > 0) {
        log("info", `[ECC] Progress: ${completed}/${total} tasks completed`);
      }
    },

    /**
     * Mistral Steering — End-of-System-Prompt Reminder
     *
     * Triggers: Before every chat completion
     * Action: When the active model is Mistral, append a terse end-of-prompt
     *   reminder that re-states the most-violated rules. End-of-system-prompt
     *   sits in the highest-attention slot just before the user message,
     *   which is the only position open-weight reasoning models reliably
     *   honor after they consume their thinking budget.
     *
     * Why scoped to Mistral: Anthropic/GPT-5 reliably end turns with tool
     *   calls when the prompt asks. Mistral Medium 2604 emits plan prose
     *   and halts. This reminder is overhead for stronger models; we skip
     *   them to avoid prompt-bloat.
     */
    "experimental.chat.system.transform": async (
      input: { sessionID?: string; model: { providerID: string; modelID: string } },
      output: { system: string[] },
    ) => {
      const isMistral = isMistralModel(input.model.providerID, input.model.modelID);

      if (!isMistral) return;

      const reminder = [
        "## CRITICAL — END-OF-PROMPT REMINDER (Mistral)",
        "",
        "Your turn MUST end with a tool call. Text without a tool_call = the user sees nothing and is blocked.",
        "Forbidden opening words for assistant text between tools: Now, First, Next, Then, So, Need to, Let me, I will, Let's, Good, OK, Understanding, Based on. If you would write one of these, emit the next tool call instead.",
        "After ANY tool returns: next message is either another tool call or the final user answer. No recap. No plan-for-next-step. No prose summarizing what you read.",
        "Long task (>2 steps, >2 files, >2 todos) → first tool call is `task` → `planner`. Do not read files yourself.",
        "Hard cap: 2 direct file reads per user request. Third read = dispatch a specialist.",
        "Never re-confirm an actionable request. User said X → dispatch immediately.",
      ].join("\n");

      output.system.push(reminder);
    },

    /**
     * Mistral Conductor Retry-Guard
     *
     * Triggers: After a conductor assistant message completes
     * Action: If the message has zero tool_call parts AND its text starts
     *   with a banned narration opener AND the model is Mistral, force a
     *   retry by sending a synthetic user message demanding a tool call.
     *
     * Why: Prompt-only steering hit a model ceiling — Mistral Medium 2604
     *   emits plan prose ("Now understand structure. Need add...") instead
     *   of structured tool_calls under long-context load. Sometimes it also
     *   hallucinates XML tool syntax (`<read>{...}</read>`). Neither parses
     *   as a tool call → harness ends turn → user is blocked.
     *
     * Anti-loop: every retried messageID is recorded in retriedMessageIds;
     *   a second narration after retry will NOT trigger a second retry
     *   (escalate to user via session error instead).
     *
     * Scope: conductor agent only, Mistral provider only. Other agents and
     *   non-Mistral models are left alone.
     */
    "message.updated": async (event: {
      properties?: { info?: unknown };
    }) => {
      const info = (event?.properties?.info ?? {}) as {
        id?: string;
        sessionID?: string;
        role?: string;
        mode?: string;
        modelID?: string;
        providerID?: string;
        finish?: string;
      };

      if (info.role !== "assistant") return;
      if (!info.id || !info.sessionID) return;
      if (!info.finish) return; // not yet completed
      if (info.mode !== "conductor") return;
      if (!info.providerID || !info.modelID) return;
      if (!isMistralModel(info.providerID, info.modelID)) return;
      if (retriedMessageIds.has(info.id)) return;

      // Fetch full message with parts.
      let parts: Array<{ type?: string; text?: string; synthetic?: boolean }> = [];
      try {
        const res = await client.session.message({
          path: { id: info.sessionID, messageID: info.id },
        });
        const data = (res as { data?: { parts?: typeof parts } })?.data;
        parts = data?.parts ?? [];
      } catch (e) {
        log("warn", `[ECC retry-guard] failed to fetch message ${info.id.slice(0, 8)}: ${String(e)}`);
        return;
      }

      // If any tool part exists, message is fine.
      const hasToolCall = parts.some((p) => p.type === "tool");
      if (hasToolCall) return;

      // Concatenate visible text parts.
      const text = parts
        .filter((p) => p.type === "text" && !p.synthetic && typeof p.text === "string")
        .map((p) => p.text ?? "")
        .join("\n")
        .trim();

      if (text.length === 0) return; // empty/aborted — let it be

      // Only retry if text starts with a banned narration opener. A valid
      // final synthesis to the user typically opens with answer content
      // (a noun, a result, code), not "Now"/"First"/"Let me"/etc.
      if (!BANNED_OPENER.test(text)) return;

      retriedMessageIds.add(info.id);
      log(
        "warn",
        `[ECC retry-guard] Mistral conductor narration-only message ${info.id.slice(0, 8)} — forcing retry. First 80 chars: ${text.slice(0, 80)}`,
      );

      // Inject a synthetic user message that re-demands a tool call.
      // Uses promptAsync so we don't block the event handler.
      try {
        await client.session.promptAsync({
          path: { id: info.sessionID },
          body: {
            parts: [
              {
                type: "text",
                text: [
                  "[SYSTEM RETRY — automatic]",
                  "Your previous assistant message contained TEXT but NO tool_call. That ends the turn and blocks the user. You said: \"" +
                    text.slice(0, 120).replace(/"/g, "'") +
                    "...\"",
                  "Re-do that reasoning AS A TOOL CALL. Invoke `task` with the appropriate specialist (coder/planner/writer/tdd-guide/etc.) and put the brief in the prompt field.",
                  "Do NOT narrate again. Emit a tool call now.",
                ].join("\n\n"),
              },
            ],
          },
        } as Parameters<typeof client.session.promptAsync>[0]);
      } catch (e) {
        log("error", `[ECC retry-guard] retry injection failed for ${info.id.slice(0, 8)}: ${String(e)}`);
      }
    },
  };
};

export default ECCHooksPlugin;
