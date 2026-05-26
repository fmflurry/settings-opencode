export const NotificationPlugin = async ({
  project,
  client,
  $,
  directory,
  worktree,
}) => {
  let hasSubstantiveToolWork = false;

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

      try {
        await Promise.all([
          $`osascript -e 'display notification "Done !" with title "OpenCode"'`,
          $`afplay /System/Library/Sounds/Glass.aiff`,
        ]);
      } catch {
        // Notification failures should not break OpenCode event handling.
      }
    },
  };
};
