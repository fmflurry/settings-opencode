/**
 * Contract tests for the node-free number/label formatting helpers (`./format.ts`).
 *
 * These back the human-readable figures in the llm-metrics UI: grouped token
 * counts, dollar costs, and a clear main/sub session label for the details
 * pop-in. PURE and SDK-independent (no imports beyond this module).
 *
 * Pinned API:
 *   formatNumber(value: number | null | undefined): string
 *     - null/undefined/NaN/±Infinity => "-"; otherwise the integer part grouped
 *       with "," every 3 digits, any decimals preserved verbatim (no rounding).
 *   formatCost(value: number | null | undefined, decimals?: number): string
 *     - decimals defaults to 4; null/undefined/NaN => "-"; otherwise "$" + the
 *       grouped integer part + exactly `decimals` fractional digits (toFixed, so
 *       it rounds AND zero-pads).
 *   formatSessionLabel(sessionID: string, title: string | undefined, isRoot: boolean): string
 *     - `${isRoot ? "main" : "sub"} · ${sessionID}${title ? ` (${title})` : ""}`;
 *       the FULL sessionID is used (never truncated).
 *
 * RED phase: `./format.ts` does not exist yet — this file fails to load
 * ("Cannot find module './format.ts'") until the implementer adds it. It lives
 * in its own file (repo RED convention) so the missing module cannot take down
 * the established suites.
 *
 * Contract decisions (where the spec left a choice):
 *   1. Grouping is US-style: "," every 3 digits of the INTEGER part only; the
 *      fractional part is never grouped.
 *   2. formatNumber PRESERVES whatever decimals the input already has (no
 *      rounding/padding); formatCost FIXES the fraction to `decimals` (toFixed).
 *   3. formatNumber pins ±Infinity => "-" (explicitly enumerated). formatCost
 *      pins NaN => "-" (per the contract prose) but ±Infinity for cost is LEFT
 *      UNPINNED (the spec only enumerates null/undefined/NaN for cost), so the
 *      implementer may choose there.
 *   4. The session-label separator is " · " (space, middle-dot U+00B7, space).
 *   5. An EMPTY title string is falsy under the contract formula (`title ? ...`)
 *      and is intentionally LEFT UNPINNED (the spec only exercises undefined and
 *      non-empty titles).
 */

import { describe, expect, test } from "bun:test";
import { formatCost, formatNumber, formatSessionLabel } from "./format.ts";

// ── formatNumber ─────────────────────────────────────────────────────────────

describe("formatNumber", () => {
  test("groups the integer part with ',' every 3 digits", () => {
    expect(formatNumber(1000)).toBe("1,000");
    expect(formatNumber(446659)).toBe("446,659");
    expect(formatNumber(1234567)).toBe("1,234,567");
  });

  test("leaves sub-1000 integers ungrouped", () => {
    expect(formatNumber(0)).toBe("0");
    expect(formatNumber(999)).toBe("999");
  });

  test("preserves decimals while grouping the integer part", () => {
    expect(formatNumber(44665.9)).toBe("44,665.9");
  });

  test("groups negative numbers (sign preserved, magnitude grouped)", () => {
    expect(formatNumber(-1234)).toBe("-1,234");
  });

  test("null / undefined / NaN / ±Infinity => '-'", () => {
    expect(formatNumber(null)).toBe("-");
    expect(formatNumber(undefined)).toBe("-");
    expect(formatNumber(Number.NaN)).toBe("-");
    expect(formatNumber(Number.POSITIVE_INFINITY)).toBe("-");
    expect(formatNumber(Number.NEGATIVE_INFINITY)).toBe("-");
  });
});

// ── formatCost ───────────────────────────────────────────────────────────────

describe("formatCost", () => {
  test("defaults to 4 decimals with a '$' prefix and grouped integer part", () => {
    expect(formatCost(0.0012)).toBe("$0.0012");
    expect(formatCost(1234.5678)).toBe("$1,234.5678");
  });

  test("zero pads to the default 4 decimals", () => {
    expect(formatCost(0)).toBe("$0.0000");
  });

  test("honors an explicit decimals argument (toFixed rounding/padding)", () => {
    expect(formatCost(1234.5, 2)).toBe("$1,234.50");
    expect(formatCost(1234, 0)).toBe("$1,234");
  });

  test("null / undefined / NaN => '-'", () => {
    expect(formatCost(null)).toBe("-");
    expect(formatCost(undefined)).toBe("-");
    expect(formatCost(Number.NaN)).toBe("-");
  });
});

// ── formatSessionLabel ───────────────────────────────────────────────────────

describe("formatSessionLabel", () => {
  const id = "ses_abc123";

  test("root session without title => 'main · <id>'", () => {
    expect(formatSessionLabel(id, undefined, true)).toBe("main · ses_abc123");
  });

  test("root session with title => 'main · <id> (<title>)'", () => {
    expect(formatSessionLabel(id, "T", true)).toBe("main · ses_abc123 (T)");
  });

  test("sub session without title => 'sub · <id>'", () => {
    expect(formatSessionLabel(id, undefined, false)).toBe("sub · ses_abc123");
  });

  test("sub session with title => 'sub · <id> (<title>)'", () => {
    expect(formatSessionLabel(id, "agent", false)).toBe("sub · ses_abc123 (agent)");
  });

  test("uses the FULL sessionID (never truncated)", () => {
    const long = "ses_" + "x".repeat(40);
    expect(formatSessionLabel(long, undefined, true)).toBe("main · " + long);
  });
});

