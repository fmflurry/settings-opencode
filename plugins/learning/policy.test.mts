import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_REVIEWER_RESPONSE_BYTES,
  buildReviewerRequest,
  classifyEligibleSignals,
  createLearningRuntimeGate,
  sanitizeDirectUserPrompt,
  validateReviewerResponse,
} from "./policy.ts";

test("fails closed unless an offline reviewer executable and artifact are configured", async () => {
  const disabled = createLearningRuntimeGate({});
  const cloud = createLearningRuntimeGate({
    OPENCODE_MODEL_LEARNING: "https://reviewer.example.com/v1",
  });
  const remoteAddress = createLearningRuntimeGate({
    OPENCODE_MODEL_LEARNING: "http://192.168.1.10:8080/v1",
  });
  const daemon = createLearningRuntimeGate({
    OPENCODE_MODEL_LEARNING: "ollama://llama3.2",
  });

  assert.equal(await disabled.isEnabled(), false);
  assert.equal(await cloud.isEnabled(), false);
  assert.equal(await remoteAddress.isEnabled(), false);
  assert.equal(await daemon.isEnabled({ probe: async () => true }), false);
  assert.equal(await daemon.isEnabled({ probe: async () => false }), false);
});

test("sanitizes a direct prompt before it can reach the reviewer or store", () => {
  const raw = [
    "I prefer terse answers.",
    "My email is farmer@example.test and my API key is sk-super-secret.",
    "See /Users/farmer/private/brief.md and attachment invoice.pdf.",
    "<tool_output>database password=wrong-horse</tool_output>",
    "[assistant] Here is the previous response.",
  ].join("\n");

  const sanitized = sanitizeDirectUserPrompt(raw);

  assert.deepEqual(sanitized, {
    text: "I prefer terse answers.",
    redacted: true,
  });
  assert.doesNotMatch(JSON.stringify(sanitized), /farmer@example|sk-super-secret|\/Users\/farmer|invoice\.pdf|wrong-horse|previous response/i);
});

test("accepts only corrections and repeated preferences, ignoring retired recurring-friction input", () => {
  const signals = classifyEligibleSignals({
    prompts: [
      { captureId: "capture-1", text: "No, use facade services in components, not use cases.", occurredAt: 1 },
      { captureId: "capture-2", text: "I prefer terse answers.", occurredAt: 2 },
      { captureId: "capture-3", text: "Please keep answers terse.", occurredAt: 3 },
      { captureId: "capture-4", text: "The same test command has failed three times.", occurredAt: 4 },
    ],
    verifiedRecurringFriction: [
      { key: "test-command-failure", occurrences: 3, verifiedAt: 5 },
    ],
  });

  assert.deepEqual(
    signals.map((signal) => signal.kind),
    ["explicit-correction", "repeated-preference"],
  );
});

test("does not create a learning signal from recurring-friction input alone", () => {
  assert.deepEqual(classifyEligibleSignals({
    prompts: [],
    verifiedRecurringFriction: [{ key: "test-command-failure", occurrences: 3, verifiedAt: 1 }],
  }), []);
});

test("does not treat a one-off task, an unverified complaint, or a single preference as a learning signal", () => {
  const signals = classifyEligibleSignals({
    prompts: [
      { captureId: "capture-1", text: "Fix the failing test.", occurredAt: 1 },
      { captureId: "capture-2", text: "I prefer terse answers.", occurredAt: 2 },
      { captureId: "capture-3", text: "This command is annoying.", occurredAt: 3 },
    ],
    verifiedRecurringFriction: [],
  });

  assert.deepEqual(signals, []);
});

test("reviewer input contains only sanitized eligible signals, never prompt history or tool data", () => {
  const request = buildReviewerRequest([
    {
      kind: "explicit-correction",
      summary: "Components use facades instead of use cases.",
      occurredAt: 1,
    },
  ]);

  assert.deepEqual(request, {
    signals: [
      {
        kind: "explicit-correction",
        summary: "Components use facades instead of use cases.",
      },
    ],
  });
  assert.doesNotMatch(JSON.stringify(request), /history|assistant|tool|transcript|path|attachment/i);
});

test("rejects reviewer responses outside the proposal-only schema", () => {
  const accepted = validateReviewerResponse({
    proposals: [
      {
        kind: "preference",
        title: "Prefer terse answers",
        rationale: "Repeated direct preference",
        change: "Respond concisely by default.",
      },
      {
        kind: "skill",
        title: "Terse response skill",
        rationale: "Repeated direct preference",
        change: "Provide concise responses by default.",
      },
      {
        kind: "prompt",
        title: "Terse response prompt",
        rationale: "Repeated direct preference",
        change: "Favor concise responses.",
      },
    ],
  });

  assert.equal(accepted.ok, true);

  for (const response of [
    { proposals: [{ kind: "config", title: "Change config", rationale: "", change: "" }] },
    { proposals: [{ kind: "plugin", title: "Run plugin", rationale: "", change: "" }] },
    { proposals: [{ kind: "skill", title: "Escape", rationale: "", change: "../../.zshrc" }] },
    { proposals: [{ kind: "unknown", title: "Unknown", rationale: "", change: "" }] },
    {
      proposals: [
        {
          kind: "prompt",
          title: "Oversized",
          rationale: "",
          change: "x".repeat(MAX_REVIEWER_RESPONSE_BYTES + 1),
        },
      ],
    },
  ]) {
    assert.equal(validateReviewerResponse(response).ok, false);
  }
});
