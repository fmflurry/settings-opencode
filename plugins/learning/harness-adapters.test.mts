import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  captureClaudeUserPrompt,
  captureOpenCodeDirectMessage,
  type DirectPromptSink,
} from "./harness-adapters.ts";
import { createProposalReviewer } from "./reviewer.ts";

function createSink(): { sink: DirectPromptSink; prompts: string[] } {
  const prompts: string[] = [];
  return {
    sink: {
      capture: async (prompt) => {
        prompts.push(prompt.text);
      },
    },
    prompts,
  };
}

test("the OpenCode adapter captures only a user's direct, non-synthetic text message", async () => {
  const { sink, prompts } = createSink();

  await captureOpenCodeDirectMessage(sink, {
    role: "user",
    sessionId: "session",
    parts: [{ type: "text", text: "I prefer terse answers.", synthetic: false }],
  });
  await captureOpenCodeDirectMessage(sink, {
    role: "assistant",
    sessionId: "session",
    parts: [{ type: "text", text: "Assistant content", synthetic: false }],
  });
  await captureOpenCodeDirectMessage(sink, {
    role: "user",
    sessionId: "session",
    parts: [{ type: "tool", text: "Tool output", synthetic: false }],
  });
  await captureOpenCodeDirectMessage(sink, {
    role: "user",
    sessionId: "session",
    parts: [{ type: "text", text: "Synthetic prompt", synthetic: true }],
  });

  assert.deepEqual(prompts, ["I prefer terse answers."]);
});

test("the Claude UserPromptSubmit adapter ignores transcript_path and reads only user_prompt", async () => {
  const root = mkdtempSync(join(tmpdir(), "settings-opencode-learning-"));
  const transcriptPath = join(root, "transcript.jsonl");
  writeFileSync(transcriptPath, "assistant: leaked transcript\ntool: leaked output\nsecret=leaked\n");
  const { sink, prompts } = createSink();

  await captureClaudeUserPrompt(sink, {
    session_id: "session",
    user_prompt: "Please keep replies terse.",
    transcript_path: transcriptPath,
  });

  assert.deepEqual(prompts, ["Please keep replies terse."]);
  rmSync(root, { recursive: true, force: true });
});

test("the reviewer has no tools, filesystem, MCP, or claim-write capability and can change proposal state only", () => {
  const reviewer = createProposalReviewer();

  assert.deepEqual(reviewer.capabilities, {
    tools: false,
    filesystem: false,
    mcp: false,
    claimWrites: false,
    targetChanges: false,
    proposalStateChanges: true,
  });
});
