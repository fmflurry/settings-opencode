/**
 * Contract tests for the SDK-INDEPENDENT request/response "exchange" extractor
 * (`./exchange.ts`) that backs the details pop-in (show the user's request next
 * to the assistant's response for the latest turn).
 *
 * The lib keeps its no-SDK-dependency invariant: this module declares its OWN
 * structural types (ExchangePart / ExchangeMessageInfo / ExchangeMessage /
 * ExchangeDetails) rather than importing the SDK's message shapes.
 *
 * Pinned API:
 *   joinTextParts(parts: readonly ExchangePart[]): string
 *     - keeps ONLY parts with type === "text" that are NEITHER synthetic NOR
 *       ignored; joins their `text` with "\n" in order; [] => "".
 *   pickLatestExchange(messages: readonly ExchangeMessage[]): ExchangeDetails | null
 *     - selects the LAST message whose info.role === "assistant" (array order);
 *       assistantMessageID = that message's info.id;
 *       responseText = joinTextParts(its parts);
 *       requestText  = joinTextParts(parts of the message whose info.id ===
 *                      assistant.info.parentID); userMessageID = that id, or null
 *                      when no such message exists (missing target OR no parentID);
 *       modelID = assistant.info.modelID ?? ""; cost = assistant.info.cost ?? 0;
 *       null when there is no assistant message (incl. empty input).
 *
 * RED phase: `./exchange.ts` does not exist yet — this file fails to load
 * ("Cannot find module './exchange.ts'") until the implementer adds it. It lives
 * in its own file (repo RED convention) so the missing module cannot take down
 * the established suites.
 *
 * Contract decisions (where the spec left a choice):
 *   1. "Last assistant" is by ARRAY ORDER (the final element with role
 *      "assistant"), matching the SDK's chronological message ordering.
 *   2. A part is excluded when synthetic === true OR ignored === true (either
 *      flag alone skips it); a part with NEITHER flag is kept.
 *   3. A missing parentID and a parentID that points to an absent message BOTH
 *      yield requestText === "" and userMessageID === null (the spec's "null if
 *      not found" covers both; the no-parentID edge is pinned explicitly).
 *   4. modelID/cost fall back to ""/0 via ?? when the assistant info omits them,
 *      so the result is always a plain string/number (never undefined).
 *   5. A "text" part whose `text` is undefined is LEFT UNPINNED (the spec only
 *      exercises parts with concrete text); the implementer may choose.
 */

import { describe, expect, test } from "bun:test";
import { joinTextParts, pickLatestExchange, pickLatestRequestExchange } from "./exchange.ts";
import type {
  ExchangeDetails,
  ExchangeMessage,
  ExchangeMessageInfo,
  ExchangePart,
  RequestExchangeDetails,
} from "./exchange.ts";

// ── Builders (typed literals — no `any`) ─────────────────────────────────────

function textPart(
  text: string,
  flags: { synthetic?: boolean; ignored?: boolean } = {},
): ExchangePart {
  const part: ExchangePart = { type: "text", text };
  if (flags.synthetic !== undefined) part.synthetic = flags.synthetic;
  if (flags.ignored !== undefined) part.ignored = flags.ignored;
  return part;
}

/** A non-text part (e.g. "tool"); may carry text that must still be ignored. */
function partOfType(type: string, text?: string): ExchangePart {
  const part: ExchangePart = { type };
  if (text !== undefined) part.text = text;
  return part;
}

/** The optional info fields beyond the required id/role. */
type ExtraInfo = Omit<ExchangeMessageInfo, "id" | "role">;

function message(
  role: string,
  id: string,
  parts: readonly ExchangePart[],
  info: ExtraInfo = {},
): ExchangeMessage {
  return { info: { id, role, ...info }, parts };
}

const userMsg = (id: string, text: string): ExchangeMessage =>
  message("user", id, [textPart(text)]);

// ── joinTextParts ────────────────────────────────────────────────────────────

