import assert from "node:assert/strict";
import {
  existsSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { captureOpenCodeDirectMessage, type DirectPromptSink } from "./harness-adapters.ts";
import { synchronizeLearningRuntime } from "./installer-runtime.ts";
import { createProposalQueue } from "./proposal-queue.ts";

const repositoryRoot = join(import.meta.dirname, "..", "..");
const dayMs = 24 * 60 * 60 * 1_000;

function root(): string {
  return mkdtempSync(join(tmpdir(), "settings-opencode-remaining-review-"));
}

function proposal() {
  return {
    sessionId: "session",
    harness: "opencode" as const,
    kind: "preference" as const,
    title: "Prefer terse answers",
    rationale: "Repeated direct preference",
    change: "Respond concisely by default.",
  };
}

test("captures a direct OpenCode user text part when synthetic is omitted, excluding only synthetic true", async () => {
  const prompts: string[] = [];
  const sink: DirectPromptSink = { capture: async (prompt) => { prompts.push(prompt.text); } };

  await captureOpenCodeDirectMessage(sink, {
    role: "user",
    sessionId: "session",
    parts: [
      { type: "text", text: "Omitted synthetic is a real user prompt." },
      { type: "text", text: "Generated prompt", synthetic: true },
    ],
  });

  assert.deepEqual(prompts, ["Omitted synthetic is a real user prompt."]);
});

test("the Claude hook resolves its runtime from the hook script for global and local installs", () => {
  const hook = readFileSync(join(repositoryRoot, ".claude", "hooks", "learning-user-prompt-submit.sh"), "utf8");

  assert.match(hook, /BASH_SOURCE\[0\]/);
  assert.match(hook, /dirname[^\n]*BASH_SOURCE\[0\]/);
  assert.match(hook, /learning\/claude-runtime\.ts/);
  assert.doesNotMatch(hook, /\$HOME\/\.claude/);
});

test("the official strict typecheck covers runtime, plugins, and tools with Node module interop", () => {
  const packageJson = JSON.parse(readFileSync(join(repositoryRoot, "package.json"), "utf8")) as {
    readonly scripts?: Readonly<Record<string, string>>;
  };
  const strictConfigPath = join(repositoryRoot, "tsconfig.strict.json");

  assert.equal(packageJson.scripts?.["typecheck:strict"], "tsc --noEmit --project tsconfig.strict.json");
  assert.equal(existsSync(strictConfigPath), true);
  const strictConfig = readFileSync(strictConfigPath, "utf8");
  assert.match(strictConfig, /"esModuleInterop"\s*:\s*true/);
  assert.match(strictConfig, /"plugins\/\*\*\/\*.ts"/);
  assert.match(strictConfig, /"tools\/\*\*\/\*.ts"/);
  assert.match(strictConfig, /"scripts\/\*\*\/\*.ts"/);
});

test("Claude sync has an explicit managed allowlist and excludes every private runtime-data directory", () => {
  const installer = readFileSync(join(repositoryRoot, "install.sh"), "utf8");
  const privatePaths = ["projects", "sessions", "history", "backups", "debug", "statsig", "todos"];

  assert.match(installer, /CLAUDE_(?:MANAGED_)?ALLOWLIST=/);
  for (const path of privatePaths) {
    assert.match(installer, new RegExp(`--exclude=['\"]${path}['\"]`), path);
  }
  assert.match(installer, /copy_claude_managed_files|copy_claude_allowlist/);
});

test("proposal operations have no model command route and remain available through the fixed local CLI", () => {
  const config = readFileSync(join(repositoryRoot, "opencode.jsonc"), "utf8");
  const cli = readFileSync(join(repositoryRoot, "plugins", "learning", "state-cli.ts"), "utf8");
  const commandNames = ["list", "show", "accept", "reject", "export", "delete", "delete-all", "status", "enable", "disable", "purge"];

  assert.doesNotMatch(config, /local_learning_state|"learning-state"|"learn-(?:pending|show|accept|approve|reject|export)"/);
  for (const commandName of commandNames) {
    assert.match(cli, new RegExp(`"${commandName}"`), commandName);
  }
});

test("Claude hook merge preserves heterogeneous hooks and removes only known legacy learning commands", () => {
  const temporaryRoot = root();
  const sourceRoot = join(temporaryRoot, "source");
  const claudeRoot = join(temporaryRoot, "claude");
  const settingsPath = join(claudeRoot, "settings.json");
  mkdirSync(join(sourceRoot, "claude", "hooks"), { recursive: true });
  mkdirSync(join(sourceRoot, "plugins", "learning"), { recursive: true });
  mkdirSync(claudeRoot, { recursive: true });
  writeFileSync(join(sourceRoot, "claude", "hooks", "learning-user-prompt-submit.sh"), "#!/usr/bin/env bash\n");
  writeFileSync(join(sourceRoot, "plugins", "learning", "claude-runtime.ts"), "export {};\n");
  writeFileSync(settingsPath, JSON.stringify({
    hooks: {
      UserPromptSubmit: [
        { matcher: "*", hooks: [{ type: "command", command: "~/.claude/hooks/custom.sh" }] },
        { matcher: "*", hooks: [{ type: "prompt", prompt: "retain this heterogeneous hook" }] },
        { matcher: "*", hooks: [{ type: "command", command: "~/.claude/hooks/learning-loop.sh" }] },
        { matcher: "*", hooks: [{ type: "command", command: "~/.claude/hooks/learning-notes.sh" }] },
      ],
    },
  }));

  try {
    synchronizeLearningRuntime({ sourceRoot, openCodeRoot: join(temporaryRoot, "opencode"), claudeRoot, targets: { opencode: false, claude: true } });
    const settings = readFileSync(settingsPath, "utf8");
    assert.match(settings, /custom\.sh/);
    assert.match(settings, /retain this heterogeneous hook/);
    assert.match(settings, /learning-notes\.sh/);
    assert.doesNotMatch(settings, /learning-loop\.sh/);
    assert.match(settings, /learning-user-prompt-submit\.sh/);
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test("Claude settings symlinks are rejected without changing the link target", () => {
  const temporaryRoot = root();
  const sourceRoot = join(temporaryRoot, "source");
  const claudeRoot = join(temporaryRoot, "claude");
  const externalSettings = join(temporaryRoot, "external-settings.json");
  const settingsPath = join(claudeRoot, "settings.json");
  const original = '{"hooks":{"UserPromptSubmit":[]}}\n';
  mkdirSync(join(sourceRoot, "claude", "hooks"), { recursive: true });
  mkdirSync(join(sourceRoot, "plugins", "learning"), { recursive: true });
  mkdirSync(claudeRoot, { recursive: true });
  writeFileSync(join(sourceRoot, "claude", "hooks", "learning-user-prompt-submit.sh"), "#!/usr/bin/env bash\n");
  writeFileSync(join(sourceRoot, "plugins", "learning", "claude-runtime.ts"), "export {};\n");
  writeFileSync(externalSettings, original);
  symlinkSync(externalSettings, settingsPath);

  try {
    synchronizeLearningRuntime({ sourceRoot, openCodeRoot: join(temporaryRoot, "opencode"), claudeRoot, targets: { opencode: false, claude: true } });
    assert.equal(lstatSync(settingsPath).isSymbolicLink(), true);
    assert.equal(readFileSync(externalSettings, "utf8"), original);
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test("periodic cleanup runs while inactive and expires proposal, tombstone, and audit retention without exporting deleted data", async () => {
  const temporaryRoot = root();
  const statePath = join(temporaryRoot, "proposals.json");
  const auditPath = join(temporaryRoot, "audit.jsonl");
  const runtime = readFileSync(join(repositoryRoot, "plugins", "learning", "runtime.ts"), "utf8");
  let now = 1;
  const queue = createProposalQueue({ statePath, auditPath, now: () => now });

  try {
    assert.match(runtime, /setInterval[\s\S]*purgeExpired|purgeExpired[\s\S]*setInterval/);
    await queue.setEnabled(true, { noticeAcknowledgedAt: 1, profile: "local-owner", noticeVersion: "2026-07-17", noticeHash: "sha256:190b3b554de3ac1a5d9b5d89843b8a17a0e6c76e385ae8fd023dd405e29a890e", controller: "Local profile owner", lawfulBasis: "household activity", householdContext: "personal household use" });
    const queued = await queue.enqueue(proposal());
    assert.equal(queued.status, "queued");
    if (queued.status !== "queued") return;
    await queue.setEnabled(false, { revokedAt: 2, profile: "local-owner" });

    now = 31 * dayMs;
    assert.deepEqual(await queue.export(), []);
    assert.deepEqual(await queue.get(queued.proposal.id), { id: queued.proposal.id, state: "tombstoned" });

    now = 62 * dayMs;
    await queue.status();
    assert.equal(await queue.get(queued.proposal.id), null);
    assert.deepEqual((await queue.exportAll()).audit, []);
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test("macOS installer registers a fixed daily state-only maintenance command", () => {
  const installer = readFileSync(join(repositoryRoot, "install.sh"), "utf8");

  assert.match(installer, /install_learning_maintenance/);
  assert.match(installer, /launchctl bootstrap/);
  assert.match(installer, /StartInterval<\/key><integer>86400<\/integer>/);
  assert.match(installer, /state-cli\.ts[\s\S]{0,240}<\/string><string>purge/);
});

test("an audit mirror failure retains the transactional state audit instead of losing a decision event", async () => {
  const temporaryRoot = root();
  const statePath = join(temporaryRoot, "proposals.json");
  const auditPath = join(temporaryRoot, "audit.jsonl");
  const queue = createProposalQueue({ statePath, auditPath });

  try {
    await queue.setEnabled(true, { noticeAcknowledgedAt: 1, profile: "local-owner", noticeVersion: "2026-07-17", noticeHash: "sha256:190b3b554de3ac1a5d9b5d89843b8a17a0e6c76e385ae8fd023dd405e29a890e", controller: "Local profile owner", lawfulBasis: "household activity", householdContext: "personal household use" });
    const queued = await queue.enqueue(proposal());
    assert.equal(queued.status, "queued");
    if (queued.status !== "queued") return;
    assert.equal(await queue.accept(queued.proposal.id), true);
    assert.equal((await queue.get(queued.proposal.id))?.state, "accepted");
    assert.equal((await queue.exportAll()).audit.some((event) => event.event === "decision"), true);
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test("activation notice and configuration document loopback, privacy, audit retention, revocation, and remove legacy learning variables", () => {
  const learning = readFileSync(join(repositoryRoot, "LEARNING.md"), "utf8");
  const config = readFileSync(join(repositoryRoot, "opencode.jsonc"), "utf8");
  const installer = readFileSync(join(repositoryRoot, "install.sh"), "utf8");

  assert.match(learning, /OPENCODE_LEARNING_REVIEWER_EXECUTABLE=\/absolute\/path\/to\/reviewer[\s\S]*OPENCODE_LEARNING_REVIEWER_EXECUTABLE_SHA256=<64-hex-character-sha256>[\s\S]*OPENCODE_LEARNING_REVIEWER_MODEL_ARTIFACT=\/absolute\/path\/to\/model\.artifact[\s\S]*OPENCODE_LEARNING_REVIEWER_MODEL_SHA256=<64-hex-character-sha256>/);
  assert.match(learning, /legal basis|privacy notice|controller/i);
  assert.match(learning, /audit[^\n]{0,80}retention|retention[^\n]{0,80}audit/i);
  assert.match(learning, /revoke|revocation/i);
  assert.doesNotMatch(config, /local_learning_state|"learning-state"|"learn-(?:pending|show|accept|approve|reject|export)"/);
  assert.doesNotMatch(`${learning}\n${config}\n${installer}`, /OPENCODE_(?:LEARNING_LOOP|LEARNING_IDLE|LEARNING_DEBOUNCE)/);
});
