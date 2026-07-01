/**
 * Heuristic: does this user message contain a durable assertion that
 * the agent should consider asserting via codememory_assert_claim?
 *
 * Port of plugins/claude-code/scripts/lib/claim-intent.js — keep regex
 * patterns and behavior in sync. False positives (one extra reminder
 * line in the system prompt) are cheap; false negatives (silent claim
 * drop) are the bug we're fixing.
 */

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

export const PATTERNS: ReadonlyArray<Pattern> = [
  {
    kind: "preference",
    re: /\b(i|we)\s+(love|like|prefer|enjoy|favor|favour)\b[^.!?\n]{1,120}/i,
    suggestion: "prefers",
  },
  {
    kind: "preference",
    re: /\b(i|we)\s+(want|need|wanna|wish|would\s+like)\s+to\b[^.!?\n]{1,120}/i,
    suggestion: "wants-to",
  },
  {
    kind: "rejection",
    re: /\b(i|we)\s+(hate|dislike|reject|refuse|don'?t\s+(want|like|use)|won'?t\s+(use|ship|build))\b[^.!?\n]{1,120}/i,
    suggestion: "rejected",
  },
  {
    kind: "rejection",
    re: /\b(let'?s\s+not|we'?re\s+not\s+(using|doing|shipping|building))\b[^.!?\n]{1,120}/i,
    suggestion: "rejected",
  },
  {
    kind: "decision",
    re: /\b(we|our\s+(project|team|app|service))\s+(use|uses|using|deploy|deploys|deployed|run|runs|running)\b[^.!?\n]{1,120}/i,
    suggestion: "uses",
  },
  {
    kind: "ownership",
    re: /\b([A-Z][a-zA-Z]+|i|we)\s+own[s]?\b[^.!?\n]{1,120}/i,
    suggestion: "owns",
  },
  {
    kind: "location",
    re: /\b(lives?|located|sits?|is)\s+(at|in|under)\s+[`"']?[a-z0-9_\-./]+[`"']?/i,
    suggestion: "is-located-at",
  },
];

export function isPureQuestion(text: string | null | undefined): boolean {
  const trimmed = String(text ?? "").trim();
  if (!trimmed.endsWith("?")) return false;
  const stripped = trimmed.slice(0, -1);
  return !/[.!]/.test(stripped);
}

export function detectClaimIntent(text: unknown): ClaimHit | null {
  if (typeof text !== "string" || text.length === 0) return null;
  if (isPureQuestion(text)) return null;

  for (const { kind, re, suggestion } of PATTERNS) {
    const m = re.exec(text);
    if (m) {
      const snippet = String(m[0]).trim().replace(/\s+/g, " ");
      return { kind, snippet, suggestion };
    }
  }
  return null;
}

export function formatClaimNudge(hit: ClaimHit): string {
  return [
    "[code-memory] Durable user assertion detected — ACT BEFORE ANSWERING.",
    "",
    `Matched (${hit.kind}): "${hit.snippet}"`,
    `Suggested triple: user ${hit.suggestion} "<extracted object>"`,
    "",
    "DEFAULT ACTION: call codememory_assert_claim NOW, in the same response,",
    "BEFORE any other tool call or user-facing text.",
    "",
    "  codememory_assert_claim(",
    '    subject="user",',
    `    predicate="${hit.suggestion}",`,
    '    object="<extracted object>",',
    '    project="<project slug>",',
    '    evidence_span="<verbatim user quote>"',
    "  )",
    "",
    "DO NOT skip because:",
    "  - the fact is already in CLAUDE.md / AGENTS.md / code  (restatement",
    "    reinforces; assert with confidence=0.85)",
    '  - the wording is emotional ("love", "hate", "really want")  (sentiment',
    "    verbs ARE preference signals when paired with a noun/tech/pattern)",
    "  - the user is also asking a question in the same message  (handle BOTH:",
    "    assert first, then answer)",
    '  - you "are not sure of the scope"  (assert with the literal object the',
    "    user named; refine later if contradicted)",
    "",
    "SKIP ONLY if ALL of these hold:",
    '  - the sentence is hypothetical ("if we used X..."), counterfactual,',
    "    or a quoted third party",
    "  - OR the user is asking whether they should adopt X (question, not",
    "    assertion)",
    "  - OR the user explicitly retracts it in the same message",
    "  - OR a higher-confidence claim with the same subject+predicate+object",
    "    was asserted in this session (dedupe)",
    "",
    'If you skip, state ONE LINE in your response: "skipped claim: <reason>".',
    "Silent skips are a bug.",
  ].join("\n");
}
