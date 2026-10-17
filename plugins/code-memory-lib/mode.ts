/**
 * Whether CodeMemory should run.
 *
 * The shell copy is `.claude/hooks/codememory-mode.sh`. Keep the decision
 * table in sync: hooks cannot import this module.
 */

import http from "node:http";
import net from "node:net";

export const CODEMEMORY_OVERRIDE_ENV = "FMFLURRY_CODEMEMORY";
export const CODEMEMORY_ENDPOINT_HOST = "127.0.0.1";
export const CODEMEMORY_FALKOR_PORT = 6379;
export const CODEMEMORY_QDRANT_PORT = 6333;
const PROBE_TIMEOUT_MS = 300;

export type CodememoryReason =
  | "override-on"
  | "override-off"
  | "cloud"
  | "local"
  | "endpoint-up"
  | "endpoint-down";

export interface CodememorySignals {
  readonly override?: string | undefined;
  readonly claudeRemote?: string | undefined;
  readonly claudeRemoteSessionId?: string | undefined;
  readonly cursorRuntime?: string | null | undefined;
  readonly githubActions?: string | undefined;
  readonly gitlabCi?: string | undefined;
  readonly circleCi?: string | undefined;
  readonly buildkite?: string | undefined;
  readonly tfBuild?: string | undefined;
  readonly jenkinsUrl?: string | undefined;
  readonly platform?: string | undefined;
  /** `null` means not probed. Inconclusive sessions then count as down. */
  readonly endpointReachable?: boolean | null | undefined;
}

export interface CodememoryDecision {
  readonly enabled: boolean;
  readonly reason: CodememoryReason;
}

export interface CodememoryDeps {
  readonly env?: NodeJS.ProcessEnv | undefined;
  readonly platform?: NodeJS.Platform | undefined;
  readonly readCursorRuntime?: ((env: NodeJS.ProcessEnv) => Promise<string | null>) | undefined;
  readonly probeEndpoint?: (() => Promise<boolean>) | undefined;
}

function truthy(value: string | undefined): boolean {
  const normalized = (value ?? "").trim().toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "yes";
}

function present(value: string | undefined): boolean {
  return (value ?? "").trim() !== "";
}

function cloudSignal(signals: CodememorySignals): boolean {
  if (truthy(signals.claudeRemote) || present(signals.claudeRemoteSessionId)) return true;
  if ((signals.cursorRuntime ?? "").trim() === "managed") return true;
  if (truthy(signals.githubActions) || truthy(signals.gitlabCi)) return true;
  if (truthy(signals.circleCi) || truthy(signals.buildkite)) return true;
  if (present(signals.tfBuild) || present(signals.jenkinsUrl)) return true;
  return false;
}

export function decideCodememory(signals: CodememorySignals): CodememoryDecision {
  const override = (signals.override ?? "").trim().toLowerCase();
  if (override === "on") return { enabled: true, reason: "override-on" };
  if (override === "off") return { enabled: false, reason: "override-off" };
  if (cloudSignal(signals)) return { enabled: false, reason: "cloud" };
  if (signals.platform === "darwin") return { enabled: true, reason: "local" };
  if (signals.endpointReachable === true) return { enabled: true, reason: "endpoint-up" };
  return { enabled: false, reason: "endpoint-down" };
}

function signalsFromEnv(
  env: NodeJS.ProcessEnv,
  platform: string,
  cursorRuntime: string | null,
  endpointReachable: boolean | null,
): CodememorySignals {
  return {
    override: env[CODEMEMORY_OVERRIDE_ENV],
    claudeRemote: env.CLAUDE_CODE_REMOTE,
    claudeRemoteSessionId: env.CLAUDE_CODE_REMOTE_SESSION_ID,
    cursorRuntime,
    githubActions: env.GITHUB_ACTIONS,
    gitlabCi: env.GITLAB_CI,
    circleCi: env.CIRCLECI,
    buildkite: env.BUILDKITE,
    tfBuild: env.TF_BUILD,
    jenkinsUrl: env.JENKINS_URL,
    platform,
    endpointReachable,
  };
}

export function readCursorRuntime(env: NodeJS.ProcessEnv = process.env): Promise<string | null> {
  const socketPath = (env.CURSOR_AGENT_SOCKET ?? "").trim() || "/run/cursor/api.sock";
  return new Promise((resolve) => {
    const req = http.request(
      {
        socketPath,
        path: "/v1/meta-data/agent/runtime",
        method: "GET",
        timeout: PROBE_TIMEOUT_MS,
      },
      (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          resolve(null);
          return;
        }
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8").trim() || null));
      },
    );
    req.on("error", () => resolve(null));
    req.on("timeout", () => {
      req.destroy();
      resolve(null);
    });
    req.end();
  });
}

function portOpen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host: CODEMEMORY_ENDPOINT_HOST, port, timeout: PROBE_TIMEOUT_MS });
    const finish = (open: boolean) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(open);
    };
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}

export async function probeCodeMemoryEndpoint(): Promise<boolean> {
  try {
    const falkor = await portOpen(CODEMEMORY_FALKOR_PORT);
    if (!falkor) return false;
    return await portOpen(CODEMEMORY_QDRANT_PORT);
  } catch {
    return false;
  }
}

export async function resolveCodememory(deps: CodememoryDeps = {}): Promise<CodememoryDecision> {
  const env = deps.env ?? process.env;
  const platform = deps.platform ?? process.platform;
  const override = (env[CODEMEMORY_OVERRIDE_ENV] ?? "").trim().toLowerCase();
  if (override === "on" || override === "off") {
    return decideCodememory(signalsFromEnv(env, platform, null, null));
  }

  const fromEnv = decideCodememory(signalsFromEnv(env, platform, null, null));
  if (fromEnv.reason === "cloud") return fromEnv;

  let runtime: string | null = null;
  try {
    runtime = await (deps.readCursorRuntime ?? readCursorRuntime)(env);
  } catch {
    runtime = null;
  }
  const withRuntime = decideCodememory(signalsFromEnv(env, platform, runtime, null));
  if (withRuntime.reason === "cloud" || withRuntime.reason === "local") return withRuntime;

  let reachable = false;
  try {
    reachable = await (deps.probeEndpoint ?? probeCodeMemoryEndpoint)();
  } catch {
    reachable = false;
  }
  return decideCodememory(signalsFromEnv(env, platform, runtime, reachable));
}
