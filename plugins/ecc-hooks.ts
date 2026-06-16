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
  const SYSTEM_RETRY_ENABLED: boolean = false;

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

  // OpenSpec artifact-generation detector. OpenSpec workflows (/opsx-* commands)
  // produce ONLY markdown files under openspec/changes/<name>/ — no buildable
  // source. Pattern C must not demand a tsc/cargo/etc. run after these jobs.
  // Match the banner the conductor emits when artifacts are ready, plus the
  // canonical path prefix and the "READY FOR /opsx" handoff line.
  const OPENSPEC_DONE =
    /openspec\/changes\/|OPENSPEC ARTIFACTS|OPENPEC ARTIFACTS|READY FOR:?\s+\/opsx|\/opsx-apply-change/i;

  // XML-style tool-call hallucination. Mistral (and other open-weight
  // models) sometimes emit tool invocations wrapped in XML tags as
  // plain text — e.g. `<read>{"filePath":"..."}</read>`, `<task>...`.
  // These never fire; the harness sees them as text. Detect and retry.
  const TOOL_XML_HALLUCINATION =
    /<(?:read|write|edit|bash|task|grep|glob|webfetch|websearch|todowrite|todoread|codememory_[a-z_]+|mcp__[a-z0-9_-]+)\s*>\s*[\{\["]/i;

  // Brace/JSON-style tool-call hallucination. The more common Mistral
  // failure: it emits the call as `toolname{json}` plain text with NO
  // angle brackets — e.g. `grep{"pattern":"..."}`, `read{"filePath":"..."}`,
  // even chained `grep{...}grep{...}read{...}`. Confirmed live in the ecc
  // log: `finish=stop hasTool=false textLen=629 first40=grep{"pattern":...`.
  // The harness sees text, the turn dies, and the XML regex above misses it.
  // Anchored to line-start (the hallucination always opens the message) so
  // prose that merely mentions a tool name mid-sentence won't trip it.
  const TOOL_JSON_HALLUCINATION =
    /(?:^|\n)\s*(?:read|write|edit|bash|task|grep|glob|list|patch|webfetch|websearch|todowrite|todoread|code-?memory_[a-z_]+|mcp__[a-z0-9_-]+)\s*\{\s*["']?[a-z_]/i;

  // Subagents whose work TOUCHES SOURCE CODE → require post-dispatch verify.
  const CODE_TOUCHING_SUBAGENTS = new Set([
    "coder",
    "tdd-guide",
    "build-error-resolver",
    "refactor-cleaner",
    "writer", // writer can touch code paths per conductor.txt verify protocol
  ]);

  // All subagent mode names (mirrors the conductor.txt routing table). Used to
  // extend ONLY the tool-call-hallucination guard (Pattern E) to subagents.
  // Subagents must NOT get Patterns A/B/C/D: a subagent's normal completion IS
  // a text-only message with finish=stop (that's how it returns its result to
  // the conductor), so those patterns would retry every legitimate result.
  const KNOWN_SUBAGENTS = new Set([
    "planner",
    "architect",
    "coder",
    "writer",
    "code-reviewer",
    "security-reviewer",
    "tdd-guide",
    "build-error-resolver",
    "e2e-runner",
    "doc-updater",
    "refactor-cleaner",
    "database-reviewer",
    "git-specialist",
    "angular-cop",
    "dotnet-cop",
  ]);

  // Helper to call the SDK's log API with correct signature
  const log = (level: "debug" | "info" | "warn" | "error", message: string) =>
    client.app.log({ body: { service: "ecc", level, message } });

  // Returns true if the provider/model is in the Mistral family.
  // Mirrors the scope of the experimental.chat.system.transform hook.
  const isMistralModel = (providerID?: string, modelID?: string): boolean => {
    if (providerID === "myMistral") return true;
    const m = (modelID ?? "").toLowerCase();
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
      // === HARD STOP: malformed tool-call name (Mistral serialization bug) ===
      // Mistral sometimes emits the tool NAME as the arguments JSON blob, e.g.
      // name = `{"description":...,"subagent_type":"coder"} task`. OpenCode can't
      // resolve it and routes to the `invalid` tool, returning a verbose
      // "unavailable tool / Available tools: ..." dump that Mistral ignores and
      // loops on. Intercept with TARGETED format guidance instead. No real tool
      // name contains `{`, so this can't false-positive on a valid call.
      if (
        typeof input.tool === "string" &&
        (input.tool.includes("{") || input.tool === "invalid")
      ) {
        const msg = [
          "[ECC] Malformed tool call. The tool NAME must be a bare identifier",
          "(e.g. `task`, `bash`, `read`, `edit`), NOT a JSON object and NOT a",
          "name+JSON string. You put the arguments into the name field.",
          "Retry as a STRUCTURED tool_call: name = the tool alone (e.g. `task`),",
          'arguments = the JSON object (e.g. {"subagent_type":"coder",',
          '"description":"...","prompt":"..."}). Do not concatenate the JSON and',
          "the tool name into one string, and do not wrap the call in text.",
        ].join(" ");
        log(
          "error",
          `[ECC] malformed tool name intercepted: ${input.tool.slice(0, 80)}`,
        );
        throw new Error(msg);
      }

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
     *   Pattern E — tool-call hallucination (XML or JSON/brace form):
     *     Text contains tool-call syntax typed as prose — either XML
     *     `<read>{...}</read>` / `<task>{...}</task>`, OR the more common
     *     brace form `grep{"pattern":...}` / `read{"filePath":...}`. These
     *     never fire (harness sees plain text; finish=stop, hasTool=false).
     *     Model thought it was calling a tool but used the wrong wire
     *     format. Fires regardless of opener.
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
     * Scope: the conductor gets the FULL guard (Patterns A–E). Subagents
     *   (coder/git-specialist/etc.) get ONLY Pattern E — they hallucinate
     *   tool calls too (e.g. git-specialist typing `bash{...}` as text and
     *   stalling), but their normal completion is a text-only finish=stop
     *   message, so Patterns A/B/C/D would false-positive on every legit
     *   result. A `!isConductor` short-circuit after Pattern E enforces this.
     *   NOTE: retry-injection into a subagent's session is unverified live —
     *   the per-message + per-session budgets bound any misfire.
     */
    // OpenCode dispatches bus events ONLY through the generic `event` hook.
    // Top-level keys like "message.updated" / "session.idle" / "file.edited"
    // are NOT part of the Hooks interface and are silently ignored — which is
    // why the retry-guard never ran. We route message.updated here.
    event: async (input: {
      event?: { type?: string; properties?: { info?: unknown } };
    }) => {
      const ev = input?.event;
      if (ev?.type !== "message.updated") return;
      if (!SYSTEM_RETRY_ENABLED) return;
      const info = (ev.properties?.info ?? {}) as {
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
      // Pre-gate trace: confirms the dispatched event reaches the guard and
      // reveals the real `mode` value. Remove once the guard is verified live.
      log("info", `[ECC retry-guard] entry msg=${info.id.slice(0, 8)} mode=${info.mode} finish=${info.finish}`);
      // Scope. The AssistantMessage `mode` field carries the AGENT NAME
      // (confirmed live as "conductor"). The conductor gets the FULL guard
      // (Patterns A–E). Subagents get ONLY Pattern E (tool-call hallucination):
      // their normal completion is a text-only finish=stop message, so the other
      // patterns would false-positive on every legit result. Anything that is
      // neither the conductor nor a known subagent is out of scope.
      const isConductor = info.mode === "conductor";
      const isSubagent = KNOWN_SUBAGENTS.has(info.mode ?? "");
      if (!isConductor && !isSubagent) return;
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
        state?: { input?: { command?: string; subagent_type?: string; agent?: string; subagent?: string; prompt?: string; description?: string } };
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

      // Diagnostic: logged for EVERY finished primary message the guard
      // evaluates, whether or not a pattern fires. Reveals stall shape
      // (tool-call present? text empty? finish reason?) in the ecc log.
      log(
        "info",
        `[ECC retry-guard] eval ${info.id.slice(0, 8)} finish=${info.finish} hasTool=${hasToolCall} textLen=${text.length} first40=${text.slice(0, 40).replace(/\n/g, " ")}`,
      );

      // Only act when the conductor VOLUNTARILY ended its turn. finish === "tool-calls"
      // means the turn continues (tools pending) — never intervene there. The message
      // accumulates ALL parts across rounds, so `hasToolCall` is true even on a clean
      // stop; that's why the old `!hasToolCall` gate could never fire. Gate on finish.
      if (info.finish !== "stop") return;

      // Dispatching a `task` IS valid progress — the subagent runs and the conductor
      // resumes when it returns. Don't treat a delegation turn as a stall.
      const dispatchedTask = parts.some(
        (p) => p.type === "tool" && p.tool === "task",
      );
      if (dispatchedTask) return;

      // ────────────────────────────────────────────────────────────────
      // Pattern B — Exploration-only / empty stall
      // Conductor ended its turn delivering NO answer text and dispatching
      // NO task — typically after read-only exploration (grep/glob/read).
      // This is the dominant Mistral failure: it "researches" then halts.
      // Conductor-only: an empty subagent turn is handled below (Pattern E or
      // the !isConductor short-circuit), never treated as a delegation stall.
      // ────────────────────────────────────────────────────────────────
      if (isConductor && text.length === 0) {
        retriedMessageIds.add(info.id);
        retryCountBySession.set(info.sessionID, usedBudget + 1);
        log(
          "warn",
          `[ECC retry-guard B] conductor msg ${info.id.slice(0, 8)} ended turn with no answer and no task dispatch (hasTool=${hasToolCall}). Budget ${usedBudget + 1}/${RETRY_BUDGET}.`,
        );
        await injectRetry(
          info.sessionID,
          [
            "[SYSTEM RETRY — automatic, Pattern B: exploration-only stall]",
            "Your previous turn ended without delivering an answer to the user and without dispatching a `task`. Exploring the repo (grep/glob/read) is NOT a turn-ender — you must either delegate or answer.",
            "As the conductor you do not implement directly. Dispatch the next step now: emit a `task` tool call to the matching specialist (coder for code edits, planner for multi-step work, etc.) with a concrete brief in the prompt field.",
            "Do NOT narrate. Emit the `task` tool call.",
          ].join("\n\n"),
        );
        return;
      }

      // ────────────────────────────────────────────────────────────────
      // Pattern E — tool-call hallucination (XML or JSON/brace form)
      // Most specific signal: model tried to call a tool by typing its
      // syntax in text instead of emitting a structured tool_call. Two
      // shapes seen from Mistral: XML `<read>{...}</read>` and the more
      // common brace form `read{"filePath":...}` / `grep{"pattern":...}`.
      // Fires regardless of opener.
      // ────────────────────────────────────────────────────────────────
      const xmlMatch = TOOL_XML_HALLUCINATION.exec(text);
      const jsonMatch = TOOL_JSON_HALLUCINATION.exec(text);
      if (xmlMatch || jsonMatch) {
        retriedMessageIds.add(info.id);
        retryCountBySession.set(info.sessionID, usedBudget + 1);
        const match = xmlMatch ?? jsonMatch;
        const form = xmlMatch ? "XML" : "JSON/brace";
        const role = isConductor ? "conductor" : `subagent:${info.mode}`;
        log(
          "warn",
          `[ECC retry-guard E] ${form} tool-call hallucination in ${role} msg ${info.id.slice(0, 8)}. Matched: ${(match?.[0] ?? "(?)").trim().slice(0, 60)}. Budget ${usedBudget + 1}/${RETRY_BUDGET}.`,
        );

        const sharedE = [
          "[SYSTEM RETRY — automatic, Pattern E: tool-call hallucination]",
          'Your previous message typed tool-call syntax as TEXT — either XML like `<read>{...}</read>` or the brace form like `grep{"pattern":...}` / `read{"filePath":...}` / `bash{"command":...}`. Neither fires: the harness sees plain text, ends the turn, and nothing happens.',
          "Tools must be invoked as STRUCTURED tool_calls (the API tool-calling channel), NOT typed into your message body. You cannot write the invocation as text — emit it through the tool-calling channel.",
        ];
        const tailE = isConductor
          ? "Per the conductor rules, do not explore the repo yourself with grep/read/glob. Retry the original request as a real `task` tool call to the matching specialist (coder for code edits, planner for multi-step work) with the brief in the prompt field. Do not type any tool name followed by `{` or `<`."
          : "You are a subagent: you execute the work YOURSELF, you do NOT delegate. Re-issue the SAME tool you intended (read/bash/edit/grep/glob/etc.) as a real structured tool_call now. If you have finished the work, return your result as plain prose with NO tool-call syntax in it. Do not type any tool name followed by `{` or `<`.";

        await injectRetry(info.sessionID, [...sharedE, tailE].join("\n\n"));
        return;
      }

      // Beyond this point the patterns (D, A, C) are conductor-specific: they
      // assume a delegating orchestrator with TODOs and a verification gate.
      // A subagent that reached here ended with legitimate result text — leave
      // it alone.
      if (!isConductor) return;

      // ────────────────────────────────────────────────────────────────
      // Pattern D — Open TODOs at turn end
      // Strong signal: work isn't done, conductor stalled with narration.
      // ────────────────────────────────────────────────────────────────
      {
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
      if (BANNED_OPENER.test(text)) {
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

      // OpenSpec workflows (/opsx-* commands) produce only markdown artifacts
      // under openspec/changes/<name>/ — nothing buildable is emitted. Skip the
      // verification gate entirely when the conductor's done-message signals an
      // OpenSpec artifact-generation result (e.g. "READY FOR: /opsx-apply-change").
      if (OPENSPEC_DONE.test(text)) return;

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
            // Skip: tasks whose brief references openspec paths or /opsx commands
            // produce only markdown artifacts — nothing to build/typecheck.
            const brief = String(inputArgs.prompt ?? inputArgs.description ?? "");
            const isOpenSpecTask = OPENSPEC_DONE.test(brief) || /\/opsx\b/i.test(brief);
            if (CODE_TOUCHING_SUBAGENTS.has(target) && !isOpenSpecTask) {
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
