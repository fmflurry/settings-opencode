import { createHash, randomBytes, randomUUID } from "node:crypto";
import { lstat, mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, parse, relative, resolve, sep } from "node:path";

import { validateReviewerResponse, type CapturedDescriptor, type ReviewerProposal } from "./policy.ts";
import { asPersonalNotice, digest, personalNotice } from "./notices.ts";

const DAY_MS = 24 * 60 * 60 * 1_000;
const RETENTION_MS = 30 * DAY_MS;
const DESCRIPTOR_FINGERPRINT_TTL_MS = 30 * 60 * 1_000;
const MAX_DESCRIPTOR_FINGERPRINTS = 128;
const CANCELLATION_TIMEOUT_MS = 5_000;
const CANCELLATION_POLL_MS = 25;
type Harness = "opencode" | "claude";
type ProposalState = "queued" | "accepted" | "rejected";
type AuditEvent = "activation" | "revocation" | "processing" | "proposal" | "decision" | "purge" | "deletion";
type Profile = "local-owner" | "personal-household" | "personal-harness";

export interface QueuedProposal extends ReviewerProposal { readonly id: string; readonly state: ProposalState; readonly createdAt: number; readonly harnesses: readonly Harness[]; }
export interface AuditMetadata { readonly at: number; readonly event: AuditEvent; readonly profile: Profile; readonly controllerHash: string; readonly scope: Profile; readonly sessionHash?: string; }
interface StoredProposal extends QueuedProposal { readonly contentHash: string; readonly sessionHash: string; }
interface Tombstone { readonly id: string; readonly tombstonedAt: number; }
interface ReviewJob { readonly id: string; readonly generation: number; readonly sessionHash: string; readonly reservedAt: number; readonly cancelledAt?: number; }
interface DescriptorFingerprint { readonly sessionHash: string; readonly kind: string; readonly summary: string; readonly firstSeenAt: number; readonly lastSeenAt: number; readonly count: number; readonly expiresAt: number; }
export interface ActivationMetadata {
  readonly noticeAcknowledgedAt: number;
  readonly profile: Profile;
  readonly noticeVersion: string;
  readonly noticeHash: string;
  readonly controller: string;
  readonly lawfulBasis: string;
  readonly householdContext?: string;
  readonly noticeRecord?: unknown;
}
interface QueueState { readonly version: 2; readonly enabled: boolean; readonly generation: number; readonly sessionSalt: string; readonly acknowledgement: ActivationMetadata | null; readonly proposals: readonly StoredProposal[]; readonly tombstones: readonly Tombstone[]; readonly jobs: readonly ReviewJob[]; readonly descriptorFingerprints: readonly DescriptorFingerprint[]; readonly audit: readonly AuditMetadata[]; }
export interface QueueInput extends ReviewerProposal { readonly sessionId: string; readonly harness: Harness; readonly source?: unknown; }
export interface ProposalQueue {
  enqueue(input: QueueInput): Promise<{ readonly status: "queued"; readonly proposal: QueuedProposal } | { readonly status: "deduplicated"; readonly proposal: QueuedProposal } | { readonly status: "disabled" | "session-quota-exceeded" | "daily-quota-exceeded" | "rejected" }>;
  preflight(sessionId: string): Promise<boolean>;
  recordProcessing(): Promise<boolean>;
  recordDescriptor(sessionId: string, descriptor: CapturedDescriptor): Promise<{ readonly count: number }>;
  list(): Promise<readonly QueuedProposal[]>;
  get(id: string): Promise<QueuedProposal | { readonly id: string; readonly state: "tombstoned" } | null>;
  export(id?: string): Promise<readonly QueuedProposal[]>;
  exportAll(): Promise<{ readonly enabled: boolean; readonly proposals: readonly QueuedProposal[]; readonly tombstones: readonly { readonly id: string; readonly state: "tombstoned" }[]; readonly audit: readonly AuditMetadata[] }>;
  accept(id: string): Promise<boolean>;
  reject(id: string): Promise<boolean>;
  delete(id: string): Promise<boolean>;
  deleteAll(): Promise<number>;
  setEnabled(enabled: boolean, metadata?: Partial<ActivationMetadata> & { readonly revokedAt?: number }): Promise<void>;
  beginReview(sessionId?: string): Promise<{ readonly signal: AbortSignal; readonly finish: () => void } | null>;
  onRevocation(listener: () => void): () => void;
  status(): Promise<{ readonly enabled: boolean; readonly queued: number; readonly tombstones: number }>;
  purgeExpired(): Promise<number>;
}

