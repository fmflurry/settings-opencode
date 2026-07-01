/**
 * code-memory OpenCode plugin
 *
 * Auto-retrieve: hook `chat.message` to detect substantive code intent, fetch
 * a Context Pack via `code-memory retrieve --json`, and stash it per session.
 * Hook `experimental.chat.system.transform` injects the pack into the system
 * prompt while it is fresh.
 *
 * Auto-learn: hook `tool.execute.after` to call `code-memory reingest <path>`
 * whenever the agent writes or edits a file. Hook `event session.idle` to
 * record the session as an episode (best-effort).
 *
 * All backend calls are best-effort: a missing or broken `code-memory` CLI
 * degrades to no-op without breaking the session.
 */

import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";

import type { Plugin } from "@opencode-ai/plugin";

import {
  type ContextPack,
  type LogLevel,
  type MemoryClient,
  createMemoryClient,
} from "./code-memory-lib/memory-client.ts";
import {
  extractQueryFromMessage,
  isSubstantiveCodeIntent,
} from "./code-memory-lib/intent.ts";
import {
  detectClaimIntent,
  formatClaimNudge,
} from "./code-memory-lib/claim-intent.ts";

const execFile = promisify(execFileCb);

const PACK_TTL_MS = 5 * 60 * 1000; // 5 min
const DEDUP_WINDOW_MS = 60 * 1000; // 60 s
// After the *last* write in a burst, wait this long before re-running the
// resolver. Keeps high-frequency edit storms from spawning N resolver runs.
const RESOLVER_DEBOUNCE_MS = 1500;
const WRITE_TOOLS: ReadonlySet<string> = new Set(["write", "edit", "patch"]);
const GATED_READ_TOOLS: ReadonlySet<string> = new Set([
  "read",
  "bash",
  "grep",
  "glob",
]);
const MEMORY_TOOL_PREFIXES: readonly string[] = [
  "codememory_",
  "code-memory_",
  "code_memory_",
  "mcp__code-memory__",
];
const SERVICE = "code-memory";

const GATE_NUDGE = [
  "## code-memory gate",
  "",
  "Your previous tool calls hit the filesystem / shell without first making",
  "an explicit code-memory MCP call. The auto-injected Context Pack is",
  "orientation only; it does not satisfy this gate. For codebase questions",
  "(where is X, how does Y work, who calls Z, where are the docs) call",
  "`codememory_retrieve` first, then use filesystem tools only to verify:",
  "",
  "- `codememory_retrieve` — semantic + episodic recall",
  "- `codememory_definitions` — exact symbol locations",
  "- `codememory_callers` / `codememory_callees` — call graph",
  "- `codememory_importers` / `codememory_dependencies` — imports",
  "- `codememory_health` — backend status + collection stats",
  "",
  "Default to one targeted MCP call before scanning the filesystem.",
].join("\n");

interface SessionMemory {
  pack: ContextPack | null;
  query: string | null;
  fetchedAt: number;
  firstUserMessage: string | null;
  autoRetrieveSeen: boolean;
  explicitMemorySeen: boolean;
  pendingGateNudge: boolean;
  pendingClaimNudge: string | null;
}

function isMemoryTool(tool: string): boolean {
  const lower = tool.toLowerCase();
  return MEMORY_TOOL_PREFIXES.some((p) => lower.includes(p));
}

interface ToolInput {
  readonly tool?: string;
  readonly sessionID?: string;
  readonly callID?: string;
}

interface ToolOutput {
  readonly args?: Record<string, unknown>;
  readonly metadata?: Record<string, unknown>;
}

interface ChatMessageInput {
  readonly sessionID?: string;
}

interface ChatMessageOutput {
  readonly parts?: ReadonlyArray<{ type?: string; text?: string }>;
}

interface SystemTransformOutput {
  system?: string[];
}

interface ToolDefinitionInput {
  readonly toolID: string;
}

interface ToolDefinitionOutput {
  description: string;
  parameters: unknown;
}

interface EventEnvelope {
  readonly type?: string;
  readonly properties?: Record<string, unknown>;
}

