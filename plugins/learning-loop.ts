/**
 * learning-loop OpenCode plugin
 *
 * Triggers one learning review per idle window, not per message.
 * After the session goes idle, a debounced timer fires after
 * LEARNING_LOOP_IDLE_MS (default 5 min). If the session becomes active
 * again before the timer fires, the timer is reset. Once the timer fires,
 * exactly one review is dispatched for that idle window and the session is
 * marked "reviewed" until it goes active again.
 *
 * Guards (all durable across restarts via SQLite):
 *   - Kill-switch: LEARNING_LOOP_ENABLED=false|0 disables all dispatches.
 *   - Daily cap (LEARNING_LOOP_DAILY_CAP, default 50) persisted in SQLite.
 *   - Circuit breaker: any balance/quota/auth error arms a time-based breaker
 *     (default 6 h) stored in SQLite. Resets automatically after the window.
 *   - Pre-dispatch signal gate: skips low-signal sessions (too few messages,
 *     no corrections/preferences/error-fix cycles, or duplicate signature).
 *   - Per-idle-window budget (LEARNING_LOOP_BUDGET, default 1) per session
 *     (still in-memory; intentionally resets on restart as it's transient).
 *   - Dedup: session signatures persisted in learning_seen table.
 *
 * The review is dispatched as a fire-and-forget child session running the
 * `learning-reviewer` agent. The model is NOT hardcoded here — it comes from
 * the learning-reviewer agent configuration.
 *
 * NOTE: The SDK emits `session.idle` (EventSessionIdle) when a session
 * transitions to idle. This replaces the previous per-`message.updated`
 * trigger that caused ~7,000 spurious dispatches in 46 minutes.
 */

import type { Plugin } from "@opencode-ai/plugin";
import type { Event } from "@opencode-ai/sdk";
import { Database } from "bun:sqlite";
import * as os from "node:os";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { mkdirSync, renameSync, existsSync } from "node:fs";

// ─── Types ───────────────────────────────────────────────────────────────────

interface SessionResponse {
  data?: {
    id: string;
  };
}

interface MessagePart {
  type?: string;
  text?: string;
  synthetic?: boolean;
}

interface MessageEntry {
  info?: {
    role?: string;
    mode?: string;
  };
  parts?: MessagePart[];
  toolName?: string;
}

interface MessagesResponse {
  data?: MessageEntry[];
}

// ─── Constants ───────────────────────────────────────────────────────────────

const SERVICE = "learning-loop";

/** HTTP status codes that arm the circuit breaker. */
const BREAKER_STATUS_CODES: ReadonlySet<number> = new Set([401, 402, 403, 429]);

/** String patterns that arm the circuit breaker (case-insensitive). */
const QUOTA_ERROR_PATTERNS: ReadonlyArray<string> = [
  "insufficient balance",
  "insufficient_balance",
  "quota exceeded",
  "rate limit",
  "unauthorized",
  "forbidden",
  "payment required",
];

/** Minimum non-synthetic messages required before dispatching a review. */
const MIN_MESSAGES = 10;

/** Minimum user turns required before dispatching a review. */
const MIN_USER_TURNS = 2;

/** Maximum number of recent signatures to retain in the dedup window. */
const DEDUP_WINDOW = 20;

