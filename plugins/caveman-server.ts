import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { Plugin } from "@opencode-ai/plugin";

/**
 * Caveman Server Plugin
 *
 * Injects caveman ultra instructions into every chat system prompt via
 * `experimental.chat.system.transform`. No more session.command race —
 * the instruction lives alongside the user's actual message.
 *
 * Still writes a flag file so the TUI sidebar knows it's active.
 */

const CAVEMAN_INSTRUCTION = [
  "Use caveman ultra mode for this entire session.",
  "",
  "Respond terse like smart caveman. Keep full technical accuracy. Cut fluff.",
  "",
  "Rules:",
  "- Drop articles, filler, pleasantries, hedging",
  "- Fragments OK",
  "- Use short technical abbreviations like DB, auth, config, req, res, fn, impl when clear",
  "- Use arrows for causality when helpful: X -> Y",
  "- Keep code blocks unchanged",
  "- Quote errors exactly",
  "",
  "Exceptions — temporarily switch to normal clarity for:",
  "- Security warnings",
  "- Irreversible actions",
  "- Confusing multi-step instructions",
  "Resume caveman after clear part done.",
].join("\n");

function flagPath(sessionID: string): string {
  return path.join(os.tmpdir(), `opencode-caveman-${sessionID}.flag`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function extractSessionID(event: unknown): string | undefined {
  if (!isRecord(event)) return undefined;
  if (typeof event.sessionID === "string") return event.sessionID;
  const properties = isRecord(event.properties) ? event.properties : undefined;
  if (properties) {
    if (typeof properties.sessionID === "string") return properties.sessionID;
    const info = isRecord(properties.info) ? properties.info : undefined;
    if (info && typeof info.id === "string") return info.id;
  }
  return undefined;
}

const CavemanServerPlugin: Plugin = async ({ client }) => {
  const log = (level: "debug" | "info" | "warn" | "error", message: string) =>
    client.app.log({ body: { service: "caveman", level, message } }).catch(() => {});

  void log("info", "Caveman ultra will be injected via chat.system.transform");

  return {
    event: async ({ event }) => {
      if (!isRecord(event) || typeof event.type !== "string") return;

      if (event.type === "session.created") {
        const sessionID = extractSessionID(event);
        if (!sessionID) return;

        // Write flag so TUI sidebar knows caveman is active
        try {
          const { writeFileSync } = await import("node:fs");
          writeFileSync(flagPath(sessionID), "ultra", "utf8");
        } catch {
          // non-critical
        }

        await log("info", `Caveman ultra armed for session ${sessionID}`);
      }

      if (event.type === "session.deleted") {
        const sessionID = extractSessionID(event);
        if (!sessionID) return;

        try {
          const { unlinkSync } = await import("node:fs");
          unlinkSync(flagPath(sessionID));
        } catch {
          // absent
        }
      }
    },

    "experimental.chat.system.transform": async (_input, output) => {
      if (!Array.isArray(output.system)) return;
      output.system.push(CAVEMAN_INSTRUCTION);
    },
  };
};

export default CavemanServerPlugin;
