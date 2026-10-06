---
description: Audit PostgreSQL backup/restore posture (archiving, pg_stat_archiver, dumps, volume persistence) and emit advisory setup commands for human execution
agent: postgres-dba
subtask: true
---

# DB Backup Check Command

Delegate to the `postgres-dba` agent to audit this repository's PostgreSQL backup/restore posture (`gc-platform-postgres`, `postgres:16-alpine`).

## Task

Load the `postgres-backup-restore` skill and audit:

- **Archiving configured?** `SHOW archive_mode` / `archive_command` / `archive_timeout` / `wal_level`
- **Archiver healthy?** `pg_stat_archiver` — `failed_count`, `last_failed_time` (failures → `pg_wal` fills → PANIC shutdown)
- **Last successful dump?** check `./backups/` (or ask the user where dumps live); verify readability with `pg_restore -l`; confirm globals (roles) coverage
- **Volume persistence?** `docker volume inspect postgres-data` — data must sit on the named volume at `/var/lib/postgresql/data`
- **PITR possible today?** base backup + WAL archive present, or not (PG16 has NO native incremental backups)

Produce a **gap report** (CRITICAL → HIGH → MEDIUM → LOW) and **advisory setup commands** — archiving enablement, `pg_dump`/`pg_basebackup` recipes, PITR recovery steps — each as a `⚠️ HUMAN CONFIRMATION REQUIRED` block. Compose changes are recommended as handoffs to `coder` via the conductor. Nothing is executed.

## Scope

- If `$ARGUMENTS` is provided (e.g., `/db-backup-check pitr`): audit that focus area (archiving, pitr, dumps, or volume)
- If `$ARGUMENTS` is empty: audit the full backup posture

$ARGUMENTS

## Output Format

Return the structured report per the `postgres-dba` agent specification:

- **Severity tiers:** CRITICAL → HIGH → MEDIUM → LOW
- **Evidence:** exact query/command + observed values per finding
- **Remediation:** human-confirmation blocks for all backup/restore/config commands; `coder` briefs for compose changes
- **Restore drill:** state whether a drill is recorded and due (checklist in the skill)