describe("joinTextParts", () => {
  test("joins multiple text parts with '\\n' in order", () => {
    const parts: readonly ExchangePart[] = [textPart("a"), textPart("b"), textPart("c")];
    expect(joinTextParts(parts)).toBe("a\nb\nc");
  });

  test("skips synthetic text parts", () => {
    const parts: readonly ExchangePart[] = [
      textPart("hidden", { synthetic: true }),
      textPart("shown"),
    ];
    expect(joinTextParts(parts)).toBe("shown");
  });

  test("skips ignored text parts", () => {
    const parts: readonly ExchangePart[] = [
      textPart("hidden", { ignored: true }),
      textPart("shown"),
    ];
    expect(joinTextParts(parts)).toBe("shown");
  });

  test("skips non-'text' parts (e.g. tool) even when they carry text", () => {
    const parts: readonly ExchangePart[] = [
      partOfType("tool", "tool output"),
      textPart("shown"),
    ];
    expect(joinTextParts(parts)).toBe("shown");
  });

  test("empty parts => ''", () => {
    expect(joinTextParts([])).toBe("");
  });

  test("all parts filtered out => ''", () => {
    const parts: readonly ExchangePart[] = [
      textPart("s", { synthetic: true }),
      partOfType("tool", "t"),
    ];
    expect(joinTextParts(parts)).toBe("");
  });
});

// ── pickLatestExchange ────────────────────────────────────────────────────────

describe("pickLatestExchange", () => {
  test("picks the LAST assistant message and resolves the request via parentID", () => {
    const messages: readonly ExchangeMessage[] = [
      userMsg("u1", "first question"),
      message("assistant", "a1", [textPart("first answer")], {
        parentID: "u1",
        modelID: "old-model",
        cost: 0.1,
      }),
      userMsg("u2", "second question"),
      message("assistant", "a2", [textPart("second answer")], {
        parentID: "u2",
        modelID: "claude-sonnet-4-6",
        cost: 0.5,
      }),
    ];

    const details = pickLatestExchange(messages);
    expect(details).not.toBeNull();
    const d: ExchangeDetails = details!;
    // The LAST assistant (a2), NOT the earlier a1.
    expect(d.assistantMessageID).toBe("a2");
    expect(d.responseText).toBe("second answer");
    // Request resolved from the parent (u2)'s text parts.
    expect(d.userMessageID).toBe("u2");
    expect(d.requestText).toBe("second question");
    // Carries the assistant's model + cost.
    expect(d.modelID).toBe("claude-sonnet-4-6");
    expect(d.cost).toBe(0.5);
  });

  test("joins multiple response text parts with '\\n'", () => {
    const messages: readonly ExchangeMessage[] = [
      userMsg("u1", "q"),
      message("assistant", "a1", [textPart("line1"), textPart("line2")], {
        parentID: "u1",
        modelID: "m",
        cost: 0,
      }),
    ];
    expect(pickLatestExchange(messages)!.responseText).toBe("line1\nline2");
  });

  test("no assistant message => null (user-only and empty input)", () => {
    expect(pickLatestExchange([userMsg("u1", "hi")])).toBeNull();
    expect(pickLatestExchange([])).toBeNull();
  });

  test("assistant.parentID points to a MISSING message => requestText '' and userMessageID null", () => {
    const messages: readonly ExchangeMessage[] = [
      message("assistant", "a1", [textPart("response")], {
        parentID: "does_not_exist",
        modelID: "m",
        cost: 0.25,
      }),
    ];
    const d = pickLatestExchange(messages)!;
    expect(d.assistantMessageID).toBe("a1");
    expect(d.responseText).toBe("response");
    expect(d.requestText).toBe("");
    expect(d.userMessageID).toBeNull();
  });

  test("assistant with NO parentID => requestText '' and userMessageID null", () => {
    const messages: readonly ExchangeMessage[] = [
      message("assistant", "a1", [textPart("response")], { modelID: "m", cost: 0 }),
    ];
    const d = pickLatestExchange(messages)!;
    expect(d.requestText).toBe("");
    expect(d.userMessageID).toBeNull();
  });

  test("assistant with modelID/cost undefined => modelID '' and cost 0", () => {
    const messages: readonly ExchangeMessage[] = [
      userMsg("u1", "q"),
      message("assistant", "a1", [textPart("r")], { parentID: "u1" }),
    ];
    const d = pickLatestExchange(messages)!;
    expect(d.modelID).toBe("");
    expect(d.cost).toBe(0);
  });
});

// ── pickLatestRequestExchange ─────────────────────────────────────────────────
//
// Keyed off the LATEST USER message (not the assistant) so the request is
// showable the moment the user message exists — the mid-stream fix backing the
// details modal (the request renders immediately; the response fills in as it
// streams).

