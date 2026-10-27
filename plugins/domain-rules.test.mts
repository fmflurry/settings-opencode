import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import type { PluginInput } from "@opencode-ai/plugin";
import { DomainRulesPlugin } from "./domain-rules.ts";
import { decideDomainRules, executeDomainRules } from "./lib/domain-rules.ts";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const hook = path.join(repo, ".claude/hooks/domain-rules.sh");

function project() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "domain-rules-"));
  const script = path.join(root, "scripts/check-domain-rules.sh");
  fs.mkdirSync(path.dirname(script), { recursive: true });
  fs.writeFileSync(script, "#!/bin/bash\nprintf ran >> \"$HARNESS_PROJECT_ROOT/ran.txt\"\nexit 1\n");
  fs.chmodSync(script, 0o755);
  return root;
}

test("domain-rules stays off when config is missing or disabled", () => {
  const root = project();
  try {
    assert.deepEqual(decideDomainRules(root), { action: "skip" });
    assert.deepEqual(executeDomainRules(decideDomainRules(root)), { code: 0, stderr: "" });
    fs.mkdirSync(path.join(root, ".harness-local"));
    fs.writeFileSync(path.join(root, ".harness-local/domain-rules.json"), '{"enabled": false}\n');
    assert.equal(decideDomainRules(path.join(root, "src")).action, "skip");
    assert.equal(executeDomainRules(decideDomainRules(root)).code, 0);
    assert.equal(fs.existsSync(path.join(root, "ran.txt")), false);

    const ran = spawnSync("bash", [hook], { cwd: root, encoding: "utf8" });
    assert.equal(ran.status, 0, ran.stderr);
    assert.equal(fs.existsSync(path.join(root, "ran.txt")), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("an enabled domain-rules script runs and a failure blocks", () => {
  const root = project();
  try {
    fs.mkdirSync(path.join(root, ".harness-local"));
    fs.writeFileSync(
      path.join(root, ".harness-local/domain-rules.json"),
      '{"enabled": true, "script": "scripts/check-domain-rules.sh"}\n',
    );
    const result = executeDomainRules(decideDomainRules(root));
    assert.equal(result.code, 2);
    assert.equal(fs.readFileSync(path.join(root, "ran.txt"), "utf8"), "ran");
    const ran = spawnSync("bash", [hook], { cwd: root, encoding: "utf8" });
    assert.equal(ran.status, 2, ran.stderr);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("an escaping script path is refused and not executed", () => {
  const root = project();
  try {
    fs.mkdirSync(path.join(root, ".harness-local"));
    fs.writeFileSync(
      path.join(root, ".harness-local/domain-rules.json"),
      '{"enabled": true, "script": "../check-domain-rules.sh"}\n',
    );
    const decision = decideDomainRules(root);
    assert.equal(decision.action, "error");
    assert.equal(executeDomainRules(decision).code, 2);
    assert.equal(fs.existsSync(path.join(root, "ran.txt")), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("a script symlink that leaves the project is refused", () => {
  const root = project();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "domain-escape-"));
  try {
    fs.writeFileSync(path.join(outside, "escape.sh"), "#!/bin/bash\nexit 1\n");
    fs.rmSync(path.join(root, "scripts/check-domain-rules.sh"));
    fs.symlinkSync(path.join(outside, "escape.sh"), path.join(root, "scripts/check-domain-rules.sh"));
    fs.mkdirSync(path.join(root, ".harness-local"));
    fs.writeFileSync(
      path.join(root, ".harness-local/domain-rules.json"),
      '{"enabled": true, "script": "scripts/check-domain-rules.sh"}\n',
    );
    const decision = decideDomainRules(root);
    assert.equal(decision.action, "error");
    assert.equal(executeDomainRules(decision).code, 2);
    assert.equal(fs.existsSync(path.join(root, "ran.txt")), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test("the OpenCode plugin blocks edits only when the project script is enabled", async () => {
  const root = project();
  try {
    const plugin = await DomainRulesPlugin({ directory: root } as PluginInput);
    const before = plugin["tool.execute.before"];
    await before({ tool: "edit" }, { args: { filePath: "src/app.ts" } });
    assert.equal(fs.existsSync(path.join(root, "ran.txt")), false);

    fs.mkdirSync(path.join(root, ".harness-local"));
    fs.writeFileSync(path.join(root, ".harness-local/domain-rules.json"), '{"enabled": true}\n');
    await before({ tool: "bash" }, { args: { command: "true" } });
    assert.equal(fs.existsSync(path.join(root, "ran.txt")), false);
    await assert.rejects(before({ tool: "write" }, { args: {} }), /domain-rules/);
    assert.equal(fs.readFileSync(path.join(root, "ran.txt"), "utf8"), "ran");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
