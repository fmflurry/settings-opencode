import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  asGovernanceRecord,
  asOrganizationalNotice,
  digest,
  organizationalGovernanceRecord,
  organizationalNotice,
  personalNotice,
  renderArticle13Notice,
  sha256 as sha256Digest,
} from "./notices.ts";
import { localReviewerConfiguration } from "./policy.ts";
import { createProposalQueue } from "./proposal-queue.ts";
import { invokeLocalReviewer } from "./reviewer-transport.ts";
import { createProposalLearningRuntime } from "./runtime.ts";

const repositoryRoot = join(import.meta.dirname, "..", "..");
const sha256 = "a".repeat(64);

function root(): string {
  return mkdtempSync(join(tmpdir(), "settings-opencode-release-blockers-"));
}

function processIsRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ESRCH") return false;
    throw error;
  }
}

async function waitForFile(path: string): Promise<void> {
  const deadline = Date.now() + 1_000;
  while (Date.now() < deadline) {
    try {
      readFileSync(path, "utf8");
      return;
    } catch {
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
    }
  }
  throw new Error(`Timed out waiting for ${path}`);
}

test("reviewer cancellation waits for close and force-kills a child that survives its bounded grace period", async () => {
  const temporaryRoot = mkdtempSync(join(homedir(), ".settings-opencode-release-blockers-"));
  const executable = join(temporaryRoot, "reviewer");
  const artifact = join(temporaryRoot, "model.artifact");
  const pidPath = `${executable}.pid`;
  const executableContents = `#!/bin/sh\nprintf '%s' "$$" > '${pidPath}'\ntrap '' TERM\nwhile :; do :; done\n`;
  const artifactContents = "offline-model";
  writeFileSync(executable, executableContents, { mode: 0o700 });
  chmodSync(executable, 0o700);
  writeFileSync(artifact, artifactContents, { mode: 0o600 });
  const configuration = {
    executable,
    executableHash: sha256Digest(executableContents),
    modelArtifact: artifact,
    modelArtifactHash: sha256Digest(artifactContents),
  };
  const controller = new AbortController();

  try {
    const review = invokeLocalReviewer(configuration, { signals: [] }, controller.signal);
    await waitForFile(pidPath);
    controller.abort();
    assert.equal(await review, "");
    assert.equal(processIsRunning(Number(readFileSync(pidPath, "utf8"))), false);
  } finally {
    try {
      const pid = Number(readFileSync(pidPath, "utf8"));
      if (processIsRunning(pid)) process.kill(pid, "SIGKILL");
    } catch {
      // The child may have been force-killed by the implementation under test.
    }
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test("offline reviewer configuration accepts safe Windows absolute paths and rejects relative or unsafe paths", () => {
  assert.deepEqual(localReviewerConfiguration({
    OPENCODE_LEARNING_REVIEWER_EXECUTABLE: "C:\\Program Files\\Offline Reviewer\\reviewer.exe",
    OPENCODE_LEARNING_REVIEWER_EXECUTABLE_SHA256: sha256,
    OPENCODE_LEARNING_REVIEWER_MODEL_ARTIFACT: "D:\\models\\reviewer.gguf",
    OPENCODE_LEARNING_REVIEWER_MODEL_SHA256: sha256,
  }), {
    executable: "C:\\Program Files\\Offline Reviewer\\reviewer.exe",
    executableHash: sha256,
    modelArtifact: "D:\\models\\reviewer.gguf",
    modelArtifactHash: sha256,
  });

  for (const executable of ["reviewer.exe", "C:reviewer.exe", "C:\\models\\..\\reviewer.exe", "C:\\reviewer\u0000.exe"]) {
    assert.equal(localReviewerConfiguration({
      OPENCODE_LEARNING_REVIEWER_EXECUTABLE: executable,
      OPENCODE_LEARNING_REVIEWER_EXECUTABLE_SHA256: sha256,
      OPENCODE_LEARNING_REVIEWER_MODEL_ARTIFACT: "D:\\models\\reviewer.gguf",
      OPENCODE_LEARNING_REVIEWER_MODEL_SHA256: sha256,
    }), null, executable);
  }
});

test("organizational activation refuses bundled defaults and requires explicit approved notice and governance files", () => {
  const temporaryRoot = root();
  const stateCli = join(repositoryRoot, "plugins", "learning", "state-cli.ts");
  const result = spawnSync(process.execPath, ["--experimental-strip-types", stateCli, "enable", "--profile", "organizational", "--controller", "Example controller", "--lawful-basis", "legitimate interests", "--notice-version", organizationalNotice.version, "--notice-hash", digest(organizationalNotice), "--governance-record-version", organizationalGovernanceRecord.version, "--governance-record-hash", digest(organizationalGovernanceRecord), "--legal-basis-reference", organizationalGovernanceRecord.lawfulBasis, "--acknowledge-notice", digest(organizationalNotice)], {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: { ...process.env, XDG_STATE_HOME: temporaryRoot },
  });

  try {
    assert.equal(result.status, 2, result.stderr);
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test("organizational governance rejects placeholders and requires approval evidence with a selectable Article 6 basis", () => {
  const record = {
    breachPath: "Detect, contain, assess, document, and notify within 72 hours where required.",
    controller: "Acme Farms Cooperative",
    controllerContact: "privacy-office@acme.example",
    dataProvisionInformation: "Providing preference information is optional.",
    dpiaScreening: "DPIA screening assesses automated preference-pattern analysis and no solely automated decision-making.",
    lawfulBasis: "GDPR Article 6(1)(f)",
    mandatoryConsequenceInformation: "No service consequence follows from declining to provide preference information.",
    noticeDeliveryEvidence: {
      audience: "Affected support users",
      method: "Privacy portal acknowledgement",
      deliveredAt: "2026-07-17T12:00:00.000Z",
      reference: "NOTICE-DELIVERY-2026-0717",
    },
    recipientsProcessorsTransfers: "Local reviewer processor; no third-country transfers.",
    retentionJustification: "Thirty-day retention supports proposal review and audit.",
    ropaReference: "ROPA-2026-0717",
    rightsContact: "privacy@acme.example",
    status: "completed",
    version: "2026-07-17",
  };

  const approvalEvidence = {
    approvedAt: "2026-07-17T12:00:00.000Z",
    approvedBy: "Data Protection Officer",
    decisionReference: "DPO-2026-0717",
  };
  const approved = asGovernanceRecord({ ...record, approvalEvidence });

  assert.equal(asGovernanceRecord(record), null, "approval evidence is mandatory");
  assert.deepEqual((approved as unknown as { readonly approvalEvidence?: unknown } | null)?.approvalEvidence, approvalEvidence);
  assert.equal(asGovernanceRecord({ ...record, controller: "[complete]" }), null);
  assert.equal(asGovernanceRecord({ ...record, controller: "Example controller" }), null);
  assert.equal(asGovernanceRecord({ ...record, rightsContact: "privacy@example.invalid" }), null);
  assert.equal(asGovernanceRecord({ ...record, lawfulBasis: "GDPR Article 6(1)(z)" }), null);
});

test("Article 13 organizational notices require and render every mandatory transparency field", () => {
  const incomplete = {
    article: "GDPR Article 13",
    controller: "Acme Farm Cooperative",
    lawfulBasis: "GDPR Article 6(1)(f)",
    recipients: "Approved local runtime processor",
    rightsContact: "privacy@acme.example",
    transfers: "No transfers",
    version: "2026-07-17",
  };
  const complete = {
    ...incomplete,
    controllerContact: "privacy-office@acme.example",
    dataProvisionInformation: "Providing preference information is optional.",
    mandatoryConsequenceInformation: "No service consequence follows from declining to provide preference information.",
    purpose: "Proposal-only local learning",
    retention: "30-day proposal and audit retention",
    dpoContact: "dpo@acme.example",
    rights: "access, rectification, erasure, restriction, portability, objection, withdraw consent",
    cnilComplaint: "Complain to the CNIL",
    processingInformation: "Automated preference-pattern analysis produces review proposals only; no decision is based solely on automated processing.",
  };

  assert.equal(asOrganizationalNotice(incomplete), null);
  const notice = asOrganizationalNotice(complete);
  assert.notEqual(notice, null);
  if (notice === null) return;
  const rendered = renderArticle13Notice(notice);
  for (const requiredContent of ["Purpose", "Retention", "DPO", "Rights contact", "access", "rectification", "erasure", "restriction", "portability", "objection", "withdraw", "CNIL", "processing", "profiling", "Recipients", "Transfers"]) {
    assert.match(rendered, new RegExp(requiredContent, "i"), requiredContent);
  }
});

test("the CLI displays the notice before acknowledgement validation and exposes separate notice and enable steps", () => {
  const stateCli = readFileSync(join(repositoryRoot, "plugins", "learning", "state-cli.ts"), "utf8");
  const activationStart = stateCli.indexOf("function activation");
  const activation = stateCli.slice(activationStart, stateCli.indexOf("async function main", activationStart));

  assert.ok(activation.indexOf("renderArticle13Notice") < activation.indexOf("--acknowledge-notice"));
  assert.match(stateCli, /if \(command === "notice"\)[\s\S]{0,800}digest/);
  assert.match(stateCli, /if \(command === "enable"\)[\s\S]{0,500}activation/);
});

test("disabled and revoked runtimes gate OpenCode and Claude input before accessing prompt content", async () => {
  const temporaryRoot = root();
  const queue = createProposalQueue({ statePath: join(temporaryRoot, "proposals.json") });
  const runtime = createProposalLearningRuntime({
    env: {},
    homeDirectory: temporaryRoot,
    queue,
    invokeReviewer: async () => "",
  });

  try {
    await assert.doesNotReject(runtime.captureOpenCode({
      role: "user",
      sessionId: "session",
      parts: [{ type: "text", get text(): string { throw new Error("disabled OpenCode input was read"); } }],
    }));
    await assert.doesNotReject(runtime.captureClaude({
      session_id: "session",
      get user_prompt(): string { throw new Error("disabled Claude input was read"); },
    }));
    await queue.setEnabled(true, {
      noticeAcknowledgedAt: 1,
      profile: "local-owner",
      noticeVersion: personalNotice.version,
      noticeHash: digest(personalNotice),
      controller: personalNotice.controller,
      lawfulBasis: "household activity",
      householdContext: "personal household use",
    });
    await queue.setEnabled(false, { profile: "local-owner", revokedAt: 2 });
    await assert.doesNotReject(runtime.captureOpenCode({
      role: "user",
      sessionId: "revoked-session",
      parts: [{ type: "text", get text(): string { throw new Error("revoked OpenCode input was read"); } }],
    }));
  } finally {
    runtime.dispose();
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test("hook input handling has bounded OpenCode parts and Claude stream bytes without unbounded aggregation", () => {
  const adapters = readFileSync(join(repositoryRoot, "plugins", "learning", "harness-adapters.ts"), "utf8");
  const claudeRuntime = readFileSync(join(repositoryRoot, "plugins", "learning", "claude-runtime.ts"), "utf8");

  assert.match(adapters, /MAX_(?:OPENCODE_)?PROMPT_(?:PARTS|BYTES)/);
  assert.doesNotMatch(adapters, /\.join\(|\.split\(/);
  assert.match(claudeRuntime, /MAX_(?:CLAUDE_)?STDIN_BYTES/);
  assert.match(claudeRuntime, /byteLength|byteLength\s*\+/);
  assert.doesNotMatch(claudeRuntime, /Buffer\.concat\(|\.join\(|\.split\(/);
});

test("governance fields reject control sequences and terminal rendering escapes them", () => {
  assert.equal(asOrganizationalNotice({
    article: "GDPR Article 13",
    controller: "Acme\u001b[2JFarms",
    lawfulBasis: "GDPR Article 6(1)(f)",
    recipients: "Approved processor",
    rightsContact: "privacy@acme.example",
    transfers: "No transfers",
    version: "2026-07-17",
  }), null);

  const rendered = renderArticle13Notice({ ...organizationalNotice, controller: "Acme\u001b[2JFarms" });
  assert.doesNotMatch(rendered, /\u001b/);
  assert.match(rendered, /\\u001b\[2J/);
});

test("production dependency audit has no uuid vulnerability", () => {
  const audit = spawnSync("npm", ["audit", "--omit=dev", "--json"], {
    cwd: repositoryRoot,
    encoding: "utf8",
  });

  assert.equal(audit.status, 0, audit.stdout || audit.stderr);
  assert.doesNotMatch(audit.stdout, /"uuid"\s*:/i);
});

test("README does not describe the retired Ollama transport", () => {
  const readme = readFileSync(join(repositoryRoot, "README.md"), "utf8");

  assert.doesNotMatch(readme, /ollama:\/\/|local `ollama` executable/i);
});
