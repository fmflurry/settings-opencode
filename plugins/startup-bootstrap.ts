import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { Plugin } from "@opencode-ai/plugin";

type SessionStartupState = {
  serenaDone: boolean;
  directory?: string;
};

const SERENA_ACTIVATE_TOOL = "serena_activate_project";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getNestedRecord(
  value: Record<string, unknown>,
  key: string,
): Record<string, unknown> | undefined {
  const nestedValue = value[key];
  return isRecord(nestedValue) ? nestedValue : undefined;
}

function getNestedString(
  value: Record<string, unknown>,
  key: string,
): string | undefined {
  const nestedValue = value[key];
  return typeof nestedValue === "string" ? nestedValue : undefined;
}

function extractSessionID(event: unknown): string | undefined {
  if (!isRecord(event)) return undefined;

  const topLevelSessionID = getNestedString(event, "sessionID");
  const session = getNestedRecord(event, "session");
  const body = getNestedRecord(event, "body");
  const bodySession = body ? getNestedRecord(body, "session") : undefined;
  const properties = getNestedRecord(event, "properties");
  const propertiesInfo = properties
    ? getNestedRecord(properties, "info")
    : undefined;
  const propertiesSession = properties
    ? getNestedRecord(properties, "session")
    : undefined;

  return (
    topLevelSessionID ??
    getNestedString(properties ?? {}, "sessionID") ??
    getNestedString(propertiesInfo ?? {}, "id") ??
    getNestedString(session ?? {}, "id") ??
    getNestedString(bodySession ?? {}, "id") ??
    getNestedString(propertiesSession ?? {}, "id") ??
    getNestedString(properties ?? {}, "id")
  );
}

function extractSessionDirectory(event: unknown): string | undefined {
  if (!isRecord(event)) return undefined;

  const info = getNestedRecord(
    getNestedRecord(event, "properties") ?? {},
    "info",
  );
  return getNestedString(info ?? {}, "directory");
}

function normalizePath(value: string): string {
  return path.resolve(value);
}

function matchesProjectTarget(
  requestedProject: string,
  directory: string,
): boolean {
  const normalizedDirectory = normalizePath(directory);

  if (path.isAbsolute(requestedProject)) {
    return normalizePath(requestedProject) === normalizedDirectory;
  }

  if (requestedProject === path.basename(normalizedDirectory)) {
    return true;
  }

  return (
    normalizePath(path.join(normalizedDirectory, requestedProject)) ===
    normalizedDirectory
  );
}

async function loadInstructionFile(
  filePath: string,
  fallback: string,
): Promise<string> {
  try {
    const content = await readFile(filePath, "utf8");
    const trimmedContent = content.trim();
    return trimmedContent.length > 0 ? trimmedContent : fallback;
  } catch {
    return fallback;
  }
}

const StartupBootstrapPlugin: Plugin = async ({ client }) => {
  const pluginDirectory = path.dirname(fileURLToPath(import.meta.url));
  const instructionsDirectory = path.resolve(
    pluginDirectory,
    "../instructions",
  );

  const serenaInstruction = await loadInstructionFile(
    path.join(instructionsDirectory, "serena.md"),
    `Connect to Serena by calling \`${SERENA_ACTIVATE_TOOL}\` with the current project path.`,
  );

  async function log(
    level: "debug" | "info" | "warn" | "error",
    message: string,
  ): Promise<void> {
    try {
      await client.app.log({
        body: { service: "startup-bootstrap", level, message },
      });
    } catch {
      // ignore logging failures during startup
    }
  }

  const sessionState = new Map<string, SessionStartupState>();

  return {
    event: async ({ event }) => {
      if (!isRecord(event) || typeof event.type !== "string") {
        return;
      }

      if (event.type === "session.created") {
        const sessionID = extractSessionID(event);
        if (!sessionID) {
          return;
        }

        const directory = extractSessionDirectory(event);

        sessionState.set(sessionID, {
          serenaDone: false,
          directory,
        });

        await log("info", `Startup bootstrap armed for session ${sessionID}`);
        return;
      }

      if (event.type === "session.deleted") {
        const sessionID = extractSessionID(event);
        if (!sessionID) {
          return;
        }

        sessionState.delete(sessionID);
      }
    },

    "tool.execute.after": async (input) => {
      const state = sessionState.get(input.sessionID);
      if (!state) {
        return;
      }

      if (input.tool !== SERENA_ACTIVATE_TOOL) {
        return;
      }

      if (!isRecord(input.args)) {
        return;
      }

      const requestedProject = getNestedString(input.args, "project");
      if (!requestedProject || !state.directory) {
        return;
      }

      if (!matchesProjectTarget(requestedProject, state.directory)) {
        return;
      }

      state.serenaDone = true;
    },

    "experimental.chat.system.transform": async (input, output) => {
      if (!input.sessionID || !Array.isArray(output.system)) {
        return;
      }

      const state = sessionState.get(input.sessionID);
      if (!state) {
        return;
      }

      if (!state.serenaDone) {
        output.system.push(
          [
            "Session startup: activate Serena before doing substantive work.",
            serenaInstruction.trim(),
            "Do this first, then continue normally.",
          ].join("\n\n"),
        );
      }
    },
  };
};

export default StartupBootstrapPlugin;
