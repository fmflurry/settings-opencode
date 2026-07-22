/**
 * Contract tests for PURE sanitized-header helpers (`./headers.ts`) used by the
 * llm-metrics plugin layer.
 *
 * Plugin feasibility is intentionally PARTIAL only:
 *   - request headers are best-effort from request-side hooks
 *   - response headers are only available from error responses
 *   - raw success-path response headers are unavailable
 *
 * The security-critical logic therefore lives in a pure helper module whose
 * behavior is pinned here FIRST.
 *
 * Pinned API:
 *   interface SanitizedHeader {
 *     name: string;          // normalized lowercase header name
 *     value: string;         // displayed value or "<redacted>"
 *     redacted: boolean;
 *     source: "request" | "response" | "error-response" | "plugin" | "model" | "unknown";
 *   }
 *
 *   interface TurnHeaderSnapshot {
 *     sessionID: string;
 *     userMessageID: string | null;
 *     assistantMessageID: string | null;
 *     providerID: string;
 *     modelID: string;
 *     createdAt: number;
 *     requestHeaders: readonly SanitizedHeader[];
 *     responseHeaders: readonly SanitizedHeader[];
 *     responseHeadersSource: "none" | "error";
 *   }
 *
 *   normalizeHeaderName(name: string): string
 *   isSensitiveHeader(name: string): boolean
 *   sanitizeHeader(name: string, value: unknown,
 *                  source?: SanitizedHeader["source"]): SanitizedHeader
 *   sanitizeHeaderMap(input: Record<string, unknown> |
 *                     readonly (readonly [string, unknown])[],
 *                     source?: SanitizedHeader["source"]): SanitizedHeader[]
 *   mergeSanitizedHeaders(...groups: readonly (readonly SanitizedHeader[])[]): SanitizedHeader[]
 *   selectLatestHeaderSnapshot(
 *     snapshots: readonly TurnHeaderSnapshot[],
 *     match: { sessionID: string; userMessageID?: string | null; assistantMessageID?: string | null },
 *   ): TurnHeaderSnapshot | null
 *
 * RED phase: `./headers.ts` does not exist yet — this file fails to load
 * ("Cannot find module './headers.ts'") until the implementer adds it. The
 * new contract lives in its own file so the missing module cannot take down the
 * established suites.
 *
 * Contract decisions (where the spec left a choice):
 *   1. Header-name normalization trims outer whitespace BEFORE lowercasing.
 *   2. Sensitive detection is token-based on the NORMALIZED lowercase name; the
 *      pinned low-risk examples remain readable.
 *   3. Newlines in sanitized values are flattened to a single line, but the
 *      exact replacement character/spacing is LEFT UNPINNED — only the
 *      single-line invariant is asserted.
 *   4. `sanitizeHeaderMap()` PRESERVES duplicate normalized names; dedupe is a
 *      separate responsibility of `mergeSanitizedHeaders()`.
 *   5. `mergeSanitizedHeaders()` is pinned to: dedupe by normalized `name`,
 *      LAST value wins across groups, final order = the first appearance index
 *      of each surviving name.
 *   6. `selectLatestHeaderSnapshot()` precedence is pinned to:
 *      assistantMessageID exact match > userMessageID exact match > latest by
 *      createdAt within the matching session.
 */

import { describe, expect, test } from "bun:test";
import {
  isSensitiveHeader,
  mergeSanitizedHeaders,
  normalizeHeaderName,
  sanitizeHeader,
  sanitizeHeaderMap,
  selectLatestHeaderSnapshot,
} from "./headers.ts";
import type { SanitizedHeader, TurnHeaderSnapshot } from "./headers.ts";

function header(
  name: string,
  value: string,
  redacted: boolean,
  source: SanitizedHeader["source"] = "unknown",
): SanitizedHeader {
  return { name, value, redacted, source };
}

interface SnapshotInput {
  sessionID?: string;
  userMessageID?: string | null;
  assistantMessageID?: string | null;
  createdAt?: number;
  requestHeaders?: readonly SanitizedHeader[];
  responseHeaders?: readonly SanitizedHeader[];
  responseHeadersSource?: TurnHeaderSnapshot["responseHeadersSource"];
  providerID?: string;
  modelID?: string;
}

