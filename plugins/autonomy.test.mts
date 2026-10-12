import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { blockReason, denyReason, runHook } from "./lib/autonomy-hooks.ts";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dirs = [path.join(repo, ".claude/hooks")];

const setup = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "autonomy-"));
  const state = path.join(root, "state");
  fs.mkdirSync(state);
  fs.mkdirSync(path.join(root, "proj"));
  const env = { AGENT_HARNESS_TEST: "1", AGENT_STATE_DIR: state, NO_COLOR: "1" };
  return { root, state, env, opts: { directory: path.join(root, "proj"), env, dirs } };
};

test("git guard is a no-op when autonomy is off", async () => {
  const { opts } = setup();
  const result = await runHook("autonomy-git-guard.sh", { tool_input: { command: "git push origin main" } }, opts);
  assert.equal(result, null);
});

test("git guard denies a push to the base branch when autonomy is on", async () => {
  const { opts, state } = setup();
  fs.writeFileSync(path.join(state, "autonomy.on"), "");
  const result = await runHook("autonomy-git-guard.sh", { tool_input: { command: "git push origin main" } }, opts);
  assert.ok(denyReason(result));
});

test("stop gate blocks when a goal is active without a PR", async () => {
  const { opts, state } = setup();
  fs.writeFileSync(path.join(state, "autonomy.on"), "");
  execFileSync("bash", [path.join(repo, "scripts/agent-harness/goal.sh"), "set", "ship it"], {
    cwd: opts.directory,
    env: { ...process.env, CLAUDE_PROJECT_DIR: opts.directory, ...opts.env },
    stdio: "ignore",
  });
  const result = await runHook("ship-stop-gate.sh", {}, opts);
  assert.ok(blockReason(result));
});

test("hook that exceeds its timeout fails open", async () => {
  const { opts, root } = setup();
  const slowDir = path.join(root, "slow");
  fs.mkdirSync(slowDir);
  fs.writeFileSync(path.join(slowDir, "slow.sh"), "sleep 5\necho '{\"decision\":\"block\"}'\n");
  const result = await runHook("slow.sh", {}, { ...opts, dirs: [slowDir], timeoutMs: 200 });
  assert.equal(result, null);
});
