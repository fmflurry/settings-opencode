/**
 * Continuous-Learning v2 — Session-Start Digest
 *
 * Surfaces what the daemon learned since the last session by comparing the
 * current set of instinct files against a sentinel snapshot from the previous
 * session start. New or updated instincts are summarised in a small preamble
 * appended to the system prompt (separate from the always-on instinct preamble
 * produced by instinct-injector.ts).
 *
 * Lifecycle:
 *   plugin factory  → resolve project_id (same algorithm as injector)
 *                   → load sentinel from disk (last_check timestamp + known IDs)
 *                   → scan instinct dirs (project + global personal/inherited)
 *                   → compute set differences vs sentinel → digest
 *                   → write fresh sentinel back to disk
 *   chat.system.transform → push digest preamble (if non-empty)
 *
 * State file: ~/.config/opencode/.instinct-digest-state.json (gitignored).
 *
 * Read paths: ~/.claude/homunculus/{instincts/, projects/<id>/instincts/}
 * Write paths: state file only.
 *
 * All failures soft. If sentinel missing/corrupt → treat all current instincts
 * as already-seen (no digest on first run; sentinel rebuilt for next session).
 */

import { execFile as execFileCb } from "node:child_process";
import {
  readFile,
  readdir,
  realpath,
  stat,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import type { Plugin } from "@opencode-ai/plugin";

const execFile = promisify(execFileCb);

const HOMUNCULUS_ROOT = path.join(os.homedir(), ".claude", "homunculus");
const PROJECTS_JSON = path.join(HOMUNCULUS_ROOT, "projects.json");
const GLOBAL_INSTINCTS_ROOT = path.join(HOMUNCULUS_ROOT, "instincts");

const STATE_FILE = path.join(
  os.homedir(),
  ".config",
  "opencode",
  ".instinct-digest-state.json",
);

const MAX_DIGEST_ENTRIES = 5;

type LogLevel = "debug" | "info" | "warn" | "error";
type LogFn = (level: LogLevel, message: string) => Promise<void>;

interface InstinctSummary {
  readonly id: string;
  readonly relPath: string;
  readonly mtimeMs: number;
  readonly trigger: string;
  readonly action: string;
}

interface SentinelState {
  readonly last_check_iso: string;
  /** Map: relPath → mtimeMs at last check. */
  readonly seen: Readonly<Record<string, number>>;
}

interface Digest {
  readonly added: readonly InstinctSummary[];
  readonly updated: readonly InstinctSummary[];
}

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

async function resolveProjectId(directory: string): Promise<string | null> {
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
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
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
    let value = kv[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    fm[kv[1]] = value;
  }
  return { fm, body };
}

function extractAction(body: string): string | null {
  const match = body.match(/^##\s+Action\s*\r?\n([\s\S]*?)(?=^##\s|$)/m);
  if (!match) return null;
  return match[1].trim() || null;
}

async function summariseFile(
  fullPath: string,
  relPath: string,
): Promise<InstinctSummary | null> {
  let raw: string;
  let mtimeMs: number;
  try {
    const st = await stat(fullPath);
    mtimeMs = st.mtimeMs;
    raw = await readFile(fullPath, "utf8");
  } catch {
    return null;
  }
  const parsed = parseFrontmatter(raw);
  if (!parsed) return null;
  const { fm, body } = parsed;
  if (!fm.id || !fm.trigger) return null;
  const action = extractAction(body) ?? fm.trigger;
  return { id: fm.id, relPath, mtimeMs, trigger: fm.trigger, action };
}

async function scanDir(
  dir: string,
  relRoot: string,
): Promise<readonly InstinctSummary[]> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }
  const out: InstinctSummary[] = [];
  for (const entry of entries) {
    if (!entry.endsWith(".md")) continue;
    const fullPath = path.join(dir, entry);
    const relPath = path.posix.join(relRoot, entry);
    const summary = await summariseFile(fullPath, relPath);
    if (summary) out.push(summary);
  }
  return out;
}

async function scanAll(
  projectId: string | null,
): Promise<readonly InstinctSummary[]> {
  const tasks: Promise<readonly InstinctSummary[]>[] = [
    scanDir(path.join(GLOBAL_INSTINCTS_ROOT, "personal"), "global/personal"),
    scanDir(path.join(GLOBAL_INSTINCTS_ROOT, "inherited"), "global/inherited"),
  ];
  if (projectId) {
    const base = path.join(HOMUNCULUS_ROOT, "projects", projectId, "instincts");
    tasks.push(scanDir(path.join(base, "personal"), `project/personal`));
    tasks.push(scanDir(path.join(base, "inherited"), `project/inherited`));
  }
  const pools = await Promise.all(tasks);
  return pools.flat();
}

