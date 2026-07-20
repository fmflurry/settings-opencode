---
name: config-sync
description: >
  Sync configuration changes across the settings-opencode repo and live harness directories (OpenCode and Claude Code).
  Invoke when adding, updating, or removing agents, rules, hooks, commands, prompts, skills, or harness config.
  Keywords: "add agent", "change rule", "update skill", "modify config", "add hook", "keep configs in sync", "propagate settings", "update my config", "harness configuration"
---

# Configuration Sync

## Overview

This repo is the **single source of truth** for both OpenCode and Claude Code harness configuration. Never hand-edit the live directories (`~/.config/opencode`, `~/.claude`). Always edit the repo first, then propagate via `settings-sync` (works from any directory) or `bash install.sh --yes` (from the repo root).

## What Goes Where: Decision & Mapping Table

**Verified directory structure:**
- OpenCode target (`~/.config/opencode`) receives: entire repo tree minus `.claude` and excludes
- Claude target (`~/.claude`) receives: ONLY the allowlist from `.claude/` subtree
- Skills are the **only "edit once → both" case** via union sync (root `skills/` ∪ `.claude/skills/`, root wins)

| Item | Repo source location(s) | OpenCode | Claude | Edit location(s) | Notes |
|------|---|---|---|---|---|
| **Agents (OpenCode)** | `opencode.jsonc` (inline defs) + `prompts/agents/*.txt` (prompts) | ✓ | ✗ | `opencode.jsonc` or `prompts/agents/` | OpenCode-only. Agents defined inline in opencode.jsonc or as prompt templates. NO top-level `agents/` dir exists. |
| **Agents (Claude)** | `.claude/agents/` | ✗ | ✓ | `.claude/agents/` | Claude-only agent definitions. |
| **Rules** | `.claude/rules/` | ✗ | ✓ | `.claude/rules/` | Claude-only rules (e.g., orchestration.md, verification-gate.md, codebase-exploration.md). |
| **Hooks** | `.claude/hooks/` | ✗ | ✓ | `.claude/hooks/` | Claude-only runtime hooks (e.g., installed by learning runtime). |
| **Commands** | `commands/` | ✓ | ✗ | `commands/` | OpenCode-only slash commands. |
| **Prompts** | `prompts/` | ✓ | ✗ | `prompts/` (including `prompts/agents/` for agent prompts) | OpenCode-only prompt templates. |
| **Contexts** | `contexts/` | ✓ | ✗ | `contexts/` | OpenCode-only context definitions. |
| **Tools** | `tools/` | ✓ | ✗ | `tools/` | OpenCode-only tool definitions. |
| **Plugins** | `plugins/` | ✓ | ✗ | `plugins/` | OpenCode-only plugins. |
| **Skills (shared)** | `skills/` (primary source) | ✓ | ✓ | `skills/` | The **ONLY "edit once, both harnesses" type**. Root `skills/` wins on name conflict with `.claude/skills/` via union sync. |
| **Skills (Claude-only/override)** | `.claude/skills/` (secondary source) | ✓ | ✓ | `.claude/skills/` | Lower priority; root `skills/` overrides. Both targets receive via union sync. |
| **Harness config** | `opencode.jsonc` | ✓ | ✗ | `opencode.jsonc` | OpenCode harness configuration (models, providers, settings, agent defs). |
| **Global instructions** | `.claude/CLAUDE.md` + `.claude/RTK.md` | ✗ | ✓ | `.claude/CLAUDE.md`, `.claude/RTK.md` | Claude-only global instructions and token-optimization guide. |
| **Personal: settings.json** | `.claude/settings.json` (seed) or `settings.json` (root seed, if exists) | ⚠ | ⚠ | Manual merge if needed | Seed-only; never overwritten on reinstall. Edit live copy or merge after repo changes. |
| **Personal: settings.local.json** | `.claude/settings.local.json` (seed) | ⚠ | ⚠ | Manual merge if needed | Seed-only; local overrides. |
| **Personal: policy-limits.json** | `.claude/policy-limits.json` (seed) | ⚠ | ⚠ | Manual merge if needed | Seed-only; rate limit policies. User edits in live dir will NOT propagate via reinstall. |
| **Personal: *.local.json** | `*.local.json` (seed) | ⚠ | ⚠ | Manual merge if needed | Seed-only; any other .local.json files. |

**Legend:**
- ✓ = Item is propagated to this target
- ✗ = Item does not reach this target
- ⚠ (seed-only) = Only populated on first install; user edits in the live dir are **NOT synced back** to the repo on reinstall. To propagate changes: edit repo source, run `bash install.sh --yes`, then manually re-apply personal customizations to the live copy.

## Workflow: Edit → Propagate → Verify

This workflow is **cwd-independent** — it works from any directory, not just the repo root. The `settings-sync` command (installed globally onto `PATH` by `install.sh`) locates the repo for you.

### Repo discovery order

`settings-sync` resolves the repo path in this order:
1. `$SETTINGS_OPENCODE_REPO` — exported by the managed shell rc block, if it points at a directory with an executable `install.sh`
2. `$HOME/Workspace/settings-opencode`
3. `$HOME/.local/share/settings-opencode`

If none resolve, it exits with an error asking you to set `SETTINGS_OPENCODE_REPO`.

### Step 1: Edit the Repo

Edit files under `$SETTINGS_OPENCODE_REPO/...` (absolute paths — always edit the canonical repo, never a live harness directory). Example:

