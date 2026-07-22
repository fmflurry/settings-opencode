export interface SanitizedHeader {
  name: string;
  value: string;
  redacted: boolean;
  source: "request" | "response" | "error-response" | "plugin" | "model" | "unknown";
}

export interface TurnHeaderSnapshot {
  sessionID: string;
  userMessageID: string | null;
  assistantMessageID: string | null;
  providerID: string;
  modelID: string;
  createdAt: number;
  requestHeaders: readonly SanitizedHeader[];
  responseHeaders: readonly SanitizedHeader[];
  responseHeadersSource: "none" | "error";
}

const EXACT_SENSITIVE_HEADERS = new Set<string>([
  "authorization",
  "proxy-authorization",
  "x-api-key",
  "api-key",
  "apikey",
  "cookie",
  "set-cookie",
]);

const SENSITIVE_NAME_TOKENS = ["auth", "token", "secret", "signature", "api-key", "apikey"];

export function normalizeHeaderName(name: string): string {
  return name.trim().toLowerCase();
}

export function isSensitiveHeader(name: string): boolean {
  const normalized = normalizeHeaderName(name);
  if (EXACT_SENSITIVE_HEADERS.has(normalized)) return true;
  return SENSITIVE_NAME_TOKENS.some((token) => normalized.includes(token));
}

function stringifyHeaderValue(value: unknown): string {
  const raw = typeof value === "string" ? value : String(value);
  return raw.replace(/[\r\n]+/g, " ").trim();
}

export function sanitizeHeader(
  name: string,
  value: unknown,
  source: SanitizedHeader["source"] = "unknown",
): SanitizedHeader {
  const normalizedName = normalizeHeaderName(name);
  const redacted = isSensitiveHeader(normalizedName);

  return {
    name: normalizedName,
    value: redacted ? "<redacted>" : stringifyHeaderValue(value),
    redacted,
    source,
  };
}

export function sanitizeHeaderMap(
  input: Record<string, unknown> | readonly (readonly [string, unknown])[],
  source: SanitizedHeader["source"] = "unknown",
): SanitizedHeader[] {
  if (Array.isArray(input)) {
    return input.map(([name, value]) => sanitizeHeader(name, value, source));
  }

  return Object.entries(input).map(([name, value]) => sanitizeHeader(name, value, source));
}

export function mergeSanitizedHeaders(
  ...groups: readonly (readonly SanitizedHeader[])[]
): SanitizedHeader[] {
  const merged = new Map<string, SanitizedHeader>();

  for (const group of groups) {
    for (const entry of group) {
      const name = normalizeHeaderName(entry.name);
      merged.set(name, {
        ...entry,
        name,
      });
    }
  }

  return [...merged.values()];
}

function latestByCreatedAt<T extends TurnHeaderSnapshot>(snapshots: readonly T[]): T | null {
  let latest: T | null = null;

  for (const snapshot of snapshots) {
    if (latest === null || snapshot.createdAt >= latest.createdAt) {
      latest = snapshot;
    }
  }

  return latest;
}

export function selectLatestHeaderSnapshot(
  snapshots: readonly TurnHeaderSnapshot[],
  match: {
    sessionID: string;
    userMessageID?: string | null;
    assistantMessageID?: string | null;
  },
): TurnHeaderSnapshot | null {
  const sessionSnapshots = snapshots.filter((snapshot) => snapshot.sessionID === match.sessionID);
  if (sessionSnapshots.length === 0) return null;

  if (typeof match.assistantMessageID === "string") {
    const assistantMatches = sessionSnapshots.filter(
      (snapshot) => snapshot.assistantMessageID === match.assistantMessageID,
    );
    const latestAssistantMatch = latestByCreatedAt(assistantMatches);
    if (latestAssistantMatch !== null) return latestAssistantMatch;
  }

  if (typeof match.userMessageID === "string") {
    const userMatches = sessionSnapshots.filter(
      (snapshot) => snapshot.userMessageID === match.userMessageID,
    );
    const latestUserMatch = latestByCreatedAt(userMatches);
    if (latestUserMatch !== null) return latestUserMatch;
  }

  return latestByCreatedAt(sessionSnapshots);
}
