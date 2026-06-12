/**
 * Continuous-Learning v2 — Read Wire (OpenCode side)
 *
 * Consumes the shared homunculus store at ~/.claude/homunculus and injects
 * high-confidence instincts into every OpenCode chat system prompt.
 *
 * Lifecycle:
 *   plugin factory  → resolve project_id from projects.json using the
 *                     opencode-provided `directory` input
 *                   → load instincts (project + personal + inherited)
 *                   → filter (confidence >= THRESHOLD)
 *                   → rank (project > personal > inherited; confidence DESC)
 *                   → cap at MAX_INJECTED
 *                   → format preamble once
 *   chat.system.transform → push preamble into system prompt
 *
 * Read-only against ~/.claude/homunculus. All failures are soft.
 *
 * Note: opencode does not reliably deliver `session.created` to plugin event
 * handlers, so this plugin does not rely on it. The plugin input `directory`
 * is sufficient because one opencode instance serves one project directory.
 */

import { execFile as execFileCb } from "node:child_process";
import { readFile, readdir, realpath } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import type { Plugin } from "@opencode-ai/plugin";

const execFile = promisify(execFileCb);

const HOMUNCULUS_ROOT = path.join(os.homedir(), ".claude", "homunculus");
const PROJECTS_JSON = path.join(HOMUNCULUS_ROOT, "projects.json");
const GLOBAL_INSTINCTS_ROOT = path.join(HOMUNCULUS_ROOT, "instincts");

const CONFIDENCE_THRESHOLD = 0.8;
const MAX_INJECTED = 10;

/**
 * Framework-specific domain tags. An instinct tagged with one of these is
 * relevant only when the current project actually uses that framework.
 * Untagged instincts (no domain) and generic-domain instincts (e.g. "workflow",
 * "git", "code-style") are always eligible.
 *
 * Each entry maps a domain to a stack-detection key. The injector checks the
 * project's package.json + filesystem hints to compute a Set<string> of stack
 * tags, then filters: framework-tagged instinct passes only if its domain
 * appears in that set.
 */
const FRAMEWORK_DOMAINS: ReadonlySet<string> = new Set([
  "angular",
  "react",
  "vue",
  "svelte",
  "nextjs",
  "nestjs",
  "django",
  "rails",
  "laravel",
  "spring",
  "flutter",
  "rust",
  "go",
  "python",
  "java",
  "kotlin",
  "csharp",
  "dotnet",
]);

type InstinctScope = "project" | "personal" | "inherited";

interface Instinct {
  readonly id: string;
  readonly trigger: string;
  readonly action: string;
  readonly confidence: number;
  readonly scope: InstinctScope;
  readonly domain?: string;
}

type LogLevel = "debug" | "info" | "warn" | "error";
type LogFn = (level: LogLevel, message: string) => Promise<void>;

