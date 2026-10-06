---
name: postgres-container-ops
description: "PostgreSQL container operations for the docker instance: volume persistence audit (PGDATA layout and the PG18 version-specific data-directory change), /dev/shm sizing (shm_size), pg_isready healthcheck tuning, minor-version pin policy (16-alpine to explicit 16.x-alpine), the major-version upgrade runbook (pg_upgrade --link vs pg_dump/restore fallback), and the /docker-entrypoint-initdb.d init-scripts caveat. Use when asked about container upgrade, pg_upgrade, postgres version bump, volume persistence, shm_size, healthcheck tuning, init scripts, or pin tag. Target: postgres:16-alpine (container gc-platform-postgres). Read alongside the postgres-dba agent."
---

# PostgreSQL Container Operations

**Target version:** `postgres:16-alpine` — this repository's `gc-platform-postgres` container (db `gcplatform`, owner role `gcplatform`, data on named volume `postgres-data` → `/var/lib/postgresql/data`). The second Postgres, `gc-platform-langfuse-postgres` (Langfuse observability tier), is **out of scope** for this skill unless explicitly asked.

**Contract:** auditing is read-only (`docker volume inspect`, `docker inspect`, `docker ps`, `pg_isready`). Every upgrade, dump/restore, volume, or server-config command below is emitted ONLY as a `⚠️ HUMAN CONFIRMATION REQUIRED` block — the `postgres-dba` agent never executes upgrades, restores, or config changes. Image-layout facts marked **(verified)** are confirmed against the official docker-library postgres README; facts marked ⚠️ are established guidance to verify before acting.

**Source of truth for image behaviour:** https://github.com/docker-library/docs/blob/master/postgres/README.md (verified). `pg_upgrade` mechanics: https://www.postgresql.org/docs/current/pgupgrade.html ⚠️.

**Connection / inspection:**

```bash
docker exec gc-platform-postgres psql -U gcplatform -d gcplatform -c "<query>"
docker exec gc-platform-postgres pg_isready -U gcplatform -d gcplatform
```

---

## 1. Volume persistence audit

Where the data physically lives is the single most important container fact. Get it wrong and a container re-create silently loses the database.

```bash
# Named volume + its host mountpoint:
docker volume inspect postgres-data

# What is actually mounted inside the container, and where:
docker inspect --format '{{range .Mounts}}{{.Type}} {{.Name}} -> {{.Destination}}{{println}}{{end}}' gc-platform-postgres

# Restart-survival probe (read-only): the data dir must be on the named volume, not an anonymous one:
docker inspect --format '{{range .Mounts}}{{if eq .Destination "/var/lib/postgresql/data"}}{{.Name}} ({{.Type}}){{end}}{{end}}' gc-platform-postgres
```

**Interpretation:**
- **PG ≤ 17 (this repo, on 16):** the image declares its `VOLUME` at `/var/lib/postgresql/data`, and `PGDATA` defaults there. The data volume **must** be mounted at `/var/lib/postgresql/data`. (verified) Mounting at `/var/lib/postgresql` on PG ≤ 17 **WILL NOT PERSIST** data: the runtime auto-creates an anonymous volume at the declared path and data is written there instead, lost on container deletion. (verified)
- **PG18+ layout change (matters for any 16→18 upgrade plan):** from PostgreSQL 18 the image makes `PGDATA` version-specific — `/var/lib/postgresql/<major>/docker` (e.g. `/var/lib/postgresql/18/docker`) — and moves the declared `VOLUME` up to `/var/lib/postgresql`. Mounts/volumes must target the new location. (verified) This is precisely what enables the fast `pg_upgrade --link` path (see §5): old and new data directories coexist under one mounted `/var/lib/postgresql`. (verified)
- **Opt-in early:** you can adopt the PG18 layout on 16/17 by setting `PGDATA` explicitly (`PGDATA=/var/lib/postgresql/17/docker`) and mounting the volume at `/var/lib/postgresql` — but to migrate pre-existing data you must first move all database files into a `<PG_MAJOR>/docker` subdirectory of the volume. (verified) Treat that move as a mutation (human-only, with a fresh backup).
- **Anonymous volume or bind-mount into the repo tree = CRITICAL.** Anonymous volumes vanish with `docker compose down`; repo-tree bind-mounts corrupt on macOS Docker file-sharing. `docker volume rm postgres-data` is on the postgres-dba never-execute list — deletion is a human decision taken with a verified backup in hand.

