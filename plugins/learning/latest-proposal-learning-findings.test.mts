import assert from "node:assert/strict";
import {
  existsSync,
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

import { synchronizeLearningRuntime } from "./installer-runtime.ts";
import { createProposalQueue } from "./proposal-queue.ts";
import { createProposalLearningRuntime } from "./runtime.ts";

const repositoryRoot = join(import.meta.dirname, "..", "..");
const dayMs = 24 * 60 * 60 * 1_000;

function root(): string {
  return mkdtempSync(join(tmpdir(), "settings-opencode-latest-learning-findings-"));
}

function reviewerResponse(): string {
  return JSON.stringify({
    proposals: [{
      kind: "preference",
      title: "Prefer terse answers",
      rationale: "Repeated direct preference",
      change: "Respond concisely by default.",
    }],
  });
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function readCommand(settingsPath: string): string {
  const settings: unknown = JSON.parse(readFileSync(settingsPath, "utf8"));
  assert.equal(typeof settings, "object");
  assert.notEqual(settings, null);
  assert.equal(Array.isArray(settings), false);
  const hooks = (settings as { readonly hooks?: unknown }).hooks;
  assert.equal(typeof hooks, "object");
  assert.notEqual(hooks, null);
  const userPromptSubmit = (hooks as { readonly UserPromptSubmit?: unknown }).UserPromptSubmit;
  assert.equal(Array.isArray(userPromptSubmit), true);
  const entry = (userPromptSubmit as readonly unknown[]).at(-1);
  assert.equal(typeof entry, "object");
  assert.notEqual(entry, null);
  const commands = (entry as { readonly hooks?: unknown }).hooks;
  assert.equal(Array.isArray(commands), true);
  const command = ((commands as readonly unknown[])[0] as { readonly command?: unknown }).command;
  assert.equal(typeof command, "string");
  return command;
}

test("proposal content is unavailable to conductor, modelled agents, and external tools; the control plane is local CLI only", () => {
  const config = readFileSync(join(repositoryRoot, "opencode.jsonc"), "utf8");
  const stateCli = readFileSync(join(repositoryRoot, "plugins", "learning", "state-cli.ts"), "utf8");

  assert.doesNotMatch(config, /local_learning_state/);
  assert.doesNotMatch(config, /"learn-(?:pending|show|accept|approve|reject|export)"[\s\S]{0,250}"agent"/);
  assert.match(stateCli, /type Command = .*"export"/);
  assert.doesNotMatch(stateCli, /(?:model|provider|fetch|tool|agent)/i);
});

test("Claude managed hook commands are shell-escaped and all equivalent managed entries normalize to one", () => {
  const temporaryRoot = root();
  const sourceRoot = join(temporaryRoot, "source");
  const claudeRoot = join(temporaryRoot, "Claude root with spaces ' and ; metacharacters");
  const settingsPath = join(claudeRoot, "settings.json");
  const managedPath = join(claudeRoot, "hooks", "learning-user-prompt-submit.sh");
  mkdirSync(join(sourceRoot, "claude", "hooks"), { recursive: true });
  mkdirSync(join(sourceRoot, "plugins", "learning"), { recursive: true });
  mkdirSync(claudeRoot, { recursive: true });
  writeFileSync(join(sourceRoot, "claude", "hooks", "learning-user-prompt-submit.sh"), "#!/usr/bin/env bash\n");
  writeFileSync(join(sourceRoot, "plugins", "learning", "claude-runtime.ts"), "export {};\n");
  writeFileSync(settingsPath, JSON.stringify({
    hooks: {
      UserPromptSubmit: [{ matcher: "*", hooks: [{ type: "command", command: shellQuote(managedPath) }] }],
    },
  }));

  try {
    synchronizeLearningRuntime({ sourceRoot, openCodeRoot: join(temporaryRoot, "opencode"), claudeRoot, targets: { opencode: false, claude: true } });
    const settings = readFileSync(settingsPath, "utf8");
    assert.equal((settings.match(/learning-user-prompt-submit\.sh/g) ?? []).length, 1);
    assert.equal(readCommand(settingsPath), shellQuote(managedPath));
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test("session descriptors are non-reversible, expire, and cannot survive disable then re-enable", async () => {
  const temporaryRoot = root();
  const statePath = join(temporaryRoot, "proposals.json");
  let clock = 1;
  let reviewerInvocations = 0;
  const originalDateNow = Date.now;
  Date.now = () => clock;
  const queue = createProposalQueue({ statePath, now: () => clock });
  const runtime = createProposalLearningRuntime({
    env: { OPENCODE_MODEL_LEARNING: "http://127.0.0.1:11434/v1" },
    homeDirectory: temporaryRoot,
    queue,
    probe: async () => true,
    invokeReviewer: async () => {
      reviewerInvocations += 1;
      return reviewerResponse();
    },
  });

  try {
    await queue.setEnabled(true, { noticeAcknowledgedAt: 1, profile: "local-owner", noticeVersion: "2026-07-17", noticeHash: "sha256:190b3b554de3ac1a5d9b5d89843b8a17a0e6c76e385ae8fd023dd405e29a890e", controller: "Local profile owner", lawfulBasis: "household activity", householdContext: "personal household use" });
    await runtime.captureOpenCode({ role: "user", sessionId: "session", parts: [{ type: "text", text: "I prefer terse answers." }] });
    await queue.setEnabled(false, { profile: "local-owner", revokedAt: 2 });
    await queue.setEnabled(true, { noticeAcknowledgedAt: 3, profile: "local-owner" });
    await runtime.captureOpenCode({ role: "user", sessionId: "session", parts: [{ type: "text", text: "I prefer terse answers." }] });
    clock += 31 * dayMs;
    await runtime.captureOpenCode({ role: "user", sessionId: "session", parts: [{ type: "text", text: "I prefer terse answers." }] });

    assert.equal(reviewerInvocations, 0);
    assert.doesNotMatch(readFileSync(join(repositoryRoot, "plugins", "learning", "runtime.ts"), "utf8"), /text:\s*sanitized\.text/);
  } finally {
    Date.now = originalDateNow;
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test("revocation waits for an in-flight reviewer before reporting success and prevents its result from being queued", async () => {
  const temporaryRoot = root();
  const queue = createProposalQueue({ statePath: join(temporaryRoot, "proposals.json") });
  let startReview: (() => void) | undefined;
  const reviewerStarted = new Promise<void>((resolve) => { startReview = resolve; });
  let finishReview: ((value: string) => void) | undefined;
  const reviewerFinished = new Promise<string>((resolve) => { finishReview = resolve; });
  const runtime = createProposalLearningRuntime({
    env: { OPENCODE_MODEL_LEARNING: "http://127.0.0.1:11434/v1" },
    homeDirectory: temporaryRoot,
    queue,
    probe: async () => true,
    invokeReviewer: async () => {
      startReview?.();
      return reviewerFinished;
    },
  });

  try {
    await queue.setEnabled(true, { noticeAcknowledgedAt: 1, profile: "local-owner", noticeVersion: "2026-07-17", noticeHash: "sha256:190b3b554de3ac1a5d9b5d89843b8a17a0e6c76e385ae8fd023dd405e29a890e", controller: "Local profile owner", lawfulBasis: "household activity", householdContext: "personal household use" });
    await runtime.captureOpenCode({ role: "user", sessionId: "session", parts: [{ type: "text", text: "I prefer terse answers." }] });
    const capture = runtime.captureOpenCode({ role: "user", sessionId: "session", parts: [{ type: "text", text: "I prefer terse answers." }] });
    await reviewerStarted;

    let revokeReported = false;
    const revoke = queue.setEnabled(false, { revokedAt: 2, profile: "local-owner" }).then(() => { revokeReported = true; });
    await Promise.resolve();
    assert.equal(revokeReported, false);

    finishReview?.(reviewerResponse());
    await Promise.all([capture, revoke]);
    assert.deepEqual(await queue.list(), []);
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test("maintenance is safely installed for Darwin, Linux, and Windows with a fixed purge-only command", () => {
  const installer = readFileSync(join(repositoryRoot, "install.sh"), "utf8");

  assert.match(installer, /Darwin/);
  assert.match(installer, /launchctl bootstrap/);
  assert.match(installer, /Linux|systemctl --user|systemd|cron/);
  assert.match(installer, /schtasks(?:\.exe)?|Register-ScheduledTask/);
  assert.match(installer, /state-cli\.ts.*purge/);
  assert.doesNotMatch(installer, /state-cli\.ts.*\$[@*]/);
});

test("activation records the exact notice and accountability context, and rejects incomplete profile metadata", async () => {
  const temporaryRoot = root();
  const statePath = join(temporaryRoot, "proposals.json");
  const queue = createProposalQueue({ statePath });

  try {
    await queue.setEnabled(true, { noticeAcknowledgedAt: 1, profile: "local-owner" });
    assert.equal((await queue.status()).enabled, false);

    const activation = {
      noticeAcknowledgedAt: 2,
      profile: "local-owner",
      noticeVersion: "2026-07-17",
       noticeHash: "sha256:190b3b554de3ac1a5d9b5d89843b8a17a0e6c76e385ae8fd023dd405e29a890e",
      controller: "Local profile owner",
      lawfulBasis: "household activity",
      householdContext: "personal household use",
    };
    await queue.setEnabled(true, activation);
    const persisted: unknown = JSON.parse(readFileSync(statePath, "utf8"));
    assert.deepEqual((persisted as { readonly acknowledgement?: unknown }).acknowledgement, activation);
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test("transparency documentation describes local raw-prompt disposal, trusted loopback limits, and personal versus organizational accountability", () => {
  const learning = readFileSync(join(repositoryRoot, "LEARNING.md"), "utf8");

  assert.match(learning, /raw direct prompt[\s\S]{0,180}processed locally[\s\S]{0,180}descriptor[\s\S]{0,180}discard/i);
  assert.match(learning, /reviewer is only[\s\S]{0,180}offline executable[\s\S]{0,180}model-artifact[\s\S]{0,500}verifies[\s\S]{0,180}SHA-256/i);
  assert.match(learning, /personal[\s\S]{0,180}(?:household|accountability)[\s\S]{0,300}organizational[\s\S]{0,180}(?:controller|lawful basis)/i);
});

test("queue state, processing records, retention, export, and deletion use one serialized transactional audit boundary", () => {
  const queue = readFileSync(join(repositoryRoot, "plugins", "learning", "proposal-queue.ts"), "utf8");

  assert.match(queue, /async recordProcessing\(\)\s*\{[\s\S]{0,500}mutate/);
  assert.match(queue, /async exportAll\(\)[\s\S]{0,700}(?:acquireLock|mutate)/);
  assert.doesNotMatch(queue, /async deleteAll\(\)[\s\S]{0,1200}rm\(auditPath/);
});

test("installer rejects symlinked target components before copying runtime or writing a manifest", () => {
  const temporaryRoot = root();
  const sourceRoot = join(temporaryRoot, "source");
  const externalRoot = join(temporaryRoot, "external");
  const openCodeRoot = join(temporaryRoot, "opencode");
  mkdirSync(join(sourceRoot, "opencode"), { recursive: true });
  mkdirSync(externalRoot, { recursive: true });
  writeFileSync(join(sourceRoot, "opencode", "learning-runtime.ts"), "export {};\n");
  symlinkSync(externalRoot, openCodeRoot);

  try {
    assert.throws(() => synchronizeLearningRuntime({
      sourceRoot,
      openCodeRoot,
      claudeRoot: join(temporaryRoot, "claude"),
      targets: { opencode: true, claude: false },
    }));
    assert.equal(existsSync(join(externalRoot, "plugins", "learning-runtime.ts")), false);
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test("the official npm test command runs every learning test with a declared strip-types-compatible Node version", () => {
  const packageJson: unknown = JSON.parse(readFileSync(join(repositoryRoot, "package.json"), "utf8"));
  const manifest = packageJson as {
    readonly scripts?: Readonly<Record<string, string>>;
    readonly engines?: Readonly<Record<string, string>>;
  };

  assert.match(manifest.scripts?.test ?? "", /node .*--test.*plugins\/learning/);
  assert.match(manifest.scripts?.test ?? "", /--experimental-strip-types|tsx|ts-node/);
  assert.match(manifest.engines?.node ?? "", />=22\.6/);
});
