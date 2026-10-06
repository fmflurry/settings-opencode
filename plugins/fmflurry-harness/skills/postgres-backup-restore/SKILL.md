---
name: postgres-backup-restore
description: "PostgreSQL backup & restore playbook for the docker instance: pg_dump/pg_dumpall recipes, WAL archiving + PITR setup (archive_mode, archive_command, recovery.signal, recovery_target_time, timelines), restore drills, and the PG16 no-incremental-backup constraint. Use when asked about backup, restore, PITR, pg_dump, pg_basebackup, WAL archiving, or disaster recovery. Target: postgres:16-alpine (container gc-platform-postgres). Read alongside the postgres-dba agent."
---

# PostgreSQL Backup & Restore

**Target version:** `postgres:16-alpine` — this repository's `gc-platform-postgres` container (db `gcplatform`, owner role `gcplatform`, data on named volume `postgres-data`).

**Contract:** auditing is read-only (`SHOW`, `pg_stat_archiver`, `docker volume inspect`). Every backup/restore/ config command below is emitted ONLY as a `⚠️ HUMAN CONFIRMATION REQUIRED` block — the `postgres-dba` agent never executes backups, restores, or server-config changes. Restores are ALWAYS human-executed: a restore overwrites data and is irreversible in the wrong hands.

**Connection:**

```bash
docker exec gc-platform-postgres psql -U gcplatform -d gcplatform -c "<query>"
```

---

## 1. Backup strategy map (pick per need)

| Method | Captures | PITR? | Notes for this repo |
|---|---|---|---|
| `pg_dump -Fc` | One database, logical (SQL-level) | NO | Restores into any PG version ≥ source; slow on huge DBs; does NOT capture roles/tablespaces |
| `pg_dumpall --globals-only` | Cluster globals: **roles**, tablespaces | NO | Needed separately — `gc_kourou_app_login`, `gc_kourou_identity_app`, `gc_kourou_identity_migrator` are global objects (though this repo re-provisions them via migrations on boot) |
| `pg_basebackup` | Physical whole-cluster copy | Base for PITR | Must stop/quiet writes for a consistent snapshot unless using WAL archiving; docker volume makes this awkward |
| WAL archiving + base backup | Continuous, point-in-time | **YES** | Requires `archive_mode=on` + working `archive_command` (see §3) |
| PG16 native incremental backup | — | — | **NOT AVAILABLE: `pg_basebackup --incremental` is PostgreSQL 17+ only.** On PG16, "incremental" = WAL archiving layered on periodic base backups. |

`pg_dump` can never do PITR — it is a logical snapshot at dump time.

---

## 2. Logical backup recipes (docker instance)

⚠️ HUMAN CONFIRMATION REQUIRED

```bash
# Database dump, custom format (compressed, parallel-restoreable, selective):
docker exec gc-platform-postgres pg_dump -U gcplatform -d gcplatform -Fc -f /tmp/gcplatform_$(date +%F).dump
docker cp gc-platform-postgres:/tmp/gcplatform_$(date +%F).dump ./backups/

# Plain-SQL alternative (readable in git/diff, no parallel restore):
docker exec gc-platform-postgres pg_dump -U gcplatform -d gcplatform -f - > ./backups/gcplatform_$(date +%F).sql

# Cluster globals (roles!) — not included in pg_dump:
docker exec gc-platform-postgres pg_dumpall -U gcplatform --globals-only -f - > ./backups/globals_$(date +%F).sql
```

**Interpretation for audits:** a dump in `./backups/` older than the agreed RPO (or no dumps at all) = HIGH. Custom-format dumps are verified with `pg_restore -l <file>` (lists TOC, does not restore).

⚠️ HUMAN CONFIRMATION REQUIRED

```bash
# Verify a dump is structurally readable WITHOUT restoring it:
pg_restore -l ./backups/gcplatform_YYYY-MM-DD.dump | head
```

---

## 3. PITR setup (WAL archiving) — PG16

Source: https://www.postgresql.org/docs/16/continuous-archiving.html

### 3a. Audit current posture (read-only)

```sql
SHOW wal_level;        -- PG16 default 'replica' ✓ (sufficient for archiving)
SHOW archive_mode;     -- 'off' in the stock compose → PITR currently impossible
SHOW archive_command;  -- '(disabled)' when archive_mode=off
SHOW archive_timeout;  -- 0 = WAL segments only archived when full (16MB)
SELECT archived_count, failed_count, last_archived_wal, last_archived_time,
       last_failed_wal, last_failed_time
FROM pg_stat_archiver;
```

**Interpretation:** `failed_count > 0` with recent `last_failed_time` = CRITICAL (archives retry forever, `pg_wal` grows until PANIC shutdown). `archive_mode = off` + no dump cron = no recovery story = HIGH.

### 3b. Enable archiving (config change → `coder` for compose edit + human restart)

⚠️ HUMAN CONFIRMATION REQUIRED

