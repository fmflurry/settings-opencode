# Reference — EF Core Migration OPS Hygiene

**Scope:** the **instance/OPS side** of applying EF Core migrations against `gc-platform-postgres` (db `gcplatform`). Lock behaviour at apply time, the `CREATE INDEX CONCURRENTLY`-vs-transaction conflict, post-migration bloat/vacuum watch, and live model-drift detection.

**Boundary:** code-side correctness — migration design, schema design, index design in code, RLS policy code, whether a migration *should* exist — belongs to the `database-reviewer` agent. This reference never duplicates that; it cross-references it. The `postgres-dba` agent stays read-only/advisory: every mutation below is a `⚠️ HUMAN CONFIRMATION REQUIRED` block.

**Connection:**

```bash
docker exec gc-platform-postgres psql -U gcplatform -d gcplatform -c "<query>"
```

---

## 1. Lock analysis at apply time

**Fact:** EF Core applies each migration **inside a transaction by default** (`Database.Migrate()`/`MigrateAsync()` wraps each pending migration in its own transaction). That transaction holds whatever locks the migration's DDL acquires **until the whole migration commits** — so a migration's lock window is "from first statement to commit", not per-statement. ⚠️ Verify the exact transactional behaviour against the repo's EF Core version; the per-migration-transaction default is long-standing but version details matter.

Most schema DDL takes an **ACCESS EXCLUSIVE** lock on the affected table, which blocks **everything — including plain SELECTs — for the whole lock window.** Watch for these inside a migration:

| DDL | Lock on the table | Effect during the lock window |
|---|---|---|
| `ALTER TABLE` (most forms: add/drop/rename column, add constraint) | **ACCESS EXCLUSIVE** | Blocks all reads + writes ⚠️ |
| `DROP TABLE` | **ACCESS EXCLUSIVE** | Blocks all reads + writes |
| `TRUNCATE` | **ACCESS EXCLUSIVE** | Blocks all reads + writes |
| `CREATE INDEX` (non-concurrent) | **SHARE** | Blocks writes; reads continue |
| `CREATE INDEX CONCURRENTLY` | (cannot run in a txn — see §2) | — |
| `ALTER TABLE ... ADD COLUMN` with a **volatile** default, or a table **rewrite** | **ACCESS EXCLUSIVE** + full rewrite | Long window on big tables ⚠️ |
| `ALTER TABLE ... ADD COLUMN` with a **constant** default (PG 11+) | **ACCESS EXCLUSIVE** but metadata-only | Short window — no rewrite (PG 11+) ⚠️ |

⚠️ The exact lock mode per `ALTER TABLE` sub-form is PostgreSQL-version-dependent; confirm against https://www.postgresql.org/docs/16/sql-altertable.html and https://www.postgresql.org/docs/16/explicit-locking.html before relying on a specific row.

**Lock-window timing guidance (OPS):**
- Because the lock is held to commit, the window = (migration runtime) + (any queue behind it). A fast `ALTER TABLE` can still stall for minutes if it queues behind a long-running transaction holding a conflicting lock.
- **Before applying migrations, check for lock-blockers** (read-only):

```sql
-- Who holds locks on user tables right now, and how long:
SELECT l.relation::regclass AS table, l.mode, l.granted,
       a.pid, a.state, now() - a.xact_start AS tx_age, LEFT(a.query, 80) AS query
FROM pg_locks l
JOIN pg_stat_activity a ON a.pid = l.pid
WHERE l.relation::regclass::text NOT LIKE 'pg_%'
ORDER BY a.xact_start NULLS LAST;
```

- Apply migrations in a **quiet window** (no long-running `idle in transaction` sessions — see `postgres-health-check` §5; those hold back locks AND autovacuum).
- A migration that adds an index non-concurrently on a hot, large table takes a SHARE lock that blocks writes for the build duration — schedule it, or do the index concurrently out-of-band (§2).

**Severity:** HIGH (an ACCESS EXCLUSIVE migration queued behind long transactions on a hot table → user-visible outage); MEDIUM (large non-concurrent index build in the migration window).

---

## 2. `CREATE INDEX CONCURRENTLY` cannot run inside a transaction

**Hard PostgreSQL rule:** `CREATE INDEX CONCURRENTLY` (and `REINDEX CONCURRENTLY`, `DROP INDEX CONCURRENTLY`) **cannot be executed inside a transaction block.** Since EF Core wraps each migration in a transaction by default (§1), a raw `CREATE INDEX CONCURRENTLY` placed in a migration's `Up()` **fails** at apply time. ⚠️ Verify against the repo's EF Core + Npgsql versions — the exact suppression mechanism and any provider-specific support are version-dependent.