describe("pickLatestRequestExchange", () => {
  test("picks the LAST user message and resolves its assistant response", () => {
    const messages: readonly ExchangeMessage[] = [
      userMsg("u1", "first question"),
      message("assistant", "a1", [textPart("first answer")], {
        parentID: "u1",
        modelID: "old-model",
        cost: 0.1,
      }),
      userMsg("u2", "second question"),
      message("assistant", "a2", [textPart("second answer")], {
        parentID: "u2",
        modelID: "claude-sonnet-4-6",
        cost: 0.5,
      }),
    ];

    const details = pickLatestRequestExchange(messages);
    expect(details).not.toBeNull();
    const d: RequestExchangeDetails = details!;
    // The LAST user (u2), NOT the earlier u1.
    expect(d.userMessageID).toBe("u2");
    expect(d.requestText).toBe("second question");
    // Response resolved from the assistant whose parentID === u2.
    expect(d.assistantMessageID).toBe("a2");
    expect(d.responseText).toBe("second answer");
    expect(d.modelID).toBe("claude-sonnet-4-6");
    expect(d.cost).toBe(0.5);
  });

  test("mid-stream: user present but NO assistant yet => request shown, response empty", () => {
    // The KEY case: the user message exists, the reply has not produced an
    // assistant message yet. The request must still resolve.
    const messages: readonly ExchangeMessage[] = [userMsg("u1", "hello there")];
    const d = pickLatestRequestExchange(messages)!;
    expect(d.userMessageID).toBe("u1");
    expect(d.requestText).toBe("hello there");
    expect(d.assistantMessageID).toBeNull();
    expect(d.responseText).toBe("");
    expect(d.modelID).toBe("");
    expect(d.cost).toBe(0);
  });

  test("multi-step: resolves the assistant whose parentID is the user, NOT a chained continuation", () => {
    // During a multi-step turn the LAST assistant is a continuation step whose
    // parentID is the previous assistant (a1), and it may carry no text yet.
    // The response must come from a1 (parentID === u1), and the request must be
    // the USER prompt — not a1's own text (the bug pickLatestExchange exhibits).
    const messages: readonly ExchangeMessage[] = [
      userMsg("u1", "the actual prompt"),
      message("assistant", "a1", [textPart("partial answer")], {
        parentID: "u1",
        modelID: "m",
        cost: 0,
      }),
      message("assistant", "a2", [], { parentID: "a1", modelID: "m", cost: 0 }),
    ];
    const d = pickLatestRequestExchange(messages)!;
    expect(d.userMessageID).toBe("u1");
    expect(d.requestText).toBe("the actual prompt");
    expect(d.assistantMessageID).toBe("a1");
    expect(d.responseText).toBe("partial answer");
  });

  test("streaming partial response text is returned as-is", () => {
    const messages: readonly ExchangeMessage[] = [
      userMsg("u1", "q"),
      message("assistant", "a1", [textPart("line1"), textPart("line2")], {
        parentID: "u1",
        modelID: "m",
        cost: 0,
      }),
    ];
    expect(pickLatestRequestExchange(messages)!.responseText).toBe("line1\nline2");
  });

  test("no user message => null (assistant-only and empty input)", () => {
    const assistantOnly: readonly ExchangeMessage[] = [
      message("assistant", "a1", [textPart("r")], { parentID: "u1", modelID: "m", cost: 0 }),
    ];
    expect(pickLatestRequestExchange(assistantOnly)).toBeNull();
    expect(pickLatestRequestExchange([])).toBeNull();
  });

  test("user message with NO matching assistant parentID => assistant null, response empty", () => {
    // An assistant exists but its parentID points elsewhere (not at the user).
    const messages: readonly ExchangeMessage[] = [
      userMsg("u1", "q"),
      message("assistant", "a1", [textPart("r")], { parentID: "other", modelID: "m", cost: 0 }),
    ];
    const d = pickLatestRequestExchange(messages)!;
    expect(d.userMessageID).toBe("u1");
    expect(d.requestText).toBe("q");
    expect(d.assistantMessageID).toBeNull();
    expect(d.responseText).toBe("");
  });

  test("assistant with modelID/cost undefined => modelID '' and cost 0", () => {
    const messages: readonly ExchangeMessage[] = [
      userMsg("u1", "q"),
      message("assistant", "a1", [textPart("r")], { parentID: "u1" }),
    ];
    const d = pickLatestRequestExchange(messages)!;
    expect(d.modelID).toBe("");
    expect(d.cost).toBe(0);
  });
});
