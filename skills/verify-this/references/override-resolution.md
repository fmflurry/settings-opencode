# How verify-this finds a project override

Checked 2026-10-18. The generic skill does not assume the harness will swap itself for the project file. `scripts/load-override.mjs` reads the override when it exists and prints `default` when it does not.

Paths:

| Harness | Project file | What the harness itself does with the same skill name |
| --- | --- | --- |
| Claude Code | `.claude/skills/verify-this/SKILL.md` | Personal wins. `/verify-this` runs `~/.claude/skills/verify-this`, where this harness is installed. |
| OpenCode | `.opencode/skills/verify-this/SKILL.md` | On v2, the project file replaces `~/.config/opencode/skills/verify-this`. |
| Cursor | `.cursor/skills/verify-this/SKILL.md` | Cursor discovers this directory. Same-name order against a plugin skill is not documented. |

The loader looks at the current harness's path first, then `.cursor/skills/verify-this`, `.opencode/skills/verify-this`, and `.claude/skills/verify-this`. The first directory that has both `SKILL.md` and a version-1 `commands.json` is the override. A missing or unreadable `commands.json` is skipped. With no override, the generic surfaces in `SKILL.md` stay in force.

## Claude Code

Source: [Claude Code skills](https://code.claude.com/docs/en/skills), section "Resolve skills that share a name", fetched 2026-10-18.

Enterprise, then personal (`~/.claude/skills`), then project (`.claude/skills`). A `deploy` skill in both `~/.claude/skills` and the project's `.claude/skills` runs the personal one. Plugin skills are namespaced (`/plugin-name:skill-name`) and both load.

This repo installs the generic skill with `scripts/sync-skills.sh` into `~/.claude/skills`. A project copy under `.claude/skills/verify-this/` does not replace that install. Claude Code's own note on the same layout (issue anthropics/claude-code#20309, 2026-08-19) is that both copies show up and `/dupe` runs the personal one.

So the installed skill is the one that runs, and it has to open the project file itself. That is what `load-override.mjs` does. The generated file is still a complete skill, so reading it is enough.

## OpenCode

Two loaders show up in the record.

`scripts/skill-drift-check.sh` describes the older one: the same skill name across `.claude/skills`, `.opencode/skills`, `~/.config/opencode/skills`, and `~/.claude/skills` was last-writer-wins, and the winner could change with I/O order (anomalyco/opencode#32202). That is why a second copy of a skill in this settings repo is treated as drift.

OpenCode v2, [Skills](https://opencode.ai/v2/docs/skills), fetched 2026-10-18, registers sources from lower to higher precedence and keeps the later one:

1. Built-in skills
2. `.claude/skills`, global first, then ancestors toward the current directory
3. `.agents/skills`, the same way
4. `~/.config/opencode/skills`
5. Project `.opencode/skills`, from the project root toward the current directory
6. Explicit `skills` config entries

The skill id is the directory name. `~/.config/opencode/skills/verify-this` loses to `.opencode/skills/verify-this`. A project `.claude/skills/verify-this` does not win over the installed `~/.config/opencode/skills/verify-this`, because the global OpenCode directory is registered later.

On v2 the project file replaces the generic skill, so the generator writes a full workflow, not a fragment. On the older loader the generic skill may be the one that loads; it still calls `load-override.mjs`, which reads `.opencode/skills/verify-this` when that directory is present.

## Cursor

Source: [Cursor Agent Skills](https://cursor.com/docs/skills), fetched 2026-10-18.

Discovered project directories include `.cursor/skills/`, `.agents/skills/`, and, for compatibility, `.claude/skills/` and `.codex/skills/`. User directories include `~/.cursor/skills/` and `~/.claude/skills/`. Plugin skills come from the plugin manifest. This plugin sets `"skills": "./skills/"`.

The page does not say which copy is used when a plugin skill and a project skill share a name. Root `skills/` in a repository is not one of the listed directories.

This Cursor cloud session on 2026-10-18 listed skills from `<repo>/.claude/skills/` and from `~/.cursor/plugins/cache/`, as separate entries. It did not list `<repo>/skills/`. The repo has no `.cursor/skills/` directory, so that path was not in the list either. Nothing in that session was a same-name collision, so it does not show which copy would win.

The plugin copy of `verify-this` therefore runs `load-override.mjs`, which reads `.cursor/skills/verify-this/` when the generator has written it, and otherwise keeps the generic surfaces.

## What the loader will run

`commands.json` version must be 1. A command is executed only when it matches the allowlist in `scripts/lib.mjs`: `npm`/`pnpm`/`yarn`/`bun` `run <script>` or `<pm> test` (not `bun test`, which is a different tool), `dotnet build`/`dotnet test` plus one relative path, or `make <target>`. A single-line CI `run:` or `script:` that looks like build, test, or e2e but does not match that shape is stored as evidence and skipped. Other CI lines, including GitLab `script:` lists, are ignored. `curl` against a `launchSettings.json` URL is recorded with `run: false`.
