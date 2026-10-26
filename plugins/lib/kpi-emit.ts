import { spawn } from "node:child_process";
import { hookPath, projectHookDirs } from "./autonomy-hooks.ts";

const SAFE_ARG = /^[A-Za-z0-9._:=-]{1,80}$/;

/** Fire-and-forget append to the local KPI log. Never throws, never logs tool args. */
export function emitKpi(directory: string, args: string[]): void {
  if (process.env.AGENT_HARNESS_KPI === "0") return;
  if (process.env.AGENT_HARNESS_TEST === "1" && !process.env.AGENT_HARNESS_KPI_LOG) return;
  const hook = hookPath("kpi-emit.sh", projectHookDirs(directory));
  if (!hook) return;
  const safe = args.filter((arg) => SAFE_ARG.test(arg));
  if (safe.length === 0) return;
  try {
    const child = spawn("bash", [hook, ...safe], {
      cwd: directory,
      env: {
        ...process.env,
        AGENT_HARNESS_TOOL: "opencode",
        AGENT_HARNESS_KPI: "1",
      },
      stdio: "ignore",
      detached: true,
    });
    child.unref();
    child.on("error", () => undefined);
  } catch {
    /* fail open */
  }
}
