import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin, PluginInput } from "@opencode-ai/plugin";
import {
  logNotification,
  markSubagentEnd,
  markSubagentStart,
  shouldDeliver,
  type NotificationLogEntry,
} from "./lib/notification-gate.ts";

const TITLE = "OpenCode";
const MESSAGE = "Conductor stopped — input may be needed";
const IPHONE_TITLE = TITLE;
const IPHONE_MESSAGE = MESSAGE;
const HOME_IPHONE_SCRIPT = process.env.HOME
  ? join(process.env.HOME, ".config", "opencode", "scripts", "notify-iphone.sh")
  : undefined;
const REPO_IPHONE_SCRIPT = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "scripts",
  "notify-iphone.sh",
);
const GLOBAL_SESSION_KEY = "__global__";
// Verified against node_modules/@opencode-ai/sdk/dist/{gen,v2/gen}/types.gen.d.ts:
// the legacy client emits "permission.updated" (Permission), the v2 client emits
// "permission.asked" (PermissionRequest). Neither SDK defines a "permission.v2.*"
// event; those two entries are kept only as defensive aliases in case a future
// server build uses that naming. Both real families can fire for the SAME prompt
// with two independently-minted `id`s, so dedupe below keys on the underlying
// tool invocation (messageID + callID) rather than on `id` — see
// permissionDedupeKey.
const PERMISSION_EVENTS = new Set([
  "permission.asked",
  "permission.updated",
  "permission.v2.asked",
  "permission.v2.updated",
]);

type SessionKey = string;

// Narrow local types matching the verified SDK shapes for question events.
// Both QuestionInfo and QuestionV2Info share the same fields we need.
interface QuestionInfoShape {
  question: string; // Complete question text — this is the notification title
  header: string;   // Very short label (max 30 chars) — used in body
  options: Array<{ label?: string; value?: string }>;
  multiple?: boolean;
  custom?: boolean;
}

interface QuestionEventProperties {
  id: string;
  sessionID: string;
  questions: Array<QuestionInfoShape>;
}

function iphoneScriptPath(): string {
  return (
    process.env.OPENCODE_NOTIFY_IPHONE_SCRIPT ||
    (HOME_IPHONE_SCRIPT && existsSync(HOME_IPHONE_SCRIPT)
      ? HOME_IPHONE_SCRIPT
      : REPO_IPHONE_SCRIPT)
  );
}

function osascriptNotification(title: string, message: string): string {
  return `display notification ${JSON.stringify(message)} with title ${JSON.stringify(title)}`;
}

