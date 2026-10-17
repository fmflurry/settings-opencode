import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  decideCodememory,
  resolveCodememory,
  type CodememorySignals,
} from "./mode.ts";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const hook = path.join(repo, ".claude/hooks/codememory-mode.sh");

const quiet: CodememorySignals = {
  override: undefined,
  claudeRemote: undefined,
  claudeRemoteSessionId: undefined,
  cursorRuntime: null,
  githubActions: undefined,
  gitlabCi: undefined,
  circleCi: undefined,
  buildkite: undefined,
  tfBuild: undefined,
  jenkinsUrl: undefined,
  platform: "darwin",
  endpointReachable: false,
};

function bashDecide(signals: CodememorySignals): "enabled" | "disabled" {
  const args = [
    signals.override ?? "",
    signals.cursorRuntime ?? "",
    signals.platform ?? "",
    signals.endpointReachable === true ? "1" : signals.endpointReachable === false ? "0" : "",
    signals.claudeRemote ?? "",
    signals.claudeRemoteSessionId ?? "",
    signals.githubActions ?? "",
    signals.gitlabCi ?? "",
    signals.circleCi ?? "",
    signals.buildkite ?? "",
    signals.tfBuild ?? "",
    signals.jenkinsUrl ?? "",
  ];
  const out = execFileSync(
    "bash",
    ["-c", '. "$1"; shift; codememory_decide "$@"', "codememory", hook, ...args],
    { encoding: "utf8" },
  );
  const line = out.trim();
  if (line !== "enabled" && line !== "disabled") {
    throw new Error(`unexpected bash decision: ${JSON.stringify(out)}`);
  }
  return line;
}

function expectSame(signals: CodememorySignals): void {
  const ts = decideCodememory(signals);
  const bash = bashDecide(signals);
  assert.equal(bash, ts.enabled ? "enabled" : "disabled");
}

test("cloud env detected: Cursor managed runtime disables CodeMemory", () => {
  const signals: CodememorySignals = { ...quiet, platform: "linux", cursorRuntime: "managed", endpointReachable: true };
  assert.deepEqual(decideCodememory(signals), { enabled: false, reason: "cloud" });
  expectSame(signals);
});

test("cloud env detected: CLAUDE_CODE_REMOTE and a remote session id disable CodeMemory", () => {
  const remote: CodememorySignals = { ...quiet, claudeRemote: "true", endpointReachable: true };
  const session: CodememorySignals = { ...quiet, claudeRemoteSessionId: "cse_123", endpointReachable: true };
  assert.equal(decideCodememory(remote).enabled, false);
  assert.equal(decideCodememory(session).reason, "cloud");
  expectSame(remote);
  expectSame(session);
});

test("cloud env detected: vendor CI flags disable CodeMemory, including on macOS", () => {
  for (const signals of [
    { ...quiet, githubActions: "true" },
    { ...quiet, platform: "linux", gitlabCi: "true", endpointReachable: true },
    { ...quiet, circleCi: "TRUE" },
    { ...quiet, buildkite: "1" },
    { ...quiet, platform: "linux", tfBuild: "True", endpointReachable: true },
    { ...quiet, jenkinsUrl: "http://jenkins.example" },
  ] satisfies CodememorySignals[]) {
    assert.equal(decideCodememory(signals).reason, "cloud");
    expectSame(signals);
  }
});

test("override on enables CodeMemory even in the cloud", () => {
  const signals: CodememorySignals = {
    ...quiet,
    override: " ON ",
    platform: "linux",
    cursorRuntime: "managed",
    claudeRemote: "true",
    githubActions: "true",
    endpointReachable: false,
  };
  assert.deepEqual(decideCodememory(signals), { enabled: true, reason: "override-on" });
  expectSame(signals);
});

test("override off disables CodeMemory on a local Mac with a reachable endpoint", () => {
  const signals: CodememorySignals = { ...quiet, override: "off", endpointReachable: true };
  assert.deepEqual(decideCodememory(signals), { enabled: false, reason: "override-off" });
  expectSame(signals);
});

