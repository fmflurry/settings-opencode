# OpenCode Setup (This Repo)

This repository is a versioned OpenCode configuration: agents, skills, slash commands, plugins/hooks, and custom tools.

## Table of contents

- [Français](#francais)
  - [Plan de lecture](#plan-fr)
  - [Objectif](#objectif-fr)
  - [Structure du repo](#structure-fr)
  - [Installation](#installation-fr)
  - [Configuration](#config-fr)
  - [Agents](#agents-fr)
  - [Commandes slash](#commands-fr)
  - [Skills](#skills-fr)
  - [Plugins & hooks](#plugins-fr)
  - [Outils custom](#tools-fr)
  - [Apprentissage continu](#learning-fr)
  - [Comment tout s'emboite](#flow-fr)
- [English](#english)
  - [Reading plan](#plan-en)
  - [Goals](#goals-en)
  - [Repository layout](#layout-en)
  - [Install](#install-en)
  - [Configuration](#config-en)
  - [Agents](#agents-en)
  - [Slash commands](#commands-en)
  - [Skills](#skills-en)
  - [Plugins & hooks](#plugins-en)
  - [Custom tools](#tools-en)
  - [Continuous learning](#learning-en)
  - [How it fits together](#flow-en)

<a id="francais"></a>
## Français

Ce depot est un "dotfiles repo" pour OpenCode. Il versionne une configuration complete (agent principal + sous-agents), des skills (regles de qualite), des commandes slash, des plugins (hooks) et des outils custom.

<a id="plan-fr"></a>
### Plan de lecture (navigation)

- [Objectif](#objectif-fr)
- [Structure du repo](#structure-fr)
- [Installation](#installation-fr)
- [Configuration: `opencode.jsonc`](#config-fr)
- [Agents: qui fait quoi](#agents-fr)
- [Commandes slash: comment deleguer](#commands-fr)
- [Skills: le contrat de qualite](#skills-fr)
- [Plugins & hooks: garde-fous](#plugins-fr)
- [Outils custom: tests/coverage/audit](#tools-fr)
- [Apprentissage continu: stop hook](#learning-fr)
- [Comment tout s'emboite](#flow-fr)

<a id="objectif-fr"></a>
### Objectif

- Reproductibilite: meme comportement d'agent entre machines/sessions.
- Qualite: TDD par defaut et verification reguliere.
- Securite: reduction du risque (secrets, validation, patterns OWASP).
- Coherence: conventions de code centralisees (naming, types, pratiques).
- Amelioration continue: extraction de patterns reutilisables a la fin des sessions.

<a id="structure-fr"></a>
### Structure du repo

- Entree: `opencode.jsonc`
- Skills (instructions): `skills/*/SKILL.md`
- Prompts agents: `prompts/agents/*.txt`
- Commandes slash (templates): `commands/*.md`
- Plugins / hooks: `plugins/*`
- Outils custom (OpenCode tools): `tools/*.ts`
- Contextes (memos de mode): `contexts/*.md`
- Scripts utilitaires: `scripts/*`

<a id="installation-fr"></a>
### Installation

1. Placer ce depot dans `~/.config/opencode/` (clone direct) ou creer un lien symbolique vers ce dossier.
2. Installer les dependances (plugins/outils):

```bash
npm ci
```

3. Lancer OpenCode: il charge `~/.config/opencode/opencode.jsonc` et les fichiers references.

<a id="config-fr"></a>
### Configuration: `opencode.jsonc`

`opencode.jsonc` est la couche "wiring":

- `instructions`: charge des skills globaux au debut de chaque session.
  - Dans ce setup: `skills/tdd-workflow/SKILL.md`, `skills/security-review/SKILL.md`, `skills/coding-standards/SKILL.md`, `skills/learned-skillbook/SKILL.md`.
- `default_agent`: `build` (agent principal pour la plupart des taches).
- `agent`: definit les sous-agents specialises (planning, review, securite, TDD, etc.) et leurs prompts (`prompts/agents/*.txt`).
- `command`: mappe des slash commands (`/plan`, `/tdd`, `/security`, ...) vers des templates dans `commands/*.md`.
  - "subtask": la commande est executee par un sous-agent specialise.
- `mcp`: liste des MCP servers (local/remote). Les champs sensibles sont volontairement vides: a configurer via variables d'environnement / config locale non versionnee.

Pourquoi ce design: `opencode.jsonc` fait l'orchestration (qui + quand), tandis que `skills/` fixe les regles transverses (comment), et `commands/` capture les workflows repetables.

<a id="agents-fr"></a>
### Agents: qui fait quoi

- Agent principal: `build`
  - optimise pour "livrer": lecture/edition/fichiers + bash.
- Sous-agents (exemples):
  - `planner`: produit un plan (et les risques) avant une grosse modif.
  - `tdd-guide`: force le cycle RED->GREEN->REFACTOR et la couverture.
  - `code-reviewer`: revue qualite (diff, conventions, tests, risques).
  - `security-reviewer`: revue OWASP/secrets/deps.

Pourquoi: tu gardes un agent principal stable, et tu "switch" de specialiste via des commandes plutot que de melanger planning, implementation, review et securite dans un seul flux mental.

<a id="commands-fr"></a>
### Commandes slash: comment deleguer

Les commandes dans `commands/*.md` sont des templates utilises par OpenCode.

- Exemples: `/plan`, `/tdd`, `/code-review`, `/security`, `/build-fix`, `/e2e`.
- Ces templates definissent un format et un workflow (ex: `/plan` impose d'attendre une confirmation avant de coder).

Pourquoi: eviter de "reinventer" la procedure (plan, verif, review) et rendre les sorties scannables.

<a id="skills-fr"></a>
### Skills: le contrat de qualite

Les skills dans `skills/` sont chargees via `instructions`.

- `skills/tdd-workflow/SKILL.md`: tests avant code, strategie unit/integration/e2e, cible 80%+.
- `skills/security-review/SKILL.md`: checklist securite (secrets, validation, authz, XSS/CSRF, deps).
- `skills/coding-standards/SKILL.md`: conventions TypeScript/JS (naming, immutabilite, erreurs, perf).
- `skills/learned-skillbook/SKILL.md`: bundle de patterns "learned" curates.

Pourquoi: les skills sont le garde-fou "toujours actif". Les commandes changent le mode de travail, mais les skills restent le cadre.

<a id="plugins-fr"></a>
### Plugins & hooks: garde-fous

Les fichiers `plugins/` sont des plugins OpenCode (base: `@opencode-ai/plugin`) qui s'accrochent aux evenements (edition de fichier, execution d'outil, fin de session, etc.).

- `plugins/ecc-hooks.ts`:
  - format automatique (Prettier) quand possible sur fichiers JS/TS
  - detection et audit de `console.log` sur les fichiers touches
  - check TypeScript (`npx tsc --noEmit`) apres edition de `.ts/.tsx`
  - rappels de prudence sur commandes sensibles (ex: `git push`)

Pourquoi: boucle de feedback courte (format/tsc/logs) pour reduire les allers-retours en fin de tache.

<a id="tools-fr"></a>
### Outils custom: tests/coverage/audit

`tools/` implemente des "OpenCode tools" re-utilisables:

- `tools/run-tests.ts`: construit une commande de test adaptee (pm + framework).
- `tools/check-coverage.ts`: lit les rapports de couverture et compare a un seuil.
- `tools/security-audit.ts`: scan deps + secrets + patterns a risque.

Pourquoi: standardiser les verifications et eviter les checks oublies.

Bonus navigation:

- `scripts/codemaps/generate.ts`: genere des codemaps dans `docs/CODEMAPS/` pour naviguer rapidement un gros repo.

<a id="learning-fr"></a>
### Apprentissage continu: stop hook

But: transformer une session "utile" en patterns reutilisables.

- `plugins/continuous-learning-stop-hook.js` declenche un stop hook a la fin d'une session.
- Il appelle `skills/continuous-learning/hooks/stop.sh` -> `skills/continuous-learning/stop.sh`.
- `skills/continuous-learning/bin/evaluate-session.js`:
  - recupere la transcription (fichier si dispo, sinon via session id)
  - detecte des patterns (debug, corrections user, conventions, etc.)
  - ecrit des drafts dans `~/.config/opencode/skills/learned/` selon `skills/continuous-learning/config.json`

Pourquoi: capturer automatiquement les "bonnes manieres" observees, puis les reincorporer dans le contexte via `skills/learned-skillbook/SKILL.md`.

<a id="flow-fr"></a>
### Comment tout s'emboite

1. Tu demarres une tache: l'agent `build` travaille avec les skills globales chargees.
2. Tu actives un workflow via une commande (`/plan`, `/tdd`, `/security`, ...): OpenCode route vers le bon sous-agent + template.
3. Pendant l'implementation: les plugins appliquent les hooks (format, check TS, audits).
4. Fin de session: le stop hook peut extraire des learnings (draft skills) pour renforcer le setup.

<a id="english"></a>
## English

This is an OpenCode dotfiles repo. It versions a complete setup: main + specialist agents, global skills (quality rules), slash-command templates, plugins/hooks, and custom tools.

<a id="plan-en"></a>
### Reading plan (navigation)

- [Goals](#goals-en)
- [Repository layout](#layout-en)
- [Install](#install-en)
- [Configuration: `opencode.jsonc`](#config-en)
- [Agents: who does what](#agents-en)
- [Slash commands: delegating workflows](#commands-en)
- [Skills: the quality contract](#skills-en)
- [Plugins & hooks: guardrails](#plugins-en)
- [Custom tools: tests/coverage/audit](#tools-en)
- [Continuous learning: stop hook](#learning-en)
- [How it fits together](#flow-en)

<a id="goals-en"></a>
### Goals

- Reproducibility: same agent behavior across machines/sessions.
- Quality: default TDD posture and frequent verification.
- Security: reduce risk (secrets, validation, OWASP patterns).
- Consistency: centralized conventions (naming, types, practices).
- Continuous improvement: extract reusable patterns at session end.

<a id="layout-en"></a>
### Repository layout

- Entry point: `opencode.jsonc`
- Skills (instructions): `skills/*/SKILL.md`
- Agent prompts: `prompts/agents/*.txt`
- Slash commands (templates): `commands/*.md`
- Plugins / hooks: `plugins/*`
- Custom tools (OpenCode tools): `tools/*.ts`
- Context notes (mode memos): `contexts/*.md`
- Utility scripts: `scripts/*`

<a id="install-en"></a>
### Install

1. Put this repo at `~/.config/opencode/` (direct clone) or symlink it there.
2. Install dependencies (plugins/tools):

```bash
npm ci
```

3. Start OpenCode: it will load `~/.config/opencode/opencode.jsonc` and referenced files.

<a id="config-en"></a>
### Configuration: `opencode.jsonc`

`opencode.jsonc` is the wiring layer:

- `instructions`: loads global skills at the start of every session.
- `default_agent`: `build` (primary agent for most work).
- `agent`: declares specialist sub-agents and points them to `prompts/agents/*.txt`.
- `command`: maps slash commands (`/plan`, `/tdd`, `/security`, ...) to `commands/*.md` templates.
  - When `subtask: true`, the command runs under a specialist sub-agent.
- `mcp`: MCP servers (local/remote). Sensitive fields are intentionally blank: configure them via env vars / local untracked config.

Why this design: `opencode.jsonc` orchestrates (who/when), `skills/` defines cross-cutting rules (how), and `commands/` captures repeatable workflows.

<a id="agents-en"></a>
### Agents: who does what

- Primary agent: `build` (shipping-focused).
- Specialist examples:
  - `planner`: produces a plan + risks before large changes.
  - `tdd-guide`: enforces RED->GREEN->REFACTOR and coverage.
  - `code-reviewer`: quality review over diffs and conventions.
  - `security-reviewer`: OWASP/secrets/deps review.

Why: keep the main agent stable, and switch to specialists via commands instead of blending planning/implementation/review/security into one mode.

<a id="commands-en"></a>
### Slash commands: delegating workflows

`commands/*.md` are templates consumed by OpenCode.

- Examples: `/plan`, `/tdd`, `/code-review`, `/security`, `/build-fix`, `/e2e`.
- The templates define expected output + procedure (e.g. `/plan` requires explicit confirmation before coding).

Why: avoid re-inventing the process and make outputs consistent and easy to scan.

<a id="skills-en"></a>
### Skills: the quality contract

Skills are loaded via `instructions` and apply continuously.

- `skills/tdd-workflow/SKILL.md`: tests-first, unit/integration/e2e strategy, 80%+ target.
- `skills/security-review/SKILL.md`: security checklist (secrets, validation, authz, XSS/CSRF, deps).
- `skills/coding-standards/SKILL.md`: TypeScript/JS conventions.
- `skills/learned-skillbook/SKILL.md`: curated bundle of learned patterns.

Why: commands change the workflow, but skills define the baseline expectations.

<a id="plugins-en"></a>
### Plugins & hooks: guardrails

Files in `plugins/` are OpenCode plugins (via `@opencode-ai/plugin`) that hook into events (file edits, tool execution, session lifecycle).

- `plugins/ecc-hooks.ts`:
  - optional Prettier formatting on edited JS/TS files
  - `console.log` detection + idle audit on touched files
  - TypeScript check (`npx tsc --noEmit`) after editing `.ts/.tsx`
  - reminders for sensitive commands (e.g. `git push`)

Why: shorten feedback loops (format/tsc/log hygiene) and reduce end-of-task cleanup.

<a id="tools-en"></a>
### Custom tools: tests/coverage/audit

`tools/` implements reusable OpenCode tools:

- `tools/run-tests.ts`: builds a test command based on package manager + test framework.
- `tools/check-coverage.ts`: reads coverage reports and compares against a threshold.
- `tools/security-audit.ts`: scans deps + secrets + risky patterns.

Why: standardize verification and reduce missed checks.

Bonus navigation:

- `scripts/codemaps/generate.ts`: generates codemaps under `docs/CODEMAPS/` for fast architecture-level navigation.

<a id="learning-en"></a>
### Continuous learning: stop hook

Goal: turn a "valuable" session into reusable patterns.

- `plugins/continuous-learning-stop-hook.js` triggers a stop hook at session end.
- It runs `skills/continuous-learning/hooks/stop.sh` -> `skills/continuous-learning/stop.sh`.
- `skills/continuous-learning/bin/evaluate-session.js`:
  - fetches the transcript (file path when available, otherwise by session id)
  - detects patterns (debugging flow, user corrections, conventions, etc.)
  - writes draft skills to `~/.config/opencode/skills/learned/` based on `skills/continuous-learning/config.json`

Why: automatically capture effective behaviors and re-inject them into future sessions via `skills/learned-skillbook/SKILL.md`.

<a id="flow-en"></a>
### How it fits together

1. Start a task: `build` runs with global skills loaded.
2. Use a command (`/plan`, `/tdd`, `/security`, ...): OpenCode routes to a specialist agent + template.
3. While implementing: plugins apply hooks (format, TS check, audits).
4. At session end: the stop hook may extract learnings (draft skills) to strengthen the setup over time.