const SCOPE_RANK: Readonly<Record<InstinctScope, number>> = {
  project: 0,
  personal: 1,
  inherited: 2,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getStringField(
  record: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}

function parseFrontmatter(
  raw: string,
): { fm: Record<string, string>; body: string } | null {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) return null;

  const [, fmRaw, body] = match;
  const fm: Record<string, string> = {};

  for (const line of fmRaw.split(/\r?\n/)) {
    const kv = line.match(/^([a-zA-Z0-9_-]+):\s*(.*)$/);
    if (!kv) continue;
    const key = kv[1];
    let value = kv[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    fm[key] = value;
  }

  return { fm, body };
}

function extractAction(body: string): string | null {
  const match = body.match(/^##\s+Action\s*\r?\n([\s\S]*?)(?=^##\s|$)/m);
  if (!match) return null;
  return match[1].trim() || null;
}

function parseInstinct(raw: string, scope: InstinctScope): Instinct | null {
  const parsed = parseFrontmatter(raw);
  if (!parsed) return null;

  const { fm, body } = parsed;
  const confidence = Number(fm.confidence);
  if (!fm.id || !fm.trigger || !Number.isFinite(confidence)) return null;

  const action = extractAction(body) ?? fm.trigger;

  return {
    id: fm.id,
    trigger: fm.trigger,
    action,
    confidence,
    scope,
    domain: fm.domain || undefined,
  };
}

async function loadInstinctDir(
  dir: string,
  scope: InstinctScope,
  log: LogFn,
): Promise<readonly Instinct[]> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }

  const instincts: Instinct[] = [];
  for (const entry of entries) {
    if (!entry.endsWith(".md")) continue;
    const fullPath = path.join(dir, entry);
    try {
      const raw = await readFile(fullPath, "utf8");
      const instinct = parseInstinct(raw, scope);
      if (instinct) {
        instincts.push(instinct);
      } else {
        await log("warn", `instinct-injector: skipped malformed ${fullPath}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await log("warn", `instinct-injector: read failed ${fullPath}: ${msg}`);
    }
  }
  return instincts;
}

async function tryRealpath(p: string): Promise<string | null> {
  try {
    return await realpath(p);
  } catch {
    return null;
  }
}

async function findGitRoot(dir: string): Promise<string | null> {
  try {
    const { stdout } = await execFile(
      "git",
      ["-C", dir, "rev-parse", "--show-toplevel"],
      { timeout: 2000 },
    );
    const trimmed = stdout.trim();
    return trimmed.length > 0 ? trimmed : null;
  } catch {
    return null;
  }
}

async function resolveProjectId(
  directory: string,
  log: LogFn,
): Promise<string | null> {
  if (!directory) return null;

  let resolved = await tryRealpath(directory);
  if (!resolved) return null;

  const gitRoot = await findGitRoot(resolved);
  if (gitRoot) {
    const gitResolved = await tryRealpath(gitRoot);
    if (gitResolved) resolved = gitResolved;
  }

  let raw: string;
  try {
    raw = await readFile(PROJECTS_JSON, "utf8");
  } catch {
    await log("warn", `instinct-injector: projects.json not readable at ${PROJECTS_JSON}`);
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await log("warn", `instinct-injector: projects.json parse failed: ${msg}`);
    return null;
  }

  if (!isRecord(parsed)) return null;

  for (const [id, entry] of Object.entries(parsed)) {
    if (!isRecord(entry)) continue;
    const root = getStringField(entry, "root");
    if (!root) continue;
    const rootResolved = await tryRealpath(root);
    if (rootResolved && rootResolved === resolved) return id;
  }

  return null;
}

/**
 * Detect framework/language tags for the project at `directory`. Best-effort
 * inspection of package.json deps and a few filesystem markers. Returns
 * lowercase tag strings matching FRAMEWORK_DOMAINS keys.
 */
async function detectStack(directory: string): Promise<ReadonlySet<string>> {
  const tags = new Set<string>();
  if (!directory) return tags;

  // package.json deps
  try {
    const pkgRaw = await readFile(path.join(directory, "package.json"), "utf8");
    const pkg = JSON.parse(pkgRaw) as unknown;
    if (isRecord(pkg)) {
      const allDeps: Record<string, unknown> = {};
      for (const key of ["dependencies", "devDependencies", "peerDependencies"]) {
        const block = pkg[key];
        if (isRecord(block)) Object.assign(allDeps, block);
      }
      const depNames = Object.keys(allDeps);
      const has = (needle: string): boolean =>
        depNames.some((d) => d.includes(needle));
      if (has("@angular/")) tags.add("angular");
      if (has("react") || has("react-dom")) tags.add("react");
      if (has("vue")) tags.add("vue");
      if (has("svelte")) tags.add("svelte");
      if (has("next")) tags.add("nextjs");
      if (has("@nestjs/")) tags.add("nestjs");
    }
  } catch {
    // no package.json or unreadable
  }

  // Filesystem markers
  const markers: ReadonlyArray<readonly [string, string]> = [
    ["pyproject.toml", "python"],
    ["requirements.txt", "python"],
    ["manage.py", "django"],
    ["Cargo.toml", "rust"],
    ["go.mod", "go"],
    ["pom.xml", "java"],
    ["build.gradle", "java"],
    ["build.gradle.kts", "kotlin"],
    ["pubspec.yaml", "flutter"],
    ["composer.json", "laravel"],
    ["Gemfile", "rails"],
  ];
  for (const [marker, tag] of markers) {
    try {
      await readFile(path.join(directory, marker), "utf8");
      tags.add(tag);
    } catch {
      // marker absent
    }
  }

  return tags;
}

function isRelevantToStack(
  instinct: Instinct,
  stack: ReadonlySet<string>,
): boolean {
  if (!instinct.domain) return true;
  if (!FRAMEWORK_DOMAINS.has(instinct.domain)) return true;
  return stack.has(instinct.domain);
}

async function loadAllInstincts(
  projectId: string | null,
  log: LogFn,
): Promise<readonly Instinct[]> {
  const tasks: Promise<readonly Instinct[]>[] = [
    loadInstinctDir(path.join(GLOBAL_INSTINCTS_ROOT, "personal"), "personal", log),
    loadInstinctDir(path.join(GLOBAL_INSTINCTS_ROOT, "inherited"), "inherited", log),
  ];

  if (projectId) {
    const base = path.join(HOMUNCULUS_ROOT, "projects", projectId, "instincts");
    tasks.push(loadInstinctDir(path.join(base, "personal"), "project", log));
    tasks.push(loadInstinctDir(path.join(base, "inherited"), "project", log));
  }

  const pools = await Promise.all(tasks);
  return pools.flat();
}

function selectInstincts(
  all: readonly Instinct[],
  stack: ReadonlySet<string>,
): readonly Instinct[] {
  const filtered = all.filter(
    (i) => i.confidence >= CONFIDENCE_THRESHOLD && isRelevantToStack(i, stack),
  );
  const sorted = [...filtered].sort((a, b) => {
    const scopeDelta = SCOPE_RANK[a.scope] - SCOPE_RANK[b.scope];
    if (scopeDelta !== 0) return scopeDelta;
    return b.confidence - a.confidence;
  });
  return sorted.slice(0, MAX_INJECTED);
}

function formatPreamble(instincts: readonly Instinct[]): string {
  if (instincts.length === 0) {
    return "Active instincts: (none above confidence threshold)";
  }

  const lines = instincts.map((i) => {
    const pct = Math.round(i.confidence * 100);
    const action = i.action.replace(/\s+/g, " ").trim();
    return `- [${i.scope} ${pct}%] ${i.trigger} → ${action}`;
  });

  return [
    "Active instincts (from continuous-learning v2 shared store):",
    ...lines,
  ].join("\n");
}

const InstinctInjectorPlugin: Plugin = async ({ client, directory }) => {
  const log: LogFn = async (level, message) => {
    // Fire-and-forget: awaiting client.app.log during plugin init deadlocks
    // the server (server waits for init before accepting requests).
    client.app
      .log({ body: { service: "instinct-injector", level, message } })
      .catch(() => {});
  };

  // Plugin lifetime is bound to one opencode instance, which is bound to one
  // project directory. Resolve instincts once at factory time, reuse for every
  // session/message. Avoids dependency on `session.created` (which is not
  // reliably delivered to plugin event handlers).
  const projectId = await resolveProjectId(directory ?? "", log);
  const stack = await detectStack(directory ?? "");
  const all = await loadAllInstincts(projectId, log);
  const selected = selectInstincts(all, stack);
  const preamble = formatPreamble(selected);

  const stackTags = stack.size > 0 ? [...stack].join(",") : "none";
  await log(
    "info",
    `ready: ${selected.length}/${all.length} instincts ` +
      `(project=${projectId ?? "global-only"}, stack=${stackTags}, ` +
      `dir=${directory ?? "<none>"})`,
  );

  return {
    "experimental.chat.system.transform": async (_input, output) => {
      if (!Array.isArray(output.system)) return;
      if (selected.length === 0) return;
      output.system.push(preamble);
    },
  };
};

export default InstinctInjectorPlugin;
