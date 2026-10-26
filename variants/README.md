# Harness variants

Both variants install the same `skills/` tree. A variant does not get a second copy of a skill.

Conductor is the repository root (`.claude/`, `opencode.jsonc`, `prompts/agents/`, `instructions/`). The conductor routes, and the primary agent does not write. This is the default install, and it is what `install-cursor.sh` builds. `orchestration` is an install alias for Conductor.

Monolith is `variants/monolith/`. `install.sh` copies the Conductor tree, then `scripts/variants/apply-monolith.mjs` overlays the lean roster onto that copy. The source checkout is not rewritten. Switching back runs `scripts/variants/prune-foreign.mjs`, which removes Monolith-only agents, commands, and rules.

```bash
./install.sh
./install.sh conductor
./install.sh monolith
./install.sh --status
./install.sh --variant orchestration
HARNESS_VARIANT=monolith ./install.sh --yes
```

`--yes` with no variant stays Conductor. A positional name skips the prompts. Windows: `bootstrap.ps1 conductor`, `bootstrap.ps1 monolith`, `bootstrap.ps1 -Status`.
