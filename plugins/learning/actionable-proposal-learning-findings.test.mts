import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { synchronizeLearningRuntime } from "./installer-runtime.ts";
import { digest } from "./notices.ts";
import { createLearningRuntimeGate } from "./policy.ts";
import { createProposalQueue } from "./proposal-queue.ts";
import { createProposalLearningRuntime } from "./runtime.ts";

const repositoryRoot = join(import.meta.dirname, "..", "..");

function temporaryRoot(): string {
  return mkdtempSync(join(tmpdir(), "settings-opencode-actionable-findings-"));
}

function localActivation() {
  return {
    noticeAcknowledgedAt: 1,
    profile: "local-owner" as const,
    noticeVersion: "2026-07-17",
    noticeHash: "sha256:190b3b554de3ac1a5d9b5d89843b8a17a0e6c76e385ae8fd023dd405e29a890e",
    controller: "Local profile owner",
    lawfulBasis: "household activity",
    householdContext: "personal household use",
  };
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

test("runtime migration removes every retired learning command and asset from both selected targets", () => {
  const root = temporaryRoot();
  const sourceRoot = join(root, "source");
  const openCodeRoot = join(root, "opencode");
  const claudeRoot = join(root, "claude");
  const retiredOpenCodePaths = [
    "commands/learn-approve.md",
    "commands/learn-pending.md",
    "commands/learn-reject.md",
    "commands/learn-review.md",
    "commands/learn-show.md",
    "commands/learn-accept.md",
    "commands/learn-export.md",
    "plugins/learning-loop.ts",
    "bin/learning-loop",
  ];
  const retiredClaudePaths = [
    "commands/learn-approve.md",
    "commands/learn-pending.md",
    "commands/learn-reject.md",
    "commands/learn-review.md",
    "commands/learn-show.md",
    "commands/learn-accept.md",
    "commands/learn-export.md",
    "hooks/learning-loop.sh",
    "hooks/learning-review.sh",
    "bin/learning-loop",
  ];

  try {
    for (const relativePath of [...retiredOpenCodePaths, ...retiredClaudePaths]) {
      for (const target of [openCodeRoot, claudeRoot]) {
        const path = join(target, relativePath);
        mkdirSync(join(path, ".."), { recursive: true });
        writeFileSync(path, "retired learning asset\n");
      }
    }

    synchronizeLearningRuntime({
      sourceRoot,
      openCodeRoot,
      claudeRoot,
      targets: { opencode: true, claude: true },
    });

    for (const relativePath of retiredOpenCodePaths) {
      assert.equal(existsSync(join(openCodeRoot, relativePath)), false, relativePath);
    }
    for (const relativePath of retiredClaudePaths) {
      assert.equal(existsSync(join(claudeRoot, relativePath)), false, relativePath);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("Windows bootstrap defines guarded runtime synchronization and purge-only maintenance before invoking them", () => {
  const bootstrap = readFileSync(join(repositoryRoot, "bootstrap.ps1"), "utf8");

  assert.match(bootstrap, /function\s+Sync-LearningRuntime\b/);
  assert.match(bootstrap, /function\s+Install-LearningMaintenance\b/);
  assert.match(bootstrap, /Set-StrictMode\s+-Version\s+Latest/);
  assert.match(bootstrap, /Sync-LearningRuntime[\s\S]{0,600}Install-LearningMaintenance/);
  assert.match(bootstrap, /state-cli\.ts[\s\S]{0,100}\bpurge\b/);
  assert.doesNotMatch(bootstrap, /Install-LearningMaintenance[^(\n]*\$\w+/);
});

test("disable and delete-all revoke a review owned by another queue instance and wait for its acknowledgement", async () => {
  const root = temporaryRoot();
  const statePath = join(root, "proposals.json");
  const owner = createProposalQueue({ statePath });
  const revoker = createProposalQueue({ statePath });
  let review: Awaited<ReturnType<typeof owner.beginReview>> = null;

  try {
    await owner.setEnabled(true, localActivation());
    review = await owner.beginReview();
    assert.notEqual(review, null);
    if (!review) return;

    let reported = false;
    const deletion = revoker.deleteAll().then(() => { reported = true; });
    await Promise.resolve();

    assert.equal(review.signal.aborted, true, "delete-all must signal a review held by a separate process");
    assert.equal(reported, false, "delete-all must wait until the active review acknowledges cancellation");
    review.finish();
    await deletion;
  } finally {
    review?.finish();
    rmSync(root, { recursive: true, force: true });
  }
});

test("disable fails closed across queue instances until the active review has stopped", async () => {
  const root = temporaryRoot();
  const statePath = join(root, "proposals.json");
  const owner = createProposalQueue({ statePath });
  const revoker = createProposalQueue({ statePath });
  let review: Awaited<ReturnType<typeof owner.beginReview>> = null;

  try {
    await owner.setEnabled(true, localActivation());
    review = await owner.beginReview();
    assert.notEqual(review, null);
    if (!review) return;

    let reported = false;
    const disable = revoker.setEnabled(false, { revokedAt: 2, profile: "local-owner" }).then(() => { reported = true; });
    await Promise.resolve();

    assert.equal(review.signal.aborted, true, "disable must signal a review held by a separate process");
    assert.equal(reported, false, "disable must not report success before cancellation acknowledgement");
    review.finish();
    await disable;
  } finally {
    review?.finish();
    rmSync(root, { recursive: true, force: true });
  }
});

test("audit has one recoverable transactional authority instead of an independent best-effort mirror", () => {
  const queue = readFileSync(join(repositoryRoot, "plugins", "learning", "proposal-queue.ts"), "utf8");

  assert.doesNotMatch(queue, /async function synchronizeAudit\(/);
  assert.match(queue, /(?:mutate|transaction)[\s\S]{0,900}(?:processing|decision|deletion|purge)/);
  assert.match(queue, /async deleteAll\(\)\s*\{[\s\S]{0,240}mutate/);
  assert.match(queue, /(?:exportAll|deleteAll)[\s\S]{0,900}(?:audit|transaction)/);
});

test("session descriptor cache is salted, bounded by TTL and LRU, stores no session identifier, and clears on disable and deletion", () => {
  const runtime = readFileSync(join(repositoryRoot, "plugins", "learning", "runtime.ts"), "utf8");

  assert.match(runtime, /(?:SESSION|DESCRIPTOR).*SALT|createHash\(/);
  assert.match(runtime, /(?:SESSION|DESCRIPTOR).*TTL|expiresAt|expires/);
  assert.match(runtime, /descriptorsBySession\.delete|descriptorsBySession\.clear/);
  assert.doesNotMatch(runtime, /descriptorsBySession\.(?:get|set)\(prompt\.sessionId/);
  assert.match(runtime, /deleteAll|onDeletion|onRevocation[\s\S]{0,180}descriptorsBySession\.clear/);
});

test("Linux maintenance rejects unsafe paths, preserves XDG_STATE_HOME, and invokes only fixed purge", () => {
  const installer = readFileSync(join(repositoryRoot, "install.sh"), "utf8");
  const linuxStart = installer.indexOf("Linux)");
  const linux = linuxStart === -1 ? "" : installer.slice(linuxStart, installer.indexOf(";;", linuxStart));

  assert.match(linux, /systemd-escape|(?:reject|validate).*path/i);
  assert.match(linux, /Environment=XDG_STATE_HOME=/);
  assert.match(linux, /state-cli\.ts\s+purge/);
  assert.doesNotMatch(linux, /state-cli\.ts\s+\$|state-cli\.ts\s+"?\$\w+/);
});

test("Claude-only POSIX installation seeds canonical settings then merges only managed learning hooks", () => {
  const installer = readFileSync(join(repositoryRoot, "install.sh"), "utf8");
  const claudeInstallStart = installer.indexOf("install_claude_mirror()");
  const claudeInstall = claudeInstallStart === -1 ? "" : installer.slice(claudeInstallStart, installer.indexOf("print_next_steps", claudeInstallStart));

  assert.match(claudeInstall, /settings\.json/);
  assert.match(claudeInstall, /(?:seed|ignore-existing|merge)/i);
  assert.match(installer, /install_claude_mirror[\s\S]{0,1000}sync_learning_runtime\s*\|\|/);
  assert.doesNotMatch(claudeInstall, /(?:rm\s+-rf|Remove-Item)[\s\S]{0,120}settings\.json/);
});

test("state-root security rejects symlinked ancestors and requires every existing ancestor to be owned by the current user", async () => {
  const root = temporaryRoot();
  const externalRoot = join(root, "external");
  const linkedRoot = join(root, "state-link");
  const statePath = join(linkedRoot, "v1", "proposals.json");
  const queueSource = readFileSync(join(repositoryRoot, "plugins", "learning", "proposal-queue.ts"), "utf8");

  mkdirSync(externalRoot, { recursive: true, mode: 0o700 });
  symlinkSync(externalRoot, linkedRoot);
  try {
    const queue = createProposalQueue({ statePath });
    await queue.setEnabled(true, localActivation());

    assert.equal(existsSync(join(externalRoot, "v1", "proposals.json")), false);
    assert.match(queueSource, /\.uid\s*===?\s*process\.getuid\(\)/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("concurrent reviewers reserve daily quota atomically before model dispatch", async () => {
  const root = temporaryRoot();
  const queue = createProposalQueue({ statePath: join(root, "proposals.json") });
  let invocations = 0;
  const runtime = createProposalLearningRuntime({
    env: { OPENCODE_MODEL_LEARNING: "http://127.0.0.1:11434/v1" },
    homeDirectory: root,
    queue,
    probe: async () => true,
    invokeReviewer: async () => {
      invocations += 1;
      return reviewerResponse();
    },
  });
  const sessions = Array.from({ length: 11 }, (_, index) => `session-${index}`);

  try {
    await queue.setEnabled(true, localActivation());
    await Promise.all(sessions.map((sessionId) => runtime.captureOpenCode({
      role: "user",
      sessionId,
      parts: [{ type: "text", text: "I prefer terse answers." }],
    })));
    await Promise.all(sessions.map((sessionId) => runtime.captureOpenCode({
      role: "user",
      sessionId,
      parts: [{ type: "text", text: "I prefer terse answers." }],
    })));

    assert.ok(invocations <= 10, `expected at most 10 model dispatches, got ${invocations}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("reviewer rejects arbitrary loopback HTTP endpoints in favor of an enforceably local transport", () => {
  const runtimePlugin = readFileSync(join(repositoryRoot, "plugins", "learning-runtime.ts"), "utf8");
  const reviewer = readFileSync(join(repositoryRoot, "plugins", "learning", "reviewer.ts"), "utf8");
  const gate = createLearningRuntimeGate({ OPENCODE_MODEL_LEARNING: "http://127.0.0.1:11434/v1" });

  assert.equal(gate.endpoint, null);
  assert.doesNotMatch(runtimePlugin, /OPENCODE_MODEL_LEARNING.*https?:\/\//);
  assert.doesNotMatch(reviewer, /\bfetch\(/);
});

test("organizational activation is rejected and the queue contains no organizational governance machinery", async () => {
  const root = temporaryRoot();
  const queue = createProposalQueue({ statePath: join(root, "proposals.json") });
  const queueSource = readFileSync(join(repositoryRoot, "plugins", "learning", "proposal-queue.ts"), "utf8");
  const notice = {
    article: "GDPR Article 13",
    controller: "Acme Farms Cooperative",
    controllerContact: "privacy-office@acme.example",
    dataProvisionInformation: "Providing preference information is optional.",
    mandatoryConsequenceInformation: "No service consequence follows from declining to provide preference information.",
    lawfulBasis: "GDPR Article 6(1)(f)",
    purpose: "Proposal-only learning for support preferences",
    retention: "Thirty-day proposal and audit retention",
    dpoContact: "dpo@acme.example",
    recipients: "Local reviewer processor",
    rightsContact: "privacy@acme.example",
    transfers: "No third-country transfers",
    rights: "access, rectification, erasure, restriction, portability, objection, withdraw consent",
    cnilComplaint: "Lodge a complaint with the CNIL",
    processingInformation: "Automated preference-pattern analysis produces review proposals only; no decision is based solely on automated processing.",
    version: "2026-07-17",
  };
  const governanceRecord = {
    approvalEvidence: {
      approvedAt: "2026-07-17T12:00:00.000Z",
      approvedBy: "Data Protection Officer",
      decisionReference: "DPO-2026-0717",
    },
    breachPath: "Detect, contain, assess, document, and notify within 72 hours where required.",
    controller: notice.controller,
    controllerContact: notice.controllerContact,
    dataProvisionInformation: notice.dataProvisionInformation,
    dpiaScreening: "DPIA screening assesses automated preference-pattern analysis and no solely automated decision-making.",
    lawfulBasis: notice.lawfulBasis,
    mandatoryConsequenceInformation: notice.mandatoryConsequenceInformation,
    noticeDeliveryEvidence: {
      audience: "Affected support users",
      method: "Privacy portal acknowledgement",
      deliveredAt: "2026-07-17T12:00:00.000Z",
      reference: "NOTICE-DELIVERY-2026-0717",
    },
    recipientsProcessorsTransfers: "Local reviewer processor; no third-country transfers.",
    retentionJustification: "Thirty-day retention supports proposal review and audit.",
    ropaReference: "ROPA-2026-0717",
    rightsContact: notice.rightsContact,
    status: "completed" as const,
    version: notice.version,
  };
  const organizationalActivation = {
    noticeAcknowledgedAt: 1,
    profile: "organizational" as const,
    noticeVersion: notice.version,
    noticeHash: digest(notice),
    controller: notice.controller,
    lawfulBasis: notice.lawfulBasis,
    governanceRecordVersion: governanceRecord.version,
    governanceRecordHash: digest(governanceRecord),
    legalBasisReference: governanceRecord.lawfulBasis,
    noticeRecord: notice,
    governanceRecord,
  };

  try {
    await queue.setEnabled(true, {
      noticeAcknowledgedAt: 1,
      profile: "organizational",
      noticeVersion: "2026-07-17",
      noticeHash: "sha256:eefe8f98dd64527a400118a6f727545799b8b093c90bc29eb39799b1fc286dea",
      controller: "Example controller",
      lawfulBasis: "legitimate interests",
    } as unknown as Parameters<typeof queue.setEnabled>[1]);
    assert.equal((await queue.status()).enabled, false);

    await queue.setEnabled(true, organizationalActivation as unknown as Parameters<typeof queue.setEnabled>[1]);
    assert.equal((await queue.status()).enabled, false);
    assert.doesNotMatch(queueSource, /governanceRecord(?:Version|Hash)|legalBasisReference/);
    assert.match(queueSource, /profile[\s\S]{0,100}controller|controller[\s\S]{0,100}profile/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("export and deletion keep audit atomically recoverable, and governance artifacts cover retention, ROPA, and DPIA screening", async () => {
  const root = temporaryRoot();
  const queue = createProposalQueue({ statePath: join(root, "proposals.json") });
  const learning = readFileSync(join(repositoryRoot, "LEARNING.md"), "utf8");

  try {
    await queue.setEnabled(true, localActivation());
    await queue.deleteAll();
    const exported = await queue.exportAll();

    assert.equal(exported.audit.some((event) => event.event === "deletion"), true);
    assert.match(learning, /retention justification/i);
    assert.match(learning, /ROPA|records? of processing activities/i);
    assert.match(learning, /DPIA|data protection impact assessment/i);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
