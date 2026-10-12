import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const HARNESS_DIR = path.join(os.homedir(), ".config/opencode/scripts/agent-harness");
export const HOOK_DIRS = [path.join(HARNESS_DIR, "hooks"), path.join(os.homedir(), ".claude/hooks")];

export const hookPath = (name: string, dirs: string[] = HOOK_DIRS): string | null =>
  dirs.map((dir) => path.join(dir, name)).find((candidate) => fs.existsSync(candidate)) ?? null;

export const GATE_TIMEOUT_MS = 15_000;
export const GUARD_TIMEOUT_MS = 5_000;

export type HookOptions = {
  directory: string;
  timeoutMs?: number;
  env?: Record<string, string>;
  dirs?: string[];
};

export const runHookText = (name: string, stdin: unknown, opts: HookOptions): Promise<string> => {
  const hook = hookPath(name, opts.dirs);
  if (!hook) return Promise.resolve("");
  return new Promise((resolve) => {
    const child = spawn("bash", [hook], {
      cwd: opts.directory,
      env: {
        ...process.env,
        CLAUDE_PROJECT_DIR: opts.directory,
        AGENT_HARNESS_DIR: HARNESS_DIR,
        ...opts.env,
      },
      stdio: ["pipe", "pipe", "ignore"],
    });
    let out = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve("");
    }, opts.timeoutMs ?? GUARD_TIMEOUT_MS);
    child.stdout.on("data", (chunk: Buffer) => {
      out += chunk.toString();
    });
    child.on("error", () => {
      clearTimeout(timer);
      resolve("");
    });
    child.on("close", () => {
      clearTimeout(timer);
      resolve(out.trim());
    });
    child.stdin.on("error", () => undefined);
    child.stdin.end(JSON.stringify(stdin));
  });
};

export const runHook = async (name: string, stdin: unknown, opts: HookOptions): Promise<unknown | null> => {
  const text = await runHookText(name, stdin, opts);
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;

export const denyReason = (result: unknown): string | null => {
  const specific = asRecord(asRecord(result)?.hookSpecificOutput);
  if (specific?.permissionDecision !== "deny") return null;
  return typeof specific.permissionDecisionReason === "string"
    ? specific.permissionDecisionReason
    : "Blocked by git-guard.";
};

export const blockReason = (result: unknown): string | null => {
  const record = asRecord(result);
  if (record?.decision !== "block") return null;
  return typeof record.reason === "string" ? record.reason : "Autonomous goal is not finished.";
};
