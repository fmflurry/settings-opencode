import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const HARNESS_DIR = path.join(os.homedir(), ".config/opencode/scripts/agent-harness");
export const HOOK_DIRS = [path.join(HARNESS_DIR, "hooks"), path.join(os.homedir(), ".claude/hooks")];

export const projectHookDirs = (directory: string): string[] => [
  path.join(directory, ".claude", "hooks"),
  ...HOOK_DIRS,
];

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

type HookOutcome =
  | { kind: "missing" }
  | { kind: "error" }
  | { kind: "timeout" }
  | { kind: "exit"; code: number; text: string };

const runHookProcess = (name: string, stdin: unknown, opts: HookOptions): Promise<HookOutcome> => {
  const hook = hookPath(name, opts.dirs ?? projectHookDirs(opts.directory));
  if (!hook) return Promise.resolve({ kind: "missing" });
  return new Promise((resolve) => {
    let settled = false;
    let out = "";
    let timer: ReturnType<typeof setTimeout>;
    const finish = (outcome: HookOutcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(outcome);
    };
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
    timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish({ kind: "timeout" });
    }, opts.timeoutMs ?? GUARD_TIMEOUT_MS);
    child.stdout.on("data", (chunk: Buffer) => {
      out += chunk.toString();
    });
    child.on("error", () => finish({ kind: "error" }));
    child.on("close", (code) => finish({ kind: "exit", code: code ?? 1, text: out.trim() }));
    child.stdin.on("error", () => undefined);
    child.stdin.end(JSON.stringify(stdin));
  });
};

export const runHookText = async (name: string, stdin: unknown, opts: HookOptions): Promise<string> => {
  const outcome = await runHookProcess(name, stdin, opts);
  return outcome.kind === "exit" ? outcome.text : "";
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

const GUARD_HOOK = "autonomy-git-guard.sh";
const VISUAL_HOOK = "pr-visual-report.sh";

const guardFailure = (detail: string): string => `Blocked by git-guard: ${GUARD_HOOK} ${detail}.`;

// Fail closed for the bash git guard. An empty successful run is allow.
// ask is not allow: OpenCode can only let the command run or stop it.
export const bashGuardRejection = async (stdin: unknown, opts: HookOptions): Promise<string | null> => {
  const outcome = await runHookProcess(GUARD_HOOK, stdin, opts);
  if (outcome.kind === "missing") return guardFailure("was not found");
  if (outcome.kind === "error") return guardFailure("failed to start");
  if (outcome.kind === "timeout") return guardFailure("timed out");
  if (outcome.code !== 0) return guardFailure("failed");
  if (!outcome.text) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(outcome.text);
  } catch {
    return guardFailure("returned invalid output");
  }
  const specific = asRecord(asRecord(parsed)?.hookSpecificOutput);
  const decision = specific?.permissionDecision;
  if (decision === "allow") return null;
  if (specific && (decision === "deny" || decision === "ask")) {
    const reason = specific.permissionDecisionReason;
    return typeof reason === "string" && reason.length > 0 ? reason : "Blocked by git-guard.";
  }
  return guardFailure("returned an unexpected decision");
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;

// Missing hook fails open so an older install keeps working. A present hook fails closed.
export const visualReportRejection = async (stdin: unknown, opts: HookOptions): Promise<string | null> => {
  const outcome = await runHookProcess(VISUAL_HOOK, stdin, opts);
  if (outcome.kind === "missing") return null;
  if (outcome.kind === "error") return "Blocked by pr-visual-report: hook failed to start.";
  if (outcome.kind === "timeout") return "Blocked by pr-visual-report: hook timed out.";
  if (outcome.code !== 0) return "Blocked by pr-visual-report: hook failed.";
  if (!outcome.text) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(outcome.text);
  } catch {
    return "Blocked by pr-visual-report: hook returned invalid output.";
  }
  const specific = asRecord(asRecord(parsed)?.hookSpecificOutput);
  const decision = specific?.permissionDecision;
  if (!specific || decision === "allow" || decision === "") return null;
  if (decision === "deny" || decision === "ask") {
    const reason = specific.permissionDecisionReason;
    return typeof reason === "string" && reason.length > 0 ? reason : "Blocked by pr-visual-report.";
  }
  return "Blocked by pr-visual-report: hook returned an unexpected decision.";
};

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
