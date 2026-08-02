# Harness Parity (mandatory)

When you add, edit, rename, or delete **ANY artifact** under `.claude/` or `.opencode/` — a skill, agent, command, rule, or instruction — you **MUST replicate the equivalent change in the other harness**. This includes adding/removing registry entries.

Consult the `harness-parity` skill for the translation table and replication checklist. The skill shows how artifact types map between Claude and OpenCode (path translation, frontmatter changes, registration differences).

**Critical**: Adding a file without wiring its registry/load-path entry (e.g., omitting the `@`-import in `.claude/CLAUDE.md` or the entry in `opencode.jsonc`) counts as incomplete — the artifact is orphaned.
