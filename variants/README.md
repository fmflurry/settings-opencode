# Harness variants

Both variants install the same `skills/` tree. A variant does not get a second copy of a skill.

Orchestration is the repository root (`.claude/`, `opencode.jsonc`, `prompts/agents/`, `instructions/`). The conductor routes, and the primary agent does not write. This is the default install, and it is what `install-cursor.sh` builds.

Monolith is `variants/monolith/`. `install.sh` copies the Orchestration tree, then `scripts/variants/apply-monolith.mjs` overlays the lean roster onto that copy. The source checkout is not rewritten.

```bash
./install.sh
./install.sh --variant monolith
HARNESS_VARIANT=monolith ./install.sh --yes
```

`--yes` with no variant stays Orchestration. Windows: `bootstrap.ps1 -Variant monolith`.
