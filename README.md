# OpenCode + Claude Code Setup

> My personal **OpenCode** and **Claude Code** configuration, kept public so I can sync it across machines — and so anyone curious can borrow what's useful. MIT licensed, fork freely. It evolves with my workflow, so treat it as a living reference rather than a stable distribution.

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![OpenCode](https://img.shields.io/badge/OpenCode-CLI-000)](https://opencode.ai)
[![Claude Code](https://img.shields.io/badge/Claude%20Code-mirror-d97757)](https://claude.com/claude-code)

### Want to try it? Jump to **[Public install](#public-install)** — it takes about five minutes.

---

## What's inside

A primary `build` agent backed by **12 specialist sub-agents** (planner, architect, coder, code/security/database review, TDD, build-fix, e2e, doc, refactor, git), wired together by:

- **Automatic sub-agent delegation** from `build` via the Task tool when work matches specialist scope, with a first-tool gate for open-weight models.
- **Slash commands** that force routing to the right specialist (`/plan`, `/tdd`, `/security`, `/code-review`, …).
- **Always-on skills** loaded at session start — Socratic design, security review, coding standards, git workflow, Serena bootstrap.
- **OpenCode plugins** — ECC hooks (Prettier + `tsc` on save), continuous-learning v2 (the *homunculus* instinct store), worktree spawner, auto-compact, caveman ultra mode, Figma RAG trigger, macOS notifications, startup bootstrap.
- **Custom tools** — `run-tests`, `check-coverage`, `security-audit`, plus a codemap generator.
- **A `.claude/` mirror** — hooks, rule packs, learned skills, and the shared homunculus store, so Claude Code benefits from the same guardrails.

The two halves stand alone. Use the OpenCode side, the Claude Code mirror, or both — whichever you'd find useful.

## Table of contents

- [Public install](#public-install)
- [English](#english)
  - [Goals](#goals-en)
  - [Repository layout](#layout-en)
  - [Configuration](#config-en)
  - [Agents](#agents-en)
  - [Slash commands](#commands-en)
  - [Skills](#skills-en)
  - [Plugins & hooks](#plugins-en)
  - [Custom tools](#tools-en)
  - [TUI plugins](#tui-en)
  - [Continuous learning](#learning-en)
  - [Claude Code mirror](#claude-en)
  - [How it fits together](#flow-en)
- [Français](#francais)
  - [Objectif](#objectif-fr)
  - [Structure du repo](#structure-fr)
  - [Configuration](#config-fr)
  - [Agents](#agents-fr)
  - [Commandes slash](#commands-fr)
  - [Skills](#skills-fr)
  - [Plugins & hooks](#plugins-fr)
  - [Outils custom](#tools-fr)
  - [TUI plugins](#tui-fr)
  - [Apprentissage continu](#learning-fr)
  - [Mirror Claude Code](#claude-fr)
  - [Comment tout s'emboite](#flow-fr)

---

<a id="public-install"></a>
## Public install

The repo is designed to *become* (or symlink into) `~/.config/opencode/`, plus an optional `~/.claude/` mirror. There are two paths: a one-shot script (recommended) and a manual walk-through if you want to see every step.

### Prerequisites

- macOS or Linux (the worktree and notification plugins assume macOS — works on Linux with minor degradation).
- [OpenCode CLI](https://opencode.ai) installed and on your `PATH`.
- [Claude Code](https://claude.com/claude-code) installed if you want the `.claude/` half.
- Either [Bun](https://bun.sh) (recommended — `bun.lock` is what's checked in) or Node.js 20+ with `npm`.
- `git`, plus `uv`/`uvx` for the Serena MCP server (`brew install uv` on macOS, or `pip install uv`).

### Quick install (script)

```bash
git clone https://github.com/fmflurry/settings-opencode.git ~/Workspace/settings-opencode
cd ~/Workspace/settings-opencode
./install.sh
```

`install.sh` is interactive by default. It will:

1. Verify your prerequisites (`git`, `bun`/`npm`, `uv`).
2. Symlink the repo into `~/.config/opencode` (backing up any existing config to `*.bak.<timestamp>`).
3. Run `bun install` (or `npm ci` if Bun isn't available).
4. Add the `OPENCODE_MODEL_*` and `OPENCODE_REASONING_*` defaults to your shell rc, fenced with markers so re-runs and uninstalls are idempotent.
5. Optionally symlink `.claude/` into `~/.claude` (skip with `--no-claude` if you only want the OpenCode half).
6. Print a smoke-test command and the locations to tweak afterwards.

Useful flags:

| Flag | Behaviour |
| ---- | --------- |
| _(none)_ | Interactive walk-through with `[Y/n]` prompts and sensible defaults. |
| `--yes`, `-y` | Non-interactive — accept all defaults. Still backs up existing dirs before clobbering. |
| `--no-claude` | Skip the `~/.claude` mirror (handy if you only use OpenCode, or want to manage Claude Code separately). |
| `--uninstall` | Remove the env-var block + the two symlinks. **Never deletes the cloned repo, your data, or `*.bak.*` backups.** |
| `--help`, `-h` | Print usage. |

The script writes a fenced block to your shell rc (`~/.zshrc`, `~/.bashrc`, or `~/.config/fish/config.fish`) that looks like this:

```bash
# >>> settings-opencode >>>
# Added by settings-opencode installer. Edit values to match your provider.
export OPENCODE_MODEL_PRIMARY="anthropic/claude-sonnet-4-6"
export OPENCODE_MODEL_SUBAGENT_PLANNER="anthropic/claude-opus-4-7"
export OPENCODE_MODEL_SUBAGENT_WORKER="anthropic/claude-sonnet-4-6"
export OPENCODE_MODEL_SUBAGENT_MINI="anthropic/claude-haiku-4-5"
export OPENCODE_REASONING_PRIMARY="high"
export OPENCODE_REASONING_SECONDARY="medium"
export OPENCODE_REASONING_TERTIARY="low"
# <<< settings-opencode <<<
```

Edit the values inside the markers to point at whichever provider you use. Re-running `./install.sh` rewrites the same block; `./install.sh --uninstall` removes it cleanly.

If your shell isn't bash/zsh/fish, the script prints the env block for you to paste manually and continues with the rest of the install.

### Manual install

<details>
<summary>Click to expand the step-by-step manual walk-through (same outcome as the script).</summary>

#### 1. Clone the repo into the OpenCode config dir

OpenCode loads `~/.config/opencode/opencode.jsonc` at startup, so the simplest install is to clone (or symlink) the repo there.

```bash
# Back up anything you already have there
mv ~/.config/opencode ~/.config/opencode.bak 2>/dev/null || true

# Clone
git clone https://github.com/fmflurry/settings-opencode.git ~/.config/opencode
cd ~/.config/opencode
```

Prefer keeping the repo elsewhere? Symlink it instead:

```bash
git clone https://github.com/fmflurry/settings-opencode.git ~/Workspace/settings-opencode
ln -s ~/Workspace/settings-opencode ~/.config/opencode
```

#### 2. Install plugin/tool dependencies

```bash
bun install        # uses bun.lock
# or
npm ci
```

#### 3. Set the model + reasoning environment variables

The `agent` block in `opencode.jsonc` is parameterized via env vars so you can swap providers without editing the config. Add these to your shell profile (`~/.zshrc`, `~/.bashrc`, etc.):

```bash
# Required (OpenCode model identifiers — adjust to whatever provider you use)
export OPENCODE_MODEL_PRIMARY="anthropic/claude-sonnet-4-6"
export OPENCODE_MODEL_SUBAGENT_PLANNER="anthropic/claude-opus-4-7"
export OPENCODE_MODEL_SUBAGENT_WORKER="anthropic/claude-sonnet-4-6"
export OPENCODE_MODEL_SUBAGENT_MINI="anthropic/claude-haiku-4-5"

# Reasoning effort tiers
export OPENCODE_REASONING_PRIMARY="high"
export OPENCODE_REASONING_SECONDARY="medium"
export OPENCODE_REASONING_TERTIARY="low"
```

If your provider doesn't support `reasoningEffort`, OpenCode silently ignores it — pick any value.

#### 4. Install MCP server prerequisites

`opencode.jsonc` declares four MCP servers. **Serena is required** — `instructions/serena.md` is loaded on every session and will fail to activate without it. The others are optional but documented here so you know what you're opting into.

| Server     | Install                                                                                       | Status                                                                       |
| ---------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| serena     | `pip install uv` (or `brew install uv`) — the config invokes `uvx --from git+https://github.com/oraios/serena serena start-mcp-server` | **Required.** IDE-grade semantic code retrieval used by `instructions/serena.md`. |
| context7   | nothing — `npx -y @upstash/context7-mcp@latest` is auto-installed at session start            | Live docs lookup. Auto-bootstraps on first use.                              |
| wallaby    | install [Wallaby.js](https://wallabyjs.com) and run `wallaby update-mcp`                      | Optional. Runtime-test introspection.                                        |
| Figma      | `enabled: false` by default                                                                   | Optional. Flip `enabled: true` and set up [Figma MCP](https://help.figma.com) for design-system tools. |

#### 5. (Optional) Install the Claude Code mirror

The repo ships a `.claude/` subtree. If you also use Claude Code, link or copy it into `~/.claude/`. The two halves don't depend on each other — install only what you need.

```bash
# Back up
mv ~/.claude ~/.claude.bak 2>/dev/null || true

# Symlink approach (recommended — stays in sync with the repo)
ln -s ~/.config/opencode/.claude ~/.claude

# Or copy approach (independent of the repo)
cp -R ~/.config/opencode/.claude ~/.claude
```

What this installs:

- `.claude/CLAUDE.md` — global user instructions Claude Code reads on every session.
- `.claude/settings.json` — permissions, hooks, env vars (`API_TIMEOUT_MS`, autocompact threshold, etc.).
- `.claude/hooks/*.sh` — pre-tool-use security warnings + stop hook.
- `.claude/rules/{common,typescript}/*.md` — coding-style/testing/security rule packs.
- `.claude/commands/*.md` — extra slash commands (`/create-pull-request`, `/curate-learned-skills`, `/update-codemaps`).
- `.claude/skills/**` — a curated catalog of "learned" skills (project-specific patterns, debugging recipes).
- `.claude/homunculus/` — the shared instinct store used by continuous-learning v2 (kept empty in fresh installs; populated by the OpenCode plugins as you work).

</details>

### Smoke test

```bash
opencode
```

You should see:

- The caveman ultra TUI sidebar plugin show up (or be silent if you're not in a caveman session).
- `instructions/serena.md` ask Serena to activate the project on first user message.
- The continuous-learning v2 injector preload high-confidence instincts into the system prompt.

Then drop a slash command:

```
/plan add a TODO list to my homepage
```

It should route to the `planner` sub-agent and return a structured plan without writing code.

### Updating

```bash
cd ~/.config/opencode
git pull
./install.sh --yes        # refreshes deps + env block; idempotent
# or, if you want to do it by hand:
# bun install   (or: npm ci)
```

If a new plugin shows up, OpenCode picks it up on the next restart. If an env var is added to `opencode.jsonc`, this README will mention it.

---

<a id="english"></a>
## English

Dotfiles for OpenCode + the stable parts of `~/.claude`. Ships a primary `build` agent, 12 specialist sub-agents, always-on skills, slash commands, OpenCode plugins (hooks, instincts, worktrees, auto-compact, caveman, figma RAG, notifications), custom tools, and a Claude Code mirror.

<a id="goals-en"></a>
### Goals

- Reproducibility: same agent behavior across machines/sessions.
- Quality: on-demand TDD, frequent verification, centralized conventions.
- Security: `security-review` skill loaded by default + pre-tool-use hooks.
- Continuous improvement: instincts captured into `~/.claude/homunculus`, surfaced into the system prompt on the next session.

<a id="layout-en"></a>
### Repository layout

- Configs: `opencode.jsonc`, `dcp.jsonc` (dynamic context pruning), `ocx.jsonc` (OCX registries), `tui.json` (TUI theme).
- Profiles: `profiles/<name>/` (per-profile overrides + `AGENTS.md`, run with `ocx opencode -p <name>`).
- Skills: `skills/*/SKILL.md` (plus auxiliary docs).
- Agent prompts: `prompts/agents/*.txt`.
- Slash commands: `commands/*.md`.
- OpenCode plugins: `plugins/*.{ts,js}` + `plugins/kdco-primitives/`, `plugins/worktree/`.
- TUI plugins: `tui-plugins/*.tsx`.
- Custom tools: `tools/*.ts`.
- Mode notes: `contexts/*.md`.
- Global instructions: `instructions/subagent-routing.md`, `instructions/serena.md`, `instructions/caveman-ultra.md`.
- Scripts: `scripts/setup-package-manager.js`, `scripts/codemaps/generate.ts`.
- Claude mirror: `.claude/CLAUDE.md`, `.claude/settings.json`, `.claude/hooks/`, `.claude/rules/`, `.claude/skills/`, `.claude/commands/`, `.claude/homunculus/`.
- Intentional exclusions (`.gitignore`): `.serena/` local MCP state, `node_modules/`, `.instinct-digest-state.json`, `antigravity-*`, `.DS_Store`, local `.env*` files except `.env.example`.

<a id="config-en"></a>
### Configuration: `opencode.jsonc`

Six concerns wired in one file:

1. `instructions`: always-on skills loaded at session start. Currently:
   - `instructions/subagent-routing.md` — Task-first subagent delegation gate.
   - `instructions/serena.md` — activates Serena MCP after the routing gate when specialist delegation does not apply.
   - `skills/socratic-design/SKILL.md` — evidence-first decision gating.
   - `skills/security-review/SKILL.md` — OWASP checklist.
   - `skills/coding-standards/SKILL.md` — code conventions.
   - `skills/git-workflow/SKILL.md` — branches, commits, PRs.
2. `default_agent`: `build`.
3. `agent`: sub-agent definitions (model + reasoning effort + prompt + tool allowlist). All models are env-driven (`OPENCODE_MODEL_*`, `OPENCODE_REASONING_*`) — see [Public install § 4](#public-install).
4. `command`: maps `/<name>` -> template + sub-agent + `subtask`.
5. `mcp`: serena, context7, wallaby, Figma (disabled).
6. `plugin`: external marketplace plugins (`@tarquinen/opencode-dcp@latest`).

`dcp.jsonc` configures the Dynamic Context Pruning plugin. `ocx.jsonc` registers OCX [registries](https://ocx.kdco.dev).

<a id="agents-en"></a>
### Agents

Defined in `opencode.jsonc` under `agent`:

| Agent                  | Mode     | Role                                                                                |
| ---------------------- | -------- | ----------------------------------------------------------------------------------- |
| `build`                | primary  | Orchestrator. Delegates all source-code edits to `coder`. Keeps edit perm for non-code (config/prompts/docs). |
| `planner`              | subagent | Plan + risks before large changes. Read+bash, no edit.                              |
| `architect`            | subagent | System design / scalability decisions. Read+bash only.                              |
| `coder`                | subagent | Pure non-test implementation. Mandatory build+lint+standards self-check before reporting done. Socratic ambiguity gate. |
| `code-reviewer`        | subagent | Quality review over diffs and conventions. Read-only — findings only; fixes go to `coder`. |
| `security-reviewer`    | subagent | OWASP/secrets/deps review. Read-only — reports vulnerabilities; remediation routed to `coder`. |
| `tdd-guide`            | subagent | RED -> GREEN -> REFACTOR + 80% coverage. Writes tests; delegates GREEN impl to `coder` via scoped Task perm. |
| `build-error-resolver` | subagent | Build/TS error fixes with minimal diffs.                                            |
| `e2e-runner`           | subagent | Playwright E2E tests.                                                               |
| `doc-updater`          | subagent | Documentation + codemaps.                                                           |
| `refactor-cleaner`     | subagent | Dead-code removal + consolidation.                                                  |
| `database-reviewer`    | subagent | PostgreSQL / Supabase schema, perf, security.                                       |
| `git-specialist`       | subagent | Branches, commits, pushes, PRs (mini model).                                        |

### Automatic sub-agent invocation

OpenCode exposes subagents to primary agents through the Task tool. `instructions/subagent-routing.md` enforces a Task-first gate before direct inspection for matching requests, and `prompts/agents/build.txt` repeats the routing rules for the `build` agent. This helps less inference-heavy models delegate without waiting for a slash command.

Use these paths depending on how much control you want:

- Plain request: lets `build` auto-delegate when routing rules match.
- `@agent` mention: manually invokes a specific subagent in the conversation.
- Slash command: forces a subtask with a configured template, e.g. `/plan`, `/tdd`, `/security`.

Why this exists: GPT/Claude often infer delegation from short descriptions, but open-source/open-weight models are more literal and tend to inspect with `bash`/Serena first. The top-level first-tool gate, routing prompt, and stronger `MUST delegate` agent descriptions make the same behavior more model-agnostic.

<a id="commands-en"></a>
### Slash commands

Templates in `commands/`. Most run as `subtask: true` (delegated to a specialist).

| Command               | Sub-agent             | Purpose                                          |
| --------------------- | --------------------- | ------------------------------------------------ |
| `/git`                | git-specialist        | Bounded git ops (branches, commits).             |
| `/push-changes`       | git-specialist        | Commit + push with upstream guard.               |
| `/plan`               | planner               | Implementation plan.                             |
| `/tdd`                | tdd-guide             | TDD cycle with coverage.                         |
| `/code-review`        | code-reviewer         | Quality review.                                  |
| `/security`           | security-reviewer     | Security audit.                                  |
| `/build-fix`          | build-error-resolver  | Build/TS error resolution.                       |
| `/e2e`                | e2e-runner            | E2E test generation/run.                         |
| `/refactor-clean`     | refactor-cleaner      | Dead-code cleanup.                               |
| `/orchestrate`        | planner               | Multi-agent orchestration.                       |
| `/update-docs`        | doc-updater           | Doc updates.                                     |
| `/update-codemaps`    | doc-updater           | Generates `docs/CODEMAPS/`.                      |
| `/test-coverage`      | tdd-guide             | Coverage analysis.                               |
| `/learn`              | (primary)             | Extract reusable patterns from the session.      |
| `/checkpoint`         | (primary)             | Save verification + progress state.              |
| `/verify`             | (primary)             | Verification loop.                               |
| `/eval`               | (primary)             | Evaluate against criteria.                       |
| `/setup-pm`           | (primary)             | Configure package manager.                       |
| `/skill-create`       | (primary)             | Generate a skill from git history.               |
| `/instinct-status`    | (primary)             | Inspect learned instincts.                       |
| `/instinct-import`    | (primary)             | Import instincts.                                |
| `/instinct-export`    | (primary)             | Export instincts.                                |
| `/evolve`             | (primary)             | Cluster instincts into skills.                   |

<a id="skills-en"></a>
### Skills

Always-on (declared in `instructions`):

- `skills/socratic-design/SKILL.md` — evidence-first decision gating.
- `skills/security-review/SKILL.md` — security checklist + scenarios.
- `skills/coding-standards/SKILL.md` — naming, immutability, file size, error handling.
- `skills/git-workflow/SKILL.md` — branches, conventional commits, push guards.
- `instructions/serena.md` — connects Serena MCP per session.

On-demand (loaded by description / by command):

- `skills/tdd-workflow/SKILL.md` — full TDD methodology.
- `skills/caveman/SKILL.md`, `caveman-commit`, `caveman-review` — terse mode.
- `skills/strategic-compact/SKILL.md` — manual compaction at logical breakpoints.
- `skills/dotnet-clean-architecture/SKILL.md` (+ playbooks) — .NET 8 BFF scaffolding.
- `skills/angular-clean-architecture/SKILL.md` (+ store, migration, testing) — Angular 18 standalone scaffolding.
- `skills/angular-accessibility/SKILL.md` — Angular ARIA audit.
- `skills/compress/SKILL.md` — context compression.
- `skills/flurryx/SKILL.md` — domain-specific patterns.
- `skills/continuous-learning/SKILL.md` — learned-draft schema.
- `skills/learned/` — auto-generated drafts from the stop hook.

<a id="plugins-en"></a>
### Plugins & hooks

All TypeScript plugins use `@opencode-ai/plugin@1.4.6`.

- `plugins/ecc-hooks.ts` — Prettier on edited JS/TS, `console.log` detection, `tsc --noEmit` after edit, sensitive-command reminders (`git push` etc.).
- `plugins/instinct-injector.ts` — reads `~/.claude/homunculus`, filters by confidence, injects instincts into the system prompt (continuous-learning v2 read side).
- `plugins/instinct-observer.ts` — captures `tool.execute.before/after` events and appends to `observations.jsonl` (write side).
- `plugins/instinct-digest.ts` — session-start diff: surfaces new/updated instincts since last session.
- `plugins/continuous-learning-stop-hook.js` — legacy v1 stop hook, calls `skills/continuous-learning/bin/evaluate-session.js` to write a draft into `skills/learned/`.
- `plugins/auto-compact.js` — auto-compacts once `OC_COMPACT_THRESHOLD` tool calls are reached, only while idle.
- `plugins/notification.js` — macOS notification + sound on `session.idle`.
- `plugins/caveman-server.ts` + `tui-plugins/caveman.tsx` — injects caveman instructions into the system prompt + TUI sidebar showing active mode.
- `plugins/figma-mcp-trigger.js` — Figma RAG: reads `figma-rag.md` (or `OPENCODE_FIGMA_RAG_PATHS`) and injects snippets when designs are referenced.
- `plugins/worktree.ts` (+ `plugins/worktree/`) — creates an isolated git worktree for the session and spawns a terminal (mac/Win/Linux). Inspired by opencode-worktree-session.
- `plugins/startup-bootstrap.ts` — runs `serena_activate_project` on the first tool call of a session.
- `plugins/kdco-primitives/` — shared utilities (mutex, shell, terminal-detect, project-id resolver, types).
- `@tarquinen/opencode-dcp@latest` *(external, declared in `opencode.jsonc › plugin`)* — Dynamic Context Pruning. Trims stale tool results and large files from the live context window so long sessions don't blow past the model's limit. Configured via `dcp.jsonc` at the repo root.

<a id="tools-en"></a>
### Custom tools (`tools/`)

Reusable OpenCode tools exposed via `tools/index.ts`:

- `tools/run-tests.ts` — detects package manager + framework and builds the test command.
- `tools/check-coverage.ts` — reads coverage reports and compares against a threshold.
- `tools/security-audit.ts` — scans deps + secrets + risky patterns.

<a id="tui-en"></a>
### TUI plugins

`tui-plugins/caveman.tsx` — React sidebar that shows a "CAVEMAN ULTRA" badge when the mode is active (flag file written by `caveman-server.ts`).

<a id="learning-en"></a>
### Continuous learning

Two pipelines coexist (backwards compat):

1. **v1 (legacy)** — `plugins/continuous-learning-stop-hook.js` -> `skills/continuous-learning/stop.sh` -> `skills/continuous-learning/bin/evaluate-session.js` writes at most one draft into `skills/learned/`.
2. **v2 (homunculus, shared with Claude Code)** — `plugins/instinct-observer.ts` writes to `~/.claude/homunculus/projects/<id>/observations.jsonl`. A daemon (ECC side) clusters observations into instincts. `plugins/instinct-injector.ts` injects them into the system prompt. `plugins/instinct-digest.ts` produces a session-start diff.

Curation:

- `/curate-learned-skills` (Claude Code side) — reviews drafts in `learned/` and promotes the valuable ones into real skills.
- `/instinct-status` / `/evolve` — inspect and evolve instincts into skills.

<a id="claude-en"></a>
### Claude Code mirror (`.claude/`)

- `CLAUDE.md` — global user instructions (no `any`, facade != UseCase).
- `settings.json` — allow/deny permissions, env (`API_TIMEOUT_MS=3000000`, `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1`, `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=80`), `PreToolUse` / `PostToolUse` / `Stop` hooks.
- `hooks/pre-tool-use.sh` — warning-only checks on sensitive commands/files.
- `hooks/stop.sh` — Claude Code stop hook.
- `rules/common/*.md` + `rules/typescript/*.md` — rule packs (style, testing, security, patterns, hooks, agents).
- `commands/{create-pull-request,curate-learned-skills,update-codemaps}.md` — Claude commands.
- `skills/**` — curated catalog of "learned" skills.
- `homunculus/{instincts,evolved,observations.archive}` — store shared with OpenCode.

<a id="flow-en"></a>
### How it fits together

1. Startup: OpenCode loads `opencode.jsonc` -> always-on instructions -> `instinct-injector` preloads instincts -> `instinct-digest` produces a diff -> `caveman-server` adds caveman preamble if active.
2. First user action: `startup-bootstrap` triggers `serena_activate_project`.
3. Dev: `build` executes. `ecc-hooks` formats / type-checks / flags `console.log`. `instinct-observer` archives events.
4. Workflow: `build` auto-delegates to specialists through Task; `/plan`, `/tdd`, `/security`, etc. force the same routing explicitly.
5. Idle: `auto-compact` triggers when the tool-call threshold is reached; `notification` pings macOS.
6. Stop: v1 hook writes a draft; v2 daemon clusters observations into instincts for the next session.

---

<a id="francais"></a>
## Français

Depot "dotfiles" pour OpenCode + la partie stable de `~/.claude`. Embarque un agent principal `build`, douze sous-agents specialises, des skills toujours actives, des commandes slash, des plugins (hooks, instincts, worktrees, auto-compact, caveman, figma RAG), des outils custom et un mirror Claude Code.

<a id="objectif-fr"></a>
### Objectif

- Reproductibilite: meme comportement entre machines/sessions.
- Qualite: TDD a la demande, verification reguliere, conventions centralisees.
- Securite: skill `security-review` chargee par defaut + hooks pre-tool-use.
- Apprentissage continu: capture automatique des "instincts" dans `~/.claude/homunculus`, surface dans le system prompt a la session suivante.

<a id="structure-fr"></a>
### Structure du repo

- Configs: `opencode.jsonc`, `dcp.jsonc` (dynamic context pruning), `ocx.jsonc` (registries OCX), `tui.json` (theme TUI).
- Profils: `profiles/<name>/` (override `opencode.jsonc` + `AGENTS.md` par profil, lance via `ocx opencode -p <name>`).
- Skills: `skills/*/SKILL.md` (+ ressources auxiliaires).
- Prompts agents: `prompts/agents/*.txt`.
- Commandes slash: `commands/*.md`.
- Plugins OpenCode: `plugins/*.{ts,js}` (+ `plugins/kdco-primitives/`, `plugins/worktree/`).
- TUI plugins: `tui-plugins/*.tsx` (sidebar React rendue par OpenCode).
- Outils custom: `tools/*.ts`.
- Contextes (memos de mode): `contexts/*.md`.
- Instructions globales: `instructions/subagent-routing.md`, `instructions/serena.md`, `instructions/caveman-ultra.md`.
- Scripts: `scripts/setup-package-manager.js`, `scripts/codemaps/generate.ts`.
- Mirror Claude Code: `.claude/CLAUDE.md`, `.claude/settings.json`, `.claude/hooks/`, `.claude/rules/`, `.claude/skills/`, `.claude/commands/`, `.claude/homunculus/`.
- Exclusions volontaires (`.gitignore`): etat MCP local `.serena/`, `node_modules/`, `.instinct-digest-state.json`, `antigravity-*`, `.DS_Store`, fichiers locaux `.env*` sauf `.env.example`.

<a id="config-fr"></a>
### Configuration: `opencode.jsonc`

Le fichier orchestre six choses:

1. `instructions`: skills toujours chargees au demarrage. Aujourd'hui:
   - `instructions/subagent-routing.md` -> gate Task-first pour delegation sous-agent.
   - `instructions/serena.md` -> active Serena MCP apres le gate de routage quand la delegation specialiste ne s'applique pas.
   - `skills/socratic-design/SKILL.md` -> gating evidence-first sur les decisions design.
   - `skills/security-review/SKILL.md` -> checklist OWASP.
   - `skills/coding-standards/SKILL.md` -> conventions code.
   - `skills/git-workflow/SKILL.md` -> branches, commits, PRs.
2. `default_agent`: `build`.
3. `agent`: definitions des sous-agents (modele + reasoning effort + prompt + outils autorises). Tous les modeles passent par variables d'environnement (`OPENCODE_MODEL_*`, `OPENCODE_REASONING_*`).
4. `command`: mappe `/<name>` -> template + sous-agent + `subtask` (delegation).
5. `mcp`: serena, context7, wallaby, Figma (desactive par defaut).
6. `plugin`: marketplace plugins externes (`@tarquinen/opencode-dcp@latest`).

`dcp.jsonc` configure le plugin Dynamic Context Pruning. `ocx.jsonc` declare les registries pour le wrapper [OCX](https://ocx.kdco.dev).

<a id="agents-fr"></a>
### Agents

Definis dans `opencode.jsonc` (champ `agent`):

| Agent                  | Mode      | Role                                                                                  |
| ---------------------- | --------- | ------------------------------------------------------------------------------------- |
| `build`                | primary   | Orchestrateur. Delegue toute ecriture de code source au `coder`. Garde l'edit pour non-code (config/prompts/docs). |
| `planner`              | subagent  | Plan + risques avant grosse modif. Read+bash, pas d'edit.                             |
| `architect`            | subagent  | Decisions de design / scalabilite. Read+bash uniquement.                              |
| `coder`                | subagent  | Implementation pure (hors tests). Verification build+lint+standards obligatoire avant de rendre. Gate socratique en cas d'ambiguite. |
| `code-reviewer`        | subagent  | Revue qualite (diff, conventions, tests). Read-only — findings seulement; les fixes passent par `coder`. |
| `security-reviewer`    | subagent  | Revue OWASP/secrets/deps. Read-only — rapporte les vulnerabilites; remediation routee vers `coder`. |
| `tdd-guide`            | subagent  | RED -> GREEN -> REFACTOR + 80% coverage. Ecrit les tests; delegue le GREEN au `coder` via permission Task ciblee. |
| `build-error-resolver` | subagent  | Fix build/TS errors avec diff minimal.                                                |
| `e2e-runner`           | subagent  | Tests E2E Playwright.                                                                 |
| `doc-updater`          | subagent  | Documentation et codemaps.                                                            |
| `refactor-cleaner`     | subagent  | Suppression code mort + consolidation.                                                |
| `database-reviewer`    | subagent  | PostgreSQL / Supabase: schema, perfs, securite.                                       |
| `git-specialist`       | subagent  | Branches, commits, push, PRs (modele mini).                                           |

### Invocation automatique des sous-agents

OpenCode expose les sous-agents aux agents primaires via le Task tool. `instructions/subagent-routing.md` impose un gate Task-first avant inspection directe quand une demande matche un specialiste, et `prompts/agents/build.txt` repete les regles pour l'agent `build`.

Chemins possibles:

- Requete normale: `build` auto-delegue quand une regle de routage matche.
- Mention `@agent`: invoque manuellement un sous-agent precis.
- Commande slash: force un subtask avec template configure, par ex. `/plan`, `/tdd`, `/security`.

Pourquoi: GPT/Claude inferent souvent la delegation depuis des descriptions courtes, mais les modeles open-source/open-weight sont plus litteraux et inspectent souvent avec `bash`/Serena avant de deleguer. Le gate top-level, le prompt de routage, et les descriptions `MUST delegate` rendent le comportement plus portable entre modeles.

<a id="commands-fr"></a>
### Commandes slash

Templates dans `commands/`. La plupart sont `subtask: true` -> elles s'executent dans un sous-agent isolé.

| Commande              | Sous-agent          | But                                                |
| --------------------- | ------------------- | -------------------------------------------------- |
| `/git`                | git-specialist      | Operations git encadrees (branche/commit).         |
| `/push-changes`       | git-specialist      | Commit + push (avec garde sur upstream).           |
| `/plan`               | planner             | Plan d'implementation.                             |
| `/tdd`                | tdd-guide           | Cycle TDD avec coverage.                           |
| `/code-review`        | code-reviewer       | Revue qualite.                                     |
| `/security`           | security-reviewer   | Audit securite.                                    |
| `/build-fix`          | build-error-resolver | Resolution build/TS errors.                       |
| `/e2e`                | e2e-runner          | Generation/run tests E2E.                          |
| `/refactor-clean`     | refactor-cleaner    | Nettoyage code mort.                               |
| `/orchestrate`        | planner             | Orchestration multi-agents.                        |
| `/update-docs`        | doc-updater         | Mise a jour de la doc.                             |
| `/update-codemaps`    | doc-updater         | Genere `docs/CODEMAPS/`.                           |
| `/test-coverage`      | tdd-guide           | Analyse coverage.                                  |
| `/learn`              | (primary)           | Extrait patterns reutilisables de la session.      |
| `/checkpoint`         | (primary)           | Sauvegarde verification + progress.                |
| `/verify`             | (primary)           | Boucle de verification.                            |
| `/eval`               | (primary)           | Evaluation contre criteres.                        |
| `/setup-pm`           | (primary)           | Configure le package manager.                      |
| `/skill-create`       | (primary)           | Genere une skill depuis l'historique git.          |
| `/instinct-status`    | (primary)           | Affiche les instincts appris.                      |
| `/instinct-import`    | (primary)           | Import d'instincts.                                |
| `/instinct-export`    | (primary)           | Export d'instincts.                                |
| `/evolve`             | (primary)           | Cluster instincts -> skills.                       |

<a id="skills-fr"></a>
### Skills

Skills toujours actives (declared dans `instructions`):

- `skills/socratic-design/SKILL.md` — decision-gating "evidence-first".
- `skills/security-review/SKILL.md` — checklist securite + scenarios.
- `skills/coding-standards/SKILL.md` — naming, immutabilite, taille fichier, error handling.
- `skills/git-workflow/SKILL.md` — branches, conventional commits, garde-fous push.
- `instructions/serena.md` — connecte Serena MCP a chaque session.

Skills sur demande (chargees par leur description / par une commande):

- `skills/tdd-workflow/SKILL.md` — methode TDD detaillee.
- `skills/caveman/SKILL.md`, `caveman-commit`, `caveman-review` — mode terse.
- `skills/strategic-compact/SKILL.md` — compaction manuelle aux paliers logiques.
- `skills/dotnet-clean-architecture/SKILL.md` (+ playbooks) — scaffold .NET 8 BFF.
- `skills/angular-clean-architecture/SKILL.md` (+ store, migration, tests) — scaffold Angular 18 standalone.
- `skills/angular-accessibility/SKILL.md` — audit ARIA Angular.
- `skills/compress/SKILL.md` — compression de contexte.
- `skills/flurryx/SKILL.md` — patterns specifiques.
- `skills/continuous-learning/SKILL.md` — schema des drafts learned.
- `skills/learned/` — drafts produits par le stop-hook.

<a id="plugins-fr"></a>
### Plugins & hooks

Tous les plugins TypeScript utilisent `@opencode-ai/plugin@1.4.6`.

- `plugins/ecc-hooks.ts` — Prettier sur fichiers JS/TS edites, detection `console.log`, `tsc --noEmit` post-edit, rappels sur commandes sensibles (`git push` etc.).
- `plugins/instinct-injector.ts` — lit `~/.claude/homunculus`, filtre par confidence, injecte les instincts dans le system prompt (continuous-learning v2 read-side).
- `plugins/instinct-observer.ts` — capture les events `tool.execute.before/after` et append dans `observations.jsonl` (write-side).
- `plugins/instinct-digest.ts` — diff session-start: surface les instincts nouveaux/modifies depuis la derniere session.
- `plugins/continuous-learning-stop-hook.js` — stop hook v1 (legacy) qui appelle `skills/continuous-learning/bin/evaluate-session.js` pour produire un draft dans `skills/learned/`.
- `plugins/auto-compact.js` — auto-compaction quand `OC_COMPACT_THRESHOLD` est atteint, en idle uniquement.
- `plugins/notification.js` — notification macOS (osascript + Glass.aiff) sur `session.idle`.
- `plugins/caveman-server.ts` + `tui-plugins/caveman.tsx` — injecte les instructions caveman dans le system prompt + sidebar TUI qui affiche le mode actif.
- `plugins/figma-mcp-trigger.js` — RAG figma: lit `figma-rag.md` (ou `OPENCODE_FIGMA_RAG_PATHS`) et injecte des snippets quand des designs sont referencés.
- `plugins/worktree.ts` (+ `plugins/worktree/`) — cree un git worktree isolé pour la session et spawn un terminal (mac/Win/Linux). Inspiré d'opencode-worktree-session.
- `plugins/startup-bootstrap.ts` — declenche `serena_activate_project` la premiere fois qu'un outil est appelé dans la session.
- `plugins/kdco-primitives/` — utilities partages (mutex, shell, terminal-detect, project-id resolver, types).
- `@tarquinen/opencode-dcp@latest` *(externe, declare dans `opencode.jsonc › plugin`)* — Dynamic Context Pruning. Coupe les tool results stagnants et les gros fichiers dans la fenetre de contexte pour que les sessions longues ne depassent pas la limite modele. Configure via `dcp.jsonc` a la racine du repo.

<a id="tools-fr"></a>
### Outils custom (`tools/`)

Outils OpenCode reutilisables exposes via `tools/index.ts`:

- `tools/run-tests.ts` — detecte package manager + framework et construit la commande de test.
- `tools/check-coverage.ts` — lit les rapports coverage et compare a un seuil.
- `tools/security-audit.ts` — scan deps + secrets + patterns a risque.

<a id="tui-fr"></a>
### TUI plugins

`tui-plugins/caveman.tsx` — sidebar React qui affiche un badge "CAVEMAN ULTRA" quand le mode est actif (drapeau ecrit par `caveman-server.ts`).

<a id="learning-fr"></a>
### Apprentissage continu

Deux pipelines coexistent (compatibilite ascendante):

1. **v1 (legacy)** — `plugins/continuous-learning-stop-hook.js` -> `skills/continuous-learning/stop.sh` -> `skills/continuous-learning/bin/evaluate-session.js` ecrit au plus un draft dans `skills/learned/`.
2. **v2 (homunculus, partagé avec Claude Code)** — `plugins/instinct-observer.ts` ecrit dans `~/.claude/homunculus/projects/<id>/observations.jsonl`. Un daemon (cote ECC) cluster les observations en "instincts". `plugins/instinct-injector.ts` les injecte dans le system prompt. `plugins/instinct-digest.ts` produit un diff session-start.

Curation:

- `/curate-learned-skills` (cote Claude Code) — relit les drafts dans `learned/` et promeut les bons en vraies skills.
- `/instinct-status` / `/evolve` — inspecte et fait evoluer les instincts en skills.

<a id="claude-fr"></a>
### Mirror Claude Code (`.claude/`)

- `CLAUDE.md` — instructions globales (no `any`, facade != UseCase).
- `settings.json` — permissions allow/deny, env vars (`API_TIMEOUT_MS=3000000`, `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1`, `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=80`), hooks `PreToolUse` / `PostToolUse` / `Stop`.
- `hooks/pre-tool-use.sh` — warnings sur commandes/fichiers sensibles (warn only).
- `hooks/stop.sh` — stop hook Claude Code.
- `rules/common/*.md` + `rules/typescript/*.md` — packs de regles (style, tests, securite, patterns, hooks, agents).
- `commands/{create-pull-request,curate-learned-skills,update-codemaps}.md` — commandes Claude.
- `skills/**` — catalogue de skills "learned" (debugging, project-specific, user-corrections).
- `homunculus/{instincts,evolved,observations.archive}` — store partagé avec OpenCode.

<a id="flow-fr"></a>
### Comment tout s'emboite

1. Demarrage: OpenCode charge `opencode.jsonc` -> instructions globales -> plugin `instinct-injector` injecte les instincts -> `instinct-digest` produit un diff -> `caveman-server` ajoute le preamble si actif.
2. Premiere action utilisateur: `startup-bootstrap` declenche `serena_activate_project`.
3. Dev: `build` execute. `ecc-hooks` formate / type-check / loue les `console.log`. `instinct-observer` archive les events.
4. Workflow: `build` auto-delegue aux specialistes via Task; `/plan`, `/tdd`, `/security`, etc. forcent explicitement le meme routage.
5. Idle: `auto-compact` declenche un compact quand le seuil de tool calls est atteint. `notification` ping macOS.
6. Stop: hook v1 produit un draft, hook v2 cluster les observations en instincts pour la session suivante.
