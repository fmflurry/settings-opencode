import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { AutonomyPlugin } from "./autonomy.ts";
import { bashGuardRejection, blockReason, denyReason, runHook, runHookText } from "./lib/autonomy-hooks.ts";

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

test("hook lookup prefers the checkout .claude/hooks directory", async () => {
  const { root } = setup();
  const directory = path.join(root, "proj");
  const hooks = path.join(directory, ".claude", "hooks");
  fs.mkdirSync(hooks, { recursive: true });
  fs.writeFileSync(path.join(hooks, "marker.sh"), "echo checkout-hook\n");
  const text = await runHookText("marker.sh", {}, { directory, env: { NO_COLOR: "1" } });
  assert.equal(text, "checkout-hook");
});

const writeGuard = (dir: string, body: string) => {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "autonomy-git-guard.sh"), body);
};

test("bash guard rejection fails closed when the hook is missing", async () => {
  const { opts, root } = setup();
  const reason = await bashGuardRejection({}, { ...opts, dirs: [path.join(root, "missing-hooks")] });
  assert.match(reason ?? "", /autonomy-git-guard\.sh was not found/);
});

test("bash guard rejection fails closed when the hook times out", async () => {
  const { opts, root } = setup();
  const slowDir = path.join(root, "slow-guard");
  writeGuard(slowDir, "sleep 5\n");
  const reason = await bashGuardRejection({}, { ...opts, dirs: [slowDir], timeoutMs: 200 });
  assert.match(reason ?? "", /timed out/);
});

test("bash guard rejection fails closed when the hook exits non-zero", async () => {
  const { opts, root } = setup();
  const dir = path.join(root, "bad-exit");
  writeGuard(dir, "exit 1\n");
  const reason = await bashGuardRejection({}, { ...opts, dirs: [dir] });
  assert.match(reason ?? "", /failed/);
});

test("bash guard rejection fails closed on invalid hook output", async () => {
  const { opts, root } = setup();
  const dir = path.join(root, "bad-json");
  writeGuard(dir, "echo 'not-json'\n");
  const reason = await bashGuardRejection({}, { ...opts, dirs: [dir] });
  assert.match(reason ?? "", /invalid output/);
});

test("bash guard rejection does not treat ask as allow", async () => {
  const { opts, root } = setup();
  const dir = path.join(root, "ask-hook");
  writeGuard(
    dir,
    "echo '{\"hookSpecificOutput\":{\"permissionDecision\":\"ask\",\"permissionDecisionReason\":\"confirm the push\"}}'\n",
  );
  const reason = await bashGuardRejection({ tool_input: { command: "git status" } }, { ...opts, dirs: [dir] });
  assert.match(reason ?? "", /confirm the push/);
});

test("bash guard rejection allows an empty successful hook", async () => {
  const { opts, root } = setup();
  const dir = path.join(root, "empty-hook");
  writeGuard(dir, "exit 0\n");
  const reason = await bashGuardRejection({}, { ...opts, dirs: [dir] });
  assert.equal(reason, null);
});

test("bash tool throws when the checkout git guard asks", async () => {
  const { root } = setup();
  const directory = path.join(root, "proj");
  const hooks = path.join(directory, ".claude", "hooks");
  writeGuard(
    hooks,
    "echo '{\"hookSpecificOutput\":{\"permissionDecision\":\"ask\",\"permissionDecisionReason\":\"confirm the push\"}}'\n",
  );
  const plugin = await AutonomyPlugin({
    directory,
    client: {} as never,
    $: (() => undefined) as never,
  });
  await assert.rejects(
    () => plugin["tool.execute.before"]({ tool: "bash" }, { args: { command: "git status" } }),
    /confirm the push/,
  );
});
