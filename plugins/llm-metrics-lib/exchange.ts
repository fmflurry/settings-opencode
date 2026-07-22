/**
 * SDK-INDEPENDENT request/response "exchange" extractor backing the details
 * pop-in (show the user's request next to the assistant's response for the
 * latest turn).
 *
 * The lib keeps its no-SDK-dependency invariant: this module declares its OWN
 * structural types (ExchangePart / ExchangeMessageInfo / ExchangeMessage /
 * ExchangeDetails) rather than importing the SDK's message shapes. The TUI
 * maps the SDK's `{ info, parts }` messages onto these before calling in.
 *
 * PURE (no imports, no side effects) and strict-clean.
 *
 * Contract (pinned by ./exchange.test.ts):
 *   joinTextParts — keeps ONLY parts with type === "text" that are NEITHER
 *                   synthetic NOR ignored; joins their `text` with "\n" in
 *                   order; [] => "".
 *   pickLatestExchange — selects the LAST message whose info.role ===
 *                   "assistant" (array order); resolves the request via the
 *                   assistant's parentID; null when there is no assistant.
 *   pickLatestRequestExchange — selects the LAST message whose info.role ===
 *                   "user" (array order) so the request is available as soon as
 *                   the user message exists (mid-stream safe); resolves the
 *                   response from the LAST assistant whose parentID === that
 *                   user's id (responseText "" while the reply is streaming);
 *                   null when there is no user message.
 */

/** A single message part (structural subset of the SDK's Part union). */
export interface ExchangePart {
  type: string;
  text?: string;
  synthetic?: boolean;
  ignored?: boolean;
}

/** A message's info (structural subset of the SDK's Message union). */
export interface ExchangeMessageInfo {
  id: string;
  role: string;
  parentID?: string;
  modelID?: string;
  providerID?: string;
  cost?: number;
}

/** One message: its info plus its ordered parts. */
export interface ExchangeMessage {
  info: ExchangeMessageInfo;
  parts: readonly ExchangePart[];
}

/** The extracted request/response exchange for the latest assistant turn. */
export interface ExchangeDetails {
  /** The user message id the request was resolved from; null when unresolved. */
  userMessageID: string | null;
  /** The assistant message id the exchange was extracted from. */
  assistantMessageID: string;
  /** Joined text of the parent (user) message; "" when unresolved. */
  requestText: string;
  /** Joined text of the assistant message. */
  responseText: string;
  /** Assistant model id ("" when the info omits it). */
  modelID: string;
  /** Assistant cost (0 when the info omits it). */
  cost: number;
}

/**
 * Join the human-readable text of a message: keep ONLY `type === "text"` parts
 * that are NEITHER synthetic NOR ignored, joining their `text` with "\n" in
 * order. Parts with no `text` contribute nothing. [] => "".
 */
export function joinTextParts(parts: readonly ExchangePart[]): string {
  const texts: string[] = [];
  for (const part of parts) {
    if (part.type !== "text") continue;
    if (part.synthetic === true) continue;
    if (part.ignored === true) continue;
    if (part.text === undefined) continue;
    texts.push(part.text);
  }
  return texts.join("\n");
}

/**
 * Extract the latest request/response exchange: select the LAST assistant
 * message (array order), join its text as the response, and resolve the request
 * from the message whose id equals the assistant's parentID. A missing parentID
 * OR a parentID pointing to an absent message both yield requestText === "" and
 * userMessageID === null. Returns null when there is no assistant message (incl.
 * empty input).
 */
export function pickLatestExchange(
  messages: readonly ExchangeMessage[],
): ExchangeDetails | null {
  let assistant: ExchangeMessage | null = null;
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.info.role === "assistant") {
      assistant = msg;
      break;
    }
  }
  if (assistant === null) return null;

  const responseText = joinTextParts(assistant.parts);

  let requestText = "";
  let userMessageID: string | null = null;
  const parentID = assistant.info.parentID;
  if (parentID !== undefined) {
    const parent = messages.find((m) => m.info.id === parentID);
    if (parent !== undefined) {
      requestText = joinTextParts(parent.parts);
      userMessageID = parentID;
    }
  }

  return {
    userMessageID,
    assistantMessageID: assistant.info.id,
    requestText,
    responseText,
    modelID: assistant.info.modelID ?? "",
    cost: assistant.info.cost ?? 0,
  };
}

/**
 * The extracted latest request (user prompt) and its assistant response, keyed
 * off the USER message so the request is showable mid-stream (unlike
 * `pickLatestExchange`, which keys off the assistant message and is blank until
 * the reply has content).
 */
export interface RequestExchangeDetails {
  /** The user message id the request was resolved from. */
  userMessageID: string;
  /** Joined text of the user (request) message. */
  requestText: string;
  /** The assistant message id responding to the user; null when none exists yet. */
  assistantMessageID: string | null;
  /** Joined text of the assistant response; "" when absent or still streaming. */
  responseText: string;
  /** Assistant model id ("" when absent or the info omits it). */
  modelID: string;
  /** Assistant cost (0 when absent or the info omits it). */
  cost: number;
}

/**
 * Extract the latest request/response exchange keyed off the USER message:
 * select the LAST user message (array order) and join its text as the request
 * (available the moment the user message exists, independent of the reply).
 * Resolve the response from the LAST assistant message whose parentID equals the
 * user message's id (its text accumulates across the turn's steps; "" while the
 * reply is still streaming). When no such assistant exists yet, assistantMessageID
 * is null and responseText/modelID/cost are ""/""/0. Returns null when there is
 * no user message (incl. empty input).
 */
export function pickLatestRequestExchange(
  messages: readonly ExchangeMessage[],
): RequestExchangeDetails | null {
  let user: ExchangeMessage | null = null;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].info.role === "user") {
      user = messages[i];
      break;
    }
  }
  if (user === null) return null;

  const requestText = joinTextParts(user.parts);

  let assistant: ExchangeMessage | null = null;
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.info.role === "assistant" && msg.info.parentID === user.info.id) {
      assistant = msg;
      break;
    }
  }

  if (assistant === null) {
    return {
      userMessageID: user.info.id,
      requestText,
      assistantMessageID: null,
      responseText: "",
      modelID: "",
      cost: 0,
    };
  }

  return {
    userMessageID: user.info.id,
    requestText,
    assistantMessageID: assistant.info.id,
    responseText: joinTextParts(assistant.parts),
    modelID: assistant.info.modelID ?? "",
    cost: assistant.info.cost ?? 0,
  };
}
