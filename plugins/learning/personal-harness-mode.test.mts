import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { digest, personalNotice } from "./notices.ts";
import { createProposalQueue, type ActivationMetadata } from "./proposal-queue.ts";
import { createProposalLearningRuntime } from "./runtime.ts";

const repositoryRoot = join(import.meta.dirname, "..", "..");

function root(): string {
  return mkdtempSync(join(tmpdir(), "settings-opencode-personal-harness-"));
}

function personalHarnessActivation(): ActivationMetadata {
  return {
    noticeAcknowledgedAt: 1,
    profile: "personal-harness",
    noticeVersion: personalNotice.version,
    noticeHash: digest(personalNotice),
    controller: personalNotice.controller,
    lawfulBasis: "household activity",
    householdContext: "personal harness on the owner's macOS account",
  } as unknown as ActivationMetadata;
}

function legacyLocalActivation(): ActivationMetadata {
  return {
    noticeAcknowledgedAt: 1,
    profile: "local-owner",
    noticeVersion: personalNotice.version,
    noticeHash: digest(personalNotice),
    controller: personalNotice.controller,
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

test("activation accepts the personal-harness profile", async () => {
  const temporaryRoot = root();
  const queue = createProposalQueue({ statePath: join(temporaryRoot, "proposals.json") });

  try {
    await queue.setEnabled(true, personalHarnessActivation());
    assert.equal((await queue.status()).enabled, true);
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test("activation rejects organizational and governance paths fail closed", async () => {
  const temporaryRoot = root();
  const queue = createProposalQueue({ statePath: join(temporaryRoot, "proposals.json") });
  const stateCli = readFileSync(join(repositoryRoot, "plugins", "learning", "state-cli.ts"), "utf8");

  try {
    await queue.setEnabled(true, {
      ...personalHarnessActivation(),
      profile: "organizational",
      governanceRecordVersion: "2026-07-17",
      governanceRecordHash: `sha256:${"0".repeat(64)}`,
      legalBasisReference: "GDPR Article 6(1)(f)",
      governanceRecord: { status: "completed" },
    } as unknown as ActivationMetadata);
    assert.equal((await queue.status()).enabled, false);
    assert.doesNotMatch(stateCli, /profile\s*===\s*["']organizational["']|--governance-record-file|--legal-basis-reference/);
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test("fresh Claude runtimes retain only bounded salted descriptor fingerprints for repeated preferences", async () => {
  const temporaryRoot = root();
  const statePath = join(temporaryRoot, "proposals.json");
  const queue = createProposalQueue({ statePath });
  let invocations = 0;
  const options = {
    env: {},
    homeDirectory: temporaryRoot,
    queue,
    probe: async (): Promise<boolean> => true,
    invokeReviewer: async (): Promise<string> => {
      invocations += 1;
      return reviewerResponse();
    },
  };

  try {
    await queue.setEnabled(true, legacyLocalActivation());
    const firstRuntime = createProposalLearningRuntime(options);
    await firstRuntime.captureClaude({ session_id: "claude-session-raw", user_prompt: "I prefer terse answers." });
    firstRuntime.dispose();

    const secondRuntime = createProposalLearningRuntime(options);
    assert.notEqual(secondRuntime, firstRuntime);
    await secondRuntime.captureClaude({ session_id: "claude-session-raw", user_prompt: "Please keep answers terse." });
    secondRuntime.dispose();

    assert.equal(invocations, 1);
    assert.equal((await queue.list()).length, 1);
    const persisted = readFileSync(statePath, "utf8");
    assert.doesNotMatch(persisted, /claude-session-raw|I prefer terse answers|Please keep answers terse/i);
    assert.match(persisted, /"descriptorFingerprints":\[[^\]]{1,2048}\]/);
    assert.match(persisted, /"descriptorFingerprints":\[[^\]]*[a-f0-9]{64}[^\]]*\]/i);
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test("operator documentation limits v1 to the owner's personal macOS harness and discloses residual access and egress risk", () => {
  const learning = readFileSync(join(repositoryRoot, "LEARNING.md"), "utf8");

  assert.doesNotMatch(learning, /verified recurring friction/i);
  assert.match(learning, /same[- ]UID[\s\S]{0,180}(?:state|CLI|reviewer)|(?:state|CLI|reviewer)[\s\S]{0,180}same[- ]UID/i);
  assert.match(learning, /no OS sandbox|without an OS sandbox|not OS-sandboxed/i);
  assert.match(learning, /local-only[\s\S]{0,240}(?:external egress|network egress)|(?:external egress|network egress)[\s\S]{0,240}local-only/i);
  assert.match(learning, /(?:must not|prohibited|not suitable)[\s\S]{0,180}(?:organizational|multi-user)|(?:organizational|multi-user)[\s\S]{0,180}(?:must not|prohibited|not suitable)/i);
});