**OPS-side patterns (pick one; the code-side choice is `database-reviewer`'s call):**

1. **Build the index out-of-band, concurrently, as an OPS step** — keep it OUT of the transactional migration:

   ⚠️ HUMAN CONFIRMATION REQUIRED

   ```sql
   -- Runs outside any transaction; does not block writes; can leave an INVALID index on failure:
   CREATE INDEX CONCURRENTLY IF NOT EXISTS <index_name> ON <schema>.<table> (<columns>);
   -- Verify it is valid (an INVALID concurrent index must be dropped + rebuilt):
   SELECT indexrelid::regclass, indisvalid FROM pg_index WHERE indexrelid = '<schema>.<index_name>'::regclass;
   ```

   Then the EF migration records the index in the model **without** re-creating it (so the model and the live schema agree) — that wiring is a code decision for `database-reviewer`/`coder`.

2. **Suppress the migration transaction** so the concurrent build can run in `Up()` — ⚠️ the mechanism is EF-version-specific; confirm the repo's version supports per-migration suppression before recommending it. If unsupported, fall back to pattern 1.

3. **Accept a non-concurrent `CREATE INDEX`** inside the migration during a scheduled maintenance window (SHARE lock blocks writes for the build — §1). Simplest; only acceptable with a real quiet window.

**Severity:** HIGH (a `CONCURRENTLY` statement inside a default-transactional migration → migration fails at deploy); MEDIUM (choosing pattern 3 on a hot table without a quiet window).

---

## 3. Post-migration bloat / vacuum watch

A migration that rewrites a table (a table-rewriting `ALTER TABLE`, a big backfill `UPDATE`, `VACUUM FULL`-style operations) generates **dead tuples and bloat** that autovacuum must reclaim afterwards. Watch the table(s) the migration touched:

```sql
-- Dead-tuple / autovacuum hotspot on the just-migrated tables (full battery: postgres-health-check §3):
SELECT schemaname, relname, n_live_tup, n_dead_tup,
       ROUND(n_dead_tup::numeric / NULLIF(n_live_tup + n_dead_tup, 0) * 100, 2) AS dead_pct,
       last_autovacuum, last_autoanalyze
FROM pg_stat_user_tables
WHERE (schemaname, relname) IN (('<schema>', '<table>'))   -- the migrated tables
ORDER BY n_dead_tup DESC;

-- Bloat proxy: total (table + indexes + TOAST) vs heap only:
SELECT relname, pg_size_pretty(pg_total_relation_size(relid)) AS total,
       pg_size_pretty(pg_relation_size(relid)) AS heap
FROM pg_stat_user_tables WHERE relname = '<table>';
```

**Interpretation:** a spike in `n_dead_tup` right after a migration is expected; confirm `last_autovacuum` advances and `dead_pct` falls back below ~20%. If autovacuum is held back, an `idle in transaction` session is usually the cause (`postgres-health-check` §5 feeds this). A table-rewriting migration on a large table can roughly double its on-disk footprint transiently — confirm free disk first.

**Severity:** HIGH (post-migration `dead_pct` > 50% and autovacuum not advancing); MEDIUM (20–50%, or autovacuum lagging).

**Remediation:** see `postgres-health-check` §3 for the `VACUUM (ANALYZE)` / per-table autovacuum-tuning blocks (all `⚠️ HUMAN CONFIRMATION REQUIRED`). Tightening autovacuum on a repeatedly-bloated table is a code/migration concern → `database-reviewer`.

---

## 4. Live model-drift check

Detect whether the EF model has changes not yet captured in a migration (drift between code and the migrations graph), and whether applied migrations match the database:

```bash
# ⚠️ Verify command availability against the repo's EF Core CLI version (added in EF Core 8):
dotnet ef migrations has-pending-model-changes --project <path-to-ef-project>

# Applied-vs-pending migration state (also surfaces a database the code has outgrown):
dotnet ef migrations list --project <path-to-ef-project>
```

⚠️ `has-pending-model-changes` reports model changes lacking a migration; it needs the EF Core CLI matching the repo's major version (the command itself is EF Core 8+). If the CLI errors with "unrecognized command", the repo's `dotnet-ef` tool is older — fall back to `migrations list` and a manual model diff. Confirm exact availability before relying on it.

**Interpretation for audits:** pending model changes on a deployed service = the running schema lags the code's expectations (a future deploy will apply them — assess their locks per §1 before that deploy). This is a *signal*, not a defect: code-side resolution (generate/review the migration) is `database-reviewer` + `coder` work.

**Severity:** MEDIUM (unreviewed pending model changes on a service heading toward a deploy); LOW (expected mid-development drift).

---

## Cross-references

- Lock-blocker queries, `idle in transaction`, autovacuum/bloat battery → `postgres-health-check` (§3 dead tuples, §5 long-running sessions, §6 unused indexes).
- Migration *design*, schema/index/RLS code correctness → `database-reviewer` (this reference deliberately does not cover it).
- Backup-before-migration posture and restore drills → `postgres-backup-restore` (§5).