type EnqueueResult = Awaited<ReturnType<ProposalQueue["enqueue"]>>;
interface LocalJob { readonly controller: AbortController; readonly finished: Promise<void>; readonly acknowledge: () => void; }
const localJobsByState = new Map<string, Map<string, LocalJob>>();
const revocationListenersByState = new Map<string, Set<() => void>>();

function randomSalt(): string { return randomBytes(32).toString("hex"); }
function emptyState(): QueueState { return { version: 2, enabled: false, generation: 0, sessionSalt: randomSalt(), acknowledgement: null, proposals: [], tombstones: [], jobs: [], descriptorFingerprints: [], audit: [] }; }
function isHarness(value: unknown): value is Harness { return value === "opencode" || value === "claude"; }
function isProposalState(value: unknown): value is ProposalState { return value === "queued" || value === "accepted" || value === "rejected"; }
function isAuditEvent(value: unknown): value is AuditEvent { return value === "activation" || value === "revocation" || value === "processing" || value === "proposal" || value === "decision" || value === "purge" || value === "deletion"; }
function isProfile(value: unknown): value is Profile { return value === "local-owner" || value === "personal-household" || value === "personal-harness"; }
function isUuid(value: string): boolean { return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value); }
function hash(value: string): string { return createHash("sha256").update(value).digest("hex"); }
function saltedHash(salt: string, value: string): string { return hash(`${salt}\u0000${value}`); }
function contentHash(proposal: ReviewerProposal): string { return hash(JSON.stringify([proposal.kind, proposal.title, proposal.rationale, proposal.change])); }
function publicProposal(proposal: StoredProposal): QueuedProposal { const { contentHash: ignoredContentHash, sessionHash: ignoredSessionHash, ...value } = proposal; return value; }
function controllerForProfile(profile: Profile, controller: string): string { return controller; }

