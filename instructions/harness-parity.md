# Harness Parity (mandatory)

When you add, edit, rename, or delete **ANY artifact** under `.claude/` or `.opencode/` — a skill, agent, command, rule, or instruction — you **MUST replicate the equivalent change in the other harness**. This includes adding/removing registry entries.

Consult the `harness-parity` skill for the translation table and replication checklist. The skill shows how artifact types map between Claude and OpenCode (path translation, frontmatter changes, registration differences).

**Critical**: Adding a file without wiring its registry/load-path entry (e.g., omitting the `@`-import in `.claude/CLAUDE.md` or the entry in `opencode.jsonc`) counts as incomplete — the artifact is orphaned.

---

## Scope Note

**PROJECT-SCOPED:** Harness-parity rules apply to a project's own `.claude/` ↔ `.opencode/` pair. This settings repo itself has no `.opencode/` directory; the root `skills/` directory is managed separately and is not subject to harness-parity rules. Apply harness-parity only when a project has both `.claude/` and `.opencode/` directories.
