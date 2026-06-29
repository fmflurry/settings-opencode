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
const QUESTION_EVENTS = new Set(["question.asked", "question.v2.asked"]);
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
    stringProperty(properties, "permissionID") ??
    stringProperty(properties, "questionID");

  return id
    ? `${sessionKeyFrom(event)}:${id}`
    : `${sessionKeyFrom(event)}:${event.type}`;
}

function isHumanInterventionEvent(event) {
  return QUESTION_EVENTS.has(event.type) || PERMISSION_EVENTS.has(event.type);
}

function humanInterventionMessage(event) {
  const properties = eventProperties(event);
  const session = sessionKeyFrom(event);
  const suffix = session === GLOBAL_SESSION_KEY ? "" : ` Session ${session.slice(0, 8)}.`;

  if (QUESTION_EVENTS.has(event.type)) {
    return {
      title: "OpenCode needs input",
      message: `A question is waiting.${suffix}`,
    };
  }

  return {
    title: "OpenCode permission needed",
    message: `${stringProperty(properties, "title") ?? stringProperty(properties, "type") ?? "Permission request"}.${suffix}`,
  };
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

export const NotificationPlugin = async ({ $ }) => {
  const hasSubstantiveToolWorkBySession = new Map();
  const dispatchedTaskBySession = new Map();
  const completedConductorMessages = new Set();
  const notifiedHumanInterventionEvents = new Set();

  return {
    "tool.execute.after": async (input) => {
      const key = sessionKeyFrom(input);
      hasSubstantiveToolWorkBySession.set(key, true);

      // Track when the conductor dispatches a subagent task so we know
      // the completion is intermediate, not the top-level final response.
      if (input?.tool === "task") {
        dispatchedTaskBySession.set(key, true);
      }
    },

    event: async ({ event }) => {
      if (isHumanInterventionEvent(event)) {
        const key = eventDedupeKey(event);
        if (notifiedHumanInterventionEvents.has(key)) {
          return;
        }

        notifiedHumanInterventionEvents.add(key);
        const { title, message } = humanInterventionMessage(event);
        // Permissions are blocking — send iPhone notification. Questions stay desktop-only.
        const isPermission = PERMISSION_EVENTS.has(event.type);
        await notify($, title, message, {
          iphone: isPermission,
          iphoneTitle: "OpenCode permission needed",
          iphoneMessage: "A permission request is waiting.",
        });
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

      if (completedKey !== null && completedConductorMessages.has(completedKey)) {
        return;
      }

      consumedWorkKeys.forEach((key) => {
        hasSubstantiveToolWorkBySession.set(key, false);
      });
      if (completedKey !== null) {
        completedConductorMessages.add(completedKey);
      }

      // If the conductor dispatched a task in this turn, it was delegating to
      // a subagent — this is an intermediate completion, not the final response.
      // Skip iPhone notification; only fire desktop notification.
      const dispatchedTask = dispatchedTaskBySession.get(sessionKey) ?? false;
      dispatchedTaskBySession.set(sessionKey, false);

      await notify($, TITLE, MESSAGE, { iphone: !dispatchedTask });
    },
  };
};
