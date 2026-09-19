---
name: postgres-health-check
description: "Read-only PostgreSQL instance health battery: connectivity/uptime, cache hit ratio, dead tuples & autovacuum hotspots, XID wraparound distance, long-running & idle-in-transaction sessions, unused indexes, checkpoint stats, archiver health, connection count vs max_connections, and docker container/volume checks. Use when asked about db health, postgres check, vacuum, bloat, wraparound, autovacuum, database slow, or connection count. Target: postgres:16-alpine (container gc-platform-postgres). Read alongside the postgres-dba agent."
---

# PostgreSQL Instance Health Check

**Target version:** `postgres:16-alpine` — this repository's `gc-platform-postgres` container (db `gcplatform`, owner role `gcplatform`, runtime role `gc_kourou_app_login`).

**Contract:** every check below is a read-only diagnostic (SELECT against `pg_stat_*`/`pg_catalog`, `pg_isready`, `docker` read commands). Each check gives: **query → interpretation → severity → remediation**. Remediations that mutate state are emitted ONLY as `⚠️ HUMAN CONFIRMATION REQUIRED` blocks — the `postgres-dba` agent never executes them.

**Connection:**

```bash
docker exec gc-platform-postgres psql -U gcplatform -d gcplatform -c "<query>"
```

**Progressive disclosure:** for the OPS side of applying EF Core migrations (lock windows at apply time, `CREATE INDEX CONCURRENTLY` vs the migration transaction, post-migration bloat/vacuum watch, live model-drift check), load `reference-migration-ops.md` in this skill's directory; code-side migration/schema correctness stays with `database-reviewer`.

---

## 1. Connectivity & uptime

```sql
SELECT version();
SELECT now() - pg_postmaster_start_time() AS uptime;
SELECT pg_is_in_recovery();
```

```bash
docker exec gc-platform-postgres pg_isready -U gcplatform -d gcplatform
```

**Interpretation:** `pg_isready` non-zero exit = server not accepting connections (CRITICAL). Very short uptime + no deploy = crash-loop (check `docker logs --tail 200 gc-platform-postgres`). `pg_is_in_recovery() = true` on the primary = unexpected (this stack has no replicas).

