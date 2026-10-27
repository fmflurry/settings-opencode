// Generic project hook. No domain rules live here.
// Disabled unless .harness-local/domain-rules.json sets "enabled" to true.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_DOMAIN_SCRIPT = "scripts/check-domain-rules.sh";

export type DomainDecision =
  | { action: "skip" }
  | { action: "error"; message: string }
  | { action: "run"; project: string; script: string; scriptPath: string };

function findHarnessLocal(start: string): string | null {
  let dir = path.resolve(start);
  for (;;) {
    const marker = path.join(dir, ".harness-local");
    if (fs.existsSync(marker) && fs.statSync(marker).isDirectory()) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function findProjectRoot(start: string): string | null {
  return findHarnessLocal(start) ?? (process.env.CLAUDE_PROJECT_DIR ? findHarnessLocal(process.env.CLAUDE_PROJECT_DIR) : null);
}

export function resolveProjectScript(project: string, rel: string): string {
  const norm = rel.replaceAll("\\", "/").trim();
  if (!norm || norm.includes("\0")) throw new Error("domain-rules: script must be a relative path");
  if (path.posix.isAbsolute(norm) || path.win32.isAbsolute(rel.trim())) {
    throw new Error("domain-rules: script must be a relative path");
  }
  const parts = norm.split("/");
  if (parts.includes("..") || parts.includes(".")) throw new Error("domain-rules: script must stay inside the project");
  const root = path.resolve(project);
  const full = path.resolve(root, ...parts);
  if (full !== root && !full.startsWith(root + path.sep)) {
    throw new Error("domain-rules: script must stay inside the project");
  }
  return full;
}

export function decideDomainRules(start: string): DomainDecision {
  const project = findProjectRoot(start);
  if (!project) return { action: "skip" };
  const file = path.join(project, ".harness-local", "domain-rules.json");
  const configStat = fs.lstatSync(file, { throwIfNoEntry: false });
  if (!configStat) return { action: "skip" };
  let configPath = file;
  try {
    configPath = fs.realpathSync(file);
  } catch {
    return { action: "error", message: "domain-rules: domain-rules.json must be a regular file" };
  }
  const rootReal = fs.realpathSync(project);
  if (configPath !== rootReal && !configPath.startsWith(rootReal + path.sep)) {
    return { action: "error", message: "domain-rules: domain-rules.json must stay inside the project" };
  }
  if (!fs.statSync(configPath).isFile()) {
    return { action: "error", message: "domain-rules: domain-rules.json must be a regular file" };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(configPath, "utf8"));
  } catch {
    return { action: "error", message: "domain-rules: domain-rules.json is not JSON" };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { action: "error", message: "domain-rules: domain-rules.json must be an object" };
  }
  const record = parsed as Record<string, unknown>;
  if (record.enabled !== true) return { action: "skip" };
  const script = record.script === undefined ? DEFAULT_DOMAIN_SCRIPT : record.script;
  if (typeof script !== "string") return { action: "error", message: "domain-rules: script must be a relative path" };
  let scriptPath: string;
  try {
    scriptPath = resolveProjectScript(project, script);
  } catch (error) {
    const message = error instanceof Error ? error.message : "domain-rules: script must be a relative path";
    return { action: "error", message };
  }
  const scriptStat = fs.lstatSync(scriptPath, { throwIfNoEntry: false });
  if (!scriptStat) return { action: "error", message: `domain-rules: missing ${script.trim()}` };
  let realScript: string;
  try {
    realScript = fs.realpathSync(scriptPath);
  } catch {
    return { action: "error", message: `domain-rules: missing ${script.trim()}` };
  }
  if (realScript !== rootReal && !realScript.startsWith(rootReal + path.sep)) {
    return { action: "error", message: "domain-rules: script must stay inside the project" };
  }
  if (!fs.statSync(realScript).isFile()) {
    return { action: "error", message: `domain-rules: missing ${script.trim()}` };
  }
  return { action: "run", project, script: script.trim(), scriptPath: realScript };
}

export function executeDomainRules(
  decision: DomainDecision,
  options: { input?: string; inherit?: boolean } = {},
): { code: number; stderr: string } {
  if (decision.action === "skip") return { code: 0, stderr: "" };
  if (decision.action === "error") {
    if (options.inherit) process.stderr.write(`${decision.message}\n`);
    return { code: 2, stderr: decision.message };
  }
  const shell = decision.scriptPath.endsWith(".sh");
  const result = spawnSync(shell ? "bash" : decision.scriptPath, shell ? [decision.scriptPath] : [], {
    cwd: decision.project,
    env: { ...process.env, HARNESS_PROJECT_ROOT: decision.project },
    timeout: 30_000,
    encoding: "utf8",
    stdio: options.inherit ? "inherit" : "pipe",
    input: options.inherit ? undefined : options.input,
  });
  if (result.error) {
    const message = `domain-rules: ${result.error.message}`;
    if (options.inherit) process.stderr.write(`${message}\n`);
    return { code: 2, stderr: message };
  }
  const stderr = typeof result.stderr === "string" ? result.stderr : "";
  if (result.status === 0) return { code: 0, stderr };
  const message = stderr.trim() || `domain-rules: ${decision.script} exited ${result.status ?? "signal"}`;
  if (options.inherit && !stderr.trim()) process.stderr.write(`${message}\n`);
  return { code: 2, stderr: message };
}

const invoked = Boolean(process.argv[1])
  && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (invoked) {
  const result = executeDomainRules(decideDomainRules(process.cwd()), { inherit: true });
  process.exit(result.code);
}