// ── truncateLabel ────────────────────────────────────────────────────────────
//
// Pinned API (ADDS to ./format.ts):
//   truncateLabel(value: string, max: number): string
//     - value.length <= max  => value UNCHANGED.
//     - max < 4              => value UNCHANGED (guard — the "..." ellipsis is 3
//                               chars; truncating below 4 leaves no room for a
//                               leading char). Pinned with max = 3.
//     - otherwise            => value.slice(0, max - 3) + "..." (length === max).
//
// RED phase: `truncateLabel` is NOT yet exported from `./format.ts`. It is pulled
// via a DYNAMIC import inside each new test (rather than added to the static
// import block at the top) so THIS file still LOADS during RED. NOTE: the task
// brief suggested a static import would be safe here because format.ts exists —
// but Bun fails the WHOLE module on a missing NAMED export even when the module
// file exists (verified empirically: "SyntaxError: Export named 'X' not found"
// reds EVERY test in the file, 0 pass). A static import would therefore red the
// established formatNumber / formatCost / formatSessionLabel tests above,
// violating the "keep ALL existing tests green" constraint. The dynamic import
// confines the RED to ONLY the new tests below (failing with "truncateLabel is
// not a function") until the export lands — the same trick the sibling
// ./derive.hierarchy.test.ts uses for its not-yet-exported selectors.
//
// Contract decisions (where the spec left a choice):
//   1. max < 4 returns value UNCHANGED (pinned with max = 3): the 3-char "..."
//      ellipsis needs at least one leading char of room, so sub-4 caps are a no-op.
//   2. The boundary value.length === max is UNCHANGED — truncation is STRICT
//      (only value.length > max truncates).

describe("truncateLabel", () => {
  test("short (len < max) => unchanged", async () => {
    const { truncateLabel } = await import("./format.ts");
    expect(truncateLabel("abc", 10)).toBe("abc");
  });

  test("exact (len === max) => unchanged", async () => {
    const { truncateLabel } = await import("./format.ts");
    expect(truncateLabel("abcdefg", 7)).toBe("abcdefg");
  });

  test("len === max+1 => truncated to length max, ends with '...'", async () => {
    const { truncateLabel } = await import("./format.ts");
    const result = truncateLabel("abcdefgh", 7);
    expect(result).toHaveLength(7);
    expect(result.endsWith("...")).toBe(true);
  });

  test("long string => length max, ends with '...', starts with the leading slice", async () => {
    const { truncateLabel } = await import("./format.ts");
    const result = truncateLabel("abcdefghij", 7);
    expect(result).toBe("abcd...");
    expect(result).toHaveLength(7);
    expect(result.endsWith("...")).toBe(true);
    expect(result.startsWith("abcd")).toBe(true);
  });

  test("empty string => ''", async () => {
    const { truncateLabel } = await import("./format.ts");
    expect(truncateLabel("", 10)).toBe("");
  });

  test("max < 4 (e.g. 3) => returns value unchanged (guard)", async () => {
    const { truncateLabel } = await import("./format.ts");
    expect(truncateLabel("abcdefghij", 3)).toBe("abcdefghij");
  });
});

// ── deriveAgentLabel ─────────────────────────────────────────────────────────
//
// Pinned API (ADDS to ./format.ts):
//   deriveAgentLabel(input: {
//     sessionID: string;
//     title?: string;
//     agent?: string;
//     isRoot: boolean;
//   }): string;
//
// Priority:
//   1. explicit non-empty `agent` wins (preserve exact slug)
//   2. else regex extract from title `(@<agent> subagent)` => captured slug
//   3. else if `isRoot` => "conductor"
//   4. else if non-empty title => trimmed title
//   5. else fallback => `…${sessionID.slice(-8)}`
//
// RED phase: use DYNAMIC import so a missing named export does not red the whole
// file in Bun.

describe("deriveAgentLabel", () => {
  test("explicit agent wins over title/root => exact slug", async () => {
    const { deriveAgentLabel } = await import("./format.ts");

    expect(
      deriveAgentLabel({
        sessionID: "ses_1234567890abcdef",
        title: "Run reviewer no-op (@reviewer subagent)",
        agent: "code-reviewer",
        isRoot: true,
      }),
    ).toBe("code-reviewer");
  });

  test("regex title fallback extracts agent slug from '(@<agent> subagent)'", async () => {
    const { deriveAgentLabel } = await import("./format.ts");

    expect(
      deriveAgentLabel({
        sessionID: "ses_1234567890abcdef",
        title: "Run reviewer no-op (@reviewer subagent)",
        isRoot: false,
      }),
    ).toBe("reviewer");
  });

  test("root with no agent/title => conductor", async () => {
    const { deriveAgentLabel } = await import("./format.ts");

    expect(
      deriveAgentLabel({
        sessionID: "ses_1234567890abcdef",
        isRoot: true,
      }),
    ).toBe("conductor");
  });

  test("non-root with plain title and no regex => trimmed title", async () => {
    const { deriveAgentLabel } = await import("./format.ts");

    expect(
      deriveAgentLabel({
        sessionID: "ses_1234567890abcdef",
        title: "  plain helper title  ",
        isRoot: false,
      }),
    ).toBe("plain helper title");
  });

  test("no agent/title => …last8 fallback", async () => {
    const { deriveAgentLabel } = await import("./format.ts");
    const sessionID = "ses_1234567890abcdef";

    expect(
      deriveAgentLabel({
        sessionID,
        isRoot: false,
      }),
    ).toBe(`…${sessionID.slice(-8)}`);
  });
});