**Severity:** CRITICAL if unreachable; LOW note if uptime < 1h (statistics views were reset — treat other checks' counters cautiously).

---

## 2. Cache hit ratio

```sql
SELECT
  datname,
  blks_hit,
  blks_read,
  ROUND(blks_hit::numeric / NULLIF(blks_hit + blks_read, 0) * 100, 2) AS cache_hit_ratio_pct
FROM pg_stat_database
WHERE datname = current_database();
```

**Interpretation:** ratio = shared-buffer hits / (hits + disk reads). Healthy OLTP ≥ 99%. < 95% on a warm instance means working set exceeds `shared_buffers` (default 128MB here — no `command:` override in compose) or queries do large sequential scans. Stats accumulate since last reset — judge the trend, not a snapshot.

**Severity:** MEDIUM (< 95%), HIGH (< 90% with user-visible latency).

**Remediation:** size `shared_buffers` per the `postgres-performance-tuning` skill; first confirm with EXPLAIN that low ratio is not just batch analytics scans.

---

## 3. Dead tuples & autovacuum hotspots

```sql
SELECT
  schemaname, relname,
  n_live_tup, n_dead_tup,
  ROUND(n_dead_tup::numeric / NULLIF(n_live_tup + n_dead_tup, 0) * 100, 2) AS dead_pct,
  last_vacuum, last_autovacuum, last_analyze, last_autoanalyze,
  autovacuum_count
FROM pg_stat_user_tables
ORDER BY n_dead_tup DESC
LIMIT 20;
```

**Interpretation:** `n_dead_tup` grows with UPDATE/DELETE; autovacuum reclaims them. Hotspots: high `dead_pct` (> 20%) AND (`last_autovacuum` NULL or old) = autovacuum not keeping up (long transactions hold back the xmin horizon; check check 5). `n_dead_tup` is an *estimate* from the stats collector, not an exact count. Bloat also lives in indexes — compare `pg_total_relation_size` vs `pg_relation_size`.

**Severity:** HIGH (dead_pct > 50% on a hot table, or never autovacuumed); MEDIUM (20–50%).

**Remediation:**

⚠️ HUMAN CONFIRMATION REQUIRED

```sql
-- Reclaim space without the exclusive lock of VACUUM FULL (safe online):
VACUUM (ANALYZE, VERBOSE) <schema>.<table>;

-- For tables that bloat repeatedly, tighten per-table autovacuum:
ALTER TABLE <schema>.<table> SET (
  autovacuum_vacuum_scale_factor = 0.05,
  autovacuum_analyze_scale_factor = 0.02
);
```

`VACUUM FULL` rewrites the whole table under an `ACCESS EXCLUSIVE` lock — only as last resort, off-hours, with a fresh backup. Source: https://www.postgresql.org/docs/16/routine-vacuuming.html

---

## 4. XID wraparound distance

```sql
-- Per-database age:
SELECT datname, age(datfrozenxid) AS xid_age,
       ROUND(age(datfrozenxid)::numeric / 2147483647 * 100, 2) AS pct_to_wraparound
FROM pg_database WHERE datname = current_database();

-- Oldest per-table age (finds the table holding the horizon back):
SELECT schemaname, relname, age(relfrozenxid) AS rel_xid_age
FROM pg_stat_user_tables
ORDER BY age(relfrozenxid) DESC LIMIT 10;
```

**Interpretation:** transaction IDs are 32-bit; at age ≈ 2^31 (≈ 2.147 billion) the database **stops accepting writes** to prevent wraparound data loss. PostgreSQL warns when a database comes within **40 million** XIDs of wraparound and refuses new transactions when only **3 million** remain. Autovacuum normally prevents this (`autovacuum_freeze_max_age`, default 200M, triggers aggressive freeze vacuums) — except when autovacuum is blocked (long-lived transactions, stuck replication slots, `idle in transaction` sessions). Source: https://www.postgresql.org/docs/16/routine-vacuuming.html

**Severity:** CRITICAL (age > 2.1B, i.e. within 40M of wraparound); HIGH (> 1B); MEDIUM (> 500M — investigate why freeze vacuums lag).

**Remediation:**

⚠️ HUMAN CONFIRMATION REQUIRED

```sql
-- First remove whatever holds the xmin horizon back (check 5): kill the stuck session/slot.
-- Then database-wide freeze vacuum (I/O-heavy; run off-hours):
VACUUM (FREEZE, VERBOSE) <schema>.<table>;   -- per worst table
-- or, full database (long):
-- VACUUMFREEZE via: VACUUM (FREEZE); on each database
```

---

## 5. Long-running & idle-in-transaction sessions

```sql
SELECT pid, usename, state, wait_event_type, wait_event,
       now() - xact_start AS tx_duration,
       now() - query_start AS query_duration,
       LEFT(query, 120) AS query
FROM pg_stat_activity
WHERE datname = current_database()
  AND pid <> pg_backend_pid()
  AND (state = 'idle in transaction'
       OR now() - xact_start > interval '5 minutes')
ORDER BY xact_start NULLS LAST;
```

**Interpretation:** `idle in transaction` holds locks AND holds back the xmin horizon → blocks autovacuum → feeds checks 3 and 4. A 10-minute `idle in transaction` from the backend (`gc_kourou_app_login`) usually means an undisposed EF Core transaction or a debugger paused mid-transaction. `wait_event` explains blocked sessions (e.g. `relation`, `transactionid` = lock waits).

**Severity:** HIGH (> 30 min, or blocking autovacuum on hot tables); MEDIUM (5–30 min).

**Remediation:**

⚠️ HUMAN CONFIRMATION REQUIRED

```sql
-- Prefer cancel (graceful) before terminate (force):
SELECT pg_cancel_backend(<pid>);
SELECT pg_terminate_backend(<pid>);
```

App-side fix (uncommitted transactions, missing `await using` on transactions) → dispatch `coder` via conductor.

---

## 6. Unused indexes

```sql
SELECT s.schemaname, s.relname, s.indexrelname,
       s.idx_scan, pg_size_pretty(pg_relation_size(s.indexrelid)) AS index_size
FROM pg_stat_user_indexes s
JOIN pg_index i ON s.indexrelid = i.indexrelid
WHERE s.idx_scan = 0
  AND NOT i.indisunique      -- unique indexes enforce constraints: never drop on scan count alone
  AND NOT i.indisprimary
ORDER BY pg_relation_size(s.indexrelid) DESC;
```

**Interpretation:** `idx_scan = 0` since the last statistics reset (check uptime / `pg_stat_reset` history) — a rarely-used but load-bearing index (month-end job) can look unused. Write-heavy tables pay INSERT/UPDATE cost for every unused index. Statistics are per-index-scan, not per-query.

**Severity:** MEDIUM (large unused indexes on write-heavy tables); LOW otherwise.

**Remediation:** dropping an index defined in an EF Core migration is a **code change** → recommend `database-reviewer` (review) + `coder` (migration). Ad-hoc drop, if ever:

⚠️ HUMAN CONFIRMATION REQUIRED

```sql
DROP INDEX CONCURRENTLY <schema>.<index_name>;
```

---

## 7. Checkpoint stats

```sql
SELECT checkpoints_timed, checkpoints_req,
       ROUND(checkpoints_req::numeric / NULLIF(checkpoints_timed + checkpoints_req, 0) * 100, 2) AS req_pct,
       buffers_checkpoint, buffers_clean, buffers_backend,
       ROUND(checkpoint_write_time / NULLIF(checkpoints_timed + checkpoints_req, 0)) AS avg_write_ms,
       ROUND(checkpoint_sync_time  / NULLIF(checkpoints_timed + checkpoints_req, 0)) AS avg_sync_ms
FROM pg_stat_checkpointer;   -- PG14+: split out of pg_stat_bgwriter
```

**Interpretation:** checkpoints flush dirty buffers to disk. `checkpoints_req` (forced, because `max_wal_size` filled) should be a small fraction of `checkpoints_timed` (scheduled). `req_pct` > 10–20% = WAL generation outpaces `max_wal_size` (default 1GB) → I/O spikes. High `buffers_backend` = backends flushing pages themselves because the checkpointer can't keep up. Source: https://www.postgresql.org/docs/16/wal-configuration.html

**Severity:** HIGH (req_pct > 50% with latency symptoms); MEDIUM (10–50%).

**Remediation:** raise `max_wal_size` / tune completion target per the `postgres-performance-tuning` skill (compose `command:` change → `coder` + human restart).

---

## 8. Archiver health

```sql
SHOW archive_mode;
SHOW archive_command;
SELECT archived_count, failed_count,
       last_archived_wal, last_archived_time,
       last_failed_wal, last_failed_time
FROM pg_stat_archiver;
```

**Interpretation:** if `archive_mode = on`, the archiver copies completed WAL segments for PITR. **`failed_count` increasing (or `last_failed_time` recent) is CRITICAL**: failed archives are retried and pile up in `pg_wal`; when `pg_wal` fills the disk the server **PANICs and shuts down** ("could not write to file"). A failing `archive_command` (bad path, full destination) also silently breaks any PITR strategy. With `archive_mode = off` (the current compose default) there is no PITR — see `postgres-backup-restore`. Source: https://www.postgresql.org/docs/16/continuous-archiving.html

**Severity:** CRITICAL (archiver failing); HIGH (archiving off AND no dump strategy); else OK.

**Remediation:** fix the archive destination (human), then:

⚠️ HUMAN CONFIRMATION REQUIRED

```sql
SELECT pg_stat_reset_shared('archiver');  -- only AFTER the destination is fixed, to clear counters
```

---

## 9. Connection count vs max_connections

```sql
SHOW max_connections;
SELECT state, count(*) FROM pg_stat_activity
WHERE datname = current_database() GROUP BY state ORDER BY 2 DESC;
SELECT count(*) AS total,
       (SELECT setting::int FROM pg_settings WHERE name = 'max_connections') AS max
FROM pg_stat_activity WHERE datname = current_database();
```

**Interpretation:** default `max_connections = 100`. Each connection costs ≈ 5–10MB of backend memory — with `mem_limit: 1g` the container OOMs long before 100 busy backends. Sustained usage > 80% of max → add pgbouncer (see `postgres-performance-tuning`) rather than raising max_connections. Many `idle` connections from `gc_kourou_app_login` = Npgsql pool sized too large or multiple app instances.

**Severity:** CRITICAL (≥ 95% — new connections will fail); HIGH (80–95%); MEDIUM (idle connections ≫ active).

---

## 10. Container layer

```bash
docker stats --no-stream gc-platform-postgres
docker inspect --format '{{.State.Health.Status}} | started={{.State.StartedAt}} | restarts={{.RestartCount}}' gc-platform-postgres
docker volume inspect "$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/var/lib/postgresql/data"}}{{.Name}}{{end}}{{end}}' gc-platform-postgres)"
docker inspect --format '{{.HostConfig.ShmSize}}' gc-platform-postgres
docker inspect --format '{{.Config.Image}}' gc-platform-postgres
```

**Interpretation:**
- **Volume:** data MUST live on the named volume `postgres-data` (`/var/lib/postgresql/data`). Anonymous/missing volume = data loss on container removal → CRITICAL.
- **Healthcheck:** anything but `healthy` (compose runs `pg_isready` every 5s) → investigate logs.
- **Restarts:** `RestartCount` climbing = crash-loop (OOM or PANIC — check `docker logs`).
- **ShmSize:** this compose sets no `shm_size`, so Docker defaults `/dev/shm` to **64MB**. PostgreSQL uses POSIX shared memory for parallel query coordination; the official postgres image documents 64MB as a known pitfall (parallel workers can fail with "could not resize shared memory segment"). ⚠️ Heuristic: raise to ≥ 256MB for parallel workloads.
- **Image:** confirm `postgres:16-alpine`; a drifting tag breaks upgrade planning.

**Severity:** CRITICAL (volume not persisted; crash-loop); MEDIUM (shm_size 64MB on a parallel workload).

**Remediation (compose change → `coder` + human `docker compose up -d`):**

⚠️ HUMAN CONFIRMATION REQUIRED

```yaml
# docker-compose.yml, postgres service
shm_size: 256m
```

---

## Battery order (for `/db-health`)

Run checks 1 → 10 in order; stop the write-up early only if check 1 fails (unreachable). Cross-link findings: 5 feeds 3 feeds 4 (stuck sessions → dead tuples → wraparound risk); 7 feeds the tuning skill; 8 feeds the backup skill.
