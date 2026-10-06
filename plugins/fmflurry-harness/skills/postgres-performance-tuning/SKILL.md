---
name: postgres-performance-tuning
description: "PostgreSQL performance tuning for the docker instance: memory sizing vs the 1g mem_limit (shared_buffers, effective_cache_size, work_mem math), checkpoint tuning (max_wal_size, checkpoint_completion_target, pg_stat_checkpointer), pg_stat_statements enablement via compose, slow-query triage, EXPLAIN (ANALYZE, BUFFERS) interpretation, and pgbouncer transaction-pooling constraints (SET/LISTEN-NOTIFY/PREPARE/advisory locks/WITH HOLD). Use when asked about postgres tuning, slow queries, shared_buffers, work_mem, pg_stat_statements, pgbouncer, or checkpoint tuning. Target: postgres:16-alpine (container gc-platform-postgres). Read alongside the postgres-dba agent."
---

# PostgreSQL Performance Tuning

**Target version:** `postgres:16-alpine` — this repository's `gc-platform-postgres` container: `mem_limit: 1g`, `mem_reservation: 512m`, no `command:` override (stock settings: `shared_buffers=128MB`, `max_connections=100`), no `shared_preload_libraries`.

**Contract:** diagnostics are read-only (`pg_settings`, `pg_stat_*`, `EXPLAIN` on SELECTs only). Every config change below is emitted ONLY as a `⚠️ HUMAN CONFIRMATION REQUIRED` block — the `postgres-dba` agent never applies settings. Values marked ⚠️ are **established heuristics**, not guarantees: measure before and after every change, one parameter at a time.

**Connection:**

```bash
docker exec gc-platform-postgres psql -U gcplatform -d gcplatform -c "<query>"
```

---

## 1. Memory sizing vs the 1g mem_limit

Current settings (verify live):

```sql
SELECT name, setting, unit FROM pg_settings
WHERE name IN ('shared_buffers','effective_cache_size','work_mem','maintenance_work_mem',
               'max_connections','huge_pages');
```

⚠️ Heuristic sizing for a **dedicated 1g container**:

| Parameter | Stock | Suggested | Rationale |
|---|---|---|---|
| `shared_buffers` | 128MB | **≈ 256MB** | Classic ⚠️ 25%-of-RAM heuristic; the container also needs room for per-backend memory, WAL buffers, and the OS page cache |
| `effective_cache_size` | 4GB (!) | **≈ 512–768MB** | Planner hint for "how much caching exists total" (shared_buffers + OS cache). Stock 4GB is a lie on a 1g container and biases the planner toward index scans it shouldn't trust |
| `work_mem` | 4MB | **keep 4–8MB** | Allocated PER sort/hash node PER connection. Worst case ≈ `max_connections × nodes-per-query × work_mem`: 100 × 4 nodes × 8MB = 3.2GB ≫ 1g. Raising it globally is how containers OOM; raise per-session for known big sorts instead |
| `maintenance_work_mem` | 64MB | **128–256MB** | Used by VACUUM/CREATE INDEX; few concurrent users, safe to raise |

⚠️ HUMAN CONFIRMATION REQUIRED

```yaml
# docker-compose.yml, postgres service (restart required):
command: ["postgres",
  "-c", "shared_buffers=256MB",
  "-c", "effective_cache_size=768MB",
  "-c", "maintenance_work_mem=128MB"]
```

Verify after restart: `SELECT name, setting FROM pg_settings WHERE name = 'shared_buffers';` and watch `docker stats` under load.

---

## 2. Checkpoint tuning

Source: https://www.postgresql.org/docs/16/wal-configuration.html

Diagnose first (see `postgres-health-check` §7):

```sql
SELECT checkpoints_timed, checkpoints_req,
       ROUND(checkpoints_req::numeric / NULLIF(checkpoints_timed + checkpoints_req, 0) * 100, 2) AS req_pct
FROM pg_stat_checkpointer;
SHOW max_wal_size; SHOW checkpoint_completion_target; SHOW checkpoint_warning;
```

