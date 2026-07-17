import {
  buildReviewerRequest,
  parseReviewerResponse,
  type LearningSignal,
  type ReviewerResponse,
} from "./policy.ts";

export interface ProposalReviewer {
  readonly capabilities: {
    readonly tools: false;
    readonly filesystem: false;
    readonly mcp: false;
    readonly claimWrites: false;
    readonly targetChanges: false;
    readonly proposalStateChanges: true;
  };
  review(signals: readonly LearningSignal[], invoke: (request: { readonly signals: readonly { readonly kind: string; readonly summary: string }[] }, signal?: AbortSignal) => Promise<string>, signal?: AbortSignal): Promise<ReviewerResponse | null>;
}

export function createProposalReviewer(): ProposalReviewer {
  return {
    capabilities: {
      tools: false,
      filesystem: false,
      mcp: false,
      claimWrites: false,
      targetChanges: false,
      proposalStateChanges: true,
    },
    async review(signals, invoke, signal): Promise<ReviewerResponse | null> {
      const request = buildReviewerRequest(signals);
      if (request.signals.length === 0 || signal?.aborted) return null;
      let rawResponse = "";
      try { rawResponse = await invoke(request, signal); } catch { return null; }
      if (signal?.aborted) return null;
      const response = parseReviewerResponse(rawResponse);
      return response.ok ? response.value : null;
    },
  };
}