function validActivation(value: unknown): value is ActivationMetadata {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (!isProfile(record.profile) || typeof record.noticeAcknowledgedAt !== "number" || !Number.isFinite(record.noticeAcknowledgedAt) || record.noticeAcknowledgedAt <= 0 || typeof record.noticeVersion !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(record.noticeVersion) || typeof record.noticeHash !== "string" || !/^sha256:[a-f0-9]{64}$/i.test(record.noticeHash) || typeof record.controller !== "string" || !/^[\p{L}\p{N} .,'()&-]{3,180}$/u.test(record.controller.trim()) || typeof record.lawfulBasis !== "string" || record.lawfulBasis.trim().length === 0 || record.lawfulBasis.length > 180) return false;
  const notice = record.noticeRecord === undefined ? personalNotice : asPersonalNotice(record.noticeRecord);
  return notice !== null && record.noticeVersion === notice.version && record.noticeHash === digest(notice) && record.controller === notice.controller && typeof record.householdContext === "string" && record.householdContext.trim().length > 0 && record.householdContext.length <= 180;
}

function asStoredProposal(value: unknown): StoredProposal | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  const response = validateReviewerResponse({ proposals: [{ kind: candidate.kind, title: candidate.title, rationale: candidate.rationale, change: candidate.change }] });
  if (!response.ok || typeof candidate.id !== "string" || !isUuid(candidate.id) || typeof candidate.createdAt !== "number" || !isProposalState(candidate.state) || typeof candidate.contentHash !== "string" || typeof candidate.sessionHash !== "string" || !Array.isArray(candidate.harnesses) || !candidate.harnesses.every(isHarness)) return null;
  return { id: candidate.id, ...response.value.proposals[0], state: candidate.state, createdAt: candidate.createdAt, harnesses: [...new Set(candidate.harnesses)], contentHash: candidate.contentHash, sessionHash: candidate.sessionHash };
}
function asAudit(value: unknown): AuditMetadata | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.at !== "number" || !isAuditEvent(record.event) || !isProfile(record.profile) || typeof record.controllerHash !== "string" || !isProfile(record.scope) || (record.sessionHash !== undefined && typeof record.sessionHash !== "string")) return null;
  return { at: record.at, event: record.event, profile: record.profile, controllerHash: record.controllerHash, scope: record.scope, ...(typeof record.sessionHash === "string" ? { sessionHash: record.sessionHash } : {}) };
}
function asJob(value: unknown): ReviewJob | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  return typeof record.id === "string" && isUuid(record.id) && typeof record.generation === "number" && Number.isSafeInteger(record.generation) && record.generation >= 0 && typeof record.sessionHash === "string" && typeof record.reservedAt === "number" && (record.cancelledAt === undefined || typeof record.cancelledAt === "number") ? { id: record.id, generation: record.generation, sessionHash: record.sessionHash, reservedAt: record.reservedAt, ...(typeof record.cancelledAt === "number" ? { cancelledAt: record.cancelledAt } : {}) } : null;
}
function asDescriptorFingerprint(value: unknown): DescriptorFingerprint | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.sessionHash !== "string" || typeof record.kind !== "string" || typeof record.summary !== "string" || typeof record.firstSeenAt !== "number" || typeof record.lastSeenAt !== "number" || typeof record.count !== "number" || typeof record.expiresAt !== "number") return null;
  return { sessionHash: record.sessionHash, kind: record.kind, summary: record.summary, firstSeenAt: record.firstSeenAt, lastSeenAt: record.lastSeenAt, count: record.count, expiresAt: record.expiresAt };
}
function parseState(serialized: string): QueueState | null {
  try {
    const value = JSON.parse(serialized) as unknown;
    if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
    const record = value as Record<string, unknown>;
    if (record.version !== 2 || typeof record.enabled !== "boolean" || typeof record.generation !== "number" || !Number.isSafeInteger(record.generation) || record.generation < 0 || typeof record.sessionSalt !== "string" || !/^[a-f0-9]{64}$/i.test(record.sessionSalt) || !Array.isArray(record.proposals) || !Array.isArray(record.tombstones) || !Array.isArray(record.jobs) || !Array.isArray(record.descriptorFingerprints) || !Array.isArray(record.audit)) return null;
    const acknowledgement = record.acknowledgement;
    if ((acknowledgement !== null && !validActivation(acknowledgement)) || (record.enabled && !validActivation(acknowledgement))) return null;
    const proposals = record.proposals.map(asStoredProposal);
    const jobs = record.jobs.map(asJob);
    const audit = record.audit.map(asAudit);
    const descriptorFingerprints = record.descriptorFingerprints.map(asDescriptorFingerprint);
    if (proposals.some((item) => item === null) || jobs.some((item) => item === null) || audit.some((item) => item === null) || descriptorFingerprints.some((item) => item === null)) return null;
    const tombstones: Tombstone[] = [];
    for (const value of record.tombstones) {
      if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
      const tombstone = value as Record<string, unknown>;
      if (typeof tombstone.id !== "string" || !isUuid(tombstone.id) || typeof tombstone.tombstonedAt !== "number") return null;
      tombstones.push({ id: tombstone.id, tombstonedAt: tombstone.tombstonedAt });
    }
    return { version: 2, enabled: record.enabled, generation: record.generation, sessionSalt: record.sessionSalt, acknowledgement: acknowledgement as ActivationMetadata | null, proposals: proposals as StoredProposal[], tombstones, jobs: jobs as ReviewJob[], descriptorFingerprints: descriptorFingerprints as DescriptorFingerprint[], audit: audit as AuditMetadata[] };
  } catch { return null; }
}

