import type { Plugin } from "@opencode-ai/plugin";
import { homedir } from "node:os";

import { localReviewerConfiguration } from "./learning/policy.ts";
import { invokeLocalReviewer, probeLocalReviewer } from "./learning/reviewer-transport.ts";
import { createProposalLearningRuntime } from "./learning/runtime.ts";

interface OpenCodeMessageOutput {
  readonly message?: { readonly role?: string };
  readonly parts?: readonly { readonly type?: string; readonly text?: string; readonly synthetic?: boolean }[];
}

function environment(): Readonly<Record<string, string | undefined>> {
  return process.env;
}

export { invokeLocalReviewer } from "./learning/reviewer-transport.ts";

const ProposalLearningPlugin: Plugin = async () => {
  const env = environment();
  const reviewerConfiguration = localReviewerConfiguration(env);
  const runtime = createProposalLearningRuntime({
    env,
    homeDirectory: homedir(),
    probe: reviewerConfiguration ? async () => probeLocalReviewer(reviewerConfiguration) : undefined,
    invokeReviewer: async (request, signal) => reviewerConfiguration ? invokeLocalReviewer(reviewerConfiguration, request, signal) : "",
  });
  process.once("beforeExit", runtime.dispose);
  return {
    "chat.message": async (
      input: { readonly sessionID?: string },
      output: OpenCodeMessageOutput,
    ): Promise<void> => {
      void runtime.captureOpenCode({
        role: output.message?.role,
        sessionId: input.sessionID,
        parts: output.parts,
      }).catch(() => undefined);
    },
  };
};

export default ProposalLearningPlugin;
