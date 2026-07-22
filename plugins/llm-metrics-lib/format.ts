/**
 * Node-free, SDK-independent number/label formatting helpers for the llm-metrics
 * UI: grouped token counts, dollar costs, and a clear main/sub session label.
 *
 * PURE (no imports, no side effects) and strict-clean. Backs the human-readable
 * figures in the sidebar so large token counts read at a glance (446,659 not
 * 446659) and every session row carries its FULL id with a main/sub marker.
 *
 * Contract (pinned by ./format.test.ts):
 *   formatNumber  — null/undefined/NaN/±Infinity => "-"; otherwise the INTEGER
 *                   part grouped with "," every 3 digits, any decimals preserved
 *                   verbatim (no rounding/padding).
 *   formatCost    — null/undefined/NaN/±Infinity => "-"; otherwise "$" + grouped
 *                   integer part + exactly `decimals` fractional digits (toFixed,
 *                   so it rounds AND zero-pads). decimals defaults to 4.
 *   formatSessionLabel — `${isRoot ? "main" : "sub"} · ${sessionID}` plus a
 *                   ` (${title})` hint when a non-empty title is present; the
 *                   FULL sessionID is used (never truncated).
 */

/** Insert "," every 3 digits of an integer-part string (US-style grouping). */
function groupInteger(intPart: string): string {
  return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

const SUBAGENT_TITLE_RE = /\(@([^\s)]+)\s+subagent\)/;

/**
 * Group the integer part of a finite numeric string while preserving any
 * fractional part verbatim. Handles a leading "-" sign (magnitude is grouped).
 */
function groupMagnitude(str: string): string {
  const negative = str.startsWith("-");
  const magnitude = negative ? str.slice(1) : str;
  const dot = magnitude.indexOf(".");
  const intPart = dot === -1 ? magnitude : magnitude.slice(0, dot);
  const fracPart = dot === -1 ? undefined : magnitude.slice(dot + 1);
  const grouped = groupInteger(intPart);
  const body = fracPart === undefined ? grouped : `${grouped}.${fracPart}`;
  return negative ? `-${body}` : body;
}

/**
 * Human-readable number: integer part grouped with "," every 3 digits, any
 * decimals preserved verbatim (no rounding). null/undefined/NaN/±Infinity => "-".
 */
export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "-";
  return groupMagnitude(String(value));
}

/**
 * Dollar cost: "$" + grouped integer part + exactly `decimals` fractional digits
 * (toFixed — rounds AND zero-pads). null/undefined/NaN/±Infinity => "-".
 */
export function formatCost(value: number | null | undefined, decimals = 4): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "-";
  return `$${groupMagnitude(value.toFixed(decimals))}`;
}

/**
 * Clear main/sub session label using the FULL sessionID (never truncated) plus
 * an optional ` (${title})` hint. Separator is " · " (space, middle-dot, space).
 */
export function formatSessionLabel(
  sessionID: string,
  title: string | undefined,
  isRoot: boolean,
): string {
  const marker = isRoot ? "main" : "sub";
  const hint = title !== undefined && title.length > 0 ? ` (${title})` : "";
  return `${marker} · ${sessionID}${hint}`;
}

export function deriveAgentLabel(input: {
  sessionID: string;
  title?: string;
  agent?: string;
  isRoot: boolean;
}): string {
  if (input.agent !== undefined && input.agent.trim().length > 0) return input.agent;

  const trimmedTitle = input.title?.trim();
  if (trimmedTitle !== undefined && trimmedTitle.length > 0) {
    const match = trimmedTitle.match(SUBAGENT_TITLE_RE);
    if (match?.[1] !== undefined && match[1].length > 0) return match[1];
  }

  if (input.isRoot) return "conductor";
  if (trimmedTitle !== undefined && trimmedTitle.length > 0) return trimmedTitle;
  return `…${input.sessionID.slice(-8)}`;
}

/**
 * Truncate a label to at most `max` chars, appending a 3-char "..." ellipsis
 * when it overflows (result length === max). Returns `value` UNCHANGED when it
 * already fits (value.length <= max) OR when `max < 4` (the ellipsis needs at
 * least one leading char of room, so sub-4 caps are a no-op). PURE.
 */
export function truncateLabel(value: string, max: number): string {
  if (value.length <= max || max < 4) return value;
  return value.slice(0, max - 3) + "...";
}