```bash
# Add a Claude-only agent
mkdir -p /Users/fmflurry/Workspace/settings-opencode/.claude/agents
vi /Users/fmflurry/Workspace/settings-opencode/.claude/agents/my-agent/AGENT.md

# Add an OpenCode agent (edit opencode.jsonc or create a prompt template)
vi /Users/fmflurry/Workspace/settings-opencode/opencode.jsonc
# OR add a prompt template:
echo "..." > /Users/fmflurry/Workspace/settings-opencode/prompts/agents/my-agent.txt

# Edit a Claude rule
vi /Users/fmflurry/Workspace/settings-opencode/.claude/rules/common/my-rule.md

# Add a new shared skill
mkdir -p /Users/fmflurry/Workspace/settings-opencode/skills/my-skill
echo "..." > /Users/fmflurry/Workspace/settings-opencode/skills/my-skill/SKILL.md
```

### Step 2: Propagate via settings-sync

From any directory:

```bash
settings-sync
```

This single command:
1. Copies the repo tree → `~/.config/opencode` (OpenCode target)
2. Copies the `.claude/` allowlist → `~/.claude` (Claude target)
3. Runs `scripts/sync-skills.sh` to build the canonical skill union (root `skills/` ∪ `.claude/skills/`)
4. Installs learning runtime (if applicable)

**Fast path — skills only:**

```bash
settings-sync --skills-only
```

Use this only if you changed ONLY skills and want to skip the full install cycle.

**Fallback (raw scripts, if `settings-sync` isn't on `PATH` yet):**

```bash
cd "$SETTINGS_OPENCODE_REPO" && bash install.sh --yes
# or, skills only:
bash "$SETTINGS_OPENCODE_REPO/scripts/sync-skills.sh" ~/.config/opencode/skills ~/.claude/skills
```

### Step 3: Verify Propagation

Spot-check that the edited file landed in the live directory:

```bash
# Example: check that a Claude agent propagated
ls -la ~/.claude/agents/my-agent

# Example: check that an OpenCode prompt template propagated
ls -la ~/.config/opencode/prompts/agents/my-agent.txt

# Example: check that a new shared skill propagated to both
ls -la ~/.config/opencode/skills/my-skill
ls -la ~/.claude/skills/my-skill

# Example: check that a rule updated
diff /Users/fmflurry/Workspace/settings-opencode/.claude/rules/common/my-rule.md ~/.claude/rules/common/my-rule.md

# Example: check that opencode.jsonc propagated
diff /Users/fmflurry/Workspace/settings-opencode/opencode.jsonc ~/.config/opencode/opencode.jsonc
```

Propagation is complete when the edited files appear in their respective target locations.

## Important: Seed-Only Personal Files

Files marked **seed-only** in the table above are populated only on first install. On subsequent reinstalls, `install.sh` preserves user edits in those files **by never overwriting them**.

Example:
1. First install: `~/.claude/settings.json` is seeded from the repo with defaults.
2. User edits `~/.claude/settings.json` manually (e.g., changes a model preference).
3. Second install (`bash install.sh --yes`): The edited `~/.claude/settings.json` is left untouched.
4. To apply new defaults from the repo, you must **manually merge or replace** the file in the live dir.

**Workaround:** If you need to push a new default to a seed-only file:

```bash
# Backup the current live version
cp ~/.claude/settings.json ~/.claude/settings.json.backup

# Copy the repo version (with new defaults)
cp /Users/fmflurry/Workspace/settings-opencode/.claude/settings.json ~/.claude/settings.json

# Manually re-apply your user edits
vi ~/.claude/settings.json  # add back your custom values
```

**tldr:** Do NOT expect `bash install.sh --yes` to overwrite your personal config files. They are managed by you, not the repo.

## When NOT to Use This Skill

- **Project-local installations** (`--local` flag): These create `./.opencode` and `./.claude` in your working directory for project-specific config. Do not use this skill for project-local installs; the propagation model is different (cwd-scoped, no global shell rc).
- **Runtime/session state**: Do not use this skill to sync session data (conversations, proposals, cached proposals, debug state). Those are harness runtime artifacts and are excluded from propagation.
- **Manual editing of live dirs:** If you hand-edited `~/.config/opencode` or `~/.claude` directly (not via the repo), those changes are local and will NOT propagate back to the repo on reinstall. Always edit the repo source first.

## Command Reference

Run from anywhere via `settings-sync`; the raw `install.sh`/`sync-skills.sh` invocations below are the documented fallback (require `cd "$SETTINGS_OPENCODE_REPO"` or an absolute path first).

**Full install (both harnesses, repo → ~/.config/opencode + ~/.claude):**
```bash
settings-sync
# fallback: bash install.sh --yes
```

**OpenCode target only:**
```bash
settings-sync --opencode-only
# fallback: bash install.sh --yes --no-claude
```

**Claude target only:**
```bash
settings-sync --claude-only
# fallback: bash install.sh --yes --no-opencode
```

**Skills sync only (fast path):**
```bash
settings-sync --skills-only
# fallback: bash scripts/sync-skills.sh ~/.config/opencode/skills ~/.claude/skills
```

**Where is the repo resolved to?**
```bash
settings-sync --where
```

**Uninstall (removes live copies, keeps repo):**
```bash
settings-sync --uninstall
# fallback: bash install.sh --uninstall
```

**Project-scoped (local mode, creates ./.opencode + ./.claude in cwd):**
```bash
bash install.sh --yes --local
```

See `bash install.sh --help` for full flag reference.
