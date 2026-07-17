import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { digest } from "./notices.ts";
import { classifyEligibleSignals, createLearningRuntimeGate } from "./policy.ts";
import { createProposalQueue } from "./proposal-queue.ts";

const repositoryRoot = join(import.meta.dirname, "..", "..");
const dayMs = 24 * 60 * 60 * 1_000;

const canonicalPersonalNotice = JSON.stringify({
  article: "GDPR Article 13",
  controller: "Local profile owner",
  purpose: "Proposal-only local learning",
  retention: "30-day proposal and audit retention",
  version: "2026-07-17",
});

const approvedOrganizationalNotice = {
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

const approvedGovernanceRecord = {
  approvalEvidence: {
    approvedAt: "2026-07-17T12:00:00.000Z",
    approvedBy: "Data Protection Officer",
    decisionReference: "DPO-2026-0717",
  },
  breachPath: "Detect, contain, assess, document, and notify within 72 hours where required.",
  controller: approvedOrganizationalNotice.controller,
  controllerContact: approvedOrganizationalNotice.controllerContact,
  dataProvisionInformation: approvedOrganizationalNotice.dataProvisionInformation,
  dpiaScreening: "DPIA screening assesses automated preference-pattern analysis and no solely automated decision-making.",
  lawfulBasis: "GDPR Article 6(1)(f)",
  mandatoryConsequenceInformation: approvedOrganizationalNotice.mandatoryConsequenceInformation,
  noticeDeliveryEvidence: {
    audience: "Affected support users",
    method: "Privacy portal acknowledgement",
    deliveredAt: "2026-07-17T12:00:00.000Z",
    reference: "NOTICE-DELIVERY-2026-0717",
  },
  recipientsProcessorsTransfers: "Local reviewer processor; no third-country transfers.",
  retentionJustification: "Thirty-day retention supports proposal review and audit.",
  ropaReference: "ROPA-2026-0717",
  rightsContact: approvedOrganizationalNotice.rightsContact,
  status: "completed" as const,
  version: "2026-07-17",
};

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function stateRoot(): string {
  return mkdtempSync(join(tmpdir(), "settings-opencode-final-findings-"));
}

function localActivation(noticeHash = `sha256:${sha256(canonicalPersonalNotice)}`) {
  return {
    noticeAcknowledgedAt: 1,
    profile: "local-owner" as const,
    noticeVersion: "2026-07-17",
    noticeHash,
    controller: "Local profile owner",
    lawfulBasis: "household activity",
    householdContext: "personal household use",
  };
}

test("high-signal preference counting requires distinct capture IDs and timestamps", () => {
  const duplicatedCapture = {
    captureId: "capture-1",
    text: "I prefer terse answers.",
    occurredAt: 100,
  };

  assert.deepEqual(classifyEligibleSignals({
    prompts: [duplicatedCapture, duplicatedCapture],
    verifiedRecurringFriction: [],
  }), []);

  assert.deepEqual(classifyEligibleSignals({
    prompts: [
      duplicatedCapture,
      { captureId: "capture-2", text: "Please keep answers terse.", occurredAt: 101 },
    ],
    verifiedRecurringFriction: [],
  }).map((signal) => signal.kind), ["repeated-preference"]);
});

test("organizational activation is rejected regardless of supplied governance artifacts", async () => {
  const root = stateRoot();
  const validPersonal = createProposalQueue({ statePath: join(root, "personal", "proposals.json") });
  const forgedPersonal = createProposalQueue({ statePath: join(root, "forged", "proposals.json") });
  const organizationWithApprovedArtifacts = createProposalQueue({ statePath: join(root, "organization", "proposals.json") });
  const organizationWithBundledDefaults = createProposalQueue({ statePath: join(root, "bundled-organization", "proposals.json") });
  const forgedOrganization = createProposalQueue({ statePath: join(root, "forged-organization", "proposals.json") });

  try {
    await validPersonal.setEnabled(true, localActivation());
    assert.equal((await validPersonal.status()).enabled, true);

    await forgedPersonal.setEnabled(true, localActivation(`sha256:${"0".repeat(64)}`));
    assert.equal((await forgedPersonal.status()).enabled, false);

    await organizationWithApprovedArtifacts.setEnabled(true, {
      noticeAcknowledgedAt: 1,
      profile: "organizational",
      noticeVersion: "2026-07-17",
      noticeHash: digest({ article: "GDPR Article 13", controller: "Acme Farms Cooperative", purpose: "Proposal-only learning", retention: "Thirty-day retention", version: "2026-07-17" }),
      controller: "Acme Farms Cooperative",
      lawfulBasis: "GDPR Article 6(1)(f)",
      governanceRecordVersion: "2026-07-17",
      governanceRecordHash: `sha256:${sha256(JSON.stringify({ status: "completed" }))}`,
      legalBasisReference: "GDPR Article 6(1)(f)",
      noticeRecord: { article: "GDPR Article 13", controller: "Acme Farms Cooperative", purpose: "Proposal-only learning", retention: "Thirty-day retention", version: "2026-07-17" },
      governanceRecord: { status: "completed" },
    } as unknown as Parameters<typeof organizationWithApprovedArtifacts.setEnabled>[1]);
    assert.equal((await organizationWithApprovedArtifacts.status()).enabled, false);

    await organizationWithBundledDefaults.setEnabled(true, {
      noticeAcknowledgedAt: 1,
      profile: "organizational",
      noticeVersion: "2026-07-17",
      noticeHash: `sha256:${"0".repeat(64)}`,
      controller: "Example controller",
      lawfulBasis: "legitimate interests",
    } as unknown as Parameters<typeof organizationWithBundledDefaults.setEnabled>[1]);
    assert.equal((await organizationWithBundledDefaults.status()).enabled, false);

    await forgedOrganization.setEnabled(true, {
      noticeAcknowledgedAt: 1,
      profile: "organizational",
      noticeVersion: "2026-07-17",
      noticeHash: "sha256:arbitrary-notice-label",
      controller: "Acme Farms Cooperative",
      lawfulBasis: "GDPR Article 6(1)(f)",
      governanceRecordVersion: "2026-07-17",
      governanceRecordHash: "sha256:arbitrary-governance-label",
      legalBasisReference: "GDPR Article 6(1)(f)",
      noticeRecord: { article: "GDPR Article 13", controller: "Acme Farms Cooperative", purpose: "Proposal-only learning", retention: "Thirty-day retention", version: "2026-07-17" },
      governanceRecord: { status: "completed" },
    } as unknown as Parameters<typeof forgedOrganization.setEnabled>[1]);
    assert.equal((await forgedOrganization.status()).enabled, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("maintenance preserves XDG state on macOS, verifies Node 22.6 first, and deletes tombstones successfully", async () => {
  const installer = readFileSync(join(repositoryRoot, "install.sh"), "utf8");
  const darwinStart = installer.indexOf("Darwin)");
  const darwin = darwinStart === -1 ? "" : installer.slice(darwinStart, installer.indexOf(";;", darwinStart));
  const main = installer.slice(installer.indexOf("# ------------------------------ main"));
  const root = stateRoot();
  let now = 1;
  const queue = createProposalQueue({ statePath: join(root, "proposals.json"), now: () => now });

  try {
    assert.match(darwin, /(?:EnvironmentVariables|XDG_STATE_HOME)[\s\S]{0,180}XDG_STATE_HOME/);
    assert.match(installer, /(?:minimum|required).*Node[^\n]{0,80}22\.6|Node[^\n]{0,80}(?:minimum|required)[^\n]{0,80}22\.6/i);
    assert.match(main, /check_node_version[\s\S]*sync_learning_runtime[\s\S]*install_learning_maintenance/);

    await queue.setEnabled(true, localActivation());
    const queued = await queue.enqueue({
      sessionId: "session",
      harness: "opencode",
      kind: "preference",
      title: "Prefer terse answers",
      rationale: "Repeated direct preference",
      change: "Respond concisely by default.",
    });
    assert.equal(queued.status, "queued");
    if (queued.status !== "queued") return;

    now = 31 * dayMs;
    assert.deepEqual(await queue.get(queued.proposal.id), { id: queued.proposal.id, state: "tombstoned" });
    assert.equal(await queue.delete(queued.proposal.id), true);
    assert.equal(await queue.get(queued.proposal.id), null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("reviewer transport rejects network-capable formats and requires offline executable safeguards", () => {
  const transport = readFileSync(join(repositoryRoot, "plugins", "learning", "reviewer-transport.ts"), "utf8");

  assert.equal(createLearningRuntimeGate({ OPENCODE_MODEL_LEARNING: "ollama://llama3.2" }).endpoint, null);
  assert.equal(createLearningRuntimeGate({ OPENCODE_MODEL_LEARNING: "https://reviewer.example.invalid/v1" }).endpoint, null);
  assert.equal(createLearningRuntimeGate({ OPENCODE_MODEL_LEARNING: "http://127.0.0.1:11434/v1" }).endpoint, null);
  assert.doesNotMatch(transport, /spawn\(\s*["']ollama["']/);
  assert.match(transport, /(?:lstat|stat)[\s\S]{0,300}(?:uid|owner)|(?:uid|owner)[\s\S]{0,300}(?:lstat|stat)/i);
  assert.match(transport, /sha256|createHash/i);
  assert.match(transport, /NO_PROXY|no_proxy|HTTP_PROXY|HTTPS_PROXY|ALL_PROXY/);
  assert.match(transport, /offline[\s\S]{0,240}(?:artifact|model)|(?:artifact|model)[\s\S]{0,240}offline/i);
});

test("background maintenance and lock-loss observers catch failures and expose disposal", () => {
  const runtime = readFileSync(join(repositoryRoot, "plugins", "learning", "runtime.ts"), "utf8");
  const queue = readFileSync(join(repositoryRoot, "plugins", "learning", "proposal-queue.ts"), "utf8");

  assert.doesNotMatch(runtime, /void\s+queue\.purgeExpired\(\)/);
  assert.doesNotMatch(runtime, /void\s+queue\.status\(\)\.then/);
  assert.match(runtime, /dispose[\s\S]{0,240}clearInterval|clearInterval[\s\S]{0,240}dispose/i);
  assert.doesNotMatch(queue, /void\s+jobCancelled\([^)]*\)\.then/);
});

test("Linux scheduler rejects shell metacharacters and executes fixed arguments without a shell wrapper", () => {
  const installer = readFileSync(join(repositoryRoot, "install.sh"), "utf8");
  const linuxStart = installer.indexOf("Linux)");
  const linux = linuxStart === -1 ? "" : installer.slice(linuxStart, installer.indexOf(";;", linuxStart));

  assert.match(linux, /(?:reject|validate)[\s\S]{0,180}[;&|`$<>]/i);
  assert.doesNotMatch(linux, /exec\s+"\$node_path"[\s\S]{0,160}\$runtime_root/);
  assert.match(linux, /ExecStart=.*state-cli\.ts\s+purge/);
});

test("organizational activation fails closed without a completed schema-validated governance record and displays its Article 13 notice", async () => {
  const root = stateRoot();
  const queue = createProposalQueue({ statePath: join(root, "proposals.json") });
  const stateCli = readFileSync(join(repositoryRoot, "plugins", "learning", "state-cli.ts"), "utf8");

  try {
    await queue.setEnabled(true, {
      noticeAcknowledgedAt: 1,
      profile: "organizational",
      noticeVersion: "2026-07-17",
      noticeHash: digest(approvedOrganizationalNotice),
      controller: approvedOrganizationalNotice.controller,
      lawfulBasis: approvedOrganizationalNotice.lawfulBasis,
      governanceRecordVersion: "2026-07-17",
      governanceRecordHash: `sha256:${sha256(JSON.stringify({ status: "completed" }))}`,
      legalBasisReference: "GDPR Article 6(1)(f)",
      noticeRecord: approvedOrganizationalNotice,
      governanceRecord: { status: "completed" },
    });

    assert.equal((await queue.status()).enabled, false);
    assert.match(stateCli, /Article\s*13/i);
    assert.match(stateCli, /(?:display|render|stdout)[\s\S]{0,240}(?:notice|acknowledg)|(?:notice|acknowledg)[\s\S]{0,240}(?:display|render|stdout)/i);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the governance template requires operator-completed breach and 72-hour incident handling", () => {
  const template = readFileSync(join(repositoryRoot, "PROPOSAL_LEARNING_GOVERNANCE_TEMPLATE.md"), "utf8");

  assert.match(template, /operator[\s\S]{0,180}(?:must|required to)[\s\S]{0,180}complete/i);
  assert.match(template, /breach[\s\S]{0,240}incident|incident[\s\S]{0,240}breach/i);
  assert.match(template, /72[ -]?hour/i);
  assert.match(template, /(?:supervisory authority|notification)[\s\S]{0,240}\[complete\]/i);
});