async function loadSentinel(): Promise<SentinelState | null> {
  let raw: string;
  try {
    raw = await readFile(STATE_FILE, "utf8");
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  const last = getStringField(parsed, "last_check_iso");
  const seen = parsed.seen;
  if (!last || !isRecord(seen)) return null;
  const seenNorm: Record<string, number> = {};
  for (const [k, v] of Object.entries(seen)) {
    if (typeof v === "number" && Number.isFinite(v)) {
      seenNorm[k] = v;
    }
  }
  return { last_check_iso: last, seen: seenNorm };
}

async function writeSentinel(
  current: readonly InstinctSummary[],
): Promise<void> {
  const seen: Record<string, number> = {};
  for (const s of current) seen[s.relPath] = s.mtimeMs;
  const state: SentinelState = {
    last_check_iso: new Date().toISOString(),
    seen,
  };
  try {
    await writeFile(STATE_FILE, JSON.stringify(state, null, 2), "utf8");
  } catch {
    // soft-fail; next session will treat all instincts as new
  }
}

function diffAgainstSentinel(
  current: readonly InstinctSummary[],
  sentinel: SentinelState,
): Digest {
  const added: InstinctSummary[] = [];
  const updated: InstinctSummary[] = [];
  for (const s of current) {
    const lastMtime = sentinel.seen[s.relPath];
    if (lastMtime === undefined) {
      added.push(s);
    } else if (s.mtimeMs > lastMtime + 1) {
      // +1 ms slack to absorb fs precision quirks
      updated.push(s);
    }
  }
  added.sort((a, b) => b.mtimeMs - a.mtimeMs);
  updated.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return { added, updated };
}

function formatDigest(digest: Digest, sinceIso: string): string | null {
  const total = digest.added.length + digest.updated.length;
  if (total === 0) return null;

  const lines: string[] = [
    `Recently learned (since ${sinceIso}):`,
  ];

  const fmtEntry = (label: string, s: InstinctSummary): string => {
    const action = s.action.replace(/\s+/g, " ").trim();
    const truncated = action.length > 140 ? action.slice(0, 137) + "..." : action;
    return `- [${label}] ${s.id}: ${truncated}`;
  };

  let count = 0;
  for (const s of digest.added) {
    if (count >= MAX_DIGEST_ENTRIES) break;
    lines.push(fmtEntry("new", s));
    count++;
  }
  for (const s of digest.updated) {
    if (count >= MAX_DIGEST_ENTRIES) break;
    lines.push(fmtEntry("updated", s));
    count++;
  }
  if (total > MAX_DIGEST_ENTRIES) {
    lines.push(`...and ${total - MAX_DIGEST_ENTRIES} more.`);
  }

  return lines.join("\n");
}

const InstinctDigestPlugin: Plugin = async ({ client, directory }) => {
  const log: LogFn = async (level, message) => {
    try {
      await client.app.log({
        body: { service: "instinct-digest", level, message },
      });
    } catch {
      // never let logging break digest
    }
  };

  const projectId = await resolveProjectId(directory ?? "");
  const current = await scanAll(projectId);
  const sentinel = await loadSentinel();

  let digestText: string | null = null;
  if (sentinel) {
    const digest = diffAgainstSentinel(current, sentinel);
    digestText = formatDigest(digest, sentinel.last_check_iso);
    if (digestText) {
      await log(
        "info",
        `digest: ${digest.added.length} new + ${digest.updated.length} updated since ${sentinel.last_check_iso}`,
      );
    } else {
      await log("info", `no new/updated instincts since ${sentinel.last_check_iso}`);
    }
  } else {
    await log("info", `first run, no sentinel — bootstrapping baseline`);
  }

  // Always refresh sentinel so next session diffs against now.
  await writeSentinel(current);

  return {
    "experimental.chat.system.transform": async (_input, output) => {
      if (!Array.isArray(output.system)) return;
      if (!digestText) return;
      output.system.push(digestText);
    },
  };
};

export default InstinctDigestPlugin;
