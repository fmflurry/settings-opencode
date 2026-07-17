/** Compatibility surface retained while automatic extraction is disabled. */

export type ClaimKind =
  | "preference"
  | "decision"
  | "rejection"
  | "ownership"
  | "location";

export interface ClaimHit {
  readonly kind: ClaimKind;
  readonly snippet: string;
  readonly suggestion: string;
}

interface Pattern {
  readonly kind: ClaimKind;
  readonly re: RegExp;
  readonly suggestion: string;
}

export const PATTERNS: ReadonlyArray<Pattern> = [];

export function isPureQuestion(text: string | null | undefined): boolean {
  const trimmed = String(text ?? "").trim();
  if (!trimmed.endsWith("?")) return false;
  const stripped = trimmed.slice(0, -1);
  return !/[.!]/.test(stripped);
}

export function detectClaimIntent(text: unknown): ClaimHit | null {
  void text;
  return null;
}

export function formatClaimNudge(hit: ClaimHit): string {
  void hit;
  return "";
}
