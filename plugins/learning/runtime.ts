import { createHash, randomBytes, randomUUID } from "node:crypto";
import { join } from "node:path";

import { captureClaudeUserPrompt, captureOpenCodeDirectMessage, type CaptureGate, type DirectPromptSink } from "./harness-adapters.ts";
import { createLearningRuntimeGate, describeCapturedPrompt, type CapturedDescriptor, type LearningSignal } from "./policy.ts";
import { createProposalQueue, type ProposalQueue } from "./proposal-queue.ts";
import { createProposalReviewer } from "./reviewer.ts";

const MAINTENANCE_INTERVAL_MS = 24 * 60 * 60 * 1_000;
const DESCRIPTOR_CACHE_TTL_MS = 30 * 60 * 1_000;
const DESCRIPTOR_CACHE_MAX_ENTRIES = 128;
const SESSION_DESCRIPTOR_SALT = randomBytes(32).toString("hex");

interface DescriptorCacheEntry {
  readonly descriptors: readonly CapturedDescriptor[];
  readonly expiresAt: number;
  readonly lastUsedAt: number;
}

function sessionCacheKey(sessionId: string): string {
  return createHash("sha256").update(`${SESSION_DESCRIPTOR_SALT}\u0000${sessionId}`).digest("hex");
}

export function defaultLearningStateRoot(env: Readonly<Record<string, string | undefined>>, homeDirectory: string): string {
  const stateHome = env.XDG_STATE_HOME?.trim() || join(homeDirectory, ".local", "state");
  return join(stateHome, "settings-opencode", "proposal-learning", "v1");
}

export interface ProposalLearningRuntime {
  readonly sink: DirectPromptSink;
  captureOpenCode(message: { readonly role?: string; readonly sessionId?: string; readonly parts?: readonly { readonly type?: string; readonly text?: string; readonly synthetic?: boolean }[] }): Promise<void>;
  captureClaude(payload: { readonly session_id?: string; readonly user_prompt?: string; readonly transcript_path?: unknown }): Promise<void>;
  dispose(): void;
}

function observeBackground(operation: Promise<unknown>): void {
  void operation.catch(() => undefined);
}

export function createProposalLearningRuntime(options: {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly homeDirectory: string;
  readonly invokeReviewer: (request: { readonly signals: readonly { readonly kind: string; readonly summary: string }[] }, signal?: AbortSignal) => Promise<string>;
  readonly probe?: (endpoint: string) => Promise<boolean>;
  readonly queue?: ProposalQueue;
}): ProposalLearningRuntime {
  const descriptorsBySession = new Map<string, DescriptorCacheEntry>();
  const gate = createLearningRuntimeGate(options.env);
  const queue = options.queue ?? createProposalQueue({ statePath: join(defaultLearningStateRoot(options.env, options.homeDirectory), "proposals.json") });
  const reviewer = createProposalReviewer();
  const removeRevocationListener = queue.onRevocation(() => { descriptorsBySession.clear(); });
  const maintenance = setInterval(() => { observeBackground(queue.purgeExpired()); }, MAINTENANCE_INTERVAL_MS);
  maintenance.unref();
  const refreshRevocation = async (): Promise<void> => {
    try {
      if (!(await queue.status()).enabled) descriptorsBySession.clear();
    } catch {
      descriptorsBySession.clear();
    }
  };
  const revocationMonitor = setInterval(() => { observeBackground(refreshRevocation()); }, 250);
  revocationMonitor.unref();
  const captureGate: CaptureGate = {
    isEnabled: async (sessionId: string): Promise<boolean> => queue.preflight(sessionId),
  };

  const sink: DirectPromptSink = {
    async capture(prompt): Promise<void> {
      // Queue consent, profile, expiry, and quota are checked before even
      // inspecting prompt content. A revoked state stops inference instantly.
      if (!(await queue.preflight(prompt.sessionId))) return;
      const reviewerAvailable = gate.endpoint !== null
        ? await gate.isEnabled({ probe: options.probe })
        : options.probe !== undefined;
      if (!reviewerAvailable) return;
      const occurredAt = Date.now();
      const descriptor = describeCapturedPrompt(randomUUID(), prompt.text, occurredAt);
      if (!descriptor) return;
      const cacheKey = sessionCacheKey(prompt.sessionId);
      const timestamp = Date.now();
      for (const [key, entry] of descriptorsBySession) {
        if (entry.expiresAt <= timestamp) descriptorsBySession.delete(key);
      }
      const prior = descriptorsBySession.get(cacheKey)?.descriptors ?? [];
      const descriptors = [...prior.filter((candidate) => candidate.captureId !== descriptor.captureId), descriptor].slice(-8);
      descriptorsBySession.set(cacheKey, { descriptors, expiresAt: timestamp + DESCRIPTOR_CACHE_TTL_MS, lastUsedAt: timestamp });
      if (descriptorsBySession.size > DESCRIPTOR_CACHE_MAX_ENTRIES) {
        const leastRecentlyUsed = [...descriptorsBySession.entries()].sort((left, right) => left[1].lastUsedAt - right[1].lastUsedAt).at(0);
        if (leastRecentlyUsed) descriptorsBySession.delete(leastRecentlyUsed[0]);
      }
      const repeatedCount = descriptor.signal.kind === "repeated-preference"
        ? (await queue.recordDescriptor(prompt.sessionId, descriptor)).count
        : 0;
      const inMemoryRepeatedCount = descriptors.filter((candidate) => candidate.signal.kind === "repeated-preference" && candidate.signal.summary === descriptor.signal.summary).length;
      const signals: readonly LearningSignal[] = descriptor.signal.kind === "explicit-correction"
        ? [descriptor.signal]
        : inMemoryRepeatedCount >= 2 || repeatedCount >= 2
          ? [descriptor.signal]
          : [];
      if (signals.length === 0) return;
      const review = await queue.beginReview(prompt.sessionId);
      if (!review) return;
      try {
        const response = await reviewer.review(signals, options.invokeReviewer, review.signal);
        if (!response || review.signal.aborted) return;
        for (const proposal of response.proposals) {
          await queue.enqueue({ ...proposal, sessionId: prompt.sessionId, harness: prompt.harness });
        }
      } finally {
        review.finish();
      }
    },
  };
  return {
    sink,
    captureOpenCode: async (message) => captureOpenCodeDirectMessage(sink, message, captureGate),
    captureClaude: async (payload) => captureClaudeUserPrompt(sink, payload, captureGate),
    dispose: () => {
      clearInterval(maintenance);
      clearInterval(revocationMonitor);
      removeRevocationListener();
      descriptorsBySession.clear();
    },
  };
}