**Severity:** CRITICAL (data not on the named volume `postgres-data`; anonymous volume; restart loses data); HIGH (bind-mount into repo tree); else OK.

**Remediation:** a volume/mount fix is a compose change → dispatch `coder` with a precise brief, then a human applies it. Never re-point or delete a volume without a verified restorable backup (see `postgres-backup-restore` §5 restore-drill).

---

## 2. `/dev/shm` sizing (`shm_size`)

```bash
docker inspect --format '{{.HostConfig.ShmSize}}' gc-platform-postgres   # bytes; 67108864 = 64MB
```

**Interpretation:** Docker defaults a container's `/dev/shm` to **64MB**. PostgreSQL uses POSIX shared memory for parallel-query coordination; when `/dev/shm` is exhausted, parallel workers fail with `ERROR: could not resize shared memory segment ... : No space left on device`. The official postgres image documents 64MB as a known pitfall and recommends raising it (its compose example uses `shm_size: 128mb`; ⚠️ heuristic: ≥ 256MB for parallel workloads). (verified re: the 64MB default + the error; the 256MB figure is a heuristic.) This compose sets **no** `shm_size`, so the container is on the 64MB default.

**Severity:** MEDIUM (64MB on a workload that uses parallel query); LOW (no parallel query observed).

**Remediation (compose change → `coder` + human `docker compose up -d`; restart required):**

⚠️ HUMAN CONFIRMATION REQUIRED

```yaml
# docker-compose.yml, postgres service
shm_size: 256mb
```

Verify after restart: `docker inspect --format '{{.HostConfig.ShmSize}}' gc-platform-postgres` (expect `268435456`).

---

## 3. Healthcheck tuning

Current compose healthcheck: `pg_isready -U gcplatform -d gcplatform`. Read the live config:

```bash
docker inspect --format '{{json .Config.Healthcheck}}' gc-platform-postgres
docker inspect --format '{{.State.Health.Status}} | failing={{.State.Health.FailingStreak}} | restarts={{.RestartCount}}' gc-platform-postgres
```

**Interpretation:** `pg_isready` only confirms the server accepts connections — it does NOT prove the database is usable (it can return success mid-recovery, or while a hot table is lock-blocked). Tune the four knobs, not the probe command:

| Knob | ⚠️ Heuristic | Why |
|---|---|---|
| `interval` | 5–10s | How often to probe. Too tight = needless load; too loose = slow failure detection. |
| `timeout` | 5s | Per-probe budget; must exceed a normal `pg_isready` round-trip or healthy-but-busy servers flap. |
| `retries` | 3–5 | Consecutive failures before `unhealthy`. Guards against a single slow probe. |
| `start_period` | 30–60s | Grace window while the server initialises; probes inside it don't count toward `retries`. This repo runs EF migrations + `IdentitySchemaMigrator` on backend boot, but Postgres itself starts fast — keep `start_period` modest. |

Anything but `healthy` (or a climbing `FailingStreak`/`RestartCount`) → read `docker logs --tail 200 gc-platform-postgres` before touching the healthcheck. A flapping healthcheck is usually a symptom (crash-loop, OOM, PANIC), not a misconfigured probe.

**Severity:** MEDIUM (no `start_period` and the stack falsely reports `unhealthy` during boot); LOW (cosmetic tuning); the *underlying* cause of an unhealthy container is rated on its own merits (CRITICAL for crash-loop/PANIC).

**Remediation (compose change → `coder` + human restart):**

⚠️ HUMAN CONFIRMATION REQUIRED

```yaml
# docker-compose.yml, postgres service
healthcheck:
  test: ["CMD-SHELL", "pg_isready -U gcplatform -d gcplatform"]
  interval: 10s
  timeout: 5s
  retries: 5
  start_period: 30s
```

---

## 4. Minor-version bumps (pin policy)

```bash
docker inspect --format '{{.Config.Image}}' gc-platform-postgres   # confirm the running tag
docker image inspect --format '{{index .RepoDigests 0}}' postgres:16-alpine 2>/dev/null  # pinned digest, if pulled
```

**Interpretation:** the compose pins `16-alpine` — a **floating major-version tag** that tracks the latest 16.x. Minor releases (16.x → 16.x+1) are backward-compatible bugfix/security drops; pulling a newer 16.x and restarting is the supported upgrade path and needs only a container restart (brief downtime). The risk with a floating tag is *surprise*: a `docker compose pull` + `up -d` silently moves the minor version.