function pickToolPath(args: Record<string, unknown> | undefined): string | null {
  if (!args) return null;
  for (const key of ["filePath", "file_path", "path", "target"]) {
    const v = args[key];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return null;
}

function extractText(parts: ChatMessageOutput["parts"] | undefined): string {
  if (!Array.isArray(parts)) return "";
  return parts
    .filter((p): p is { type?: string; text: string } => typeof p?.text === "string")
    .map((p) => p.text)
    .join("\n")
    .trim();
}

function formatPack(pack: ContextPack): string {
  const lines: string[] = ["## code-memory Context Pack"];
  lines.push(`Query: ${pack.query}`);

  if (pack.code.length > 0) {
    lines.push("", "### Code hits");
    for (const h of pack.code) {
      const loc = h.path
        ? `${h.path}:${h.start ?? "?"}-${h.end ?? "?"}`
        : "?";
      const kind = h.kind ?? "?";
      const name = h.name ?? "?";
      lines.push(`- ${loc} [${kind} ${name}] score=${h.score.toFixed(3)}`);
    }
  }

  if (pack.episodes.length > 0) {
    lines.push("", "### Prior episodes");
    for (const ep of pack.episodes) {
      const verdict = ep.verdict ? ` (${ep.verdict})` : "";
      lines.push(`- ${ep.id}${verdict} :: ${ep.prompt}`);
    }
  }

  const claims = pack.claims;
  if (Array.isArray(claims) && claims.length > 0) {
    lines.push("", "### User claims");
    for (const c of claims) {
      const neg = c.polarity === false ? " (NEGATED)" : "";
      const conf =
        typeof c.confidence === "number" ? c.confidence.toFixed(2) : "?";
      lines.push(
        `- ${c.subject} ${c.predicate} ${c.object}${neg} (conf=${conf})`,
      );
    }
  }

  lines.push(
    "",
    "### Next-step tools (call these autonomously when applicable)",
    "",
    "Auto-injected Context Packs are orientation only. They do not replace an",
    "explicit code-memory MCP call when repo/code/docs orientation is needed.",
    "",
    "The Code hits above are **orientation only** — they do not answer topology",
    "questions. Before reading files, decide if a graph query would give you a",
    "precise answer in one call.",
    "",
    "**Docs / repo orientation:**",
    "",
    "- Docs inventory, repo documentation, or 'where do docs live?' → call",
    "  `codememory_retrieve` first, then `glob` / `read` to verify an exhaustive",
    "  list.",
    "",
    "**Topology (call graph + imports):**",
    "",
    "- `codememory_callers(symbol)` — who calls this symbol? Use before rename/",
    "  refactor, or when asked 'what depends on X'.",
    "- `codememory_callees(symbol)` — what does the file defining this symbol",
    "  call? Use to map outgoing dependencies of a service/class.",
    "- `codememory_importers(target)` — which files import this module or path?",
    "  Use for 'who uses @scope/lib' or barrel-file impact analysis.",
    "- `codememory_dependencies(file)` — what does this file import? Use to",
    "  understand a file's external surface before reading it line-by-line.",
    "- `codememory_definitions(symbol)` — every file+line that defines a name.",
    "  Use first when a symbol name is ambiguous across the project.",
    "",
    "**.NET assembly surface (only for C# / VB / F# code):**",
    "",
    "- `codememory_assembly_members(type)` — public methods of an indexed .NET",
    "  Type, read on-demand from the DLL. Use for overload disambiguation and",
    "  'what API does this type expose'.",
    "",
    "**Temporal (time-travel queries):**",
    "",
    "- `codememory_drift(head_sha)` — symbols whose `last_seen_sha` ≠ HEAD,",
    "  classified `tombstoned` / `drifted`. Use for 'is the index stale' or",
    "  'are these comments still accurate'.",
    "- `codememory_at_sha(sha, sha_ord)` — nodes alive at a past commit. Pass",
    "  `sha_ord` precomputed via `git rev-list --count --first-parent <sha>`.",
    "- `codememory_callers_at_sha(symbol, sha, sha_ord)` — pre-deletion",
    "  callers of a symbol. Use for 'who used to call X before commit Y'.",
    "",
    "Default to one targeted graph call over a wide grep. Read source files",
    "only after the graph tells you exactly which lines to open.",
    "",
    "After completing a non-trivial task, call `codememory_record(prompt, plan,",
    "patch, verdict)` so future sessions can recall what worked.",
    "",
    "_Source: local code-memory index. Use as orientation; verify before acting._",
  );
  return lines.join("\n");
}

async function gitDiff(cwd: string): Promise<string> {
  try {
    const { stdout } = await execFile(
      "git",
      ["-C", cwd, "diff", "--unified=0"],
      { timeout: 4000, maxBuffer: 1024 * 1024 },
    );
    return stdout.trim();
  } catch {
    return "";
  }
}

const CodeMemoryPlugin: Plugin = async ({ client, directory, worktree }) => {
  const cwd = worktree || directory || process.cwd();

  const log = (level: LogLevel, message: string): void => {
    // Fire-and-forget to avoid blocking session init.
    client.app
      .log({ body: { service: SERVICE, level, message } })
      .catch(() => {});
  };

  let memory: MemoryClient;
  try {
    memory = await createMemoryClient({ cwd, log });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log("error", `failed to initialize memory client: ${msg}`);
    return {};
  }

  if (!memory.available) {
    log(
      "warn",
      "plugin loaded but `code-memory` CLI is missing. Install with " +
        "`pipx install git+https://github.com/fmflurry/code-memory` or expose " +
        "it via `uvx`. Hooks will no-op until then.",
    );
  }

  const stateBySession = new Map<string, SessionMemory>();
  // Set of sessions that have already kicked off the per-session delta
  // ingest (run once on the first prompt to catch out-of-band edits).
  const sessionsBootstrapped = new Set<string>();
  // Debounce handle for the resolver — coalesces bursts of write tools.
  let resolverTimer: NodeJS.Timeout | null = null;

  function scheduleResolver(): void {
    if (resolverTimer) clearTimeout(resolverTimer);
    resolverTimer = setTimeout(() => {
      resolverTimer = null;
      void memory.resolve().catch(() => {
        // resolve() already logs internally; swallow to keep the hook quiet
      });
    }, RESOLVER_DEBOUNCE_MS);
  }

  function invalidateAllPacks(reason: string): void {
    for (const s of stateBySession.values()) {
      if (s.pack) {
        s.pack = null;
        s.query = null;
        s.fetchedAt = 0;
      }
    }
    log("debug", `context pack cache invalidated (${reason})`);
  }

  function getSession(id: string | undefined): SessionMemory | null {
    if (!id) return null;
    let s = stateBySession.get(id);
    if (!s) {
      s = {
        pack: null,
        query: null,
        fetchedAt: 0,
        firstUserMessage: null,
        autoRetrieveSeen: false,
        explicitMemorySeen: false,
        pendingGateNudge: false,
        pendingClaimNudge: null,
      };
      stateBySession.set(id, s);
    }
    return s;
  }

  function pruneStaleSessions(now: number): void {
    for (const [id, s] of stateBySession.entries()) {
      if (s.fetchedAt && now - s.fetchedAt > PACK_TTL_MS * 4) {
        stateBySession.delete(id);
      }
    }
  }

  return {
    "chat.message": async (input: ChatMessageInput, output: ChatMessageOutput) => {
      const now = Date.now();
      pruneStaleSessions(now);

      const sid = input.sessionID;
      const session = getSession(sid);
      if (!session) return;

      // New turn: auto-retrieve may run below, but only explicit MCP tool use
      // satisfies the filesystem/search/shell gate.
      session.autoRetrieveSeen = false;
      session.explicitMemorySeen = false;

      const text = extractText(output.parts);
      if (text && !session.firstUserMessage) {
        session.firstUserMessage = text;
      }

      // Claim-intent detection runs independently of code-retrieval: a
      // message like "I love Clean Architecture" carries no code-search
      // signal but IS exactly the kind of durable assertion the agent
      // must capture via codememory_assert_claim.
      const claimHit = detectClaimIntent(text);
      if (claimHit) {
        session.pendingClaimNudge = formatClaimNudge(claimHit);
        log("info", `claim-intent: ${claimHit.kind} → "${claimHit.snippet}"`);
      }

      // Once per session, kick off a delta ingest in the background. Catches
      // out-of-band edits (vim, IDE, git pull) made between sessions so the
      // index isn't stale on the very first prompt. Also ensure a launchd /
      // systemd watcher unit exists for this repo so edits BETWEEN sessions
      // (when no agent is running) still trigger reingest automatically.
      if (memory.available && sid && !sessionsBootstrapped.has(sid)) {
        sessionsBootstrapped.add(sid);
        memory.autostartInstallDetached();
        void memory.ingest().catch(() => {
          // ingest() logs internally; never block session start on failure.
        });
      }

      if (!memory.available || !isSubstantiveCodeIntent(text)) return;

      const query = extractQueryFromMessage(text);

      // Dedup the same query within DEDUP_WINDOW_MS.
      if (
        session.query === query &&
        session.fetchedAt &&
        now - session.fetchedAt < DEDUP_WINDOW_MS
      ) {
        return;
      }

      const pack = await memory.retrieve(query, { k: 8, eps: 5 });
      if (pack) {
        session.pack = pack;
        session.query = query;
        session.fetchedAt = Date.now();
        session.autoRetrieveSeen = true;
        log(
          "info",
          `retrieved ${pack.code.length} code / ${pack.episodes.length} episodes for "${query.slice(0, 80)}"`,
        );
      }
    },

    "experimental.chat.system.transform": async (
      input: ChatMessageInput,
      output: SystemTransformOutput,
    ) => {
      if (!Array.isArray(output.system)) return;
      const session = sessionLookup(stateBySession, input.sessionID);
      if (!session) return;

      // Drain a pending gate nudge from the previous turn (the agent ran a
      // shell/read tool without first hitting code-memory). The nudge is
      // one-shot — surfaced exactly once at the next turn's system prompt.
      if (session.pendingGateNudge) {
        session.pendingGateNudge = false;
        output.system.push(GATE_NUDGE);
      }

      // Drain a pending claim nudge. One-shot per turn: surface the
      // suggestion to call codememory_assert_claim, then clear it.
      if (session.pendingClaimNudge) {
        output.system.push(session.pendingClaimNudge);
        session.pendingClaimNudge = null;
      }

      if (!session.pack) return;
      if (Date.now() - session.fetchedAt > PACK_TTL_MS) return;

      const isEmpty =
        session.pack.code.length === 0 && session.pack.episodes.length === 0;
      if (isEmpty) return;

      output.system.push(formatPack(session.pack));
    },

    "tool.execute.before": async (input: ToolInput, _output: ToolOutput) => {
      const tool = (input.tool ?? "").toLowerCase();
      if (!GATED_READ_TOOLS.has(tool)) return;

      const session = sessionLookup(stateBySession, input.sessionID);
      if (!session || session.explicitMemorySeen || session.pendingGateNudge) return;

      // Soft nudge: never block. Flag the session so the next system
      // transform surfaces a one-shot reminder, and log a warning the
      // user sees in the OpenCode UI right away.
      session.pendingGateNudge = true;
      log(
        "warn",
        `gate: ${tool} called without explicit code-memory MCP use this turn — auto Context Pack is not enough; call codememory_retrieve first`,
      );
    },

    "tool.definition": async (
      input: ToolDefinitionInput,
      output: ToolDefinitionOutput,
    ) => {
      const tool = input.toolID.toLowerCase();
      if (!GATED_READ_TOOLS.has(tool)) return;

      const prefix =
        "For repo/code/docs orientation, call code-memory MCP first: " +
        "use codememory_retrieve before grep/glob/read/bash, then verify exhaustively. ";
      if (output.description.startsWith(prefix)) return;
      output.description = `${prefix}${output.description}`;
    },

    "tool.execute.after": async (input: ToolInput, output: ToolOutput) => {
      const tool = (input.tool ?? "").toLowerCase();

      // Any code-memory MCP call satisfies the gate for this turn.
      if (isMemoryTool(tool)) {
        const session = sessionLookup(stateBySession, input.sessionID);
        if (session) {
          session.explicitMemorySeen = true;
          session.pendingGateNudge = false;
        }
      }

      // Track filesystem reads for MCP efficiency metrics.
      // Records only when the agent used code-memory MCP this turn.
      if (GATED_READ_TOOLS.has(tool)) {
        const session = sessionLookup(stateBySession, input.sessionID);
        if (session?.explicitMemorySeen) {
          const path =
            pickToolPath(output.args) ?? pickToolPath(output.metadata) ?? "";
          void memory.recordRead(tool, path);
        }
      }

      if (!memory.available) return;
      if (!WRITE_TOOLS.has(tool)) return;

      const path = pickToolPath(output.args) ?? pickToolPath(output.metadata);
      if (!path) return;

      // 1. Re-ingest the single file (fast, background).
      void memory.reingest(path);

      // 2. The file's symbols just changed — any cached Context Pack now
      //    reflects pre-write state. Drop it so the next prompt re-fetches.
      invalidateAllPacks(`${tool}(${path})`);

      // 3. Schedule the cross-file resolver. Debounced so a burst of edits
      //    (e.g. multi-file refactor) collapses to one resolver run after
      //    the dust settles.
      scheduleResolver();
    },

    event: async ({ event }: { event: EventEnvelope }) => {
      if (!memory.available) return;
      if (event.type !== "session.idle") return;

      const sid =
        typeof event.properties?.sessionID === "string"
          ? (event.properties.sessionID as string)
          : undefined;
      const session = sessionLookup(stateBySession, sid);
      if (!session?.firstUserMessage) return;

      const patch = await gitDiff(cwd);
      void memory.record({
        prompt: session.firstUserMessage,
        patch: patch || undefined,
        verdict: "idle",
      });

      // Fire-and-forget Graphiti-style claim extraction. Detached on
      // purpose: gemma2:9b inference can take several seconds and we
      // never want it to delay session.idle settling. The CLI no-ops
      // cheaply when CLAIMS_EXTRACTION is not set, so this spawn is
      // safe to issue on every idle event.
      memory.extractClaimsDetached({
        prompts: [session.firstUserMessage],
        sessionId: sid,
      });
    },
  };
};

function sessionLookup(
  map: Map<string, SessionMemory>,
  id: string | undefined,
): SessionMemory | null {
  if (!id) return null;
  return map.get(id) ?? null;
}

export default CodeMemoryPlugin;
