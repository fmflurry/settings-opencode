/**
 * Heuristic: does this user message look like a substantive code question
 * that would benefit from a Context Pack?
 *
 * False positives are cheap (one extra retrieval). False negatives are bad
 * (the agent flies blind). Bias toward true: short follow-ups like "yes" or
 * "continue" are filtered; anything else with code-shaped tokens triggers.
 */

const MIN_LENGTH = 24;

const FOLLOWUP_TERMS: ReadonlySet<string> = new Set([
  "yes",
  "no",
  "ok",
  "okay",
  "continue",
  "go",
  "proceed",
  "thanks",
  "thank you",
  "done",
  "stop",
  "wait",
  "pause",
  "next",
  "sure",
  "great",
  "perfect",
  "nice",
  "good",
]);

const CODE_VERBS: ReadonlyArray<RegExp> = [
  /\b(refactor|implement|fix|debug|optimize|rewrite|extract|inline|rename|migrate|port|wire|hook|add|remove|delete|update|enable|disable|configure|test|review|design|build|deploy|trace)\b/i,
  /\b(why|how|where|what|which)\b.*\b(does|do|is|are|was|were|should|could|would|works?|fails?|breaks?|returns?|calls?|uses?|implements?)\b/i,
];

const CODE_SHAPED: ReadonlyArray<RegExp> = [
  /[a-z][A-Za-z0-9]+\.[a-zA-Z][A-Za-z0-9]*\(/, // foo.bar(
  /[A-Z][A-Za-z0-9]*[a-z][A-Za-z0-9]*/, // PascalCase (heuristic)
  /[a-z][A-Za-z0-9]+_[a-z][A-Za-z0-9_]*/, // snake_case_ident
  /\b\w+\/\w+/, // path/segments
  /\.(ts|tsx|js|jsx|py|rs|go|java|kt|cs|cpp|c|h|hpp|rb|php|swift|sql|yml|yaml|toml|json)\b/i,
  /`[^`]+`/, // backticked symbol
  /\b\w+::\w+\b/, // module::symbol
];

export function isSubstantiveCodeIntent(text: string | null | undefined): boolean {
  if (!text) return false;
  const trimmed = text.trim();
  if (trimmed.length === 0) return false;

  // Follow-up acks: short, single-word affirmatives.
  const lowered = trimmed.toLowerCase();
  if (FOLLOWUP_TERMS.has(lowered)) return false;

  if (trimmed.length < MIN_LENGTH) {
    // Short message — only accept if it looks code-shaped (a symbol/path).
    return CODE_SHAPED.some((re) => re.test(trimmed));
  }

  if (CODE_SHAPED.some((re) => re.test(trimmed))) return true;
  if (CODE_VERBS.some((re) => re.test(trimmed))) return true;

  // Long but generic: still retrieve — relevance scoring filters noise.
  return trimmed.length >= 80;
}

export function extractQueryFromMessage(text: string): string {
  // Truncate huge prompts so the embedding call stays bounded.
  const collapsed = text.replace(/\s+/g, " ").trim();
  return collapsed.length > 480 ? collapsed.slice(0, 480) : collapsed;
}
