import { homedir } from "node:os";

import { localReviewerConfiguration } from "./policy.ts";
import { invokeLocalReviewer, probeLocalReviewer } from "./reviewer-transport.ts";
import { createProposalLearningRuntime } from "./runtime.ts";

const MAX_CLAUDE_STDIN_BYTES = 16_384;

async function main(): Promise<void> {
  const decoder = new TextDecoder();
  let bytes = 0;
  let serialized = "";
  for await (const chunk of process.stdin) {
    if (!(chunk instanceof Uint8Array)) return;
    bytes += chunk.byteLength;
    if (bytes > MAX_CLAUDE_STDIN_BYTES) return;
    serialized += decoder.decode(chunk, { stream: true });
  }
  let payload: unknown;
  try {
    payload = JSON.parse(serialized + decoder.decode()) as unknown;
  } catch {
    return;
  }
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return;
  const reviewerConfiguration = localReviewerConfiguration(process.env);
  const runtime = createProposalLearningRuntime({
    env: process.env,
    homeDirectory: homedir(),
    probe: reviewerConfiguration ? async () => probeLocalReviewer(reviewerConfiguration) : undefined,
    invokeReviewer: async (request, signal) => reviewerConfiguration ? invokeLocalReviewer(reviewerConfiguration, request, signal) : "",
  });
  try {
    if (!reviewerConfiguration) return;
    await runtime.captureClaude(payload as { readonly session_id?: string; readonly user_prompt?: string; readonly transcript_path?: unknown });
  } finally {
    runtime.dispose();
  }
}

void main();
