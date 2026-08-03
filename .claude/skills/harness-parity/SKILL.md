---
name: harness-parity
description: Use whenever you add, edit, rename, or delete any harness artifact — a skill, agent, command, rule, or instruction — in either .claude/ or .opencode/. Replicate the equivalent change in the other harness with the correct frontmatter and registration translation, so the two trees stay in parity.
---

# Harness Parity — Keep Claude & OpenCode in Sync

When you add, edit, rename, or delete **any artifact** in `.claude/` or `.opencode/` (skills, agents, commands, rules, instructions), you **MUST replicate the equivalent change in the other harness**. This keeps the two harness codebases at parity, avoiding orphaned or divergent tools.

## A. Replication Checklist

Follow these steps in order for every harness artifact change:

1. **Identify artifact type and source harness**
   - Artifact type: skill / command / agent / rule-instruction
   - Source: which harness changed (Claude `.claude/` or OpenCode `.opencode/`)?

2. **Locate or create the mirror path in the other harness**
   - Use the translation table (Section B) to find the equivalent path.
   - Create the directory structure if it doesn't exist.

3. **Apply the frontmatter/registration translation**
   - Consult the translation table for frontmatter fields and required registration entries.
   - Copy the body verbatim (for skills, commands, rules, instructions).
   - For agents: split the single Claude `.md` into a prompt `.txt` + JSONC config entry.

4. **Wire the artifact into the registry/load-path**
   - Claude: Add an `@`-import line to `.claude/CLAUDE.md` for rules/instructions.
   - OpenCode: Add entries to `opencode.jsonc`: `instructions` array, `command` object, or `agent` object.
   - If the artifact needs registration, skipping this step leaves it orphaned.

5. **Bring across any reference sub-files**
   - For skills with reference files (`reference.md`, `templates.md`, etc.), copy them too.
   - File paths are relative; preserve the directory structure.

6. **For deletes/renames: remove mirrors and their registry entries**
   - Delete or rename the mirror artifact in the other harness.
   - Remove any `@`-import, `instructions` array entry, or `command`/`agent` object entry referencing it.

7. **Validate syntax and references**
   - OpenCode: `opencode.jsonc` still parses (JSONC allows trailing commas).
   - Claude: All `@`-import paths resolve to existing files.
   - Cross-check wikilinks (`[[skill-name]]`) — they must point to existing skills in the same harness.

## B. Translation Table

| Artifact | Claude Path | OpenCode Path | Frontmatter | Registration | Notes |
|----------|------------|---------------|-------------|--------------|-------|
| **Skill** | `.claude/skills/<name>/SKILL.md` | `.opencode/skills/<name>/SKILL.md` | Both: `name` + `description` (no changes) | None (no registry entry either side) | Copy reference files (`reference-*.md`, etc.) with the same directory structure. |
| **Command** | `.claude/commands/<name>.md` (subdir allowed, e.g. `opsx/new.md`) | `.opencode/commands/<name>.md` (flat; convert `opsx/new` → `opsx-new`) | Claude: `description` only. Body includes `> CC: delegate to <agent>` note. | OpenCode: `description` + `agent:` + `subtask: true` | Add to `opencode.jsonc` `command` object for visibility. Drop the `> CC:` note when porting; it's replaced by `agent:` frontmatter. |
| **Agent** | `.claude/agents/<name>.md` (single file: frontmatter `name`/`description`/`tools` + prompt body) | Prompt: `.opencode/prompts/agents/<name>.txt` (prompt body only). Config: entry in `opencode.jsonc` `agent` object. | Claude: `name`, `description`, `tools`, frontmatter + prompt body. | OpenCode: Remove `name`/`description`/`tools` from `.txt`, place in JSONC `agent` object with keys `description`, `mode`, `model`, `prompt`, `temperature`, `topP`, `tools`, optional `permission`. | If delegatable, also add to `conductor.permission.task` allow-list in JSONC. Split the Claude file into prompt text + JSONC config. |
| **Rule / Instruction** | `.claude/rules/**/*.md` + `@rules/...` import in `.claude/CLAUDE.md` | `.opencode/instructions/<name>.md` + entry in `opencode.jsonc` `instructions` array | Both: standard markdown frontmatter (none required; body is the content). | Claude: `@rules/path/to/file.md` line in `.claude/CLAUDE.md`. | Adding the file alone is NOT enough — it must be in the active load path or it is orphaned. Register immediately. |

### Key Translation Notes

- **Skill references within text**: Keep `[[skill-name]]` wikilinks verbatim (they are harness-local).
- **Subdir flattening for commands**: `opsx/new` in Claude becomes `opsx-new` in OpenCode (flat structure, hyphens instead of slashes).
- **Agent split**: Claude's single `.md` file (frontmatter + body) becomes OpenCode's separate `.txt` (body only) + JSONC entry (config).
- **Command delegation**: Claude uses `> CC: delegate to <agent>` body note; OpenCode uses `agent:` frontmatter field.

## C. Discovery & Trigger

This skill is always loaded in the harness rule/instruction (`.claude/rules/common/harness-parity.md` or `.opencode/instructions/harness-parity.md`), which reminds you to consult this skill whenever you modify a harness artifact. The skill provides the detailed translation table and replication checklist.

Whenever you **add, edit, rename, or delete** any artifact — no matter which harness you're in — the rule/instruction will prompt you to replicate the change in the other harness using this skill.

---

**Maintenance**: If new artifact types are introduced or paths change, update this table. Keep it as the single source of truth for Claude ↔ OpenCode artifact translation.
