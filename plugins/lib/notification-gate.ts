import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

// Append-only trigger logger for the OpenCode notification plugin.
// Log-only: never affects notification delivery. Mirrors the TSV shape
// written by scripts/notify-log.sh so both harnesses share one log format.
//
// This module also implements the delivery gate (inflight tracking +
// debounce) using the SAME on-disk state as scripts/notify-gate.sh, so the
// Claude and OpenCode harnesses share one debounce window per session.

export type NotificationLogEntry = {
  readonly harness: string;
  readonly event: string;
  readonly sessionID?: string;
  readonly notificationClass: string;
  readonly decision: string;
  readonly inflightCount?: number;
  readonly title: string;
};

const DEFAULT_LOG_PATH = join(homedir(), ".claude", "logs", "notify.log");
const DEFAULT_STATE_DIR = join(homedir(), ".claude", "state", "notify");

function resolveLogPath(): string {
  return process.env.NOTIFY_LOG || DEFAULT_LOG_PATH;
}

function resolveStateDir(): string {
  return process.env.NOTIFY_STATE_DIR || DEFAULT_STATE_DIR;
}

const DEFAULT_INFLIGHT_TTL_SECONDS = 900;
const DEFAULT_DEBOUNCE_SECONDS = 90;

function resolvePositiveIntEnv(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

function resolveInflightTtlSeconds(): number {
  return resolvePositiveIntEnv("NOTIFY_INFLIGHT_TTL_SECONDS", DEFAULT_INFLIGHT_TTL_SECONDS);
}

function resolveDebounceSeconds(): number {
  return resolvePositiveIntEnv("NOTIFY_DEBOUNCE_SECONDS", DEFAULT_DEBOUNCE_SECONDS);
}

function sessionStateDir(sessionID: string): string {
  return join(resolveStateDir(), sessionID);
}

function inflightDirFor(sessionID: string): string {
  return join(sessionStateDir(sessionID), "inflight");
}

function lastSentPathFor(sessionID: string): string {
  return join(sessionStateDir(sessionID), "last-sent");
}

function countInflight(sessionID: string): number {
  try {
    const inflightDir = inflightDirFor(sessionID);
    if (!existsSync(inflightDir)) return 0;
    return readdirSync(inflightDir).length;
  } catch {
    return 0;
  }
}

/**
 * Record that a subagent (the "task" tool) has started running for this
 * session/call. Used by shouldDeliver() to suppress notifications while any
 * subagent is still in flight.
 */
export function markSubagentStart(sessionID: string, callID: string): void {
  try {
    const dir = inflightDirFor(sessionID);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, callID), "");
  } catch {
    // Swallow all IO errors — the gate must fail open, not crash the plugin.
  }
}

/**
 * Record that a previously-started subagent call has finished.
 */
export function markSubagentEnd(sessionID: string, callID: string): void {
  try {
    const filePath = join(inflightDirFor(sessionID), callID);
    if (existsSync(filePath)) unlinkSync(filePath);
  } catch {
    // Swallow all IO errors — the gate must fail open, not crash the plugin.
  }
}

/**
 * Prune inflight markers older than the TTL (a subagent that crashed without
 * clearing its marker must not permanently suppress notifications) and
 * return the count of markers still alive.
 */
function pruneInflight(sessionID: string): number {
  try {
    const inflightDir = inflightDirFor(sessionID);
    if (!existsSync(inflightDir)) return 0;

    const ttlMs = resolveInflightTtlSeconds() * 1000;
    const now = Date.now();
    let remaining = 0;

    for (const name of readdirSync(inflightDir)) {
      const entryPath = join(inflightDir, name);
      try {
        const { mtimeMs } = statSync(entryPath);
        if (now - mtimeMs > ttlMs) {
          unlinkSync(entryPath);
        } else {
          remaining += 1;
        }
      } catch {
        // Entry vanished mid-scan or is unreadable — ignore it.
      }
    }

    return remaining;
  } catch {
    return 0;
  }
}

/**
 * Delivery gate shared with scripts/notify-gate.sh (same on-disk paths and
 * env vars). Ordering:
 *   1. Prune stale inflight markers.
 *   2. If any subagent is still inflight and this isn't a permission
 *      notification, suppress.
 *   3. If we notified this session within the debounce window, suppress.
 *   4. Otherwise touch last-sent and allow delivery.
 *
 * Fails open on IO errors: a broken state dir must never permanently
 * silence notifications.
 */
export function shouldDeliver(entry: NotificationLogEntry): boolean {
  try {
    const sessionID = entry.sessionID ?? "";
    const inflightCount = pruneInflight(sessionID);

    if (inflightCount > 0 && entry.notificationClass !== "permission") {
      return false;
    }

    const lastSentPath = lastSentPathFor(sessionID);
    const debounceMs = resolveDebounceSeconds() * 1000;

    if (existsSync(lastSentPath)) {
      const { mtimeMs } = statSync(lastSentPath);
      if (Date.now() - mtimeMs < debounceMs) {
        return false;
      }
    }

    mkdirSync(dirname(lastSentPath), { recursive: true });
    writeFileSync(lastSentPath, "");
    return true;
  } catch {
    return true;
  }
}

function sanitizeTitle(title: string): string {
  return title.replace(/[\t\n\r]+/g, " ");
}

export function logNotification(entry: NotificationLogEntry): void {
  try {
    const sessionID = entry.sessionID ?? "";
    const inflightCount = entry.inflightCount ?? countInflight(sessionID);
    const logPath = resolveLogPath();

    mkdirSync(dirname(logPath), { recursive: true });

    const line = [
      new Date().toISOString(),
      entry.harness,
      entry.event,
      sessionID,
      entry.notificationClass,
      entry.decision,
      String(process.pid),
      String(process.ppid),
      String(inflightCount),
      sanitizeTitle(entry.title),
    ].join("\t");

    appendFileSync(logPath, `${line}\n`);
  } catch {
    // Swallow all IO errors — logging must never affect delivery.
  }
}
