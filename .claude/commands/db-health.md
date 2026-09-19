---
description: Run a read-only PostgreSQL instance health battery (vacuum/bloat, wraparound, connections, indexes, checkpoints, archiver, container) and produce a tiered advisory report
argument-hint: "[optional] focus: vacuum|connections|wraparound|indexes"
agent: postgres-dba
---

# DB Health Check Command

Delegate to the `postgres-dba` agent to run a full read-only instance health battery against this repository's PostgreSQL container (`gc-platform-postgres`, `postgres:16-alpine`).

## Task

Load the `postgres-health-check` skill and run the battery: connectivity/uptime, cache hit ratio, dead-tuple/autovacuum hotspots, XID wraparound distance, long-running & idle-in-transaction sessions, unused indexes, checkpoint stats, archiver health, connection count vs max_connections, and the container layer (docker stats, volume presence, healthcheck, shm_size).

Produce a **tiered findings report** (CRITICAL → HIGH → MEDIUM → LOW) with, per finding: the diagnostic query used, observed values, interpretation (with source URL), severity, and remediation. Mutations (VACUUM, REINDEX, session kills, config changes) appear ONLY as `⚠️ HUMAN CONFIRMATION REQUIRED` blocks. Repo changes (compose flags, migrations) are recommended as handoffs to `coder` via the conductor.

## Scope

- If `$ARGUMENTS` is provided (e.g., `/db-health vacuum`): run only that focus area (vacuum/bloat, connections, wraparound, or indexes)
- If `$ARGUMENTS` is empty: run the full battery

$ARGUMENTS

## Output Format

Return the structured report per the `postgres-dba` agent specification:

- **Severity tiers:** CRITICAL → HIGH → MEDIUM → LOW
- **Evidence:** exact query + observed values per finding
- **Remediation:** human-confirmation blocks for instance mutations; `coder` briefs for repo changes
- **Action plan:** immediate human steps, then repo-change dispatches, then re-check instruction
