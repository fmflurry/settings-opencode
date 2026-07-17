import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { asGovernanceRecord, asOrganizationalNotice, renderArticle13Notice, sha256 } from "./notices.ts";
import { invokeLocalReviewer, validateOfflineReviewer } from "./reviewer-transport.ts";

const repositoryRoot = join(import.meta.dirname, "..", "..");
const stateCli = join(repositoryRoot, "plugins", "learning", "state-cli.ts");

function root(): string {
  return mkdtempSync(join(tmpdir(), "settings-opencode-latest-release-findings-"));
}

function approvedGovernanceRecord(): Record<string, unknown> {
  return {
    approvalEvidence: {
      approvedAt: "2026-07-17T12:00:00.000Z",
      approvedBy: "Privacy Officer",
      decisionReference: "PRIV-2026-0717",
    },
    breachPath: "Detect, contain, assess, document, and notify within 72 hours where required.",
    controller: "Acme Farms Cooperative",
    dpiaScreening: "The DPIA assesses automated preference-pattern analysis, its risks, safeguards, and confirms that no solely automated decision is made.",
    lawfulBasis: "GDPR Article 6(1)(f)",
    recipientsProcessorsTransfers: "Local reviewer processor; no third-country transfers.",
    retentionJustification: "Thirty-day retention supports proposal review and audit.",
    ropaReference: "ROPA-2026-0717",
    rightsContact: "privacy@acme.example",
    status: "completed",
    version: "2026-07-17",
  };
}

