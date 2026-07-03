import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const TITLE = "OpenCode";
const MESSAGE = "Conductor stopped — input may be needed";
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
const PERMISSION_EVENTS = new Set([
  "permission.asked",
  "permission.updated",
  "permission.v2.asked",
  "permission.v2.updated",
]);

function iphoneScriptPath() {
  return (
    process.env.OPENCODE_NOTIFY_IPHONE_SCRIPT ||
    (HOME_IPHONE_SCRIPT && existsSync(HOME_IPHONE_SCRIPT)
      ? HOME_IPHONE_SCRIPT
      : REPO_IPHONE_SCRIPT)
  );
}

function osascriptNotification(title, message) {
  return `display notification ${JSON.stringify(message)} with title ${JSON.stringify(title)}`;
}

function powershellString(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function stringProperty(value, key) {
  return value && typeof value === "object" && typeof value[key] === "string"
    ? value[key]
    : undefined;
}

function sessionIDFrom(value) {
  if (!value || typeof value !== "object") return undefined;

  const properties = value.properties;
  const info = properties && typeof properties === "object" ? properties.info : undefined;
  const session = value.session;

  return (
    stringProperty(value, "sessionID") ??
    stringProperty(properties, "sessionID") ??
    stringProperty(info, "sessionID") ??
    stringProperty(session, "id")
  );
}

function sessionKeyFrom(value) {
  return sessionIDFrom(value) ?? GLOBAL_SESSION_KEY;
}

function eventProperties(event) {
  return event?.properties && typeof event.properties === "object"
    ? event.properties
    : {};
}

function eventDedupeKey(event) {
  const properties = eventProperties(event);
  const id =
    stringProperty(properties, "id") ??
    stringProperty(properties, "permissionID");

  return id
    ? `${sessionKeyFrom(event)}:${id}`
    : `${sessionKeyFrom(event)}:${event.type}`;
}

function toolCallIDFrom(input) {
  return stringProperty(input, "callID") ?? stringProperty(input, "callId");
}

function questionDedupeKey(input) {
  const callID = toolCallIDFrom(input);

  return callID ? `${sessionKeyFrom(input)}:${callID}` : undefined;
}

function isHumanInterventionEvent(event) {
  return PERMISSION_EVENTS.has(event.type);
}

function extractPermissionContent(event) {
  const properties = eventProperties(event);
  
  const title = stringProperty(properties, "title") ?? stringProperty(properties, "type") ?? "Permission request";
  const detail = stringProperty(properties, "detail") ?? stringProperty(properties, "description") ?? "";
  
  return {
    title: "OpenCode permission needed",
    message: detail ? `${title}: ${detail}` : `${title}.`,
  };
}

function extractQuestionContent(input) {
  const args = input?.args;
  const questions = args?.questions;
  
  if (Array.isArray(questions) && questions.length > 0) {
    const questionObj = questions[0];
    if (questionObj && typeof questionObj === "object") {
      const questionText =
        questionObj.question ??
        questionObj.text ??
        questionObj.prompt ??
        questionObj.message ??
        JSON.stringify(questionObj);
      
      if (questionText) {
        const displayText = typeof questionText === "string" && questionText.length > 100
          ? questionText.substring(0, 100) + "..."
          : questionText;
        return {
          title: "OpenCode needs input",
          message: displayText,
        };
      }
    }
  }
  
  return null;
}

function extractCompletionContent(event) {
  const properties = eventProperties(event);
  const info = properties?.info;

  // Try to get message content from summary.title or summary.body
  if (info && typeof info === "object") {
    const summary = info.summary;
    if (summary && typeof summary === "object") {
      // Try summary.title first
      const summaryTitle = summary.title;
      if (summaryTitle) {
        const displayText = typeof summaryTitle === "string" ? (summaryTitle.length > 100 ? summaryTitle.substring(0, 100) + "..." : summaryTitle) : "";
        return {
          title: TITLE,
          message: displayText,
        };
      }
      
      // Try summary.body second
      const summaryBody = summary.body;
      if (summaryBody) {
        const body = typeof summaryBody === "string" ? (summaryBody.length > 100 ? summaryBody.substring(0, 100) + "..." : summaryBody) : "";
        return {
          title: TITLE,
          message: body,
        };
      }
    }
  }
  
  return null;
}

/**
 * Build the list of desktop notification commands appropriate for the current OS.
 * Each entry returns a promise; failures are swallowed individually.
 *
 * @param {(strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>} $
 * @returns {Array<() => Promise<unknown>>}
 */
function buildDesktopNotifiers($, title, message) {
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

/**
 * Build the iPhone push notification command (macOS only, via Bark script).
 * Returns null on non-macOS so callers can skip gracefully.
 *
 * @param {(strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>} $
 * @returns {(() => Promise<unknown>) | null}
 */
function buildIphoneNotifier($, title, message) {
  if (process.platform !== "darwin") return null;
  return () => $`${iphoneScriptPath()} ${title} ${message}`;
}

/**
 * Run notification commands. Desktop notifiers always fire; iPhone notifier
 * fires only when the `iphone` option is true.
 *
 * @param {(strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>} $
 * @param {string} title
 * @param {string} message
 * @param {{ iphone?: boolean, iphoneTitle?: string, iphoneMessage?: string }} [options]
 */
async function notify(
  $,
  title,
  message,
  { iphone = false, iphoneTitle = title, iphoneMessage = message } = {},
) {
  const notifiers = buildDesktopNotifiers($, title, message);

  if (iphone) {
    const iphoneNotifier = buildIphoneNotifier($, iphoneTitle, iphoneMessage);
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

// Max entries for dedup Sets/Maps to prevent unbounded memory growth.
// When exceeded, the entire structure is cleared — worst case is a duplicate
// notification (harmless) or a missed dedup (one extra notify per session).
const MAX_DEDUP_SIZE = 2000;


// ── LRU caps: prevent unbounded growth over long-running sessions ─────
const MAX_MAP_SIZE = 500;
const MAX_SET_SIZE = 5000;

function evictOldestMap(map) {
  const first = map.keys().next();
  if (!first.done) map.delete(first.value);
}
function evictOldestSet(set) {
  const first = set.values().next();
  if (!first.done) set.delete(first.value);
}

export const NotificationPlugin = async ({ $ }) => {
  const hasSubstantiveToolWorkBySession = new Map();
  const dispatchedTaskBySession = new Map();
  const completedConductorMessages = new Set();
  const notifiedHumanInterventionEvents = new Set();

  return {
    "tool.execute.before": async (input, output) => {
      if (input?.tool !== "question") {
        return;
      }

      const key = questionDedupeKey(input);
      if (key) {
        if (notifiedHumanInterventionEvents.size > MAX_DEDUP_SIZE) {
          notifiedHumanInterventionEvents.clear();
        }
        if (notifiedHumanInterventionEvents.has(key)) {
          return;
        }
        notifiedHumanInterventionEvents.add(key);
        if (notifiedHumanInterventionEvents.size > MAX_SET_SIZE) evictOldestSet(notifiedHumanInterventionEvents);
      }
      
      // tool.execute.before passes args in the second parameter (output.args)
      const questionContent = extractQuestionContent(output ?? input);
      const session = sessionKeyFrom(input);
      const suffix = session === GLOBAL_SESSION_KEY ? "" : ` Session ${session.slice(0, 8)}.`;
      
      const title = questionContent?.title ?? "OpenCode needs input";
      const message = questionContent?.message ?? `A question is waiting.`;
      const finalMessage = `${message}${suffix}`;
      
      void notify($, title, finalMessage, {
        iphone: true,
        iphoneTitle: title,
        iphoneMessage: finalMessage,
      }).catch(() => {});
    },

    "tool.execute.after": async (input) => {
      const key = sessionKeyFrom(input);
      if (hasSubstantiveToolWorkBySession.size > MAX_DEDUP_SIZE) {
        hasSubstantiveToolWorkBySession.clear();
      }
      hasSubstantiveToolWorkBySession.set(key, true);
      if (hasSubstantiveToolWorkBySession.size > MAX_MAP_SIZE) evictOldestMap(hasSubstantiveToolWorkBySession);

      // Track when the conductor dispatches a subagent task so we know
      // the completion is intermediate, not the top-level final response.
      if (input?.tool === "task") {
        if (dispatchedTaskBySession.size > MAX_DEDUP_SIZE) {
          dispatchedTaskBySession.clear();
        }
        dispatchedTaskBySession.set(key, true);
        if (dispatchedTaskBySession.size > MAX_MAP_SIZE) evictOldestMap(dispatchedTaskBySession);
      }
    },

    event: async ({ event }) => {
      if (isHumanInterventionEvent(event)) {
        const key = eventDedupeKey(event);
        if (notifiedHumanInterventionEvents.size > MAX_DEDUP_SIZE) {
          notifiedHumanInterventionEvents.clear();
        }
        if (notifiedHumanInterventionEvents.has(key)) {
          return;
        }

        notifiedHumanInterventionEvents.add(key);
        if (notifiedHumanInterventionEvents.size > MAX_SET_SIZE) evictOldestSet(notifiedHumanInterventionEvents);
        const { title, message } = extractPermissionContent(event);
        const session = sessionKeyFrom(event);
        const suffix = session === GLOBAL_SESSION_KEY ? "" : ` Session ${session.slice(0, 8)}.`;
        const finalMessage = `${message}${suffix}`;
        void notify($, title, finalMessage, {
          iphone: true,
          iphoneTitle: title,
          iphoneMessage: finalMessage,
        }).catch(() => {});
        return;
      }

      if (event.type !== "message.updated") {
        return;
      }

      const properties = eventProperties(event);
      const info = properties.info;

      if (info?.role !== "assistant") {
        return;
      }

      if (info?.mode !== "conductor") {
        return;
      }

      if (info?.finish !== "stop") {
        return;
      }

      const sessionKey = sessionKeyFrom(event);
      const substantiveWorkKeys =
        sessionKey === GLOBAL_SESSION_KEY
          ? [GLOBAL_SESSION_KEY]
          : [sessionKey, GLOBAL_SESSION_KEY];
      const consumedWorkKeys = substantiveWorkKeys.filter((key) =>
        hasSubstantiveToolWorkBySession.get(key),
      );

      if (consumedWorkKeys.length === 0) {
        return;
      }

      const completedKey =
        typeof info?.id === "string"
          ? `${sessionKey}:${info.id}`
          : null;

      if (completedConductorMessages.size > MAX_DEDUP_SIZE) {
        completedConductorMessages.clear();
      }
      if (completedKey !== null && completedConductorMessages.has(completedKey)) {
        return;
      }

      // If the conductor dispatched a task in this turn, it was delegating to
      // a subagent — this is an intermediate completion, not the final response.
      // Skip iPhone notification; only fire desktop notification.
      const dispatchedTask = dispatchedTaskBySession.get(sessionKey) ?? false;
      dispatchedTaskBySession.set(sessionKey, false);
      if (dispatchedTaskBySession.size > MAX_MAP_SIZE) evictOldestMap(dispatchedTaskBySession);

      // Only consume the substantive-work flag for the FINAL completion.
      // Intermediate completions (dispatchedTask=true) must leave the flag so
      // the final completion still detects work and fires a notification.
      if (!dispatchedTask) {
        consumedWorkKeys.forEach((key) => {
          hasSubstantiveToolWorkBySession.set(key, false);
        });
        if (hasSubstantiveToolWorkBySession.size > MAX_MAP_SIZE) evictOldestMap(hasSubstantiveToolWorkBySession);

        // Dedupe final completions only — intermediate and final share the same
        // info.id (same message), so adding the key on an intermediate would
        // silently suppress the final notification.
        if (completedKey !== null) {
          if (completedConductorMessages.has(completedKey)) {
            return;
          }
          completedConductorMessages.add(completedKey);
          if (completedConductorMessages.size > MAX_SET_SIZE) evictOldestSet(completedConductorMessages);
        }
      }

      const completionContent = extractCompletionContent(event);
      const title = completionContent?.title ?? TITLE;
      const message = completionContent?.message ?? MESSAGE;
      const session = sessionKeyFrom(event);
      const suffix = session === GLOBAL_SESSION_KEY ? "" : ` Session ${session.slice(0, 8)}.`;
      const finalMessage = `${message}${suffix}`;
      
      void notify($, title, finalMessage, { iphone: !dispatchedTask }).catch(() => {});
    },
  };
};
