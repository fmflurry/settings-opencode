import { spawnSync } from "node:child_process";

const HOME = process.env.HOME || "";
const STOP_HOOK_PATH = HOME
  ? `${HOME}/.config/opencode/skills/continuous-learning/hooks/stop.sh`
  : "";

export const ContinuousLearningStopHookPlugin = async ({ $, client }) => {
  let lastSessionID;
  const processedSessionIDs = new Set();
  let processedWithoutSession = false;

  const runStopHookSync = (reason, sessionID) => {
    const resolvedSessionID =
      typeof sessionID === "string" && sessionID.length > 0
        ? sessionID
        : typeof lastSessionID === "string" && lastSessionID.length > 0
          ? lastSessionID
          : undefined;

    if (!STOP_HOOK_PATH || !resolvedSessionID) {
      return;
    }

    if (processedSessionIDs.has(resolvedSessionID)) {
      return;
    }

    processedSessionIDs.add(resolvedSessionID);

    try {
      spawnSync(STOP_HOOK_PATH, {
        env: {
          ...process.env,
          OPENCODE_SESSION_ID: resolvedSessionID,
          OPENCODE_STOP_REASON: reason,
        },
        stdio: "ignore",
      });
    } catch {
      // swallow - process is exiting anyway
    }
  };

  // Best-effort safety net: even if OpenCode exits without emitting disposal events
  // (e.g. abrupt shutdown), run the stop hook synchronously on process exit.
  try {
    process.once("exit", () => {
      runStopHookSync("process.exit");
    });
  } catch {
  }

  const log = async (level, message, extra) => {
    try {
      await client.app.log({
        body: {
          service: "continuous-learning-stop-hook",
          level,
          message,
          extra,
        },
      });
    } catch {
      // ignore logging failures
    }
  };

  const buildShellEnv = (extra) => {
    const merged = {};
    const base = process.env;
    for (const key of Object.keys(base)) {
      const value = base[key];
      if (typeof value === "string") {
        merged[key] = value;
      }
    }

    if (extra && typeof extra === "object") {
      for (const key of Object.keys(extra)) {
        const value = extra[key];
        if (typeof value === "string") {
          merged[key] = value;
        }
      }
    }

    return merged;
  };

  const extractSessionID = (event) => {
    if (!event || typeof event !== "object") {
      return undefined;
    }

    const direct = event.properties && event.properties.sessionID;
    if (typeof direct === "string" && direct.length > 0) {
      return direct;
    }

    const info = event.properties && event.properties.info;
    if (info && typeof info === "object") {
      if (typeof info.id === "string" && info.id.length > 0) {
        return info.id;
      }
      if (typeof info.sessionID === "string" && info.sessionID.length > 0) {
        return info.sessionID;
      }
    }

    const part = event.properties && event.properties.part;
    if (part && typeof part === "object") {
      if (typeof part.sessionID === "string" && part.sessionID.length > 0) {
        return part.sessionID;
      }
    }

    const legacyCandidates = [
      event?.session?.id,
      event?.body?.session?.id,
      event?.properties?.session?.id,
      event?.properties?.id,
    ];

    for (const candidate of legacyCandidates) {
      if (typeof candidate === "string" && candidate.length > 0) {
        return candidate;
      }
    }

    return undefined;
  };

  async function runStopHook(reason, sessionID) {
    if (!STOP_HOOK_PATH) {
      await log("warn", "continuous-learning stop hook path not resolved", {
        reason,
        hookPath: STOP_HOOK_PATH,
      });
      return;
    }

    const resolvedSessionID =
      typeof sessionID === "string" && sessionID.length > 0
        ? sessionID
        : typeof lastSessionID === "string" && lastSessionID.length > 0
          ? lastSessionID
          : undefined;

    if (resolvedSessionID) {
      if (processedSessionIDs.has(resolvedSessionID)) {
        return;
      }
      processedSessionIDs.add(resolvedSessionID);
    } else {
      if (processedWithoutSession) {
        return;
      }
      processedWithoutSession = true;
    }

    const env = {
      OPENCODE_SESSION_ID: resolvedSessionID || "",
      OPENCODE_STOP_REASON: reason,
    };

    try {
      const result = await $`${STOP_HOOK_PATH}`
        .env(buildShellEnv(env))
        .quiet()
        .nothrow();
      const stdout = result.stdout.toString("utf8").trim();
      const stderr = result.stderr.toString("utf8").trim();

      if (result.exitCode === 0) {
        await log("info", "continuous-learning stop hook executed", {
          reason,
          hookPath: STOP_HOOK_PATH,
          sessionID: resolvedSessionID,
          stdout: stdout.length > 0 ? stdout.slice(0, 2000) : undefined,
        });
        return;
      }

      await log("warn", "continuous-learning stop hook failed", {
        reason,
        hookPath: STOP_HOOK_PATH,
        sessionID: resolvedSessionID,
        exitCode: result.exitCode,
        stdout: stdout.length > 0 ? stdout.slice(0, 2000) : undefined,
        stderr: stderr.length > 0 ? stderr.slice(0, 2000) : undefined,
      });
    } catch (error) {
      await log("warn", "Failed to execute continuous-learning stop hook", {
        reason,
        hookPath: STOP_HOOK_PATH,
        sessionID: resolvedSessionID,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    event: async ({ event }) => {
      const sessionID = extractSessionID(event);
      if (sessionID) {
        lastSessionID = sessionID;
      }

      if (event.type === "global.disposed") {
        // If no session has ever been observed in this run, skip.
        if (typeof lastSessionID !== "string" || lastSessionID.length === 0) {
          return;
        }

        await runStopHook("global.disposed", lastSessionID);
        return;
      }

      if (event.type === "server.instance.disposed") {
        if (typeof lastSessionID !== "string" || lastSessionID.length === 0) {
          return;
        }

        await runStopHook("server.instance.disposed", lastSessionID);
        return;
      }

      if (event.type === "session.deleted") {
        await runStopHook("session.deleted", sessionID);
      }
    },
  };
};
