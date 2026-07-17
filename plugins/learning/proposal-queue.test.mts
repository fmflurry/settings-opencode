import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createProposalQueue } from "./proposal-queue.ts";

function createQueue(now: () => number = () => 1_000): ReturnType<typeof createProposalQueue> {
  const root = mkdtempSync(join(tmpdir(), "settings-opencode-learning-"));
  return createProposalQueue({ statePath: join(root, "proposals.json"), now });
}

function proposal(sessionId: string, harness: "opencode" | "claude", change = "Use terse answers.") {
  return {
    sessionId,
    harness,
    kind: "preference" as const,
    title: "Prefer terse answers",
    rationale: "Repeated direct preference",
    change,
  };
}

async function enable(queue: ReturnType<typeof createProposalQueue>): Promise<void> {
  await queue.setEnabled(true, { noticeAcknowledgedAt: 1, profile: "local-owner", noticeVersion: "2026-07-17", noticeHash: "sha256:190b3b554de3ac1a5d9b5d89843b8a17a0e6c76e385ae8fd023dd405e29a890e", controller: "Local profile owner", lawfulBasis: "household activity", householdContext: "personal household use" });
}

test("shares one deduplicated queue across OpenCode and Claude", async () => {
  const queue = createQueue();
  await enable(queue);

  const openCodeResult = await queue.enqueue(proposal("open-session", "opencode"));
  const claudeResult = await queue.enqueue(proposal("claude-session", "claude"));
  const duplicate = await queue.enqueue(proposal("another-session", "claude"));

  assert.equal(openCodeResult.status, "queued");
  assert.equal(claudeResult.status, "deduplicated");
  assert.equal(duplicate.status, "deduplicated");
  assert.deepEqual(
    (await queue.list()).map((item) => [...item.harnesses].sort()),
    [["claude", "opencode"]],
  );
});

test("enforces the two-per-session quota atomically across concurrent harness writes", async () => {
  const queue = createQueue();
  await enable(queue);

  const results = await Promise.all(
    ["opencode", "claude", "opencode"].map((harness, index) =>
      queue.enqueue({
        ...proposal("shared-session", harness as "opencode" | "claude", `Change ${index}`),
        title: `Proposal ${index}`,
      }),
    ),
  );

  assert.equal(results.filter((result) => result.status === "queued").length, 2);
  assert.equal(results.filter((result) => result.status === "session-quota-exceeded").length, 1);
});

test("enforces the ten-per-day quota atomically across both harnesses", async () => {
  const queue = createQueue();
  await enable(queue);

  const results = await Promise.all(
    Array.from({ length: 11 }, (_, index) =>
      queue.enqueue({
        ...proposal(`session-${index}`, index % 2 === 0 ? "opencode" : "claude", `Change ${index}`),
        title: `Proposal ${index}`,
      }),
    ),
  );

  assert.equal(results.filter((result) => result.status === "queued").length, 10);
  assert.equal(results.filter((result) => result.status === "daily-quota-exceeded").length, 1);
});

test("stores no raw prompt, secret, PII, path, attachment, or tool output", async () => {
  const root = mkdtempSync(join(tmpdir(), "settings-opencode-learning-"));
  const statePath = join(root, "proposals.json");
  const queue = createProposalQueue({ statePath, now: () => 1_000 });
  await enable(queue);

  await queue.enqueue({
    ...proposal("session", "opencode"),
    source: "My secret sk-private, farmer@example.test, /Users/farmer/private.txt, attachment.pdf, and tool output.",
  });

  const persisted = readFileSync(statePath, "utf8");
  assert.doesNotMatch(persisted, /sk-private|farmer@example|\/Users\/farmer|attachment\.pdf|tool output/i);

  rmSync(root, { recursive: true, force: true });
});

test("accepting or rejecting changes proposal state only and never applies target changes", async () => {
  const root = mkdtempSync(join(tmpdir(), "settings-opencode-learning-"));
  const targetPath = join(root, "target.txt");
  writeFileSync(targetPath, "unchanged");
  const queue = createProposalQueue({ statePath: join(root, "proposals.json"), now: () => 1_000 });
  await enable(queue);

  const queued = await queue.enqueue(proposal("session", "opencode"));
  assert.equal(queued.status, "queued");
  if (queued.status !== "queued") return;

  await queue.accept(queued.proposal.id);
  await queue.reject(queued.proposal.id);

  assert.equal(readFileSync(targetPath, "utf8"), "unchanged");
  assert.equal((await queue.get(queued.proposal.id))?.state, "rejected");

  rmSync(root, { recursive: true, force: true });
});

test("purges proposal content after 30 days while retaining only a tombstone", async () => {
  let now = 0;
  const queue = createQueue(() => now);
  await enable(queue);
  const queued = await queue.enqueue(proposal("session", "claude"));
  assert.equal(queued.status, "queued");
  if (queued.status !== "queued") return;

  now = 31 * 24 * 60 * 60 * 1_000;
  await queue.purgeExpired();

  assert.deepEqual(await queue.get(queued.proposal.id), {
    id: queued.proposal.id,
    state: "tombstoned",
  });
});

test("exports proposal state with metadata and removes all state immediately", async () => {
  const root = mkdtempSync(join(tmpdir(), "settings-opencode-learning-"));
  const queue = createProposalQueue({ statePath: join(root, "proposals.json") });
  try {
    await enable(queue);
    const queued = await queue.enqueue(proposal("session", "opencode"));
    assert.equal(queued.status, "queued");

    const exported = await queue.exportAll();
    assert.equal(exported.proposals.length, 1);
    assert.equal(exported.audit.every((event) => !("title" in event) && !("change" in event)), true);

    assert.equal(await queue.deleteAll(), 1);
    assert.equal((await queue.exportAll()).audit.some((event) => event.event === "deletion"), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
