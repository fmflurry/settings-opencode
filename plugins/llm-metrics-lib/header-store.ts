import { appendFileSync, chmodSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import type { SanitizedHeader, TurnHeaderSnapshot } from "./headers.ts";

const STORE_DIR = "llm-metrics-headers";
const FILE_MODE = 0o600;
const DIR_MODE = 0o700;

const HEADER_SOURCES: ReadonlySet<SanitizedHeader["source"]> = new Set([
  "request",
  "response",
  "error-response",
  "plugin",
  "model",
  "unknown",
]);

function isHeaderSource(value: unknown): value is SanitizedHeader["source"] {
  return typeof value === "string" && HEADER_SOURCES.has(value as SanitizedHeader["source"]);
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function ensureOwnerOnly(path: string, mode: number): void {
  try {
    chmodSync(path, mode);
  } catch {
    // Best-effort only; append/read paths remain usable even if chmod fails.
  }
}

function parseHeader(value: unknown): SanitizedHeader | null {
  const header = asObject(value);
  if (header === null) return null;

  const name = header["name"];
  const itemValue = header["value"];
  const redacted = header["redacted"];
  const source = header["source"];

  if (typeof name !== "string") return null;
  if (typeof itemValue !== "string") return null;
  if (typeof redacted !== "boolean") return null;
  if (!isHeaderSource(source)) return null;

  return {
    name,
    value: itemValue,
    redacted,
    source,
  };
}

function parseHeaderArray(value: unknown): SanitizedHeader[] | null {
  if (!Array.isArray(value)) return null;

  const headers: SanitizedHeader[] = [];
  for (const item of value) {
    const parsed = parseHeader(item);
    if (parsed === null) return null;
    headers.push(parsed);
  }

  return headers;
}

function parseSnapshot(value: unknown): TurnHeaderSnapshot | null {
  const snapshot = asObject(value);
  if (snapshot === null) return null;

  const sessionID = snapshot["sessionID"];
  const userMessageID = snapshot["userMessageID"];
  const assistantMessageID = snapshot["assistantMessageID"];
  const providerID = snapshot["providerID"];
  const modelID = snapshot["modelID"];
  const createdAt = snapshot["createdAt"];
  const requestHeaders = parseHeaderArray(snapshot["requestHeaders"]);
  const responseHeaders = parseHeaderArray(snapshot["responseHeaders"]);
  const responseHeadersSource = snapshot["responseHeadersSource"];

  if (typeof sessionID !== "string") return null;
  if (userMessageID !== null && typeof userMessageID !== "string") return null;
  if (assistantMessageID !== null && typeof assistantMessageID !== "string") return null;
  if (typeof providerID !== "string") return null;
  if (typeof modelID !== "string") return null;
  if (typeof createdAt !== "number" || !Number.isFinite(createdAt)) return null;
  if (requestHeaders === null) return null;
  if (responseHeaders === null) return null;
  if (responseHeadersSource !== "none" && responseHeadersSource !== "error") return null;

  return {
    sessionID,
    userMessageID,
    assistantMessageID,
    providerID,
    modelID,
    createdAt,
    requestHeaders,
    responseHeaders,
    responseHeadersSource,
  };
}

export function resolveHeaderStorePath(sessionID: string): string {
  return join(homedir(), "data", STORE_DIR, `${sessionID}.jsonl`);
}

export function appendHeaderSnapshot(snapshot: TurnHeaderSnapshot): void {
  const path = resolveHeaderStorePath(snapshot.sessionID);
  const dir = dirname(path);

  mkdirSync(dir, { recursive: true, mode: DIR_MODE });
  ensureOwnerOnly(dir, DIR_MODE);
  appendFileSync(path, `${JSON.stringify(snapshot)}\n`, { encoding: "utf8", mode: FILE_MODE });
  ensureOwnerOnly(path, FILE_MODE);
}

export function readHeaderSnapshots(sessionID: string): TurnHeaderSnapshot[] {
  let content: string;

  try {
    content = readFileSync(resolveHeaderStorePath(sessionID), "utf8");
  } catch {
    return [];
  }

  const snapshots: TurnHeaderSnapshot[] = [];
  const completeLines = content.endsWith("\n") ? content.slice(0, -1).split("\n") : content.split("\n").slice(0, -1);

  for (const line of completeLines) {
    if (line.trim() === "") continue;

    try {
      const parsed = parseSnapshot(JSON.parse(line) as unknown);
      if (parsed !== null) snapshots.push(parsed);
    } catch {
      // Skip malformed or partial lines.
    }
  }

  return snapshots;
}
