const SERENA_STARTUP_TOOL_NAMES = new Set([
  "activate_project",
  "check_onboarding_performed",
  "initial_instructions",
  "serena_activate_project",
  "serena_check_onboarding_performed",
  "serena_initial_instructions",
]);

const isSerenaStartupTool = (toolName) => {
  if (typeof toolName !== "string") {
    return true;
  }

  const normalizedToolName = toolName.toLowerCase().replace(/[^a-z0-9]+/g, "_");

  return SERENA_STARTUP_TOOL_NAMES.has(normalizedToolName);
};

export const NotificationPlugin = async ({
  project,
  client,
  $,
  directory,
  worktree,
}) => {
  let hasSubstantiveToolWork = false;

  return {
    "tool.execute.after": async (input) => {
      if (isSerenaStartupTool(input?.tool)) {
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
