const TITLE = "OpenCode";
const MESSAGE = "Done !";

/**
 * Build the list of notification commands appropriate for the current OS.
 * Each entry returns a promise; failures are swallowed individually.
 *
 * @param {(strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>} $
 * @returns {Array<() => Promise<unknown>>}
 */
function buildNotifiers($) {
  switch (process.platform) {
    case "darwin":
      return [
        () =>
          $`osascript -e ${`display notification "${MESSAGE}" with title "${TITLE}"`}`,
        () => $`afplay /System/Library/Sounds/Glass.aiff`,
      ];
    case "linux":
      return [
        () => $`notify-send ${TITLE} ${MESSAGE}`,
        () => $`paplay /usr/share/sounds/freedesktop/stereo/complete.oga`,
      ];
    case "win32":
      return [
        () =>
          $`powershell -NoProfile -WindowStyle Hidden -Command ${`[System.Media.SystemSounds]::Asterisk.Play(); try { New-BurntToastNotification -Text '${TITLE}','${MESSAGE}' -ErrorAction Stop } catch {}`}`,
      ];
    default:
      return [];
  }
}

export const NotificationPlugin = async ({ $ }) => {
  let hasSubstantiveToolWork = false;
  const notifiers = buildNotifiers($);

  return {
    "tool.execute.after": async () => {
      hasSubstantiveToolWork = true;
    },

    event: async ({ event }) => {
      if (event.type !== "session.idle") {
        return;
      }

      if (!hasSubstantiveToolWork) {
        return;
      }

      hasSubstantiveToolWork = false;

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
    },
  };
};
