export const NotificationPlugin = async ({
  project,
  client,
  $,
  directory,
  worktree,
}) => {
  let hasSubstantiveToolWork = false;

  const isStartupTool = (toolName) => {
    if (typeof toolName !== "string") {
      return true;
    }

    const normalizedToolName = toolName.toLowerCase().replace(/[^a-z0-9]+/g, "_");

    return (
      normalizedToolName.startsWith("serena_") ||
      normalizedToolName.includes("_serena_") ||
      normalizedToolName === "activate_project" ||
      normalizedToolName === "initial_instructions" ||
      normalizedToolName === "check_onboarding_performed"
    );
  };

  return {
    "tool.execute.after": async (input) => {
      if (isStartupTool(input?.tool)) {
        return;
      }

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