```yaml
# docker-compose.yml, postgres service — archive to a path on a dedicated volume:
command: ["postgres", "-c", "archive_mode=on", "-c", "archive_timeout=60",
          "-c", "archive_command=test ! -f /var/lib/postgresql/archive/%f && cp %p /var/lib/postgresql/archive/%f"]
volumes:
  - postgres-data:/var/lib/postgresql/data
  - postgres-archive:/var/lib/postgresql/archive
```

Hard rules for `archive_command` (from the PG docs, non-negotiable):
1. **Must return non-zero on failure** — a lying success loses WAL and silently breaks PITR.
2. **Must never overwrite an existing archive** — hence the `test ! -f … &&` guard; overwriting corrupts the timeline.
3. `archive_timeout = 60` forces a segment switch at least per minute so low-write periods still bound data loss (each forced switch closes a 16MB segment — trade disk for RPO).

`wal_level` stays at the PG16 default `replica` — no change needed.

### 3c. Base backup (the starting point PITR replays from)

⚠️ HUMAN CONFIRMATION REQUIRED

```bash
# Physical base backup of the running cluster (needs the superuser role):
docker exec gc-platform-postgres pg_basebackup -U gcplatform -D /tmp/base_$(date +%F) -Ft -z -Xs -P
docker cp gc-platform-postgres:/tmp/base_$(date +%F) ./backups/
```

`-Xs` streams WAL during the backup so the base is self-consistent.

### 3d. Recovery to a point in time (human-executed, always)

⚠️ HUMAN CONFIRMATION REQUIRED

```bash
# 1. Stop the container; preserve the current data dir (rename, never delete):
docker compose stop postgres
docker volume inspect postgres-data   # note the Mountpoint

# 2. Replace the data directory contents with the base backup (as the postgres user).

# 3. Configure recovery in the data dir (postgresql.auto.conf or recovery settings):
restore_command = 'cp /var/lib/postgresql/archive/%f %p'
recovery_target_time = '2026-07-28 14:30:00 UTC'   -- the instant BEFORE the incident
recovery_target_action = 'pause'                  -- inspect before promoting

# 4. Create the signal file that switches the server into recovery:
touch <datadir>/recovery.signal

# 5. Start; watch logs; when paused at the target and satisfied, promote:
docker compose start postgres
docker exec gc-platform-postgres psql -U gcplatform -d gcplatform -c "SELECT pg_wal_replay_resume();"  -- if paused
```

**Timelines:** every recovery creates a new timeline (`00000002.history` etc.). Keep the history files and old WAL — they let you recover to a point on the PRE-recovery timeline if the recovery target was wrong. `recovery_target_timeline = 'latest'` is the default.

---

## 4. Restore from a logical dump (human-executed)

⚠️ HUMAN CONFIRMATION REQUIRED

```bash
# Restore into a FRESH database (never over the live one without a plan):
docker exec gc-platform-postgres psql -U gcplatform -d postgres -c "CREATE DATABASE gcplatform_restore OWNER gcplatform;"
docker cp ./backups/gcplatform_YYYY-MM-DD.dump gc-platform-postgres:/tmp/restore.dump
docker exec gc-platform-postgres pg_restore -U gcplatform -d gcplatform_restore -j 4 --no-owner /tmp/restore.dump
# -j 4 = parallel restore (custom format only); --no-owner because the restoring role differs
```

**Repo-specific:** roles (`gc_kourou_app_login`, `identity_*`) are re-provisioned by EF migrations/IdentitySchemaMigrator on backend boot, so a logical restore of the database plus a backend restart re-creates runtime grants. If restoring globals too, apply `globals_*.sql` first.

---

## 5. Restore-drill checklist (a backup you cannot restore is not a backup)

Run quarterly; every step human-executed:

- [ ] Latest dump/base backup exists and `pg_restore -l` lists its TOC without errors
- [ ] Restore into a scratch database (`gcplatform_restore`) succeeds end-to-end
- [ ] Backend boots against the scratch DB and migrations report no pending model changes
- [ ] Row counts on key tables match the source (within RPO)
- [ ] (If PITR) `pg_stat_archiver.failed_count` has stayed 0 since the last drill; archive destination has free space
- [ ] Documented RTO/RPO and the runbook location are current

**Severity for audits:** no drill ever recorded = HIGH; drill older than 6 months = MEDIUM.

---

## 6. Volume persistence audit (read-only)

```bash
docker volume inspect postgres-data
docker inspect --format '{{range .Mounts}}{{.Type}} {{.Name}} -> {{.Destination}}{{println}}{{end}}' gc-platform-postgres
```

**Interpretation:** data must sit on the **named volume `postgres-data`** at `/var/lib/postgresql/data`. Anonymous volume or bind-mount into the repo tree = CRITICAL (anonymous volumes vanish with `docker compose down`; repo-tree mounts corrupt on macOS Docker file-sharing). `docker volume rm postgres-data` is in the postgres-dba never-execute list — deletion is a human decision with a fresh backup in hand.