⚠️ Heuristics:
- `max_wal_size` (default 1GB): raise to **2–4GB** if `req_pct` > 10–20% — more WAL between checkpoints = fewer forced checkpoints = smoother I/O (cost: longer crash recovery, more `pg_wal` disk).
- `checkpoint_completion_target = 0.9` — **already the default since PG14**; spreads checkpoint writes across 90% of the interval. Verify it, don't blindly set it.
- `checkpoint_warning = 30s` (default): logs when checkpoints are too close together; keep it as the canary.

⚠️ HUMAN CONFIRMATION REQUIRED

```yaml
command: ["postgres", "-c", "max_wal_size=2GB", "-c", "checkpoint_completion_target=0.9"]
```

---

## 3. Enabling pg_stat_statements

The stock compose loads no extensions (`shared_preload_libraries` empty), so `pg_stat_statements` — the single highest-value slow-query tool — is unavailable until enabled.

Source: https://www.postgresql.org/docs/16/pgstatstatements.html ⚠️ (must be loaded via `shared_preload_libraries` → requires server **restart**, not a reload; the extension object then still needs `CREATE EXTENSION` per database).

⚠️ HUMAN CONFIRMATION REQUIRED

```yaml
# docker-compose.yml, postgres service (restart required):
command: ["postgres", "-c", "shared_preload_libraries=pg_stat_statements",
          "-c", "pg_stat_statements.max=10000",
          "-c", "pg_stat_statements.track=all"]
```

Then the extension itself is a **migration** (repo change → dispatch `coder`):

⚠️ HUMAN CONFIRMATION REQUIRED

```sql
-- Applied as an EF Core migration under the superuser/migrator connection, never ad hoc:
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
```

Combine with §1/§2 if changing both: a single `command:` array holds all `-c` flags.

---

## 4. Slow-query triage workflow

Requires §3 enabled. Order of operations:

```sql
-- 1. Worst by TOTAL time (the queries costing the most aggregate):
SELECT LEFT(query, 100) AS query, calls,
       round(total_exec_time::numeric, 1) AS total_ms,
       round(mean_exec_time::numeric, 1) AS mean_ms,
       rows,
       round((shared_blks_hit * 100.0 / NULLIF(shared_blks_hit + shared_blks_read, 0))::numeric, 2) AS hit_pct
FROM pg_stat_statements
ORDER BY total_exec_time DESC LIMIT 15;

-- 2. Worst by MEAN time (individual slow queries):
SELECT LEFT(query, 100), calls, round(mean_exec_time::numeric, 1) AS mean_ms, rows
FROM pg_stat_statements
WHERE calls > 20
ORDER BY mean_exec_time DESC LIMIT 15;
```

**Interpretation:** high `calls × mean` = hot path (index or N+1 — the latter is code → `database-reviewer`); low `hit_pct` = cache/index problem; huge `rows` vs returned rows = missing predicate index. `pg_stat_statements` normalizes parameters (`$1`) — it shows query *shapes*, not literals.

**Remediation:** index/query fixes are **code/migration changes** → `database-reviewer` + `coder`. Instance-side only: `pg_stat_statements_reset()` to re-measure after a change:

⚠️ HUMAN CONFIRMATION REQUIRED

```sql
SELECT pg_stat_statements_reset();
```

---