export function createProposalQueue(options: { readonly statePath: string; readonly auditPath?: string; readonly now?: () => number; readonly profile?: string }): ProposalQueue {
  const statePath = resolve(options.statePath);
  const stateDirectory = dirname(statePath);
  const lockPath = `${statePath}.lock`;
  const now = options.now ?? Date.now;
  const configuredProfile = options.profile ?? "local-owner";
  let lifecycle = Promise.resolve();

  async function serializeLifecycle<T>(operation: () => Promise<T>): Promise<T> {
    const previous = lifecycle;
    let release: (() => void) | undefined;
    lifecycle = new Promise<void>((resolveLifecycle) => { release = resolveLifecycle; });
    await previous;
    try { return await operation(); } finally { release?.(); }
  }
  function localJobs(): Map<string, LocalJob> {
    const existing = localJobsByState.get(statePath);
    if (existing) return existing;
    const created = new Map<string, LocalJob>();
    localJobsByState.set(statePath, created);
    return created;
  }
  function notifyRevocation(): void { for (const listener of revocationListenersByState.get(statePath) ?? []) listener(); }
  function abortLocalJobs(ids: readonly string[]): void { for (const id of ids) localJobs().get(id)?.controller.abort(); }

  async function secureDirectory(): Promise<boolean> {
    if (basename(statePath) !== "proposals.json" || configuredProfile !== "local-owner") return false;
    const target = resolve(stateDirectory);
    const root = parse(target).root;
    const relativeParts = relative(root, target).split(sep).filter(Boolean);
    let current = root;
    let userOwnedBoundaryFound = false;
    try {
      for (const part of relativeParts) {
        current = join(current, part);
        try {
          const metadata = await lstat(current);
          const darwinSystemAlias = process.platform === "darwin" && current === "/var";
          if ((metadata.isSymbolicLink() && !darwinSystemAlias) || (!metadata.isDirectory() && !darwinSystemAlias)) return false;
          if (typeof process.getuid === "function") {
            if (metadata.uid === process.getuid()) userOwnedBoundaryFound = true;
            else if (userOwnedBoundaryFound || metadata.uid !== 0) return false;
          }
          if (current === target && (metadata.mode & 0o077) !== 0) return false;
        } catch (error) {
          if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") return false;
          await mkdir(current, { mode: current === target ? 0o700 : 0o700 });
          const created = await lstat(current);
          if (created.isSymbolicLink() || !created.isDirectory() || (typeof process.getuid === "function" && created.uid !== process.getuid()) || (current === target && (created.mode & 0o077) !== 0)) return false;
          userOwnedBoundaryFound = true;
        }
      }
      return true;
    } catch { return false; }
  }
  async function acquireLock(): Promise<(() => Promise<void>) | null> {
    if (!(await secureDirectory())) return null;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      try {
        const handle = await open(lockPath, "wx", 0o600);
        const owned = await handle.stat();
        return async (): Promise<void> => {
          try {
            const current = await lstat(lockPath);
            if (current.isFile() && current.dev === owned.dev && current.ino === owned.ino) await rm(lockPath);
          } finally { await handle.close(); }
        };
      } catch (error) {
        if (!(error instanceof Error) || !("code" in error) || error.code !== "EEXIST") return null;
        await new Promise<void>((resolveDelay) => setTimeout(resolveDelay, attempt + 1));
      }
    }
    return null;
  }
  async function readState(): Promise<{ readonly state: QueueState; readonly valid: boolean; readonly exists: boolean }> {
    try {
      const metadata = await lstat(statePath);
      if (!metadata.isFile() || metadata.isSymbolicLink() || (metadata.mode & 0o077) !== 0) return { state: emptyState(), valid: false, exists: true };
      const parsed = parseState(await readFile(statePath, "utf8"));
      return parsed ? { state: parsed, valid: true, exists: true } : { state: emptyState(), valid: false, exists: true };
    } catch (error) {
      return error instanceof Error && "code" in error && error.code === "ENOENT" ? { state: emptyState(), valid: true, exists: false } : { state: emptyState(), valid: false, exists: true };
    }
  }
  function cleanup(state: QueueState): { readonly state: QueueState; readonly purged: number; readonly changed: boolean } {
    const timestamp = now();
    const expired = state.proposals.filter((proposal) => timestamp - proposal.createdAt >= RETENTION_MS);
    const proposals = state.proposals.filter((proposal) => timestamp - proposal.createdAt < RETENTION_MS);
    const tombstones = [...state.tombstones.filter((item) => timestamp - item.tombstonedAt < RETENTION_MS), ...expired.map((proposal) => ({ id: proposal.id, tombstonedAt: timestamp }))];
    const jobs = state.jobs.filter((job) => timestamp - job.reservedAt < DAY_MS);
    const audit = state.audit.filter((event) => timestamp - event.at < RETENTION_MS);
    const descriptorFingerprints = state.descriptorFingerprints.filter((fingerprint) => timestamp < fingerprint.expiresAt);
    return { state: { ...state, proposals, tombstones, jobs, descriptorFingerprints, audit }, purged: expired.length, changed: proposals.length !== state.proposals.length || tombstones.length !== state.tombstones.length || jobs.length !== state.jobs.length || audit.length !== state.audit.length || descriptorFingerprints.length !== state.descriptorFingerprints.length };
  }
  async function syncDirectory(): Promise<void> { const directory = await open(stateDirectory, "r"); try { await directory.sync(); } finally { await directory.close(); } }
  async function writeState(state: QueueState): Promise<boolean> {
    const temporaryPath = join(stateDirectory, `.${basename(statePath)}.${randomUUID()}.tmp`);
    try {
      await writeFile(temporaryPath, JSON.stringify(state), { encoding: "utf8", mode: 0o600, flag: "wx" });
      const temporary = await open(temporaryPath, "r");
      try { await temporary.sync(); } finally { await temporary.close(); }
      await rename(temporaryPath, statePath);
      await syncDirectory();
      return true;
    } catch { await rm(temporaryPath, { force: true }); return false; }
  }
  function auditRecord(state: QueueState, event: AuditEvent, sessionHash?: string): AuditMetadata {
    const acknowledgement = state.acknowledgement;
    const profile = acknowledgement?.profile ?? "local-owner";
    return { at: now(), event, profile, controllerHash: saltedHash(state.sessionSalt, controllerForProfile(profile, acknowledgement?.controller ?? "revoked")), scope: profile, ...(sessionHash ? { sessionHash } : {}) };
  }
  async function mutate<T>(operation: (state: QueueState, purged: number) => { readonly state: QueueState; readonly result: T; readonly event?: AuditEvent; readonly sessionHash?: string }): Promise<T | null> {
    const release = await acquireLock();
    if (!release) return null;
    try {
      const current = await readState();
      if (!current.valid) return null;
      const cleaned = cleanup(current.state);
      const outcome = operation(cleaned.state, cleaned.purged);
      const event = outcome.event ?? (cleaned.purged > 0 ? "purge" : undefined);
      const state = event ? { ...outcome.state, audit: [...outcome.state.audit, auditRecord(outcome.state, event, outcome.sessionHash)] } : outcome.state;
      if ((event !== undefined || cleaned.changed || state !== current.state) && !(await writeState(state))) return null;
      return outcome.result;
    } finally { await release(); }
  }
  async function readClean(): Promise<QueueState | null> {
    const release = await acquireLock();
    if (!release) return null;
    try {
      const current = await readState();
      if (!current.valid) return null;
      const cleaned = cleanup(current.state);
      const state = cleaned.purged > 0 ? { ...cleaned.state, audit: [...cleaned.state.audit, auditRecord(cleaned.state, "purge")] } : cleaned.state;
      if (cleaned.changed && !(await writeState(state))) return null;
      return state;
    } finally { await release(); }
  }
  function active(state: QueueState): boolean { return state.enabled && validActivation(state.acknowledgement); }
  function quotaStatus(state: QueueState, sessionHash: string): "session-quota-exceeded" | "daily-quota-exceeded" | null {
    const timestamp = now();
    const processing = state.audit.filter((event) => event.event === "processing" && timestamp - event.at < DAY_MS);
    const proposals = state.proposals.filter((proposal) => timestamp - proposal.createdAt < DAY_MS);
    if (Math.max(processing.length, proposals.length) >= 10) return "daily-quota-exceeded";
    if (Math.max(processing.filter((event) => event.sessionHash === sessionHash).length, proposals.filter((proposal) => proposal.sessionHash === sessionHash).length) >= 2) return "session-quota-exceeded";
    return null;
  }
  async function completeJob(id: string): Promise<void> { await mutate((state) => ({ state: { ...state, jobs: state.jobs.filter((job) => job.id !== id) }, result: undefined })); }
  async function jobCancelled(id: string, generation: number): Promise<boolean> {
    const state = await readClean();
    const job = state?.jobs.find((candidate) => candidate.id === id);
    return state === null || !active(state) || state.generation !== generation || job === undefined || job.cancelledAt !== undefined;
  }
  async function waitForAcknowledgements(ids: readonly string[]): Promise<void> {
    const deadline = Date.now() + CANCELLATION_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const state = await readClean();
      if (state !== null && ids.every((id) => !state.jobs.some((job) => job.id === id))) return;
      await new Promise<void>((resolveDelay) => setTimeout(resolveDelay, CANCELLATION_POLL_MS));
    }
    throw new Error("proposal-learning cancellation was not acknowledged; state remains disabled");
  }

  return {
    async preflight(sessionId) { const state = await readClean(); return typeof sessionId === "string" && sessionId.length > 0 && state !== null && active(state) && quotaStatus(state, saltedHash(state.sessionSalt, sessionId)) === null; },
    async recordProcessing() { return (await mutate((state) => ({ state, result: active(state), event: active(state) ? "processing" as const : undefined }))) ?? false; },
    async recordDescriptor(sessionId, descriptor) {
      if (typeof sessionId !== "string" || sessionId.length === 0) return { count: 0 };
      const result = await mutate<{ count: number }>((state) => {
        if (!active(state)) return { state, result: { count: 0 } };
        const sessionHash = saltedHash(state.sessionSalt, sessionId);
        const timestamp = now();
        const fingerprintKey = `${sessionHash}\u0000${descriptor.signal.kind}\u0000${descriptor.signal.summary}`;
        const existingIndex = state.descriptorFingerprints.findIndex((fingerprint) => `${fingerprint.sessionHash}\u0000${fingerprint.kind}\u0000${fingerprint.summary}` === fingerprintKey);
        let descriptorFingerprints: DescriptorFingerprint[] = state.descriptorFingerprints.slice();
        let count = 1;
        if (existingIndex >= 0) {
          const existing = descriptorFingerprints[existingIndex];
          count = existing.count + 1;
          descriptorFingerprints[existingIndex] = { ...existing, lastSeenAt: timestamp, count, expiresAt: timestamp + DESCRIPTOR_FINGERPRINT_TTL_MS };
        } else {
          descriptorFingerprints.push({ sessionHash, kind: descriptor.signal.kind, summary: descriptor.signal.summary, firstSeenAt: timestamp, lastSeenAt: timestamp, count: 1, expiresAt: timestamp + DESCRIPTOR_FINGERPRINT_TTL_MS });
        }
        if (descriptorFingerprints.length > MAX_DESCRIPTOR_FINGERPRINTS) {
          descriptorFingerprints = descriptorFingerprints.slice().sort((left, right) => left.lastSeenAt - right.lastSeenAt).slice(-MAX_DESCRIPTOR_FINGERPRINTS);
        }
        return { state: { ...state, descriptorFingerprints }, result: { count } };
      });
      return result ?? { count: 0 };
    },
    async beginReview(sessionId = "review-reservation") {
      const reservation = await mutate((state) => {
        if (!active(state)) return { state, result: null };
        const sessionHash = saltedHash(state.sessionSalt, sessionId);
        if (quotaStatus(state, sessionHash)) return { state, result: null };
        const job: ReviewJob = { id: randomUUID(), generation: state.generation, sessionHash, reservedAt: now() };
        return { state: { ...state, jobs: [...state.jobs, job] }, result: job, event: "processing" as const, sessionHash };
      });
      if (!reservation) return null;
      const controller = new AbortController();
      let acknowledge: (() => void) | undefined;
      const finished = new Promise<void>((resolveFinished) => { acknowledge = resolveFinished; });
      const localJob: LocalJob = { controller, finished, acknowledge: () => acknowledge?.() };
      localJobs().set(reservation.id, localJob);
      try { if (await jobCancelled(reservation.id, reservation.generation)) controller.abort(); } catch { controller.abort(); }
      const checkCancellation = (): void => {
        const cancellation = jobCancelled(reservation.id, reservation.generation);
        void cancellation.then(
          (cancelled) => { if (cancelled) controller.abort(); },
          () => controller.abort(),
        );
      };
      const watcher = setInterval(checkCancellation, CANCELLATION_POLL_MS);
      watcher.unref();
      let finishedOnce = false;
      return {
        signal: controller.signal,
        finish: () => {
          if (finishedOnce) return;
          finishedOnce = true;
          clearInterval(watcher);
          localJobs().delete(reservation.id);
          void completeJob(reservation.id).then(localJob.acknowledge, localJob.acknowledge);
        },
      };
    },
    async enqueue(input) {
      if (!isHarness(input.harness) || typeof input.sessionId !== "string" || !input.sessionId) return { status: "rejected" };
      const validation = validateReviewerResponse({ proposals: [{ kind: input.kind, title: input.title, rationale: input.rationale, change: input.change }] });
      if (!validation.ok) return { status: "rejected" };
      const reviewerProposal = validation.value.proposals[0];
      return (await mutate<EnqueueResult>((state) => {
        if (!active(state)) return { state, result: { status: "disabled" } };
        const sessionHash = saltedHash(state.sessionSalt, input.sessionId);
        const quota = quotaStatus(state, sessionHash);
        if (quota) return { state, result: { status: quota } };
        const proposalHash = contentHash(reviewerProposal);
        const existing = state.proposals.find((proposal) => proposal.contentHash === proposalHash);
        if (existing) {
          const updated = { ...existing, harnesses: [...new Set([...existing.harnesses, input.harness])].sort() as Harness[] };
          return { state: { ...state, proposals: state.proposals.map((proposal) => proposal.id === existing.id ? updated : proposal) }, result: { status: "deduplicated", proposal: publicProposal(updated) }, event: "proposal" as const };
        }
        const proposal: StoredProposal = { id: randomUUID(), ...reviewerProposal, state: "queued", createdAt: now(), harnesses: [input.harness], contentHash: proposalHash, sessionHash };
        return { state: { ...state, proposals: [...state.proposals, proposal] }, result: { status: "queued", proposal: publicProposal(proposal) }, event: "proposal" as const };
      })) ?? { status: "disabled" };
    },
    async list() { const state = await readClean(); return state?.proposals.map(publicProposal) ?? []; },
    async get(id) { if (!isUuid(id)) return null; const state = await readClean(); if (!state) return null; const proposal = state.proposals.find((candidate) => candidate.id === id); return proposal ? publicProposal(proposal) : state.tombstones.some((item) => item.id === id) ? { id, state: "tombstoned" as const } : null; },
    async export(id) { const state = await readClean(); return !state ? [] : id && isUuid(id) ? state.proposals.filter((proposal) => proposal.id === id).map(publicProposal) : state.proposals.filter((proposal) => proposal.state === "queued").map(publicProposal); },
    async exportAll() { const state = await readClean(); return !state ? { enabled: false, proposals: [], tombstones: [], audit: [] } : { enabled: active(state), proposals: state.proposals.map(publicProposal), tombstones: state.tombstones.map(({ id }) => ({ id, state: "tombstoned" as const })), audit: state.audit }; },
    async accept(id) { return isUuid(id) && (await mutate((state) => { const exists = state.proposals.some((proposal) => proposal.id === id); return { state: { ...state, proposals: state.proposals.map((proposal) => proposal.id === id ? { ...proposal, state: "accepted" as const } : proposal) }, result: exists, event: exists ? "decision" as const : undefined }; })) === true; },
    async reject(id) { return isUuid(id) && (await mutate((state) => { const exists = state.proposals.some((proposal) => proposal.id === id); return { state: { ...state, proposals: state.proposals.map((proposal) => proposal.id === id ? { ...proposal, state: "rejected" as const } : proposal) }, result: exists, event: exists ? "decision" as const : undefined }; })) === true; },
    async delete(id) { return isUuid(id) && (await mutate((state) => { const exists = state.proposals.some((proposal) => proposal.id === id) || state.tombstones.some((item) => item.id === id); return { state: { ...state, proposals: state.proposals.filter((proposal) => proposal.id !== id), tombstones: state.tombstones.filter((item) => item.id !== id) }, result: exists, event: exists ? "deletion" as const : undefined }; })) === true; },
    async deleteAll() {
      abortLocalJobs([...localJobs().keys()]);
      const outcome = await mutate((state) => {
        const deleted = state.proposals.length + state.tombstones.length;
        const cancelledAt = now();
        const jobs = state.jobs.map((job) => ({ ...job, cancelledAt }));
        return { state: { ...state, enabled: false, generation: state.generation + 1, acknowledgement: null, proposals: [], tombstones: [], descriptorFingerprints: [], jobs }, result: { deleted, ids: jobs.map((job) => job.id) }, event: "deletion" as const };
      });
      if (!outcome) return 0;
      notifyRevocation();
      abortLocalJobs(outcome.ids);
      await waitForAcknowledgements(outcome.ids);
      return outcome.deleted;
    },
    async setEnabled(enabled, metadata = {}) {
      if (enabled) { await mutate((state) => validActivation(metadata) ? { state: { ...state, enabled: true, acknowledgement: { ...metadata } }, result: undefined, event: "activation" as const } : { state, result: undefined }); return; }
      abortLocalJobs([...localJobs().keys()]);
      const outcome = await mutate((state) => {
        const cancelledAt = now();
        const jobs = state.jobs.map((job) => ({ ...job, cancelledAt }));
        return { state: { ...state, enabled: false, generation: state.generation + 1, acknowledgement: null, descriptorFingerprints: [], jobs }, result: jobs.map((job) => job.id), event: "revocation" as const };
      });
      if (outcome === null) throw new Error("proposal-learning revocation could not acquire the secure state transaction");
      notifyRevocation();
      abortLocalJobs(outcome);
      await waitForAcknowledgements(outcome);
    },
    onRevocation(listener) { const listeners = revocationListenersByState.get(statePath) ?? new Set<() => void>(); listeners.add(listener); revocationListenersByState.set(statePath, listeners); return () => { listeners.delete(listener); if (listeners.size === 0) revocationListenersByState.delete(statePath); }; },
    async status() { const state = await readClean(); return { enabled: state !== null && active(state), queued: state?.proposals.filter((proposal) => proposal.state === "queued").length ?? 0, tombstones: state?.tombstones.length ?? 0 }; },
    async purgeExpired() { return (await mutate((state, purged) => ({ state, result: purged }))) ?? 0; },
  };
}
