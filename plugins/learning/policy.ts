export const MAX_REVIEWER_RESPONSE_BYTES = 8_192;

const MAX_FIELD_LENGTH = 180;
const SENSITIVE_PATTERN = /(?:\b(?:sk-[a-z0-9_-]{6,}|gh[opsu]_[a-z0-9]{20,}|github_pat_[a-z0-9_]{20,}|akia[0-9a-z]{16}|eyj[a-z0-9_-]+\.[a-z0-9_-]+\.[a-z0-9_-]+)\b|-----begin [^-]+-----|\b(?:api[ _-]?key|password|secret|token|authorization|bearer|private key)\b|\b(?:iban\s*)?[a-z]{2}\d{2}(?:[ ]?\d{4}){3,7}\b|\b(?:\d[ -]*?){13,19}\b|[\w.+-]+@[\w.-]+\.[a-z]{2,}|\+?\d[\d .()-]{7,}\d|\b(?:customer|account|user)\s*(?:id|number)\b|\b(?:address|rue|street|avenue)\b.*\b\d{4,6}\b|https?:\/\/|(?:^|\s)(?:~\/|\/Users\/|\/home\/|[a-z]:\\)|\.\.(?:\/|\\)|<\/?tool[^>]*>|^\s*\[assistant\])/i;
const NAME_PATTERN = /\b(?:signed|name is)\s+[A-Z][a-z]+\s+[A-Z][a-z]+\b|\b[A-Z][a-z]+\s+[A-Z][a-z]+\b/;
const DISALLOWED_TARGET_PATTERN = /\b(?:config(?:uration)?|plugin|mcp|filesystem|file|path|install(?:er)?|shell)\b/i;

export type LearningSignalKind = "explicit-correction" | "repeated-preference";

export interface DirectPrompt {
  readonly captureId: string;
  readonly text: string;
  readonly occurredAt: number;
}

export interface VerifiedRecurringFriction {
  readonly key: string;
  readonly occurrences: number;
  readonly verifiedAt: number;
}

export interface LearningSignal {
  readonly kind: LearningSignalKind;
  /** A deterministic descriptor, never copied prose. */
  readonly summary: string;
  readonly occurredAt: number;
}

export interface CapturedDescriptor {
  readonly captureId: string;
  readonly signal: LearningSignal;
}

export interface SanitizedDirectPrompt {
  readonly text: string;
  readonly redacted: boolean;
}

export interface ReviewerProposal {
  readonly kind: "preference" | "skill" | "prompt";
  readonly title: string;
  readonly rationale: string;
  readonly change: string;
}

export interface ReviewerResponse {
  readonly proposals: readonly ReviewerProposal[];
}

export type ReviewerValidation = { readonly ok: true; readonly value: ReviewerResponse } | { readonly ok: false; readonly reason: string };