## 5. EXPLAIN (ANALYZE, BUFFERS) — SELECTs only

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT …;   -- ⚠️ SELECTs only: ANALYZE EXECUTES the statement, so never run it on DML
```

Read the plan in this order:
1. **Actual vs planned rows** (`rows=X` … `actual … rows=Y`): a 100×+ mismatch = stale statistics → `ANALYZE <table>` (⚠️ human) or the planner lacks a predicate.
2. **Node time hotspots**: the top-cost node isn't always the culprit; look for nodes where actual time jumps vs their children.
3. **Buffers**: `shared hit` = cache, `shared read` = disk. High reads on a hot query = index opportunity. `BUFFERS` output is only meaningful with `ANALYZE`.
4. **Seq Scan on large tables**: fine for analytics, a bug for point lookups. **Never** add an index yourself — recommend it via `database-reviewer`.
5. **Nested Loop with high loops=**: classic N+1 shape at the plan level.

---

## 6. pgbouncer / connection pooling

Why: `max_connections=100` and each backend costs ≈ 5–10MB; pooling lets hundreds of app connections share a few dozen backends.

Source: https://www.pgbouncer.org/features.html — **transaction pooling** (the mode you want) supports only what fits inside a single transaction. It BREAKS:

| Feature | Why it breaks under transaction pooling |
|---|---|
| `SET` (session-level) | Session state is not pinned to a backend; the next query may run on another backend |
| `LISTEN` / `NOTIFY` | Notifications are session-bound; pooled clients never (reliably) receive them |
| `PREPARE` (client-side prepared statements) | The prepared plan lives on one backend; pgbouncer ≥ 1.21 can proxy them only if `max_prepared_statements > 0` |
| Session-level advisory locks (`pg_advisory_lock`) | Lock held by a backend that the client is detached from after the transaction (transaction-level `pg_advisory_xact_lock` IS safe) |
| Cursors `WITH HOLD` | Survive transaction end → meaningless when the backend changes |

### Repo-specific verdict

- ✓ **`SET LOCAL app.tenant_id = …` is transaction-pooling-safe.** It scopes to the current transaction, which is exactly what transaction pooling preserves — the RLS tenant GUC pattern (ADR-0038, canonical GUC `app.tenant_id`) works behind pgbouncer. (Session-level `SET app.tenant_id` without `LOCAL` would NOT be safe.)
- ✓ **WolverineFx (ADR-0015) is transaction-pooling-safe.** Its PostgreSQL transport does **not** use `LISTEN/NOTIFY` — it polls queue tables with `ORDER BY … LIMIT n FOR UPDATE SKIP LOCKED` (verified: https://wolverinefx.net/guide/durability/postgresql — "PostgreSQL Messaging Transport", Polling, "Dequeue Performance"). The repo's current stack (WolverineFx.Marten outbox, DurabilityAgent store-and-forward, bus not yet booted per ADR-0020) is plain SQL + polling — exactly what transaction pooling preserves.
- ⚠️ **Residual:** re-verify this verdict if any future component explicitly uses `LISTEN/NOTIFY` (custom `NOTIFY` triggers, cache-invalidation libraries, trigger-based `NOTIFY`) — those connections must bypass pgbouncer (direct connection string).
- ⚠️ **Npgsql prepared statements:** Npgsql 8+ prepares statements by default. Behind pgbouncer this requires pgbouncer ≥ 1.21 with `max_prepared_statements > 0`, or set `Max Auto Prepare=0` / `No Reset On Close=true` per Npgsql's pgbouncer guidance. Verify against the Npgsql version in `backend/` before rollout.

⚠️ HUMAN CONFIRMATION REQUIRED — pooling is an infra rollout (new compose service), emitted for humans only:

```yaml
# Sketch — not applied by this agent:
pgbouncer:
  image: edoburu/pgbouncer:latest   # ⚠️ pick a pinned, actively-maintained image
  environment:
    DB_HOST: postgres
    POOL_MODE: transaction
    MAX_PREPARED_STATEMENTS: "100"   # pgbouncer ≥ 1.21, for Npgsql prepared statements
  depends_on:
    postgres:
      condition: service_healthy
```

Rollout order: verify Wolverine transport → verify Npgsql version → pool the backend's `DefaultConnection` (`gc_kourou_app_login`) only → keep `MigrationConnection` and any LISTEN/NOTIFY consumer direct.
