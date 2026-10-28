# Harness variants

Both variants install the same `skills/` tree. A variant does not get a second copy of a skill.

Conductor is the repository root (`.claude/`, `opencode.jsonc`, `prompts/agents/`, `instructions/`). The conductor routes, and the primary agent does not write. `conductor` selects it. `orchestration` is an install alias for Conductor.

Monolith is `variants/monolith/`. `install.sh` copies the Conductor tree, then `scripts/variants/apply-monolith.mjs` overlays the lean roster onto that copy. The source checkout is not rewritten. Switching back runs `scripts/variants/prune-foreign.mjs`, which removes Monolith-only agents, commands, and rules.

`install.sh --yes`, `settings-sync`, and `bootstrap.ps1` install Monolith when no variant is set. `install-cursor.sh` builds Monolith unless `--variant conductor` or `HARNESS_VARIANT=conductor` is set. `./install.sh --local` and `bootstrap.ps1 -Local` vendor `AGENTS.md`, `.cursor/rules`, and `.agents` and default to Monolith. The same flag and env override both. `./install-cursor.sh --status` prints the variant recorded in the installed plugin.

```bash
./install.sh
./install.sh conductor
./install.sh monolith
./install.sh --status
./install.sh --variant orchestration
HARNESS_VARIANT=monolith ./install.sh --yes
```

`./install.sh --yes` with no variant is Monolith. `--local --yes` with no variant is Monolith. `conductor` selects Conductor. A positional name skips the prompts. Windows: `bootstrap.ps1` with no variant is Monolith, `bootstrap.ps1 conductor`, `bootstrap.ps1 monolith`, `bootstrap.ps1 -Local`, `bootstrap.ps1 -Status`.

```bash
./install-cursor.sh
./install-cursor.sh --variant conductor
./install-cursor.sh --status
./install.sh --local
./install.sh --local --variant conductor
```

## Project overlay

`./install.sh --local` and `bootstrap.ps1 -Local` apply `.harness-local/` after the variant is vendored. The directory is project-owned. The installer does not create it, write it, or delete it. Overlay files win. `.harness-local/exclude` names skills and paths that must not be installed and that are pruned on every run. Both variants do this. The layout and the off-by-default domain-rules hook are documented in `docs/harness-local.md`. `./install.sh --local --status` prints the overlay, the exclude entries, and the domain-rules state.