test("local default unchanged: macOS without cloud signals stays enabled", () => {
  const up: CodememorySignals = { ...quiet, endpointReachable: true };
  const down: CodememorySignals = { ...quiet, endpointReachable: false };
  const ciOnly: CodememorySignals = { ...quiet, endpointReachable: false };
  assert.deepEqual(decideCodememory(up), { enabled: true, reason: "local" });
  assert.deepEqual(decideCodememory(down), { enabled: true, reason: "local" });
  assert.equal(decideCodememory(ciOnly).reason, "local");
  expectSame(up);
  expectSame(down);
});

test("bare CI=true is not a cloud signal", async () => {
  const decision = await resolveCodememory({
    env: { CI: "true" },
    platform: "linux",
    readCursorRuntime: async () => null,
    probeEndpoint: async () => true,
  });
  assert.deepEqual(decision, { enabled: true, reason: "endpoint-up" });
});

test("inconclusive plus unreachable means disabled", () => {
  const down: CodememorySignals = { ...quiet, platform: "linux", endpointReachable: false };
  const unknown: CodememorySignals = { ...quiet, platform: "linux", endpointReachable: null };
  assert.deepEqual(decideCodememory(down), { enabled: false, reason: "endpoint-down" });
  assert.deepEqual(decideCodememory(unknown), { enabled: false, reason: "endpoint-down" });
  expectSame(down);
  expectSame(unknown);
});

test("inconclusive plus a reachable local endpoint stays enabled", () => {
  const signals: CodememorySignals = { ...quiet, platform: "linux", endpointReachable: true };
  assert.deepEqual(decideCodememory(signals), { enabled: true, reason: "endpoint-up" });
  expectSame(signals);
});

test("resolve skips probes when the override or a cheap cloud signal already decides", async () => {
  let runtimeReads = 0;
  let probes = 0;
  const deps = {
    platform: "linux" as const,
    readCursorRuntime: async () => {
      runtimeReads += 1;
      return "managed";
    },
    probeEndpoint: async () => {
      probes += 1;
      return true;
    },
  };
  const forced = await resolveCodememory({ ...deps, env: { FMFLURRY_CODEMEMORY: "on" } });
  assert.deepEqual(forced, { enabled: true, reason: "override-on" });
  const blocked = await resolveCodememory({ ...deps, env: { FMFLURRY_CODEMEMORY: "off" } });
  assert.equal(blocked.enabled, false);
  const actions = await resolveCodememory({ ...deps, env: { GITHUB_ACTIONS: "true" } });
  assert.equal(actions.reason, "cloud");
  assert.equal(runtimeReads, 0);
  assert.equal(probes, 0);
});

test("resolve treats a managed Cursor runtime as cloud and does not probe the endpoint", async () => {
  let probes = 0;
  const decision = await resolveCodememory({
    env: {},
    platform: "darwin",
    readCursorRuntime: async () => "managed",
    probeEndpoint: async () => {
      probes += 1;
      return true;
    },
  });
  assert.deepEqual(decision, { enabled: false, reason: "cloud" });
  assert.equal(probes, 0);
});

test("resolve keeps a local Mac enabled without probing the endpoint", async () => {
  let probes = 0;
  const decision = await resolveCodememory({
    env: { CI: "true" },
    platform: "darwin",
    readCursorRuntime: async () => null,
    probeEndpoint: async () => {
      probes += 1;
      return false;
    },
  });
  assert.deepEqual(decision, { enabled: true, reason: "local" });
  assert.equal(probes, 0);
});

test("resolve disables an inconclusive session when the endpoint probe fails", async () => {
  const decision = await resolveCodememory({
    env: {},
    platform: "linux",
    readCursorRuntime: async () => null,
    probeEndpoint: async () => false,
  });
  assert.deepEqual(decision, { enabled: false, reason: "endpoint-down" });
});

test("resolve enables an inconclusive session when the endpoint answers", async () => {
  const decision = await resolveCodememory({
    env: {},
    platform: "linux",
    readCursorRuntime: async () => {
      throw new Error("socket down");
    },
    probeEndpoint: async () => true,
  });
  assert.deepEqual(decision, { enabled: true, reason: "endpoint-up" });
});