function approvedOrganizationalNotice(): Record<string, unknown> {
  return {
    article: "GDPR Article 13",
    controller: "Acme Farms Cooperative",
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
}

test("Windows runtime and CLI resolve the state root from the OS homedir when HOME is absent", () => {
  const plugin = readFileSync(join(repositoryRoot, "plugins", "learning-runtime.ts"), "utf8");
  const cli = readFileSync(stateCli, "utf8");

  assert.match(plugin, /import\s+\{\s*homedir\s*\}\s+from\s+["']node:os["']/);
  assert.match(plugin, /homeDirectory:\s*homedir\(\)/);
  assert.doesNotMatch(plugin, /homeDirectory:\s*process\.env\.HOME\s*\?\?\s*["']\.["']/);
  assert.match(cli, /defaultLearningStateRoot\(process\.env,\s*homedir\(\)\)/);
});

test("installer stops before maintenance when runtime synchronization fails", () => {
  const installer = readFileSync(join(repositoryRoot, "install.sh"), "utf8");
  const syncStart = installer.indexOf("sync_learning_runtime() {");
  const sync = installer.slice(syncStart, installer.indexOf("install_learning_maintenance() {", syncStart));
  const main = installer.slice(installer.indexOf("sync_learning_runtime", installer.indexOf("# ------------------------------ main")));

  assert.match(sync, /proposal-learning runtime sync failed[\s\S]{0,180}return 1/);
  assert.match(main, /sync_learning_runtime\s*\|\|[\s\S]{0,160}exit 1[\s\S]{0,500}install_learning_maintenance/);
});

test("installer treats a rejected Claude settings-hook merge as fatal before maintenance registration", () => {
  const installerCli = readFileSync(join(repositoryRoot, "plugins", "learning", "installer-cli.ts"), "utf8");
  const installer = readFileSync(join(repositoryRoot, "install.sh"), "utf8");
  const main = installer.slice(installer.indexOf("# ------------------------------ main"));

  assert.match(installerCli, /claudeSettingsMerged[\s\S]{0,180}process\.exitCode\s*=\s*1/);
  assert.match(main, /sync_learning_runtime\s*\|\|[\s\S]{0,160}exit 1[\s\S]{0,500}install_learning_maintenance/);
});

test("CLI --json mode emits a single JSON value on stdout for notices and activation", () => {
  const temporaryRoot = root();
  const notice = spawnSync(process.execPath, ["--experimental-strip-types", stateCli, "notice", "--json", "--profile", "personal-household"], {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: { ...process.env, XDG_STATE_HOME: temporaryRoot },
  });
  const enable = spawnSync(process.execPath, ["--experimental-strip-types", stateCli, "enable", "--json", "--profile", "personal-household", "--controller", "Local profile owner", "--lawful-basis", "household activity", "--household-context", "personal household use", "--notice-version", "2026-07-17", "--notice-hash", `sha256:${sha256(JSON.stringify({ article: "GDPR Article 13", controller: "Local profile owner", purpose: "Proposal-only local learning", retention: "30-day proposal and audit retention", version: "2026-07-17" }))}`, "--acknowledge-notice", `sha256:${sha256(JSON.stringify({ article: "GDPR Article 13", controller: "Local profile owner", purpose: "Proposal-only local learning", retention: "30-day proposal and audit retention", version: "2026-07-17" }))}`], {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: { ...process.env, XDG_STATE_HOME: temporaryRoot },
  });

  try {
    assert.equal(notice.status, 0, notice.stderr);
    assert.doesNotThrow(() => JSON.parse(notice.stdout));
    assert.equal(enable.status, 0, enable.stderr);
    assert.doesNotThrow(() => JSON.parse(enable.stdout));
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test("offline reviewer validation rejects writable ancestors and binds verified paths before spawning", async (context) => {
  if (process.platform === "win32") {
    context.skip("POSIX ownership and permission modes are not reliable Windows security signals");
    return;
  }
  const temporaryRoot = root();
  const executable = join(temporaryRoot, "reviewer");
  const artifact = join(temporaryRoot, "model.artifact");
  const executableContents = "#!/bin/sh\nprintf '%s\\n' '{\"proposals\":[]}'\n";
  const artifactContents = "offline-model";
  writeFileSync(executable, executableContents, { mode: 0o700 });
  writeFileSync(artifact, artifactContents, { mode: 0o600 });
  const configuration = {
    executable,
    executableHash: sha256(executableContents),
    modelArtifact: artifact,
    modelArtifactHash: sha256(artifactContents),
  };

  try {
    chmodSync(temporaryRoot, 0o777);
    assert.equal(await validateOfflineReviewer(configuration), false, "a group/world-writable ancestor permits pathname replacement");
    assert.equal(await invokeLocalReviewer(configuration, { signals: [] }), "", "review must not spawn after insecure ancestor validation");
    const transport = readFileSync(join(repositoryRoot, "plugins", "learning", "reviewer-transport.ts"), "utf8");
    assert.match(transport, /(?:open|fstat|O_NOFOLLOW)[\s\S]{0,600}spawn|spawn[\s\S]{0,600}(?:open|fstat|O_NOFOLLOW)/, "spawn must use a bound verified object, not a pathname that can be replaced after validation");
  } finally {
    chmodSync(temporaryRoot, 0o700);
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test("organizational governance requires validated delivery evidence, controller contact, and data-provision consequences", () => {
  const baseline = approvedGovernanceRecord();
  const complete = {
    ...baseline,
    controllerContact: "privacy-office@acme.example",
    noticeDeliveryEvidence: {
      audience: "All affected support users",
      method: "Privacy portal acknowledgement",
      deliveredAt: "2026-07-17T12:00:00.000Z",
      reference: "NOTICE-DELIVERY-2026-0717",
    },
    dataProvisionInformation: "Providing preference information is optional.",
    mandatoryConsequenceInformation: "No service consequence follows from declining to provide preference information.",
  };

  assert.equal(asGovernanceRecord(baseline), null, "delivery, controller contact, and provision consequences are mandatory");
  assert.notEqual(asGovernanceRecord(complete), null, "a complete governance record is accepted");
  assert.equal(asGovernanceRecord({ ...complete, noticeDeliveryEvidence: { ...complete.noticeDeliveryEvidence, deliveredAt: "not-a-date" } }), null, "delivery date must be an ISO timestamp");
  assert.equal(asGovernanceRecord({ ...complete, controllerContact: "not-a-contact" }), null, "controller contact must be validated");
});

test("organizational notices truthfully disclose preference-pattern analysis, no solely automated decision, and DPIA assessment", () => {
  const notice = {
    ...approvedOrganizationalNotice(),
    controllerContact: "privacy-office@acme.example",
    dataProvisionInformation: "Providing preference information is optional.",
    mandatoryConsequenceInformation: "No service consequence follows from declining to provide preference information.",
  };
  const governance = approvedGovernanceRecord();
  const validatedNotice = asOrganizationalNotice(notice);

  assert.notEqual(validatedNotice, null);
  assert.equal(asOrganizationalNotice({ ...notice, processingInformation: "No automated decision-making or profiling." }), null, "the notice must disclose automated preference-pattern analysis");
  assert.equal(asOrganizationalNotice({ ...notice, processingInformation: "Automated preference-pattern analysis makes final access decisions." }), null, "the notice must state that no decision is solely automated");
  assert.equal(asGovernanceRecord({ ...governance, dpiaScreening: "DPIA screening documented safeguards." }), null, "the DPIA assessment must cover automated preference-pattern analysis");
  if (validatedNotice === null) return;
  const rendered = renderArticle13Notice(validatedNotice);
  for (const requiredText of ["privacy-office@acme.example", "Providing preference information is optional", "No service consequence", "Automated preference-pattern analysis", "no decision is based solely on automated processing"]) {
    assert.match(rendered, new RegExp(requiredText, "i"));
  }
});
