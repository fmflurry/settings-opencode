---
name: create-verification-skill
description: "Use when creating or refreshing a project's verify-this override. Discovers the real build, test, and e2e commands and writes the project skill. Trigger on \"create a verification skill\", \"generate verify-this\", or \"record this project's test commands\"."
---

# Create a verification skill

why-not-tooled: the generator records commands from the manifests; deciding that a claim is worth verifying is a judgment no linter can make.

Write a project override of `verify-this` so later verification runs this repository's commands. The generator reads the manifests.

## Output path

Pass the harness you are running in. The script writes one directory:

| Harness | Flag | Directory |
| --- | --- | --- |
| Claude Code | `--harness claude` | `.claude/skills/verify-this/` |
| OpenCode | `--harness opencode` | `.opencode/skills/verify-this/` |
| Cursor | `--harness cursor` | `.cursor/skills/verify-this/` |

Detection, when the flag is omitted: `VERIFY_HARNESS`, then `CURSOR_AGENT` or `CURSOR_PLUGIN_ROOT`, then Claude Code's `CLAUDE_CODE_*` / `CLAUDE_PROJECT_DIR`, then `OPENCODE`. If none of those is set, the script exits without writing.

```bash
node scripts/generate.mjs --root <project> --harness <claude|opencode|cursor>
```

`scripts/generate.mjs` lives next to this file. Exit 2 means nothing runnable was found; leave the generic `verify-this` in place.

## What gets written

- `SKILL.md` — a complete `verify-this` for this repository, including the verdict rules.
- `commands.json` — the same commands, for the runner.
- `scripts/run.mjs` — runs the commands marked `run`, from the repository root, and stops on the first failure.

Re-running overwrites those three files and leaves anything else in the directory.

## What it reads

In order, for each of build, test, and e2e: `package.json` scripts (`build`, `test`, then `e2e` / `test:e2e` / `e2e:ci`), a root `Makefile` target of the same name, a `*.sln` or `*.csproj` (`dotnet build` / `dotnet test`), then a single-line CI `run:` or `script:` (GitHub Actions or Azure Pipelines) that matches a command the runner is allowed to execute.

The package manager comes from the lockfile: `bun.lock` / `bun.lockb`, then `pnpm-lock.yaml`, then `yarn.lock`, otherwise npm. `bun test` is Bun's own runner, so a package script on Bun is `bun run <script>`.

A CI `run:` or `script:` that looks like build, test, or e2e but pipes, adds arguments, or otherwise fails that shape is listed as evidence and is not executed. Other CI lines, including GitLab `script:` lists, are ignored. An API URL from `Properties/launchSettings.json` is recorded and is not run automatically.

A green build is required later and is not itself a VERIFIED claim. How each harness loads the file you just wrote is in the `verify-this` skill, `references/override-resolution.md`.
