export const NotificationPlugin = async ({
  project,
  client,
  $,
  directory,
  worktree,
}) => {
  return {
    event: async ({ event }) => {
      if (event.type === "session.idle") {
        await Promise.all([
          $`osascript -e 'display notification "Done !" with title "OpenCode"'`,
          $`afplay /System/Library/Sounds/Glass.aiff`,
        ]);
      }
    },
  };
};