function snapshot(input: SnapshotInput = {}): TurnHeaderSnapshot {
  return {
    sessionID: input.sessionID ?? "ses_1",
    userMessageID: input.userMessageID ?? null,
    assistantMessageID: input.assistantMessageID ?? null,
    providerID: input.providerID ?? "anthropic",
    modelID: input.modelID ?? "claude-sonnet-4-6",
    createdAt: input.createdAt ?? 1,
    requestHeaders: input.requestHeaders ?? [],
    responseHeaders: input.responseHeaders ?? [],
    responseHeadersSource: input.responseHeadersSource ?? "none",
  };
}

describe("normalizeHeaderName", () => {
  test("lowercases a canonical header name", () => {
    expect(normalizeHeaderName("Authorization")).toBe("authorization");
  });

  test("trims outer spaces before lowercasing", () => {
    expect(normalizeHeaderName(" X-API-Key ")).toBe("x-api-key");
  });
});

describe("isSensitiveHeader", () => {
  test("returns true for explicitly sensitive header names", () => {
    expect(isSensitiveHeader("authorization")).toBe(true);
    expect(isSensitiveHeader("proxy-authorization")).toBe(true);
    expect(isSensitiveHeader("x-api-key")).toBe(true);
    expect(isSensitiveHeader("api-key")).toBe(true);
    expect(isSensitiveHeader("apikey")).toBe(true);
    expect(isSensitiveHeader("cookie")).toBe(true);
    expect(isSensitiveHeader("set-cookie")).toBe(true);
  });

  test("returns true for case-insensitive token matches", () => {
    expect(isSensitiveHeader("X-Auth-Token")).toBe(true);
    expect(isSensitiveHeader("X-Session-Token")).toBe(true);
    expect(isSensitiveHeader("my-secret-key")).toBe(true);
    expect(isSensitiveHeader("x-signature")).toBe(true);
  });

  test("returns false for pinned low-risk header names", () => {
    expect(isSensitiveHeader("content-type")).toBe(false);
    expect(isSensitiveHeader("accept")).toBe(false);
    expect(isSensitiveHeader("user-agent")).toBe(false);
    expect(isSensitiveHeader("accept-encoding")).toBe(false);
  });
});

describe("sanitizeHeader", () => {
  test("redacts sensitive names and normalizes the output name", () => {
    expect(sanitizeHeader("Authorization", "Bearer secret", "request")).toEqual({
      name: "authorization",
      value: "<redacted>",
      redacted: true,
      source: "request",
    });
  });

  test("keeps low-risk names readable", () => {
    expect(sanitizeHeader("Content-Type", "application/json", "response")).toEqual({
      name: "content-type",
      value: "application/json",
      redacted: false,
      source: "response",
    });
  });

  test("defaults source to 'unknown'", () => {
    expect(sanitizeHeader("accept", "*/*")).toEqual({
      name: "accept",
      value: "*/*",
      redacted: false,
      source: "unknown",
    });
  });

  test("stringifies non-string values", () => {
    expect(sanitizeHeader("content-length", 123, "plugin")).toEqual({
      name: "content-length",
      value: "123",
      redacted: false,
      source: "plugin",
    });
    expect(sanitizeHeader("x-cache-hit", true, "plugin")).toEqual({
      name: "x-cache-hit",
      value: "true",
      redacted: false,
      source: "plugin",
    });
  });

  test("flattens newlines so the sanitized value is single-line", () => {
    const result = sanitizeHeader("x-debug", "a\nb\r\nc", "plugin");
    expect(result.name).toBe("x-debug");
    expect(result.redacted).toBe(false);
    expect(result.source).toBe("plugin");
    expect(result.value.includes("\n")).toBe(false);
    expect(result.value.includes("\r")).toBe(false);
  });
});

describe("sanitizeHeaderMap", () => {
  test("sanitizes every entry of a plain object", () => {
    expect(
      sanitizeHeaderMap(
        {
          Authorization: "Bearer secret",
          "Content-Type": "application/json",
        },
        "request",
      ),
    ).toEqual([
      {
        name: "authorization",
        value: "<redacted>",
        redacted: true,
        source: "request",
      },
      {
        name: "content-type",
        value: "application/json",
        redacted: false,
        source: "request",
      },
    ]);
  });

  test("sanitizes tuple arrays and preserves duplicate normalized names before merge", () => {
    const input: readonly (readonly [string, unknown])[] = [
      ["Authorization", "Bearer 1"],
      ["authorization", "Bearer 2"],
      ["accept", "*/*"],
    ];

    expect(sanitizeHeaderMap(input, "request")).toEqual([
      {
        name: "authorization",
        value: "<redacted>",
        redacted: true,
        source: "request",
      },
      {
        name: "authorization",
        value: "<redacted>",
        redacted: true,
        source: "request",
      },
      {
        name: "accept",
        value: "*/*",
        redacted: false,
        source: "request",
      },
    ]);
  });
});