/** Regex: user correction signal. */
const CORRECTION_RE = /\b(no|nope|actually|wrong|don'?t|instead|revert)\b/i;

/** Regex: stated preference / decision signal. */
const PREFERENCE_RE =
  /\b(prefer|always|never|use |don'?t use|from now on)\b/i;

/** Regex: error / failure in an assistant or tool message. */
const ERROR_IN_MSG_RE = /error|failed|exception/i;

// ─── Decay / eviction constants ──────────────────────────────────────────────

/** Score multiplier when a correction is found in the session. */
const DECAY_CORRECTION_MULT = 0.5;
/** Score delta when a correction is found. */
const DECAY_CORRECTION_DELTA = -1.0;
/** Score multiplier when injected + invoked + no correction (positive signal). */
const REINFORCE_INVOKED_MULT = 1.1;
/** Score delta when injected + invoked + no correction. */
const REINFORCE_INVOKED_DELTA = 0.5;
/**
 * Score multiplier when injected + NOT invoked + no correction.
 * Intentionally 1.0 (no change) — we cannot yet PROVE non-use because the
 * tool.execute.after shape is still being discovered empirically via the
 * self-discovery log in learning-recall.ts.
 * TODO: once skill-tool shape is confirmed via discovery log, restore a
 * gentle decay here (e.g. 0.95) to distinguish advertised-but-ignored from
 * advertised-and-invoked. Until then, silence is not evidence of failure.
 */
const DECAY_NOT_INVOKED_MULT = 1.0; // no-op; see TODO above
/** Global time-decay multiplier applied to ALL rows once per idle pass. */
const GLOBAL_TIME_DECAY_MULT = 0.98;
/** Skill eviction threshold. */
const EVICTION_SCORE_THRESHOLD = 0.2;
/** Eviction age threshold in days. */
const EVICTION_AGE_DAYS = 30;

const SKILLS_DIR = path.join(
  os.homedir(),
  ".config",
  "opencode",
  "skills",
);
const PENDING_SKILLS_DIR = path.join(
  os.homedir(),
  ".config",
  "opencode",
  "pending",
  "skills",
);

// ─── Env helpers ─────────────────────────────────────────────────────────────

const envProc = (
  globalThis as { process?: { env?: Record<string, string | undefined> } }
).process;

function readEnvStr(key: string): string | undefined {
  return envProc?.env?.[key];
}

function readEnvInt(key: string, fallback: number): number {
  const raw = readEnvStr(key);
  const parsed = raw !== undefined ? parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const IDLE_MS = readEnvInt("LEARNING_LOOP_IDLE_MS", 300_000); // 5 min
const DAILY_CAP = readEnvInt("LEARNING_LOOP_DAILY_CAP", 50);
const IDLE_WINDOW_BUDGET = readEnvInt("LEARNING_LOOP_BUDGET", 1);
const BREAKER_MS = readEnvInt("LEARNING_LOOP_BREAKER_MS", 21_600_000); // 6 h

// ─── DB path ─────────────────────────────────────────────────────────────────

function getDbPath(): string {
  return path.join(os.homedir(), "data", "metrics.db");
}

// ─── Lazy DB singleton ───────────────────────────────────────────────────────

let _db: Database | null = null;

function openDb(): Database {
  if (_db !== null) return _db;
  const dbPath = getDbPath();
  // Ensure parent directory exists (tolerates pre-existing dir).
  try {
    mkdirSync(path.dirname(dbPath), { recursive: true });
  } catch {
    // ignore
  }
  const db = new Database(dbPath, { create: true });
  db.exec(`
    CREATE TABLE IF NOT EXISTS learning_budget (
      day            TEXT    PRIMARY KEY,
      count          INTEGER NOT NULL DEFAULT 0,
      breaker_until  INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS learning_seen (
      signature  TEXT    PRIMARY KEY,
      seen_at    INTEGER NOT NULL
    );
  `);
  _db = db;
  return db;
}

// ─── Budget / breaker helpers ─────────────────────────────────────────────────

interface BudgetRow {
  day: string;
  count: number;
  breaker_until: number;
}

function utcDay(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Returns the current budget row for today, or a zero-initialised default.
 * Never throws — returns null if the DB is unavailable.
 */
function readBudget(): BudgetRow | null {
  try {
    const db = openDb();
    const today = utcDay();
    const row = db
      .query<BudgetRow, [string]>(
        "SELECT day, count, breaker_until FROM learning_budget WHERE day = ?",
      )
      .get(today);
    return row ?? { day: today, count: 0, breaker_until: 0 };
  } catch {
    return null;
  }
}

/** Atomically increments today's dispatch count. Never throws. */
function incrementCount(): void {
  try {
    const db = openDb();
    const today = utcDay();
    db.run(
      `INSERT INTO learning_budget (day, count, breaker_until)
         VALUES (?, 1, 0)
         ON CONFLICT(day) DO UPDATE SET count = count + 1`,
      [today],
    );
  } catch {
    // ignore — a missing DB increment is non-fatal
  }
}

/**
 * Arms the circuit breaker for BREAKER_MS milliseconds.
 * Uses today's row so it persists across restarts.
 * Never throws.
 */
function armBreaker(): void {
  try {
    const db = openDb();
    const today = utcDay();
    const until = Date.now() + BREAKER_MS;
    db.run(
      `INSERT INTO learning_budget (day, count, breaker_until)
         VALUES (?, 0, ?)
         ON CONFLICT(day) DO UPDATE SET breaker_until = excluded.breaker_until`,
      [today, until],
    );
  } catch {
    // ignore
  }
}

// ─── Signature dedup ─────────────────────────────────────────────────────────

/**
 * Compute a lightweight session signature from:
 *   - sorted distinct tool names used
 *   - user-turn count bucket (bucketed to 1,2,3,4,5+)
 *   - normalised stem of the first user message
 * Returns a hex SHA-256 of the concatenated string.
 */
function computeSignature(msgs: MessageEntry[]): string {
  const toolNames: Set<string> = new Set<string>();
  let userTurnCount = 0;
  let firstUserText = "";

  for (const msg of msgs) {
    if (msg.toolName) {
      toolNames.add(msg.toolName);
    }
    if (msg.info?.role === "user") {
      userTurnCount += 1;
      if (firstUserText === "") {
        const text = extractText(msg.parts);
        // Normalise: lowercase, first 120 chars, collapse whitespace
        firstUserText = text.toLowerCase().replace(/\s+/g, " ").slice(0, 120);
      }
    }
  }

  const sortedTools = [...toolNames].sort().join(",");
  const countBucket = Math.min(userTurnCount, 5);
  const raw = `${sortedTools}|${countBucket}|${firstUserText}`;
  return crypto.createHash("sha256").update(raw).digest("hex");
}

/**
 * Returns true if the signature was seen within the last DEDUP_WINDOW records.
 * On success, inserts the signature. Never throws — returns false on DB error.
 */
function checkAndInsertSignature(signature: string): boolean {
  try {
    const db = openDb();
    // Check if signature already exists in the last DEDUP_WINDOW rows
    const existing = db
      .query<{ signature: string }, [number]>(
        `SELECT signature FROM learning_seen
           ORDER BY seen_at DESC
           LIMIT ?`,
        // Use a parameterised literal; fetch window+1 to detect presence
      )
      .all(DEDUP_WINDOW);
    const seen = existing.some((r: { signature: string }) => r.signature === signature);
    if (!seen) {
      db.run(
        `INSERT INTO learning_seen (signature, seen_at) VALUES (?, ?)
           ON CONFLICT(signature) DO UPDATE SET seen_at = excluded.seen_at`,
        [signature, Date.now()],
      );
    }
    return seen;
  } catch {
    return false;
  }
}

// ─── Signal gate ─────────────────────────────────────────────────────────────

interface GateResult {
  pass: boolean;
  reason: string;
}

function extractText(parts: MessagePart[] | undefined): string {
  if (!Array.isArray(parts)) return "";
  return parts
    .filter(
      (p): p is { type?: string; text: string; synthetic?: boolean } =>
        p.type === "text" && typeof p.text === "string" && !p.synthetic,
    )
    .map((p) => p.text)
    .join("\n")
    .trim();
}

/**
 * Pure-heuristic gate: returns pass=false + reason if the session lacks
 * sufficient signal to warrant a review call. Zero model tokens consumed.
 */
function runSignalGate(
  msgs: MessageEntry[],
  sessionID: string,
): GateResult {
  // 1. Count non-synthetic messages and user turns.
  const nonSynthetic = msgs.filter(
    (m) =>
      !m.parts?.every((p) => p.synthetic === true) &&
      m.info?.role !== undefined,
  );
  const userTurns = msgs.filter((m) => m.info?.role === "user");

  if (nonSynthetic.length < MIN_MESSAGES) {
    return {
      pass: false,
      reason: `too few non-synthetic messages (${nonSynthetic.length} < ${MIN_MESSAGES})`,
    };
  }
  if (userTurns.length < MIN_USER_TURNS) {
    return {
      pass: false,
      reason: `too few user turns (${userTurns.length} < ${MIN_USER_TURNS})`,
    };
  }

  // 2. Check for at least one signal marker.
  let hasCorrection = false;
  let hasErrorMsg = false;
  let hasFixAfterError = false;
  let hasPreference = false;

  for (let i = 0; i < msgs.length; i++) {
    const msg = msgs[i];
    const role = msg.info?.role ?? "";
    const text = extractText(msg.parts);

    if (role === "user") {
      if (CORRECTION_RE.test(text)) hasCorrection = true;
      if (PREFERENCE_RE.test(text)) hasPreference = true;
    }

    // Error/fix cycle: an error in assistant/tool followed by any later message
    if (
      (role === "assistant" || role === "tool") &&
      ERROR_IN_MSG_RE.test(text)
    ) {
      if (i < msgs.length - 1) {
        hasErrorMsg = true;
        // A later assistant message after an error counts as a fix attempt
        for (let j = i + 1; j < msgs.length; j++) {
          if (msgs[j].info?.role === "assistant") {
            hasFixAfterError = true;
            break;
          }
        }
      }
    }
  }

  const hasSignal =
    hasCorrection ||
    (hasErrorMsg && hasFixAfterError) ||
    hasPreference;

  if (!hasSignal) {
    return {
      pass: false,
      reason: "no signal marker (no correction, preference, or error-fix cycle)",
    };
  }

  // 3. Duplicate signature check.
  const signature = computeSignature(msgs);
  const isDuplicate = checkAndInsertSignature(signature);
  if (isDuplicate) {
    return {
      pass: false,
      reason: `duplicate session signature within last ${DEDUP_WINDOW} reviews`,
    };
  }

  return { pass: true, reason: "ok" };
}

// ─── Error classification ─────────────────────────────────────────────────────

function isBreakerError(err: unknown): boolean {
  // Check HTTP status codes first (SDK may expose them on the error object).
  if (err !== null && typeof err === "object") {
    const errObj = err as Record<string, unknown>;
    const status =
      typeof errObj["status"] === "number"
        ? errObj["status"]
        : typeof errObj["statusCode"] === "number"
          ? errObj["statusCode"]
          : null;
    if (status !== null && BREAKER_STATUS_CODES.has(status)) return true;
  }
  // Fall back to string matching.
  const msg = err instanceof Error ? err.message : String(err);
  return QUOTA_ERROR_PATTERNS.some((p) => msg.toLowerCase().includes(p));
}

// ─── Decay / reinforce pass ───────────────────────────────────────────────────

interface ScoreRow {
  learning_id: string;
  kind: string;
  score: number;
  last_used_at: number | null;
  updated_at: number;
}

/**
 * Open the metrics DB for decay operations.
 * Returns null if DB is unavailable. Never throws.
 */
function openMetricsDbForDecay(): Database | null {
  try {
    return new Database(getDbPath(), { create: false });
  } catch {
    return null;
  }
}

/**
 * Evict a skill by moving its directory to pending/skills/.
 * NEVER deletes. Logs every eviction. Never throws.
 */
function evictSkill(
  slug: string,
  score: number,
  log: (level: "debug" | "info" | "warn" | "error", msg: string) => void,
): void {
  try {
    const src = path.join(SKILLS_DIR, slug);
    const dst = path.join(PENDING_SKILLS_DIR, slug);
    if (!existsSync(src)) return;
    mkdirSync(PENDING_SKILLS_DIR, { recursive: true });
    renameSync(src, dst);
    log(
      "warn",
      `evicted skill slug=${slug} score=${score.toFixed(3)} → moved to pending/skills/${slug}`,
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log("warn", `eviction failed for slug=${slug}: ${msg}`);
  }
}

/**
 * Run the reinforce/decay pass for a session that just went idle.
 *
 * Steps:
 *   1. Look up learnings injected this session (learning_injection join).
 *   2. Determine if the session had a correction signal.
 *   3. For each injected learning:
 *      - injected + correction         → score = score * 0.5 - 1.0, corrected++
 *      - injected + invoked + no corr  → score = score * 1.1 + 0.5  (hit)
 *      - injected + NOT invoked + no corr → no change (DECAY_NOT_INVOKED_MULT=1.0)
 *        Rationale: cannot yet PROVE non-use until skill-tool shape confirmed.
 *        See TODO in DECAY_NOT_INVOKED_MULT constant for when to restore decay.
 *   4. Global time-decay: score = score * 0.98 for ALL rows (recency fairness;
 *      hits accumulate +0.5 delta which easily outpaces this small decay).
 *   5. Evict skills with score < 0.2 and not used in 30 days.
 *
 * Never throws — all errors are logged and swallowed.
 */
function runDecayPass(
  sessionID: string,
  msgs: MessageEntry[],
  log: (level: "debug" | "info" | "warn" | "error", msg: string) => void,
): void {
  const db = openMetricsDbForDecay();
  if (db === null) {
    log("warn", "decay pass: metrics DB unavailable, skipping");
    return;
  }

  try {
    // Check for correction signal in this session.
    const hasCorrection = msgs.some(
      (m) => m.info?.role === "user" && CORRECTION_RE.test(extractText(m.parts)),
    );

    // Get injected learnings for this session.
    interface InjectionRow {
      learning_id: string;
      kind: string;
    }
    const injected = db
      .query<InjectionRow, [string]>(
        `SELECT DISTINCT learning_id, kind
           FROM learning_injection
          WHERE session_id = ?`,
      )
      .all(sessionID);

    // Get slugs invoked this session (from learning_invocation recorded by
    // the tool.execute.after hook in learning-recall.ts).
    interface InvocationRow {
      learning_id: string;
    }
    const invokedThisSession: ReadonlySet<string> = new Set(
      db
        .query<InvocationRow, [string]>(
          `SELECT DISTINCT learning_id
             FROM learning_invocation
            WHERE session_id = ?`,
        )
        .all(sessionID)
        .map((r) => r.learning_id),
    );

    const nowMs = Date.now();

    for (const row of injected) {
      const existing = db
        .query<ScoreRow, [string]>(
          "SELECT learning_id, kind, score, last_used_at, updated_at FROM learning_score WHERE learning_id = ?",
        )
        .get(row.learning_id);

      if (existing === null) continue;

      let newScore: number;
      let correctedDelta = 0;

      if (hasCorrection) {
        // injected + correction → punish (miss)
        newScore = existing.score * DECAY_CORRECTION_MULT + DECAY_CORRECTION_DELTA;
        correctedDelta = 1;
      } else if (invokedThisSession.has(row.learning_id)) {
        // injected + invoked + no correction → reinforce (hit)
        newScore = existing.score * REINFORCE_INVOKED_MULT + REINFORCE_INVOKED_DELTA;
      } else {
        // injected + NOT invoked + no correction → no change.
        // DECAY_NOT_INVOKED_MULT is 1.0 (identity). We cannot yet PROVE
        // non-use — the tool.execute.after shape discovery is ongoing.
        // See constant definition for the restore-decay TODO.
        newScore = existing.score * DECAY_NOT_INVOKED_MULT;
      }

      // Clamp score to [-2, 10].
      newScore = Math.max(-2, Math.min(10, newScore));

      db.run(
        `UPDATE learning_score SET
           score        = ?,
           corrected    = corrected + ?,
           last_used_at = ?,
           updated_at   = ?
         WHERE learning_id = ?`,
        [newScore, correctedDelta, nowMs, nowMs, row.learning_id],
      );
    }

    // Global time-decay for ALL rows.
    db.run(
      `UPDATE learning_score SET
         score      = score * ?,
         updated_at = ?`,
      [GLOBAL_TIME_DECAY_MULT, nowMs],
    );

    // Eviction: skills with low score and stale last_used_at.
    const evictionCutoff = nowMs - EVICTION_AGE_DAYS * 86_400_000;
    interface EvictRow {
      learning_id: string;
      score: number;
    }
    const toEvict = db
      .query<EvictRow, [number, number]>(
        `SELECT learning_id, score
           FROM learning_score
          WHERE kind = 'skill'
            AND score < ?
            AND (last_used_at IS NULL OR last_used_at < ?)`,
      )
      .all(EVICTION_SCORE_THRESHOLD, evictionCutoff);

    for (const evictRow of toEvict) {
      evictSkill(evictRow.learning_id, evictRow.score, log);
    }

    if (injected.length > 0 || toEvict.length > 0) {
      log(
        "info",
        `decay pass: session=${sessionID.slice(0, 8)} injected=${injected.length} invoked=${invokedThisSession.size} correction=${hasCorrection} evicted=${toEvict.length}`,
      );
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log("warn", `decay pass failed (non-fatal): ${msg}`);
  } finally {
    try {
      db.close();
    } catch {
      // ignore
    }
  }
}

// ─── Plugin ──────────────────────────────────────────────────────────────────

const LearningLoopPlugin: Plugin = async ({ client }) => {
  // Per-session debounce handles: cleared+reset on each idle event.
  const debounceHandles = new Map<string, ReturnType<typeof setTimeout>>();

  // Per-session dispatch count for the current idle window.
  // Intentionally in-memory — resets on restart which is fine for transient guard.
  const windowDispatchCount = new Map<string, number>();

  const log = (
    level: "debug" | "info" | "warn" | "error",
    message: string,
  ): void => {
    client.app
      .log({ body: { service: SERVICE, level, message } })
      .catch(() => {});
  };

  /** Dispatch a review for the given session (fire-and-forget). */
  const dispatchReview = (sessionID: string): void => {
    void (async () => {
      try {
        // 1. Fetch last 50 messages for signal gate + conversation context.
        const msgsRes = await client.session.messages({
          path: { id: sessionID },
          query: { limit: 50 },
        });
        const allMsgs = ((msgsRes as MessagesResponse)?.data ?? []).slice(-50);
        const contextMsgs = allMsgs.slice(-10);

        // 2. Pre-dispatch signal gate (zero model tokens).
        const gate = runSignalGate(allMsgs, sessionID);
        if (!gate.pass) {
          log("info", `signal gate skipped session=${sessionID.slice(0, 8)}: ${gate.reason}`);
          return;
        }

        // 3. Format conversation context (last 10 for review prompt).
        const contextParts: string[] = [];
        for (const msg of contextMsgs) {
          const role = msg.info?.role ?? "unknown";
          const mode = msg.info?.mode ? ` (${msg.info.mode})` : "";
          const text = extractText(msg.parts);
          if (text) {
            contextParts.push(`[${role}${mode}]\n${text}\n`);
          }
        }
        const contextText =
          contextParts.length > 0
            ? contextParts.join("---\n")
            : "(no conversation text available)";

        // 4. Build the review prompt (task context only — system prompt
        //    learning-reviewer.txt already has the rules and instructions).
        const reviewPrompt = [
          "## Conversation Context (last 10 messages)",
          "",
          contextText,
        ].join("\n");

        // 5. Create a child session for the review.
        const createRes = await client.session.create({
          body: {
            parentID: sessionID,
            title: `learning-review-${sessionID.slice(0, 8)}-${Date.now()}`,
          },
        });
        const childId = (createRes as SessionResponse)?.data?.id;
        if (!childId) {
          log("warn", "failed to create review session (no id in response)");
          return;
        }

        // 6. Dispatch the review (fire-and-forget via promptAsync).
        //    Model is NOT specified here; comes from learning-reviewer agent config.
        await client.session.promptAsync({
          path: { id: childId },
          body: {
            agent: "learning-reviewer",
            parts: [{ type: "text" as const, text: reviewPrompt }],
          },
        } as Parameters<typeof client.session.promptAsync>[0]);

        // 7. Persist the incremented daily count.
        incrementCount();

        const budget = readBudget();
        const newCount = (budget?.count ?? 0);
        log(
          "info",
          `review dispatched for session=${sessionID.slice(0, 8)} child=${childId.slice(0, 8)} (daily ${newCount}/${DAILY_CAP})`,
        );

        // 8. Reinforce/decay pass for injected learnings in this session.
        //    Uses allMsgs already fetched above; never throws.
        runDecayPass(sessionID, allMsgs, log);
      } catch (e) {
        if (isBreakerError(e)) {
          armBreaker();
          const msg = e instanceof Error ? e.message : String(e);
          log(
            "error",
            `circuit breaker armed for ${BREAKER_MS / 3_600_000}h — balance/quota error: ${msg}`,
          );
          return;
        }

        const msg = e instanceof Error ? e.message : String(e);
        log("error", `review execution failed: ${msg}`);
      }
    })();
  };

  /** Schedule a debounced review for a session after it goes idle. */
  const scheduleReview = (sessionID: string): void => {
    // Clear any existing timer for this session.
    const existing = debounceHandles.get(sessionID);
    if (existing !== undefined) {
      clearTimeout(existing);
    }

    const handle = setTimeout(() => {
      debounceHandles.delete(sessionID);

      // All guards run inside the timer callback so they reflect state at
      // the moment the timer fires, not when the idle event arrived.

      // ── Kill-switch ─────────────────────────────────────────────────────
      const enabled = readEnvStr("LEARNING_LOOP_ENABLED");
      if (enabled === "false" || enabled === "0") return;

      // ── Durable budget + breaker (SQLite) ────────────────────────────────
      const budget = readBudget();
      if (budget === null) {
        log("warn", "DB unavailable — skipping review");
        return;
      }

      const nowMs = Date.now();
      if (budget.breaker_until > nowMs) {
        const remainMin = Math.ceil((budget.breaker_until - nowMs) / 60_000);
        log(
          "warn",
          `circuit breaker active for ${remainMin} more minutes, skipping review for session=${sessionID.slice(0, 8)}`,
        );
        return;
      }

      if (budget.count >= DAILY_CAP) {
        log(
          "warn",
          `daily cap reached (${DAILY_CAP}), skipping review for session=${sessionID.slice(0, 8)}`,
        );
        return;
      }

      // ── Per-idle-window budget (in-memory, transient) ────────────────────
      const windowCount = windowDispatchCount.get(sessionID) ?? 0;
      if (windowCount >= IDLE_WINDOW_BUDGET) {
        return;
      }

      windowDispatchCount.set(sessionID, windowCount + 1);
      dispatchReview(sessionID);
    }, IDLE_MS);

    debounceHandles.set(sessionID, handle);
  };

  return {
    event: async ({ event }: { event: Event }): Promise<void> => {
      // ── Kill-switch (fast path — checked before any async work) ──────────
      const enabled = readEnvStr("LEARNING_LOOP_ENABLED");
      if (enabled === "false" || enabled === "0") return;

      // ── session.idle: schedule a debounced review ────────────────────────
      if (event.type === "session.idle") {
        const { sessionID } = event.properties;
        scheduleReview(sessionID);
        return;
      }

      // ── session.status busy: reset the "reviewed this window" flag ───────
      // When the user sends a new message the session becomes busy again,
      // which means a future idle can trigger another review.
      if (event.type === "session.status") {
        const { sessionID, status } = event.properties;
        if (status.type === "busy") {
          windowDispatchCount.delete(sessionID);
          // Also cancel any pending timer — the session is active again.
          const handle = debounceHandles.get(sessionID);
          if (handle !== undefined) {
            clearTimeout(handle);
            debounceHandles.delete(sessionID);
          }
        }
        return;
      }
    },
  };
};

export default LearningLoopPlugin;
