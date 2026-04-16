/**
 * Continuous-Learning v2 — Write Wire (OpenCode side)
 *
 * Captures tool.execute.before/after events and appends observations to the
 * shared homunculus store at ~/.claude/homunculus/projects/<id>/observations.jsonl.
 *
 * Mirrors ClaudeCode's observe.sh schema:
 *   { timestamp, event: "tool_start"|"tool_complete", tool, session,
 *     project_id, project_name, input? | output? }
 * and adds:
 *   { harness: "opencode" }
 *
 * Read-only paths: projects.json for project id resolution.
 * Write paths:
 *   observations.jsonl (append, rotate at 10 MB)
 *   observations.archive/observations-<ts>-<pid>.jsonl (on rotation)
 *
 * All failures are soft. In-process writes serialized via Promise chain.
 */

import { execFile as execFileCb } from "node:child_process";
import {
  appendFile,
  mkdir,
  readFile,
  realpath,
  rename,
  stat,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import type { Plugin } from "@opencode-ai/plugin";

const execFile = promisify(execFileCb);

const HOMUNCULUS_ROOT = path.join(os.homedir(), ".claude", "homunculus");
const PROJECTS_JSON = path.join(HOMUNCULUS_ROOT, "projects.json");

const MAX_FIELD_CHARS = 5000;
const ROTATE_THRESHOLD_BYTES = 10 * 1024 * 1024; // 10 MB
const HARNESS = "opencode";

// Secret scrubber — ported from ~/.claude/skills/continuous-learning-v2/hooks/observe.sh
// Matches key=value / key:value / key "value" with 8+ char high-entropy values.
const SECRET_RE =
  /(api[_-]?key|token|secret|password|authorization|credentials?|auth)(["'\s:=]+)([A-Za-z]+\s+)?([A-Za-z0-9_\-/.+=]{8,})/gi;

type LogLevel = "debug" | "info" | "warn" | "error";
type LogFn = (level: LogLevel, message: string) => Promise<void>;

interface ProjectContext {
  readonly id: string;
  readonly name: string;
  readonly dir: string;
  readonly archiveDir: string;
  readonly observationsFile: string;
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

async function resolveProject(
  directory: string,
  log: LogFn,
): Promise<ProjectContext | null> {
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
    await log("warn", `projects.json unreadable at ${PROJECTS_JSON}`);
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    await log("warn", `projects.json parse failed: ${errMsg(err)}`);
    return null;
  }
  if (!isRecord(parsed)) return null;

  for (const [id, entry] of Object.entries(parsed)) {
    if (!isRecord(entry)) continue;
    const root = getStringField(entry, "root");
    const name = getStringField(entry, "name") ?? id;
    if (!root) continue;
    const rootResolved = await tryRealpath(root);
    if (rootResolved && rootResolved === resolved) {
      const dir = path.join(HOMUNCULUS_ROOT, "projects", id);
      return {
        id,
        name,
        dir,
        archiveDir: path.join(dir, "observations.archive"),
        observationsFile: path.join(dir, "observations.jsonl"),
      };
    }
  }
  return null;
}

function scrubSecrets(value: string): string {
  return value.replace(
    SECRET_RE,
    (_match, key: string, sep: string, scheme: string | undefined, _token: string) => {
      return `${key}${sep}${scheme ?? ""}[REDACTED]`;
    },
  );
}

function stringifyAndTruncate(value: unknown): string {
  let s: string;
  if (typeof value === "string") {
    s = value;
  } else if (value === undefined || value === null) {
    s = "";
  } else {
    try {
      s = JSON.stringify(value);
    } catch {
      s = String(value);
    }
  }
  if (s.length > MAX_FIELD_CHARS) s = s.slice(0, MAX_FIELD_CHARS);
  return scrubSecrets(s);
}

function nowIsoZ(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function rotateIfTooLarge(
  ctx: ProjectContext,
  log: LogFn,
): Promise<void> {
  let size: number;
  try {
    const s = await stat(ctx.observationsFile);
    size = s.size;
  } catch {
    return;
  }
  if (size < ROTATE_THRESHOLD_BYTES) return;

  try {
    await mkdir(ctx.archiveDir, { recursive: true });
  } catch (err) {
    await log("warn", `archive mkdir failed: ${errMsg(err)}`);
    return;
  }

  const ts = new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "")
    .replace("T", "-");
  const archivePath = path.join(
    ctx.archiveDir,
    `observations-${ts}-${process.pid}.jsonl`,
  );

  try {
    await rename(ctx.observationsFile, archivePath);
    await log("info", `rotated observations to ${archivePath}`);
  } catch (err) {
    await log("warn", `rotate failed: ${errMsg(err)}`);
  }
}

interface WriteQueue {
  enqueue(line: string): Promise<void>;
}

function createWriteQueue(ctx: ProjectContext, log: LogFn): WriteQueue {
  let tail: Promise<void> = Promise.resolve();

  return {
    enqueue(line: string): Promise<void> {
      const task = tail.then(async () => {
        try {
          await mkdir(ctx.dir, { recursive: true });
          await rotateIfTooLarge(ctx, log);
          await appendFile(ctx.observationsFile, line + "\n", "utf8");
        } catch (err) {
          await log("warn", `append failed: ${errMsg(err)}`);
        }
      });
      tail = task;
      return task;
    },
  };
}

interface BaseObservationFields {
  readonly timestamp: string;
  readonly event: "tool_start" | "tool_complete";
  readonly tool: string;
  readonly session: string;
  readonly project_id: string;
  readonly project_name: string;
  readonly harness: string;
}

const InstinctObserverPlugin: Plugin = async ({ client, directory }) => {
  const log: LogFn = async (level, message) => {
    try {
      await client.app.log({
        body: { service: "instinct-observer", level, message },
      });
    } catch {
      // never let logging break observation
    }
  };

  const resolvedProject = await resolveProject(directory ?? "", log);
  if (!resolvedProject) {
    await log(
      "info",
      `disabled: could not resolve project for dir=${directory ?? "<none>"}`,
    );
    return {};
  }
  const project: ProjectContext = resolvedProject;

  const queue = createWriteQueue(project, log);

  await log(
    "info",
    `ready: writing to ${project.observationsFile} (project=${project.id})`,
  );

  const baseFields = (
    event: "tool_start" | "tool_complete",
    tool: string,
    sessionID: string,
  ): BaseObservationFields => ({
    timestamp: nowIsoZ(),
    event,
    tool,
    session: sessionID,
    project_id: project.id,
    project_name: project.name,
    harness: HARNESS,
  });

  return {
    "tool.execute.before": async (input, output) => {
      const obs = {
        ...baseFields("tool_start", input.tool, input.sessionID),
        input: stringifyAndTruncate(output.args),
      };
      try {
        await queue.enqueue(JSON.stringify(obs));
      } catch {
        // swallow; queue already logs
      }
    },

    "tool.execute.after": async (input, output) => {
      const obs = {
        ...baseFields("tool_complete", input.tool, input.sessionID),
        output: stringifyAndTruncate(output.output),
      };
      try {
        await queue.enqueue(JSON.stringify(obs));
      } catch {
        // swallow
      }
    },
  };
};

export default InstinctObserverPlugin;
