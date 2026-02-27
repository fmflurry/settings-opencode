import type { Hooks, Plugin, PluginInput } from "@opencode-ai/plugin";

import ECCHooksPlugin from "./ecc-hooks.ts";
import { ContinuousLearningStopHookPlugin } from "./continuous-learning-stop-hook.js";

type NamedPlugin = {
  name: string;
  plugin: Plugin;
};

const PLUGINS: NamedPlugin[] = [
  { name: "ecc-hooks", plugin: ECCHooksPlugin },
  { name: "continuous-learning-stop-hook", plugin: ContinuousLearningStopHookPlugin },
];

function isHookFunction(
  value: unknown,
): value is (...args: readonly unknown[]) => unknown {
  return typeof value === "function";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

async function safeLog(
  client: PluginInput["client"],
  level: "debug" | "info" | "warn" | "error",
  message: string,
  extra?: Record<string, unknown>,
): Promise<void> {
  try {
    await client.app.log({
      body: {
        service: "plugins/index",
        level,
        message,
        extra,
      },
    });
  } catch {
    // ignore logging failures
  }
}

function mergeHooks(
  input: PluginInput,
  namedHooks: Array<{ name: string; hooks: Hooks }>,
): Hooks {
  const merged: Record<string, unknown> = {};

  const toolMaps: Array<Record<string, unknown>> = [];
  for (const item of namedHooks) {
    const toolValue = (item.hooks as Record<string, unknown>).tool;
    if (isRecord(toolValue)) {
      toolMaps.push(toolValue);
    }
  }

  if (toolMaps.length > 0) {
    merged.tool = Object.assign({}, ...toolMaps);
  }

  const authHooks = namedHooks
    .map((item) => ({
      name: item.name,
      auth: (item.hooks as Record<string, unknown>).auth,
    }))
    .filter((item) => item.auth !== undefined);
  if (authHooks.length > 1) {
    void safeLog(input.client, "warn", "Multiple auth hooks detected; using first", {
      plugins: authHooks.map((p) => p.name),
    });
  }
  if (authHooks.length > 0) {
    merged.auth = authHooks[0]?.auth;
  }

  for (const { name, hooks } of namedHooks) {
    const record = hooks as Record<string, unknown>;

    for (const [key, value] of Object.entries(record)) {
      if (key === "tool" || key === "auth") continue;
      if (value === undefined) continue;

      const existing = merged[key];

      if (isHookFunction(existing) && isHookFunction(value)) {
        merged[key] = async (...args: readonly unknown[]) => {
          try {
            await existing(...args);
          } catch (error: unknown) {
            void safeLog(input.client, "warn", "Plugin hook failed", {
              plugin: "(composed)",
              hook: key,
              error: error instanceof Error ? error.message : String(error),
            });
          }

          try {
            await value(...args);
          } catch (error: unknown) {
            void safeLog(input.client, "warn", "Plugin hook failed", {
              plugin: name,
              hook: key,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        };
        continue;
      }

      if (existing === undefined) {
        merged[key] = value;
        continue;
      }

      // If a later plugin wants to override a non-function hook, keep the first.
      // This prevents accidental behavior changes from ordering.
    }
  }

  return merged as Hooks;
}

const CombinedPlugin: Plugin = async (input: PluginInput) => {
  const loaded = await Promise.all(
    PLUGINS.map(async ({ name, plugin }) => {
      try {
        const hooks = await plugin(input);
        return { name, hooks };
      } catch (error: unknown) {
        void safeLog(input.client, "error", "Failed to load plugin", {
          plugin: name,
          error: error instanceof Error ? error.message : String(error),
        });
        return { name, hooks: {} };
      }
    }),
  );

  return mergeHooks(input, loaded);
};

export default CombinedPlugin;

export { ECCHooksPlugin } from "./ecc-hooks.ts";
export { ContinuousLearningStopHookPlugin } from "./continuous-learning-stop-hook.js";

// Re-export for named imports
export * from "./ecc-hooks.ts";