function powershellString(value: unknown): string {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function stringProperty<T extends Record<string, unknown>>(
  obj: unknown,
  key: keyof T,
): string | undefined {
  return obj && typeof obj === "object" && typeof (obj as T)[key] === "string"
    ? (obj as T)[key] as string
    : undefined;
}

function sessionIDFrom(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;

  const properties = (value as { properties?: unknown }).properties;
  const info = properties && typeof properties === "object" ? properties : undefined;
  const session = (value as { session?: unknown }).session;

  const sessionID1 = stringProperty<{ sessionID?: string }>(value, "sessionID");
  if (sessionID1) return sessionID1;

  const sessionID2 = stringProperty<{ sessionID?: string }>(properties, "sessionID");
  if (sessionID2) return sessionID2;

  const sessionID3 = stringProperty<{ sessionID?: string }>(info, "sessionID");
  if (sessionID3) return sessionID3;

  return stringProperty<{ id?: string }>(session, "id");
}

function sessionKeyFrom(value: unknown): SessionKey {
  return sessionIDFrom(value) ?? GLOBAL_SESSION_KEY;
}

function messageUpdatedSessionID(event: unknown): string | undefined {
  return stringProperty<{ sessionID?: string }>(eventProperties(event).info, "sessionID");
}

function eventProperties(event: unknown): Record<string, unknown> {
  return (event as { properties?: unknown })?.properties && typeof (event as { properties: unknown }).properties === "object"
    ? (event as { properties: Record<string, unknown> }).properties
    : {};
}

function eventDedupeKey(event: unknown): string {
  const properties = eventProperties(event);
  const id =
    stringProperty<{ id?: string; permissionID?: string }>(properties, "id") ??
    stringProperty<{ id?: string; permissionID?: string }>(properties, "permissionID");

  return id
    ? `${sessionKeyFrom(event)}:${id}`
    : `${sessionKeyFrom(event)}:${(event as { type?: string })?.type ?? "unknown"}`;
}

// The legacy Permission shape (permission.updated) carries messageID/callID
// at the top level; the v2 PermissionRequest shape (permission.asked) nests
// them under an optional `tool` object. Reading both lets one identity
// function recognize the invocation a permission prompt is gating,
// regardless of which family reported it.
function permissionToolIdentity(
  properties: Record<string, unknown>,
): { messageID: string; callID: string } | undefined {
  const tool = (properties as { tool?: unknown }).tool;
  const messageID =
    stringProperty<{ messageID?: string }>(properties, "messageID") ??
    stringProperty<{ messageID?: string }>(tool, "messageID");
  const callID =
    stringProperty<{ callID?: string }>(properties, "callID") ??
    stringProperty<{ callID?: string }>(tool, "callID");

  return messageID && callID ? { messageID, callID } : undefined;
}

/**
 * Dedupe key for permission events. The legacy and v2 permission APIs mint
 * independent `id`s for the same underlying prompt, so `eventDedupeKey`
 * (which keys on `id`) lets one prompt fire twice — once per family. Keying
 * on the gated tool invocation (session + messageID + callID) instead is
 * invariant across both families and collapses them to one notification.
 * Falls back to `eventDedupeKey` when that identity isn't present, so a
 * permission event without a tool invocation still gets deduped by id.
 */
function permissionDedupeKey(event: unknown): string {
  const properties = eventProperties(event);
  const toolIdentity = permissionToolIdentity(properties);

  return toolIdentity
    ? `${sessionKeyFrom(event)}:${toolIdentity.messageID}:${toolIdentity.callID}`
    : eventDedupeKey(event);
}

function isHumanInterventionEvent(event: { type?: string }): boolean {
  return PERMISSION_EVENTS.has(event.type ?? "");
}

function extractPermissionContent(event: unknown): { title: string; message: string } {
  const properties = eventProperties(event);
  const session = sessionKeyFrom(event);
  const suffix = session === GLOBAL_SESSION_KEY ? "" : ` Session ${session.slice(0, 8)}.`;

  const title = stringProperty<{ title?: string; type?: string }>(properties, "title") ??
                stringProperty<{ title?: string; type?: string }>(properties, "type") ??
                "Permission request";
  const detail = stringProperty<{ detail?: string; description?: string }>(properties, "detail") ??
                 stringProperty<{ detail?: string; description?: string }>(properties, "description") ??
                 "";

  return {
    title: "OpenCode permission needed",
    message: detail ? `${title}: ${detail}${suffix}` : `${title.replace(/\.+$/, '')}${suffix}`,
  };
}

/**
 * Extract notification content from a question.asked or question.v2.asked event.
 * Title = fixed "OpenCode asked".
 * Body = the question text (truncated to 200 chars).
 */
function extractQuestionContent(
  properties: QuestionEventProperties,
): { title: string; message: string } {
  const questions = properties.questions;

  if (!Array.isArray(questions) || questions.length === 0) {
    return { title: "OpenCode asked", message: "Awaiting your answer" };
  }

  const rawBody =
    questions.length === 1
      ? questions[0].question
      : questions.map((q) => q.question).join(" — ");

  const message = rawBody.length > 200 ? rawBody.substring(0, 200) + "..." : rawBody;

  return { title: "OpenCode asked", message };
}

function extractCompletionContent(event: unknown): { title: string; message: string } | null {
  const properties = eventProperties(event);
  const info = properties.info;
  const session = sessionKeyFrom(event);
  const suffix = session === GLOBAL_SESSION_KEY ? "" : ` Session ${session.slice(0, 8)}.`;

  if (info && typeof info === "object") {
    const summary = (info as { summary?: unknown }).summary;
    if (summary && typeof summary === "object") {
      const summaryTitle = (summary as { title?: unknown }).title;
      if (summaryTitle && typeof summaryTitle === "string") {
        const displayText = summaryTitle.length > 100 ? summaryTitle.substring(0, 100) + "..." : summaryTitle;
        return {
          title: TITLE,
          message: `${displayText}${suffix}`,
        };
      }

      const summaryBody = (summary as { body?: unknown }).body;
      if (summaryBody && typeof summaryBody === "string") {
        const displayText = summaryBody.length > 100 ? summaryBody.substring(0, 100) + "..." : summaryBody;
        return {
          title: TITLE,
          message: `${displayText}${suffix}`,
        };
      }
    }
  }

  return null;
}

function buildDesktopNotifiers(
  $: PluginInput["$"],
  title: string,
  message: string,
): Array<() => Promise<unknown>> {
  switch (process.platform) {
    case "darwin":
      return [
        () => $`osascript -e ${osascriptNotification(title, message)}`,
        () => $`afplay /System/Library/Sounds/Glass.aiff`,
      ];
    case "linux":
      return [
        () => $`notify-send ${title} ${message}`,
        () => $`paplay /usr/share/sounds/freedesktop/stereo/complete.oga`,
      ];
    case "win32":
      return [
        () =>
          $`powershell -NoProfile -WindowStyle Hidden -Command ${`[System.Media.SystemSounds]::Asterisk.Play(); try { New-BurntToastNotification -Text ${powershellString(title)},${powershellString(message)} -ErrorAction Stop } catch {}`}`,
      ];
    default:
      return [];
  }
}

function buildIphoneNotifier(
  $: PluginInput["$"],
  title: string,
  message: string,
): (() => Promise<unknown>) | null {
  if (process.platform !== "darwin") return null;
  return () => $`${iphoneScriptPath()} ${title} ${message}`;
}

async function notify(
  $: PluginInput["$"],
  title: string,
  message: string,
  {
    iphone = false,
    event,
    notificationClass,
    sessionID,
  }: {
    iphone?: boolean;
    event?: string;
    notificationClass?: string;
    sessionID?: string;
  } = {},
): Promise<void> {
  const entry: NotificationLogEntry = {
    harness: "opencode",
    event: event ?? "notification",
    sessionID,
    notificationClass: notificationClass ?? "unknown",
    decision: "SENT-phase1",
    title,
  };

  logNotification(entry);

  if (!shouldDeliver(entry)) return;

  const notifiers = buildDesktopNotifiers($, title, message);

  if (iphone) {
    const iphoneNotifier = buildIphoneNotifier($, IPHONE_TITLE, IPHONE_MESSAGE);
    if (iphoneNotifier) notifiers.push(iphoneNotifier);
  }

  if (notifiers.length === 0) {
    return;
  }

  await Promise.all(
    notifiers.map(async (run) => {
      try {
        await run();
      } catch {
        // Platform tool missing or failed — ignore so OpenCode keeps running.
      }
    }),
  );
}

export const NotificationPlugin = (async ({ $ }: PluginInput) => {
  const hasSubstantiveToolWorkBySession = new Map<SessionKey, boolean>();
  const completedConductorMessages = new Set<string>();
  const notifiedHumanInterventionEvents = new Set<string>();
  // Root/child status per session, decided once from the first chat.message
  // that carries an agent name and never flipped afterward. A session with
  // no decision yet (or no agent-tagged message at all) defaults to root —
  // losing root status must never happen, since that would silence the
  // final completion notification entirely.
  const sessionRootStatus = new Map<SessionKey, boolean>();
  const isRootConductorSession = (sessionID: string | undefined): boolean =>
    sessionID !== undefined && (sessionRootStatus.get(sessionID) ?? true);
  // Sessions where a question is pending — set from question.asked/question.v2.asked
  // so that message.updated(finish:stop) can be suppressed (no spurious completion).
  const questionPendingBySession = new Set<SessionKey>();

  return {
    "chat.message": async ({ sessionID, agent }) => {
      if (!agent || sessionRootStatus.has(sessionID)) {
        return;
      }
      sessionRootStatus.set(sessionID, agent === "conductor");
    },

    // "tool.execute.before" fires AFTER message.updated(finish:stop) for the same
    // turn, so it CANNOT reliably send the question notification. Its only job here
    // is to set questionPendingBySession as a safety net for the rare case where
    // question.asked / question.v2.asked was not delivered in time.
    // The canonical question notification is sent exclusively from those events.
    //
    // Hook signature: (input: { tool, sessionID, callID }, output: { args }) => void
    "tool.execute.before": async (
      input: { tool: string; sessionID: string; callID: string },
      _output: unknown,
    ) => {
      if (input.tool === "task") {
        markSubagentStart(input.sessionID, input.callID);
      }

      if (input.tool !== "question") {
        return;
      }

      const sessionKey = input.sessionID ?? GLOBAL_SESSION_KEY;

      // Only mark as pending — do NOT call notify() here.
      // The question.asked/question.v2.asked event handler is the single notify path.
      questionPendingBySession.add(sessionKey);
    },

    "tool.execute.after": async (input: {
      tool: string;
      sessionID: string;
      callID: string;
      args: unknown;
    }) => {
      const key = input.sessionID ?? GLOBAL_SESSION_KEY;

      if (input.tool === "question") {
        // Question answered — clear the pending flag so the next conductor
        // completion (if any) is not incorrectly suppressed.
        questionPendingBySession.delete(key);
        // Don't count the question tool as substantive work — it would
        // trigger a spurious completion notification.
        return;
      }

      if (input.tool === "task") {
        markSubagentEnd(input.sessionID, input.callID);
      }

      hasSubstantiveToolWorkBySession.set(key, true);

      if (hasSubstantiveToolWorkBySession.size > 1000) {
        hasSubstantiveToolWorkBySession.clear();
      }
    },

    event: async (eventOrPayload: { event?: unknown } | unknown) => {
      // Unwrap the { event } wrapper that OpenCode passes to the event hook.
      const event = (eventOrPayload as { event?: unknown }).event ?? eventOrPayload;
      const eventType = (event as { type?: string })?.type;

      // ── Permission events ────────────────────────────────────────────────
      if (isHumanInterventionEvent(event as { type?: string })) {
        const key = permissionDedupeKey(event);
        if (notifiedHumanInterventionEvents.has(key)) return;

        notifiedHumanInterventionEvents.add(key);

        const { title, message } = extractPermissionContent(event);
        const permissionSessionID = sessionIDFrom(event);
        void notify($, title, message, {
          iphone: isRootConductorSession(permissionSessionID),
          event: eventType,
          notificationClass: "permission",
          sessionID: permissionSessionID,
        }).catch(() => {});

        if (notifiedHumanInterventionEvents.size > 1000) notifiedHumanInterventionEvents.clear();
        return;
      }

      // ── question.asked / question.v2.asked: question notification ─────────
      // These are the canonical events that carry the readable question text.
      // Both variants have the same properties shape (id, sessionID, questions[]).
      // Dedup by properties.id so only one notification fires per question.
      if (eventType === "question.asked" || eventType === "question.v2.asked") {
        const props = eventProperties(event);

        const questionID = stringProperty<{ id?: string }>(props, "id");
        const sessionID = stringProperty<{ sessionID?: string }>(props, "sessionID");
        const sessionKey = sessionID ?? GLOBAL_SESSION_KEY;
        const dedupeKey = questionID
          ? `question:${questionID}`
          : `question:${sessionKey}:${Date.now()}`;

        if (notifiedHumanInterventionEvents.has(dedupeKey)) return;
        notifiedHumanInterventionEvents.add(dedupeKey);

        // Mark pending so message.updated(finish:stop) suppresses the completion.
        questionPendingBySession.add(sessionKey);

        const rawQuestions = props.questions;
        const questions: Array<QuestionInfoShape> = Array.isArray(rawQuestions)
          ? (rawQuestions as Array<unknown>).filter(
              (q): q is QuestionInfoShape =>
                q !== null &&
                typeof q === "object" &&
                typeof (q as QuestionInfoShape).question === "string" &&
                typeof (q as QuestionInfoShape).header === "string",
            )
          : [];

        const { title, message } = extractQuestionContent({
          id: questionID ?? "",
          sessionID: sessionKey,
          questions,
        });

        void notify($, title, message, {
          iphone: isRootConductorSession(sessionID),
          event: eventType,
          notificationClass: "question",
          sessionID,
        }).catch(() => {});

        if (notifiedHumanInterventionEvents.size > 1000) notifiedHumanInterventionEvents.clear();
        return;
      }

      // ── message.updated: assistant completion ────────────────────────────
      if (eventType !== "message.updated") {
        return;
      }

      const properties = eventProperties(event);
      const info = properties.info;

      if ((info as { role?: string })?.role !== "assistant") {
        return;
      }

      const sessionKey = messageUpdatedSessionID(event);
      if (!sessionKey) {
        return;
      }

      if ((info as { finish?: string })?.finish !== "stop") {
        return;
      }

      // Suppress if a question is pending for this session.
      // This works because message.part.updated(pending) fires before
      // message.updated(finish:stop) in the event stream.
      // Clear immediately after consuming so the flag self-heals even when
      // tool.execute.after is missed (prevents permanent suppression).
      if (questionPendingBySession.has(sessionKey)) {
        questionPendingBySession.delete(sessionKey);
        return;
      }

      if (!hasSubstantiveToolWorkBySession.get(sessionKey)) {
        return;
      }

      const completedKey =
        typeof (info as { id?: string })?.id === "string"
          ? `${sessionKey}:${(info as { id: string }).id}`
          : null;

      if (completedKey !== null && completedConductorMessages.has(completedKey)) {
        return;
      }

      // Suppression now comes from the inflight subagent counter (see
      // shouldDeliver / markSubagentStart / markSubagentEnd), not from a
      // per-session "dispatched a task" heuristic — so reset unconditionally
      // for every session, root or child.
      hasSubstantiveToolWorkBySession.set(sessionKey, false);

      if (completedKey !== null) {
        completedConductorMessages.add(completedKey);
      }

      // Only the root conductor session's completion is user-facing. A
      // non-root (subagent) session finishing must produce no notification
      // of any kind — the top-level turn notifies once, after the last
      // subagent, via the inflight gate.
      if (!isRootConductorSession(sessionKey)) {
        return;
      }

      const completionContent = extractCompletionContent(event);
      const title = completionContent?.title ?? TITLE;
      const message = completionContent?.message ?? MESSAGE;

      void notify($, title, message, {
        iphone: true,
        event: eventType,
        notificationClass: "completion",
        sessionID: sessionKey,
      }).catch(() => {});
    },
  };
}) satisfies Plugin;