describe("mergeSanitizedHeaders", () => {
  test("dedupes by normalized name, last value wins, final order follows first appearance of surviving names", () => {
    const group1: readonly SanitizedHeader[] = [
      header("content-type", "application/json", false, "request"),
      header("x-api-key", "<redacted>", true, "request"),
    ];
    const group2: readonly SanitizedHeader[] = [
      header("content-type", "text/plain", false, "plugin"),
      header("accept", "*/*", false, "request"),
    ];

    expect(mergeSanitizedHeaders(group1, group2)).toEqual([
      {
        name: "content-type",
        value: "text/plain",
        redacted: false,
        source: "plugin",
      },
      {
        name: "x-api-key",
        value: "<redacted>",
        redacted: true,
        source: "request",
      },
      {
        name: "accept",
        value: "*/*",
        redacted: false,
        source: "request",
      },
    ]);
  });
});

describe("selectLatestHeaderSnapshot", () => {
  test("same session + same userMessageID => later createdAt wins", () => {
    const early = snapshot({ sessionID: "ses_1", userMessageID: "u_1", createdAt: 10 });
    const late = snapshot({ sessionID: "ses_1", userMessageID: "u_1", createdAt: 20 });
    const otherSession = snapshot({ sessionID: "ses_other", userMessageID: "u_1", createdAt: 99 });

    expect(
      selectLatestHeaderSnapshot([early, late, otherSession], {
        sessionID: "ses_1",
        userMessageID: "u_1",
      }),
    ).toBe(late);
  });

  test("assistantMessageID exact match beats a later unrelated snapshot", () => {
    const assistantMatch = snapshot({
      sessionID: "ses_1",
      userMessageID: "u_1",
      assistantMessageID: "a_exact",
      createdAt: 10,
    });
    const laterUnrelated = snapshot({
      sessionID: "ses_1",
      userMessageID: "u_1",
      assistantMessageID: "a_other",
      createdAt: 50,
    });

    expect(
      selectLatestHeaderSnapshot([assistantMatch, laterUnrelated], {
        sessionID: "ses_1",
        assistantMessageID: "a_exact",
      }),
    ).toBe(assistantMatch);
  });

  test("without message IDs, selects the latest snapshot for the session only", () => {
    const older = snapshot({ sessionID: "ses_1", createdAt: 10 });
    const latest = snapshot({ sessionID: "ses_1", createdAt: 30 });
    const otherSession = snapshot({ sessionID: "ses_2", createdAt: 100 });

    expect(selectLatestHeaderSnapshot([older, latest, otherSession], { sessionID: "ses_1" })).toBe(
      latest,
    );
  });

  test("returns null when the session has no matching snapshots", () => {
    const onlyOtherSession = snapshot({ sessionID: "ses_other", createdAt: 1 });
    expect(selectLatestHeaderSnapshot([onlyOtherSession], { sessionID: "ses_missing" })).toBeNull();
  });

  test("round-trips an error-response snapshot with sanitized response headers", () => {
    const errorSnapshot = snapshot({
      sessionID: "ses_error",
      userMessageID: "u_err",
      assistantMessageID: "a_err",
      createdAt: 42,
      responseHeadersSource: "error",
      responseHeaders: sanitizeHeaderMap(
        [
          ["Set-Cookie", "session=abc"],
          ["Content-Type", "application/json"],
        ],
        "error-response",
      ),
    });

    const selected = selectLatestHeaderSnapshot([errorSnapshot], {
      sessionID: "ses_error",
      assistantMessageID: "a_err",
    });

    expect(selected).toEqual({
      sessionID: "ses_error",
      userMessageID: "u_err",
      assistantMessageID: "a_err",
      providerID: "anthropic",
      modelID: "claude-sonnet-4-6",
      createdAt: 42,
      requestHeaders: [],
      responseHeaders: [
        {
          name: "set-cookie",
          value: "<redacted>",
          redacted: true,
          source: "error-response",
        },
        {
          name: "content-type",
          value: "application/json",
          redacted: false,
          source: "error-response",
        },
      ],
      responseHeadersSource: "error",
    });
  });
});
