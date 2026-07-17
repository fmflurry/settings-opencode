import assert from "node:assert/strict";
import {
  chmodSync,
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

import {
  createLearningRuntimeGate,
  sanitizeDirectUserPrompt,
} from "./policy.ts";
import { createProposalQueue } from "./proposal-queue.ts";
import { createProposalLearningRuntime } from "./runtime.ts";
import { synchronizeLearningRuntime } from "./installer-runtime.ts";

const repositoryRoot = join(import.meta.dirname, "..", "..");
const dayMs = 24 * 60 * 60 * 1_000;

function proposal(sessionId = "session"): {
  readonly sessionId: string;
  readonly harness: "opencode";
  readonly kind: "preference";
  readonly title: string;
  readonly rationale: string;
  readonly change: string;
} {
  return {
    sessionId,
    harness: "opencode",
    kind: "preference",
    title: "Prefer terse answers",
    rationale: "Repeated direct preference",
    change: "Respond concisely by default.",
  };
}

function makeRoot(): string {
  return mkdtempSync(join(tmpdir(), "settings-opencode-learning-review-"));
}

test("chat.message uses output.message.role and only routes eligible direct user text", () => {
  const runtimePlugin = readFileSync(join(repositoryRoot, "plugins", "learning-runtime.ts"), "utf8");

  assert.match(runtimePlugin, /role:\s*output\.message\?\.role/);
  assert.doesNotMatch(runtimePlugin, /role:\s*output\.info\?\.role/);
  assert.match(runtimePlugin, /captureOpenCode\(\{[\s\S]*sessionId:[\s\S]*parts:/);
});

test("learning is disabled until acknowledged activation, and corrupt or missing state fails closed", async () => {
  const root = makeRoot();
  const missingStatePath = join(root, "missing", "proposals.json");
  const corruptStatePath = join(root, "corrupt", "proposals.json");
  mkdirSync(join(root, "corrupt"), { recursive: true });
  writeFileSync(corruptStatePath, "not JSON");

  try {
    const missing = createProposalQueue({ statePath: missingStatePath });
    const corrupt = createProposalQueue({ statePath: corruptStatePath });

    assert.equal((await missing.status()).enabled, false);
    assert.equal((await corrupt.status()).enabled, false);
    assert.equal((await missing.enqueue(proposal())).status, "disabled");
    assert.equal(readFileSync(corruptStatePath, "utf8"), "not JSON");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("activation requires notice acknowledgement metadata and can be revoked", async () => {
  const root = makeRoot();
  const queue = createProposalQueue({ statePath: join(root, "proposals.json") });

  try {
    await queue.setEnabled(true);
    assert.equal((await queue.status()).enabled, false);

    await queue.setEnabled(true, { noticeAcknowledgedAt: 1, profile: "local-owner", noticeVersion: "2026-07-17", noticeHash: "sha256:190b3b554de3ac1a5d9b5d89843b8a17a0e6c76e385ae8fd023dd405e29a890e", controller: "Local profile owner", lawfulBasis: "household activity", householdContext: "personal household use" });
    assert.equal((await queue.status()).enabled, true);

    await queue.setEnabled(false, { revokedAt: 2, profile: "local-owner" });
    assert.equal((await queue.status()).enabled, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("disabled or corrupt state prevents reviewer invocation and queue writes before sanitization can become processing", async () => {
  const root = makeRoot();
  const statePath = join(root, "proposals.json");
  writeFileSync(statePath, "corrupt-state");
  let invocations = 0;
  const runtime = createProposalLearningRuntime({
    env: { OPENCODE_MODEL_LEARNING: "http://127.0.0.1:11434/v1" },
    homeDirectory: root,
    probe: async () => true,
    queue: createProposalQueue({ statePath }),
    invokeReviewer: async () => {
      invocations += 1;
      return JSON.stringify({ proposals: [proposal()] });
    },
  });

  try {
    await runtime.captureOpenCode({
      role: "user",
      sessionId: "session",
      parts: [{ type: "text", text: "I prefer terse answers.", synthetic: false }],
    });
    await runtime.captureOpenCode({
      role: "user",
      sessionId: "session",
      parts: [{ type: "text", text: "Please keep answers terse.", synthetic: false }],
    });

    assert.equal(invocations, 0);
    assert.equal(readFileSync(statePath, "utf8"), "corrupt-state");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("sanitization drops arbitrary and sensitive prose instead of retaining it for the model or queue", () => {
  const disallowedInputs = [
    "I prefer terse answers, signed Alice Martin.",
    "My address is 12 rue des Fleurs, 75001 Paris.",
    "Customer ID 01HZX8R6VY3K5N1P2Q4R7S9T0U requests terse answers.",
    "Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.payload.signature",
    "github_pat_11AAABBBCCCDDDEEEFFFGGGHHH",
    "AKIAIOSFODNN7EXAMPLE",
    "-----BEGIN PRIVATE KEY-----\nMIIBVgIBADANBgkqhkiG9w0BAQEFAASC",
    "IBAN FR76 3000 6000 0112 3456 7890 189",
    "Card 4111 1111 1111 1111",
    "/Users/alice/private/transcript.jsonl",
    "https://example.test/review?token=super-secret",
    "<tool_output>credential=leaked</tool_output>",
    "[assistant] Earlier assistant transcript content",
  ];

  for (const input of disallowedInputs) {
    assert.deepEqual(sanitizeDirectUserPrompt(input), { text: "", redacted: true }, input);
  }
});

test("the reviewer endpoint accepts only an enforceably local executable configuration", async () => {
  const localhost = createLearningRuntimeGate({ OPENCODE_MODEL_LEARNING: "http://localhost:11434/v1" });
  const ipv4 = createLearningRuntimeGate({ OPENCODE_MODEL_LEARNING: "http://127.0.0.1:11434/v1" });
  const ipv6 = createLearningRuntimeGate({ OPENCODE_MODEL_LEARNING: "http://[::1]:11434/v1" });
  const ollama = createLearningRuntimeGate({ OPENCODE_MODEL_LEARNING: "ollama://llama3.2" });
  const cloud = createLearningRuntimeGate({ OPENCODE_MODEL_LEARNING: "https://model.example.test/v1" });

  assert.equal(localhost.endpoint, null);
  assert.equal(ipv4.endpoint, null);
  assert.equal(ipv6.endpoint, null);
  assert.equal(ollama.endpoint, null);
  assert.equal(cloud.endpoint, null);

  assert.equal(await ollama.isEnabled({ probe: async () => true }), false);
});

test("expiry is enforced before list, get, status, and mutations, leaving a tombstone", async () => {
  const root = makeRoot();
  let now = 0;
  const queue = createProposalQueue({ statePath: join(root, "proposals.json"), now: () => now });

  try {
    const queued = await queue.enqueue(proposal());
    assert.equal(queued.status, "disabled", "activation is required before queueing");

    await queue.setEnabled(true, { noticeAcknowledgedAt: 1, profile: "local-owner", noticeVersion: "2026-07-17", noticeHash: "sha256:190b3b554de3ac1a5d9b5d89843b8a17a0e6c76e385ae8fd023dd405e29a890e", controller: "Local profile owner", lawfulBasis: "household activity", householdContext: "personal household use" });
    const activated = await queue.enqueue(proposal());
    assert.equal(activated.status, "queued");
    if (activated.status !== "queued") return;

    now = 31 * dayMs;
    assert.deepEqual(await queue.list(), []);
    assert.deepEqual(await queue.get(activated.proposal.id), {
      id: activated.proposal.id,
      state: "tombstoned",
    });
    assert.equal(await queue.accept(activated.proposal.id), false);
    assert.equal((await queue.status()).tombstones, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("queue fails closed for symlinked or insecure state and never takes over a stale lock", async () => {
  const root = makeRoot();
  const externalStatePath = join(root, "external.json");
  const linkedStatePath = join(root, "linked", "proposals.json");
  const insecureRoot = join(root, "insecure");
  const lockedStatePath = join(root, "locked", "proposals.json");
  writeFileSync(externalStatePath, '{"sentinel":"external"}');
  mkdirSync(join(root, "linked"));
  symlinkSync(externalStatePath, linkedStatePath);
  mkdirSync(insecureRoot, { recursive: true, mode: 0o755 });
  chmodSync(insecureRoot, 0o755);
  mkdirSync(join(root, "locked"));
  writeFileSync(`${lockedStatePath}.lock`, "another writer");
  writeFileSync(`${lockedStatePath}.lock`, "another writer", { flush: true });
  try {
    const linked = createProposalQueue({ statePath: linkedStatePath });
    const insecure = createProposalQueue({ statePath: join(insecureRoot, "proposals.json") });
    const locked = createProposalQueue({ statePath: lockedStatePath, now: () => 31_000 });

    assert.equal((await linked.enqueue(proposal())).status, "disabled");
    assert.equal(lstatSync(linkedStatePath).isSymbolicLink(), true);
    assert.equal(readFileSync(externalStatePath, "utf8"), '{"sentinel":"external"}');
    assert.equal((await insecure.enqueue(proposal())).status, "disabled");
    assert.equal((await locked.enqueue(proposal())).status, "disabled");
    assert.equal(existsSync(`${lockedStatePath}.lock`), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the local CLI exposes state-only operations and no OpenCode command registry exposes proposal data", () => {
  const config = readFileSync(join(repositoryRoot, "opencode.jsonc"), "utf8");
  const cli = readFileSync(join(repositoryRoot, "plugins", "learning", "state-cli.ts"), "utf8");
  const documentedCommands = ["list", "show", "accept", "approve", "reject", "export", "delete", "delete-all", "status", "enable", "disable", "purge"];

  assert.doesNotMatch(config, /"learn-(?:pending|show|accept|approve|reject|export|review)"|local_learning_state/);
  for (const command of documentedCommands) {
    assert.match(cli, new RegExp(`"${command}"`), command);
  }
  assert.match(cli, /"export"/);
  assert.match(cli, /"delete"/);
  assert.match(cli, /"delete-all"/);
  assert.doesNotMatch(cli, /(?:writeFile|cp|rename).*?(?:skill|prompt|config)/is);
});

test("selected harness installation uses the supplied Claude root and preserves invalid settings and unrelated hooks", () => {
  const root = makeRoot();
  const sourceRoot = join(root, "source");
  const openCodeRoot = join(root, "opencode-target");
  const claudeRoot = join(root, "explicit-claude-target");
  const settingsPath = join(claudeRoot, "settings.json");
  mkdirSync(join(sourceRoot, "opencode"), { recursive: true });
  mkdirSync(join(sourceRoot, "claude", "hooks"), { recursive: true });
  mkdirSync(claudeRoot, { recursive: true });
  writeFileSync(join(sourceRoot, "opencode", "learning-runtime.ts"), "opencode runtime");
  writeFileSync(join(sourceRoot, "claude", "hooks", "learning-user-prompt-submit.sh"), "#!/usr/bin/env bash\n");
  writeFileSync(settingsPath, "{ invalid settings");

  try {
    synchronizeLearningRuntime({
      sourceRoot,
      openCodeRoot,
      claudeRoot,
      targets: { opencode: false, claude: true },
    });

    assert.equal(existsSync(join(openCodeRoot, "plugins", "learning-runtime.ts")), false);
    assert.equal(existsSync(join(claudeRoot, "hooks", "learning-user-prompt-submit.sh")), true);
    assert.equal(readFileSync(settingsPath, "utf8"), "{ invalid settings");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("installation deactivates every legacy learning assertion path", () => {
  const legacyClaimIntent = readFileSync(
    join(repositoryRoot, "plugins", "code-memory-lib", "claim-intent.ts"),
    "utf8",
  );
  const legacyReviewer = readFileSync(
    join(repositoryRoot, "prompts", "agents", "learning-reviewer.txt"),
    "utf8",
  );

  assert.doesNotMatch(legacyClaimIntent, /codememory_assert_claim|assertion detected|claim-write/i);
  assert.doesNotMatch(legacyReviewer, /claim|assert|learning loop/i);
});

test("audit events are metadata-only and the learning boundary is a documented single-user local profile", async () => {
  const root = makeRoot();
  const statePath = join(root, "proposals.json");
  const auditPath = join(root, "audit.jsonl");
  const queue = createProposalQueue({ statePath, auditPath, profile: "local-owner" });

  try {
    await queue.setEnabled(true, { noticeAcknowledgedAt: 1, profile: "local-owner", noticeVersion: "2026-07-17", noticeHash: "sha256:190b3b554de3ac1a5d9b5d89843b8a17a0e6c76e385ae8fd023dd405e29a890e", controller: "Local profile owner", lawfulBasis: "household activity", householdContext: "personal household use" });
    const queued = await queue.enqueue(proposal("Alice Martin secret sk-private"));
    if (queued.status === "queued") await queue.reject(queued.proposal.id);

    const audit = JSON.stringify((await queue.exportAll()).audit);
    assert.match(audit, /activation|decision/i);
    assert.doesNotMatch(audit, /Alice|sk-private|Respond concisely|proposal-learning/i);
    assert.match(
      readFileSync(join(repositoryRoot, "LEARNING.md"), "utf8"),
      /single-user local profile|one local owner profile/i,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