function containsSensitiveContent(value: string): boolean {
  return SENSITIVE_PATTERN.test(value) || NAME_PATTERN.test(value);
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/**
 * This guards the local capture boundary. It intentionally does not attempt to
 * redact and retain prose: an uncertain record is discarded as a whole.
 */
export function sanitizeDirectUserPrompt(value: unknown): SanitizedDirectPrompt {
  if (typeof value !== "string") return { text: "", redacted: true };
  if (/-----BEGIN [^-]+-----/i.test(value)) return { text: "", redacted: true };
  const retained = value.split(/\r?\n/).map(normalizeWhitespace).filter((line) => line.length > 0 && line.length <= MAX_FIELD_LENGTH && !containsSensitiveContent(line));
  const text = retained.join("\n");
  if (!text) return { text: "", redacted: true };
  return { text, redacted: text !== value.trim() };
}

function preferenceDescriptor(text: string): string | null {
  if (!/\b(?:prefer|keep|favor|favour|want)\b/i.test(text)) return null;
  const term = text.toLowerCase().match(/\b(?:terse|concise|brief|verbose|detailed|formal|informal)\b/)?.[0];
  if (!term) return null;
  const descriptors: Readonly<Record<string, string>> = {
    terse: "Prefer terse responses.",
    concise: "Prefer concise responses.",
    brief: "Prefer brief responses.",
    verbose: "Prefer verbose responses.",
    detailed: "Prefer detailed responses.",
    formal: "Prefer formal responses.",
    informal: "Prefer informal responses.",
  };
  return descriptors[term] ?? null;
}

function correctionDescriptor(text: string): string | null {
  const lower = text.toLowerCase();
  if (!/^(?:no|wrong|don't|do not)\b/.test(lower) && !/\b(?:instead of|rather than|not use|never use)\b/.test(lower)) return null;
  if (lower.includes("facade") && lower.includes("component")) return "Components use facades instead of use cases.";
  if (lower.includes("strict") && lower.includes("type")) return "Use strict typing.";
  return null;
}

function frictionDescriptor(key: string): string | null {
  const normalized = normalizeWhitespace(key).toLowerCase();
  return normalized === "test-command-failure" ? "Recurring test command failure." : null;
}

export function classifyEligibleSignals(input: {
  readonly prompts: readonly DirectPrompt[];
  readonly verifiedRecurringFriction: readonly VerifiedRecurringFriction[];
}): readonly LearningSignal[] {
  const signals: LearningSignal[] = [];
  const preferences = new Map<string, DirectPrompt[]>();

  const captureIds = new Set<string>();
  for (const prompt of input.prompts) {
    if (typeof prompt.captureId !== "string" || prompt.captureId.length === 0 || prompt.captureId.length > 128 || !Number.isFinite(prompt.occurredAt) || prompt.occurredAt <= 0 || captureIds.has(prompt.captureId)) continue;
    captureIds.add(prompt.captureId);
    const sanitized = sanitizeDirectUserPrompt(prompt.text);
    if (!sanitized.text) continue;
    const correction = correctionDescriptor(sanitized.text);
    if (correction) {
      signals.push({ kind: "explicit-correction", summary: correction, occurredAt: prompt.occurredAt });
      continue;
    }
    const preference = preferenceDescriptor(sanitized.text);
    if (preference) preferences.set(preference, [...(preferences.get(preference) ?? []), prompt]);
  }

  for (const [summary, occurrences] of preferences) {
    if (occurrences.length < 2) continue;
    const latest = occurrences.at(-1);
    if (latest) signals.push({ kind: "repeated-preference", summary, occurredAt: latest.occurredAt });
  }

  return signals.sort((left, right) => left.occurredAt - right.occurredAt);
}

export function describeCapturedPrompt(captureId: string, text: string, occurredAt: number): CapturedDescriptor | null {
  if (typeof captureId !== "string" || captureId.length === 0 || captureId.length > 128 || !Number.isFinite(occurredAt) || occurredAt <= 0) return null;
  const sanitized = sanitizeDirectUserPrompt(text);
  if (!sanitized.text) return null;
  const correction = correctionDescriptor(sanitized.text);
  if (correction) return { captureId, signal: { kind: "explicit-correction", summary: correction, occurredAt } };
  const preference = preferenceDescriptor(sanitized.text);
  return preference ? { captureId, signal: { kind: "repeated-preference", summary: preference, occurredAt } } : null;
}

function isSafeDescriptor(value: string): boolean {
  return [
    "Components use facades instead of use cases.",
    "Use strict typing.",
    "Prefer terse responses.",
    "Prefer concise responses.",
    "Prefer brief responses.",
    "Prefer verbose responses.",
    "Prefer detailed responses.",
    "Prefer formal responses.",
    "Prefer informal responses.",
  ].includes(value);
}

export function buildReviewerRequest(signals: readonly LearningSignal[]): { readonly signals: readonly Pick<LearningSignal, "kind" | "summary">[] } {
  return { signals: signals.filter((signal) => isSafeDescriptor(signal.summary)).map(({ kind, summary }) => ({ kind, summary })) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validField(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= MAX_FIELD_LENGTH && !containsSensitiveContent(value) && !/[\\/]/.test(value) && !DISALLOWED_TARGET_PATTERN.test(value);
}

export function validateReviewerResponse(value: unknown): ReviewerValidation {
  if (!isRecord(value) || Object.keys(value).length !== 1 || !Array.isArray(value.proposals)) return { ok: false, reason: "invalid response envelope" };
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > MAX_REVIEWER_RESPONSE_BYTES) return { ok: false, reason: "response too large" };
  if (value.proposals.length === 0 || value.proposals.length > 5) return { ok: false, reason: "invalid proposal count" };
  const proposals: ReviewerProposal[] = [];
  for (const candidate of value.proposals) {
    if (!isRecord(candidate) || Object.keys(candidate).length !== 4) return { ok: false, reason: "invalid proposal" };
    const { kind, title, rationale, change } = candidate;
    if ((kind !== "preference" && kind !== "skill" && kind !== "prompt") || !validField(title) || !validField(rationale) || !validField(change)) return { ok: false, reason: "unsafe proposal" };
    proposals.push({ kind, title: normalizeWhitespace(title), rationale: normalizeWhitespace(rationale), change: normalizeWhitespace(change) });
  }
  return { ok: true, value: { proposals } };
}

export function parseReviewerResponse(value: string): ReviewerValidation {
  if (new TextEncoder().encode(value).byteLength > MAX_REVIEWER_RESPONSE_BYTES) return { ok: false, reason: "response too large" };
  try {
    return validateReviewerResponse(JSON.parse(value) as unknown);
  } catch {
    return { ok: false, reason: "invalid JSON" };
  }
}

export interface LearningRuntimeGate {
  readonly endpoint: string | null;
  isEnabled(options?: { readonly probe?: (endpoint: string) => Promise<boolean> }): Promise<boolean>;
}

export interface LocalReviewerConfiguration {
  readonly executable: string;
  readonly executableHash: string;
  readonly modelArtifact: string;
  readonly modelArtifactHash: string;
}

function configuredPath(value: string | undefined): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > 4_096 || /[\u0000-\u001f\u007f-\u009f]/.test(value)) return null;
  const windowsPath = /^[A-Za-z]:\\(?:[^\\/:]+\\)*[^\\/:]+$/.test(value);
  const posixPath = /^\/(?:[^/]+\/)*[^/]+$/.test(value);
  if (!windowsPath && !posixPath) return null;
  const segments = value.replace(/^[A-Za-z]:\\|^\//, "").split(windowsPath ? "\\" : "/");
  return segments.every((segment) => segment !== "." && segment !== "..") ? value : null;
}

function configuredHash(value: string | undefined): string | null {
  return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value) ? value.toLowerCase() : null;
}

export function localReviewerConfiguration(env: Readonly<Record<string, string | undefined>>): LocalReviewerConfiguration | null {
  const executable = configuredPath(env.OPENCODE_LEARNING_REVIEWER_EXECUTABLE);
  const executableHash = configuredHash(env.OPENCODE_LEARNING_REVIEWER_EXECUTABLE_SHA256);
  const modelArtifact = configuredPath(env.OPENCODE_LEARNING_REVIEWER_MODEL_ARTIFACT);
  const modelArtifactHash = configuredHash(env.OPENCODE_LEARNING_REVIEWER_MODEL_SHA256);
  return executable && executableHash && modelArtifact && modelArtifactHash ? { executable, executableHash, modelArtifact, modelArtifactHash } : null;
}

export function createLearningRuntimeGate(env: Readonly<Record<string, string | undefined>>): LearningRuntimeGate {
  const reviewer = localReviewerConfiguration(env);
  const endpoint = reviewer?.executable ?? null;
  return {
    endpoint,
    async isEnabled(options = {}): Promise<boolean> {
      if (!endpoint) return false;
       const probe = options.probe ?? (async (): Promise<boolean> => false);
       return probe(endpoint);
    },
  };
}