⚠️ Heuristic pin policy:
- **Reproducible environments:** pin the explicit minor, e.g. `16.x-alpine` (replace `x` with the current tested minor — `16.14` at the time of writing per the docker-library tag list), and bump it deliberately after reading the release notes.
- **Always read the minor release notes** before bumping (https://www.postgresql.org/docs/release/ ⚠️) — they list any behaviour fixes that could bite.
- A floating `16-alpine` is acceptable for dev; pin the digest or explicit minor for anything you must reproduce.

**Severity:** LOW (floating tag in dev); MEDIUM (floating tag where reproducibility matters).

**Remediation (compose change → `coder`; the pull + restart is human-executed):**

⚠️ HUMAN CONFIRMATION REQUIRED

```bash
# After pinning the explicit minor in docker-compose.yml:
docker compose pull postgres
docker compose up -d postgres        # brief downtime: the server restarts on the new minor
docker exec gc-platform-postgres psql -U gcplatform -d gcplatform -c "SELECT version();"
```

A minor bump is NOT a major upgrade — no `pg_upgrade`, no dump/restore.

---

## 5. Major-version upgrade runbook (the core)

A major upgrade (16 → 17/18) changes the on-disk catalog format; the new server **will not start** on the old data directory until it is upgraded. Two paths:

| Path | How | When |
|---|---|---|
| **(a) `pg_upgrade --link`** | In-place, hard-links the old data files into the new cluster — fast, near-constant disk overhead | Both major versions' binaries available; data layout supports it (the PG18 `/var/lib/postgresql` volume is designed for this) |
| **(b) `pg_dump` / restore** | Logical dump on the old, restore into the new | Cross-version safety net; slower; the fallback when `pg_upgrade` is blocked |

`pg_upgrade` mechanics: https://www.postgresql.org/docs/current/pgupgrade.html ⚠️. Image layout facts: docker-library README (verified).

### 5a. Pre-upgrade checklist (non-negotiable, in order)

- [ ] **Verified restorable backup FIRST.** A fresh dump that has passed `pg_restore -l` (see `postgres-backup-restore` §2/§5). No verified backup → no upgrade. This is the rollback of last resort.
- [ ] **`pg_upgrade --check` dry run** — runs every pre-flight check WITHOUT modifying anything; fix every error it reports before the real run. ⚠️
- [ ] **Extension compatibility** — every installed extension (`\dx`) must exist for the target major version. **Alpine/musl caveat:** on `-alpine` images, any extension not in `postgres-contrib` must be compiled into a custom image (musl libc, not glibc); confirm the target Alpine image actually ships each extension you use. (verified re: the contrib/compile-in caveat)
- [ ] **Drain connections** — stop the backend (and anything else holding connections) so the cluster is quiescent; `idle in transaction` sessions block the upgrade.
- [ ] **Rollback plan written down** — keep the old data directory/volume intact (rename, never delete) until the new cluster is proven; know how to revert the compose `image:` tag and restart on the old data.

### 5b. Path (a) — `pg_upgrade --link`

The PG18 image layout (PGDATA `/var/lib/postgresql/<major>/docker`, volume `/var/lib/postgresql`, verified §1) is what makes `--link` practical in Docker: the old and new data directories live side-by-side under the one mounted volume, and `--link` hard-links the relation files instead of copying them. On the current PG ≤ 17 layout (`/var/lib/postgresql/data`) you would first have to restructure the volume (§1 opt-in) before `--link` is ergonomic.

⚠️ HUMAN CONFIRMATION REQUIRED — every step below is human-executed; the agent only emits it.

```bash
# 0. Backup verified (§5a). Stop the app + the server; keep the old volume.
docker compose stop postgres

# 1. Dry run — must come back clean before anything else (run inside an image that has BOTH majors' binaries):
pg_upgrade --check \
  --old-datadir=/var/lib/postgresql/16/docker \
  --new-datadir=/var/lib/postgresql/18/docker \
  --old-bindir=/usr/lib/postgresql/16/bin \
  --new-bindir=/usr/lib/postgresql/18/bin \
  --link

# 2. Real upgrade (only after --check is clean and connections are drained):
pg_upgrade \
  --old-datadir=/var/lib/postgresql/16/docker \
  --new-datadir=/var/lib/postgresql/18/docker \
  --old-bindir=/usr/lib/postgresql/16/bin \
  --new-bindir=/usr/lib/postgresql/18/bin \
  --link

# 3. Post-upgrade: run the generated analyze script to refresh planner stats,
#    then start the new server and verify:
#      ./analyze_new_cluster.sh
docker compose up -d postgres
docker exec gc-platform-postgres psql -U gcplatform -d gcplatform -c "SELECT version();"
```

⚠️ The exact `--bindir`/`--datadir` paths and the "image with both majors' binaries" depend on how you stage the upgrade (a throwaway upgrade container is the common pattern); the stock single-major image does not ship the other major's binaries. Verify the staging approach before running. The `pg_upgrade` flags above follow https://www.postgresql.org/docs/current/pgupgrade.html ⚠️.

### 5c. Path (b) — `pg_dump` / restore fallback

Use when `pg_upgrade` is blocked (extension unavailable on the target, awkward layout, or you want the logical-snapshot safety net). **Do not duplicate the recipes here** — the dump, the globals dump, the fresh-database restore, and the restore-drill checklist all live in the `postgres-backup-restore` skill (§2 logical dumps, §4 restore, §5 drill). The major-upgrade-specific ordering is:

1. Dump from the OLD major (`postgres-backup-restore` §2), globals included.
2. Bring up the NEW major on a fresh volume with the target image.
3. Restore into the new cluster (`postgres-backup-restore` §4); roles re-provision on backend boot via EF migrations + `IdentitySchemaMigrator`.
4. Point the backend at the new cluster, run migrations, verify (`SELECT version();`, row counts within RPO).

All dump/restore commands remain `⚠️ HUMAN CONFIRMATION REQUIRED` and are emitted by `postgres-backup-restore`, never executed by this agent.

**Severity (for audits):** no documented major-upgrade runbook + a floating tag = MEDIUM; an upgrade attempted without a verified backup or a `--check` dry run = CRITICAL (data-loss exposure).

---

## 6. Init-scripts caveat (`/docker-entrypoint-initdb.d`)

**The single most common container-ops mistake:** expecting `/docker-entrypoint-initdb.d` scripts to run on an existing instance. **They run ONLY when the container starts with an empty data directory.** Any pre-existing database is left untouched on startup — so init scripts are useless for tuning or migrating the live `gc-platform-postgres` instance. (verified) A related trap: if an init script fails and the orchestrator restarts the container against the now-initialised data dir, the scripts do NOT resume. (verified)

```bash
# Read-only: is anything even mounted into the init dir?
docker inspect --format '{{range .Mounts}}{{if eq .Destination "/docker-entrypoint-initdb.d"}}{{.Name}} -> {{.Destination}}{{end}}{{end}}' gc-platform-postgres
```

**Where runtime configuration actually goes (existing instance):**
- **Server flags:** `command: ["postgres", "-c", "<flag>=<value>", ...]` in compose (see `postgres-performance-tuning` for `shared_buffers`/`max_wal_size`/`pg_stat_statements`). Any option valid in `postgresql.conf` can be set via `-c`. (verified)
- **Mounted config file:** mount a custom `postgresql.conf` and point at it with `-c config_file=...`; the sample lives at `/usr/local/share/postgresql/postgresql.conf.sample` in the Alpine image. **You must keep `listen_addresses = '*'`** or other containers lose connectivity. (verified)
- **`POSTGRES_INITDB_ARGS`** (e.g. `--data-checksums`) and the other `POSTGRES_*` env vars are **initdb-time only** — they apply solely at first initialisation of an empty data dir, never to a running instance. (verified)

**Interpretation for audits:** a request to "add an init script to enable X on the live DB" is a category error — route runtime tuning to `command:`/mounted conf (compose change → `coder` + human restart), and schema/extension changes to an EF Core migration (`database-reviewer` + `coder`). Init scripts are only for bootstrapping a brand-new instance.

**Severity:** LOW (documentation/guidance); the misapplied-init-script itself causes no harm (it simply never runs) but signals a misunderstood change path.

**Remediation (runtime tuning via compose → `coder` + human restart):**

⚠️ HUMAN CONFIRMATION REQUIRED

```yaml
# docker-compose.yml, postgres service — runtime flags, NOT an init script:
command: ["postgres", "-c", "listen_addresses=*", "-c", "<flag>=<value>"]
```

---

## Battery order (for a container-ops review)

Run 1 → 6 in order. §1 (volume) and §5 (upgrade) are the data-safety core: never recommend an upgrade (§5) without first confirming §1 (data persisted on the named volume) and a verified backup (`postgres-backup-restore`). §2/§3/§6 are hygiene; §4 is policy. Cross-links: §2/§3/§6 remediations are compose changes → `coder`; §5 dump/restore recipes live in `postgres-backup-restore`; runtime server flags live in `postgres-performance-tuning`.
