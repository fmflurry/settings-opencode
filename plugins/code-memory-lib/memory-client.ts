/**
 * Thin shell wrapper over the `code-memory` Python CLI.
 *
 * All operations are best-effort:
 *  - If the CLI is not on PATH, every call resolves to a benign no-op.
 *  - All invocations are bounded by a per-call timeout.
 *  - Errors are surfaced via the optional `onError` logger; they never throw.
 *
 * This keeps the plugin safe to install: a missing backend never breaks a
 * user's OpenCode session.
 */

import { execFile as execFileCb, spawn } from "node:child_process";
import { promisify } from "node:util";

const execFile = promisify(execFileCb);

export type LogLevel = "debug" | "info" | "warn" | "error";
export type Logger = (level: LogLevel, message: string) => void;

export interface MemoryClientOptions {
  readonly binary?: string; // override; default "code-memory"
  readonly project?: string; // forwarded as --project
  readonly cwd?: string;
  readonly retrieveTimeoutMs?: number;
  readonly mutateTimeoutMs?: number;
  readonly log?: Logger;
}

export interface CodeHit {
  readonly path: string | null;
  readonly start: number | null;
  readonly end: number | null;
  readonly kind: string | null;
  readonly name: string | null;
  readonly score: number;
}

export interface EpisodeHit {
  readonly id: string;
  readonly verdict: string | null;
  readonly prompt: string;
  readonly score: number | null;
}

export interface ClaimHit {
  readonly subject: string;
  readonly predicate: string;
  readonly object: string;
  readonly polarity: boolean;
  readonly confidence: number;
  readonly valid_at: number;
  readonly head_sha: string | null;
}

export interface ContextPack {
  readonly query: string;
  readonly code: readonly CodeHit[];
  readonly episodes: readonly EpisodeHit[];
  readonly claims?: readonly ClaimHit[];
}

export interface MemoryClient {
  readonly available: boolean;
  retrieve(query: string, opts?: { k?: number; eps?: number }): Promise<ContextPack | null>;
  reingest(path: string): Promise<void>;
  resolve(): Promise<void>;
  ingest(opts?: { full?: boolean }): Promise<void>;
  record(input: { prompt: string; plan?: string; patch?: string; verdict?: string }): Promise<void>;
  extractClaimsDetached(input: {
    prompts: readonly string[];
    sessionId?: string;
  }): boolean;
  autostartInstallDetached(): boolean;
  recordRead(tool: string, path: string, chars?: number): Promise<void>;
}

function nullLogger(_level: LogLevel, _message: string): void {
  // no-op
}

async function detectBinary(candidate: string, log: Logger): Promise<boolean> {
  try {
    await execFile(candidate, ["--help"], { timeout: 3000 });
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log("debug", `binary ${candidate} unavailable: ${msg}`);
    return false;
  }
}

export async function createMemoryClient(
  opts: MemoryClientOptions = {},
): Promise<MemoryClient> {
  const log = opts.log ?? nullLogger;
  const binary = opts.binary ?? "code-memory";
  const cwd = opts.cwd ?? process.cwd();
  const retrieveTimeout = opts.retrieveTimeoutMs ?? 8000;
  const mutateTimeout = opts.mutateTimeoutMs ?? 20000;
  const project = opts.project;

  const available = await detectBinary(binary, log);

  if (!available) {
    log("warn", `code-memory binary not found on PATH (looked for: ${binary})`);
  }

  const baseArgs = (): string[] => (project ? ["--project", project] : []);

  return {
    available,

    async retrieve(query, options = {}) {
      if (!available) return null;
      const args = [
        "retrieve",
        query,
        "--json",
        ...(options.k ? ["--k", String(options.k)] : []),
        ...(options.eps ? ["--eps", String(options.eps)] : []),
        ...baseArgs(),
      ];
      try {
        const { stdout } = await execFile(binary, args, {
          cwd,
          timeout: retrieveTimeout,
          maxBuffer: 4 * 1024 * 1024,
        });
        return JSON.parse(stdout) as ContextPack;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log("warn", `retrieve failed: ${msg}`);
        return null;
      }
    },

    async reingest(path) {
      if (!available) return;
      const args = ["reingest", path, "--json", ...baseArgs()];
      try {
        await execFile(binary, args, { cwd, timeout: mutateTimeout });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log("warn", `reingest(${path}) failed: ${msg}`);
      }
    },

    async resolve() {
      if (!available) return;
      const args = ["resolve", "--json", ...baseArgs()];
      try {
        await execFile(binary, args, { cwd, timeout: mutateTimeout });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log("warn", `resolve failed: ${msg}`);
      }
    },

    async ingest(options = {}) {
      if (!available) return;
      const args = [
        "ingest",
        cwd,
        "--json",
        ...(options.full ? ["--full"] : []),
        ...baseArgs(),
      ];
      try {
        // Larger timeout: a delta walk can hit many files on session resume.
        await execFile(binary, args, { cwd, timeout: mutateTimeout * 3 });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log("warn", `ingest failed: ${msg}`);
      }
    },

    async record({ prompt, plan, patch, verdict }) {
      if (!available) return;
      const args = [
        "record",
        "--prompt",
        prompt,
        ...(plan ? ["--plan", plan] : []),
        ...(patch ? ["--patch", patch] : []),
        ...(verdict ? ["--verdict", verdict] : []),
        "--json",
        ...baseArgs(),
      ];
      try {
        await execFile(binary, args, { cwd, timeout: mutateTimeout });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log("warn", `record failed: ${msg}`);
      }
    },

    async recordRead(
      tool: string,
      path: string,
      chars: number = 0,
    ): Promise<void> {
      if (!available) return;
      try {
        await execFile(
          binary,
          [
            "record-read",
            "--tool",
            tool,
            "--path",
            String(path),
            "--chars",
            String(chars),
            ...baseArgs(),
          ],
          { cwd, timeout: 2000 },
        );
      } catch {
        // silent — metrics are best-effort
      }
    },

    /**
     * Fire-and-forget claim extraction. The CLI honors CLAIMS_EXTRACTION
     * — when the env knob is off it exits 0 with a "disabled" payload —
     * so this is cheap to call unconditionally on every session.idle.
     *
     * Returns true if we spawned the child, false if the binary is
     * missing or the prompt list is empty after filtering.
     */
    extractClaimsDetached({ prompts, sessionId }) {
      if (!available) return false;
      const list = (prompts ?? []).filter(
        (p): p is string => typeof p === "string" && p.trim().length > 0,
      );
      if (!list.length) return false;
      const args = ["extract-claims", "--json", ...baseArgs()];
      for (const p of list) {
        args.push("--prompt", p);
      }
      if (sessionId) args.push("--session-id", sessionId);
      try {
        const child = spawn(binary, args, {
          cwd,
          detached: true,
          stdio: "ignore",
        });
        child.unref();
        return true;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log("warn", `extractClaims spawn failed: ${msg}`);
        return false;
      }
    },

    /**
     * Fire-and-forget autostart registration for ``cwd``. Wraps
     * ``code-memory autostart install <cwd>``. ``ensure_autostart`` in
     * the CLI is idempotent and refuses unsafe roots (home/root/no VCS),
     * so this is cheap to call on every session bootstrap.
     */
    autostartInstallDetached() {
      if (!available) return false;
      const args = ["autostart", "install", cwd, "--json"];
      try {
        const child = spawn(binary, args, {
          cwd,
          detached: true,
          stdio: "ignore",
        });
        child.unref();
        return true;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log("warn", `autostart install spawn failed: ${msg}`);
        return false;
      }
    },
  };
}
