# Harness variants

Both variants install the same `skills/` tree. A variant does not get a second copy of a skill.

Conductor is the repository root (`.claude/`, `opencode.jsonc`, `prompts/agents/`, `instructions/`). The conductor routes, and the primary agent does not write. A global install with no variant stays Conductor. `orchestration` is an install alias for Conductor.

Monolith is `variants/monolith/`. `install.sh` copies the Conductor tree, then `scripts/variants/apply-monolith.mjs` overlays the lean roster onto that copy. The source checkout is not rewritten. Switching back runs `scripts/variants/prune-foreign.mjs`, which removes Monolith-only agents, commands, and rules.

`install-cursor.sh` builds Monolith unless `--variant conductor` or `HARNESS_VARIANT=conductor` is set. `./install.sh --local` and `bootstrap.ps1 -Local` vendor `AGENTS.md`, `.cursor/rules`, and `.agents` and default to Monolith. The same flag and env override both. `./install-cursor.sh --status` prints the variant recorded in the installed plugin.

```bash
./install.sh
./install.sh conductor
./install.sh monolith
./install.sh --status
./install.sh --variant orchestration
HARNESS_VARIANT=monolith ./install.sh --yes
```

Global `--yes` with no variant stays Conductor. `--local --yes` with no variant is Monolith. A positional name skips the prompts. Windows: `bootstrap.ps1 conductor`, `bootstrap.ps1 monolith`, `bootstrap.ps1 -Local`, `bootstrap.ps1 -Status`.

```bash
./install-cursor.sh
./install-cursor.sh --variant conductor
./install-cursor.sh --status
./install.sh --local
./install.sh --local --variant conductor
```
