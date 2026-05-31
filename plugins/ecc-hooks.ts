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

  // Per-session retry budget. Prevents runaway loops if the model keeps
  // emitting narration after every retry. Default cap = 5; overridable via
  // ECC_RETRY_BUDGET env var. globalThis cast avoids @types/node dep.
  const retryCountBySession = new Map<string, number>();
  const envProc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  const RETRY_BUDGET = Number(envProc?.env?.ECC_RETRY_BUDGET ?? 5);

  // Mid-task narration openers. Final synthesis to the user typically
  // starts with answer content (a noun, a code block, a fact), NOT with
  // intent verbs. These openers reliably indicate a stalled mid-task plan.
  const BANNED_OPENER =
    /^(?:now\b|first\b|next\b|then\b|so\b|need to\b|let me\b|i will\b|i'll\b|i need to\b|i should\b|we should\b|we need to\b|let's\b|good\b|ok\b|okay\b|understanding\b|based on\b|to (?:do|accomplish|implement|fix|add|build|start) this\b|here's (?:my|the) plan\b|here is (?:my|the) plan\b|the plan is\b|step \d+\b)/i;

  // "Done"-claim regex. When conductor declares completion, we verify
  // that a build/typecheck was actually run.
  const DONE_CLAIM = /\b(done|completed?|ready|finished|all set|good to go|ready to (?:merge|ship|deploy)|✅)\b/i;

  // Verification commands that satisfy the "build was run" gate.
  const VERIFY_CMD =
    /\b(tsc|cargo check|cargo build|go build|go vet|mvn .*(?:compile|verify)|gradle .*(?:compile|build|check)|gradlew .*(?:compile|build|check)|dotnet build|mypy|pyright|pytest|jest|vitest|cargo test|go test)\b/;

  // XML-style tool-call hallucination. Mistral (and other open-weight
  // models) sometimes emit tool invocations wrapped in XML tags as
  // plain text — e.g. `<read>{"filePath":"..."}</read>`, `<task>...`.
  // These never fire; the harness sees them as text. Detect and retry.
  const TOOL_XML_HALLUCINATION =
    /<(?:read|write|edit|bash|task|grep|glob|webfetch|websearch|todowrite|todoread|codememory_[a-z_]+|mcp__[a-z0-9_-]+)\s*>\s*[\{\["]/i;

  // Subagents whose work TOUCHES SOURCE CODE → require post-dispatch verify.
  const CODE_TOUCHING_SUBAGENTS = new Set([
    "coder",
    "tdd-guide",
    "build-error-resolver",
    "refactor-cleaner",
    "writer", // writer can touch code paths per conductor.txt verify protocol
  ]);

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

  // Inject a synthetic user message that re-prompts the conductor.
  // Shared by Pattern A (narration-only) and Pattern C (premature done).
  const injectRetry = async (sessionID: string, body: string): Promise<void> => {
    try {
      await client.session.promptAsync({
        path: { id: sessionID },
        body: {
          parts: [{ type: "text", text: body }],
        },
      } as Parameters<typeof client.session.promptAsync>[0]);
    } catch (e) {
      log("error", `[ECC retry-guard] injection failed: ${String(e)}`);
    }
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
     * Conductor Retry-Guard (Patterns A, C, D, E)
     *
     * Triggers: After any conductor assistant message completes
     * Detects four failure modes and force-retries by sending a synthetic
     * [SYSTEM RETRY] user message. Check order is most-specific first:
     *
     *   Pattern E — XML tool-call hallucination:
     *     Text contains `<read>{...}</read>` / `<task>{...}</task>` /
     *     similar XML-wrapped tool syntax. These never fire (harness sees
     *     plain text). Model thought it was calling a tool but used the
     *     wrong wire format. Fires regardless of opener.
     *
     *   Pattern D — Open TODOs + no tool_call:
     *     Session has pending/in_progress TODOs but conductor emitted
     *     text-only message. Work is not done; conductor stalled.
     *     Strong signal — fires regardless of opener wording.
     *
     *   Pattern A — Narration-only stall:
     *     Message has zero tool_call parts AND text starts with a banned
     *     mid-task narration opener ("Now", "First", "Let me", "I'll start",
     *     "Here's my plan", etc.). Fallback after D — used when no TODO
     *     list exists to consult. Applies to ALL providers.
     *
     *   Pattern C — Premature "done" without verification:
     *     Message claims completion ("done", "ready", "✅", etc.) AND a
     *     code-touching subagent (coder/tdd-guide/build-error-resolver/
     *     refactor-cleaner/writer) ran in this session AND no verify
     *     command (tsc/cargo check/go build/mvn compile/etc.) ran AFTER
     *     that subagent. The conductor lied about verification, violating
     *     the verification gate in conductor.txt / instructions/.
     *
     * Anti-loop:
     *   - Per-message: retriedMessageIds Set, never retry same message twice
     *   - Per-session: RETRY_BUDGET (default 5, ECC_RETRY_BUDGET env override)
     *     If a session exhausts its retry budget, the hook stops intervening
     *     and the user must take over.
     *
     * Scope: conductor agent only. Subagents (coder/writer/etc.) have
     *   different success criteria and are out of scope for this hook.
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
      if (retriedMessageIds.has(info.id)) return;

      // Session-level budget check.
      const usedBudget = retryCountBySession.get(info.sessionID) ?? 0;
      if (usedBudget >= RETRY_BUDGET) {
        log(
          "warn",
          `[ECC retry-guard] session ${info.sessionID.slice(0, 8)} exhausted retry budget (${RETRY_BUDGET}). Standing down.`,
        );
        return;
      }

      // Fetch this message's parts.
      let parts: Array<{
        type?: string;
        text?: string;
        synthetic?: boolean;
        tool?: string;
        state?: { input?: { command?: string; subagent_type?: string; agent?: string; subagent?: string } };
      }> = [];
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

      const hasToolCall = parts.some((p) => p.type === "tool");
      const text = parts
        .filter((p) => p.type === "text" && !p.synthetic && typeof p.text === "string")
        .map((p) => p.text ?? "")
        .join("\n")
        .trim();

      // ────────────────────────────────────────────────────────────────
      // Pattern E — XML tool-call hallucination
      // Most specific signal: model tried to call a tool via XML syntax
      // in text instead of emitting a structured tool_call. Fires
      // regardless of opener.
      // ────────────────────────────────────────────────────────────────
      if (!hasToolCall && text.length > 0 && TOOL_XML_HALLUCINATION.test(text)) {
        retriedMessageIds.add(info.id);
        retryCountBySession.set(info.sessionID, usedBudget + 1);
        const match = text.match(TOOL_XML_HALLUCINATION);
        log(
          "warn",
          `[ECC retry-guard E] XML tool-call hallucination in conductor msg ${info.id.slice(0, 8)}. Matched: ${match?.[0] ?? "(?)"}. Budget ${usedBudget + 1}/${RETRY_BUDGET}.`,
        );

        await injectRetry(
          info.sessionID,
          [
            "[SYSTEM RETRY — automatic, Pattern E: XML tool-call hallucination]",
            'Your previous message contained tool-call XML syntax in TEXT, e.g. `<read>{...}</read>` or `<task>{...}</task>`. That format does NOT fire — the harness sees plain text and ends the turn.',
            "Tools must be invoked as STRUCTURED tool_calls (the API field), not as text. You cannot type the tool invocation; you must emit it through the tool-calling channel.",
            "Retry the same intent as a real `task` tool call (subagent_type + description + prompt fields). Do not write any XML tags.",
          ].join("\n\n"),
        );
        return;
      }

      // ────────────────────────────────────────────────────────────────
      // Pattern D — Open TODOs + no tool_call
      // Strong signal: work isn't done, conductor stalled with text.
      // ────────────────────────────────────────────────────────────────
      if (!hasToolCall && text.length > 0) {
        let openTodos = 0;
        try {
          const todoRes = await client.session.todo({
            path: { id: info.sessionID },
          });
          const todoList = ((todoRes as { data?: Array<{ status?: string; content?: string }> })?.data ?? []);
          openTodos = todoList.filter(
            (t) => t.status === "pending" || t.status === "in_progress",
          ).length;
        } catch (e) {
          log("debug", `[ECC retry-guard D] todo fetch failed (skipping): ${String(e)}`);
        }

        if (openTodos > 0) {
          retriedMessageIds.add(info.id);
          retryCountBySession.set(info.sessionID, usedBudget + 1);
          log(
            "warn",
            `[ECC retry-guard D] conductor msg ${info.id.slice(0, 8)} stalled with ${openTodos} open TODO(s) and no tool_call. Budget ${usedBudget + 1}/${RETRY_BUDGET}. First 80: ${text.slice(0, 80)}`,
          );

          await injectRetry(
            info.sessionID,
            [
              "[SYSTEM RETRY — automatic, Pattern D: open TODOs]",
              `Your TODO list still has ${openTodos} open item(s) (pending or in_progress), but your previous message contained TEXT and NO tool_call. Work is not done — you stopped mid-task.`,
              "Continue execution by dispatching the next `task` to the appropriate specialist for the next open TODO. Do NOT emit a final answer until all TODOs are marked completed.",
              "If a TODO is actually obsolete or already done, update it via the todowrite tool — do not just narrate that it's done.",
            ].join("\n\n"),
          );
          return;
        }
      }

      // ────────────────────────────────────────────────────────────────
      // Pattern A — Narration-only stall (fallback)
      // ────────────────────────────────────────────────────────────────
      if (!hasToolCall && text.length > 0 && BANNED_OPENER.test(text)) {
        retriedMessageIds.add(info.id);
        retryCountBySession.set(info.sessionID, usedBudget + 1);
        log(
          "warn",
          `[ECC retry-guard A] narration-only conductor message ${info.id.slice(0, 8)} (${info.providerID}/${info.modelID}). Budget ${usedBudget + 1}/${RETRY_BUDGET}. First 80: ${text.slice(0, 80)}`,
        );

        await injectRetry(
          info.sessionID,
          [
            "[SYSTEM RETRY — automatic, Pattern A: narration-only]",
            'Your previous assistant message contained TEXT but NO tool_call. That ends the turn and blocks the user. You said: "' +
              text.slice(0, 160).replace(/"/g, "'") +
              '..."',
            "Re-do that reasoning AS A TOOL CALL. Invoke `task` with the appropriate specialist (coder / planner / writer / tdd-guide / git-specialist / code-reviewer / etc.) and put the brief in the prompt field. Long task (>2 steps or >2 files) → first call MUST be `task` → `planner`.",
            "Do NOT narrate again. Emit a tool call now.",
          ].join("\n\n"),
        );
        return;
      }

      // ────────────────────────────────────────────────────────────────
      // Pattern C — Premature "done" without verification
      // ────────────────────────────────────────────────────────────────
      if (text.length === 0 || !DONE_CLAIM.test(text)) return;

      // Look back over the WHOLE session to determine whether a
      // code-touching task ran and whether verify ran after it.
      let sessionMessages: Array<{
        info?: { id?: string; role?: string; time?: { created?: number } };
        parts?: typeof parts;
      }> = [];
      try {
        const res = await client.session.messages({
          path: { id: info.sessionID },
        });
        const data = (res as { data?: typeof sessionMessages })?.data;
        sessionMessages = data ?? [];
      } catch (e) {
        log("warn", `[ECC retry-guard C] failed to fetch session messages: ${String(e)}`);
        return;
      }

      let lastCodeTaskAt = -1;
      let lastVerifyAt = -1;

      sessionMessages.forEach((msg, idx) => {
        for (const part of msg.parts ?? []) {
          if (part.type !== "tool") continue;
          const toolName = part.tool ?? "";
          const inputArgs = part.state?.input ?? {};
          if (toolName === "task") {
            const target =
              inputArgs.subagent_type ?? inputArgs.agent ?? inputArgs.subagent ?? "";
            if (CODE_TOUCHING_SUBAGENTS.has(target)) {
              lastCodeTaskAt = idx;
            }
          } else if (toolName === "bash") {
            const cmd = String(inputArgs.command ?? "");
            if (VERIFY_CMD.test(cmd)) {
              lastVerifyAt = idx;
            }
          }
        }
      });

      // No code task in session → "done" claim is fine (e.g. user asked a question).
      if (lastCodeTaskAt < 0) return;
      // Verify ran AFTER (or at) the last code task → satisfied.
      if (lastVerifyAt >= lastCodeTaskAt) return;

      retriedMessageIds.add(info.id);
      retryCountBySession.set(info.sessionID, usedBudget + 1);
      log(
        "warn",
        `[ECC retry-guard C] premature 'done' from conductor ${info.id.slice(0, 8)}. Code task at msg ${lastCodeTaskAt}, last verify at msg ${lastVerifyAt}. Budget ${usedBudget + 1}/${RETRY_BUDGET}.`,
      );

      await injectRetry(
        info.sessionID,
        [
          "[SYSTEM RETRY — automatic, Pattern C: verification gate]",
          "Your previous message declared completion (\"done\" / \"ready\" / \"✅\"), but a code-touching subagent ran in this session and no build verification was executed after it.",
          "Per the verification gate (instructions/verification-gate.md + conductor.txt hard rule): you MUST run an independent typecheck/build via `bash` before claiming done. Examples:",
          "  - TS/Angular: `npx tsc --noEmit --pretty false 2>&1 | tail -50`",
          "  - Rust:       `cargo check --message-format=short 2>&1 | tail -50`",
          "  - Go:         `go build ./... 2>&1 | tail -50`",
          "  - Java/Maven: `mvn -q -DskipTests compile`",
          "  - .NET:       `dotnet build --nologo -clp:ErrorsOnly`",
          "Detect the project type from manifests, run the correct command, paste the last ~15 lines of output. If errors → dispatch `task` → `build-error-resolver` and loop. Only after verify is green may you declare done.",
        ].join("\n"),
      );
    },
  };
};

export default ECCHooksPlugin;
