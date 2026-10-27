# Project harness overlay

`./install.sh --local` and `bootstrap.ps1 -Local` vendor the harness, then read `.harness-local/` from the project. Conductor and Monolith both do this. A local install with no variant stays Monolith.

The installer never creates, edits, or deletes `.harness-local/` or anything inside it. It also does not create or delete project files outside the managed paths below.

## Layout

```text
.harness-local/
  exclude                  # optional. One harness path or skill id per line.
  domain-rules.json        # optional. Hook config. Absent means disabled.
  AGENTS.md                # optional. Replaces the vendored ./AGENTS.md
  .claude/**               # copied onto ./.claude
  .opencode/**             # copied onto ./.opencode
  .cursor/**               # copied onto ./.cursor
  .agents/**               # copied onto ./.agents
```

`exclude` and `domain-rules.json` are control files. They are not copied onto the project. Any other name at the top of `.harness-local/` is ignored and reported by `--status`.

Overlay files are copied after excludes. A file present in the overlay stays, including when the same path is listed in `exclude`.

The installer resolves the harness directory and the project root before it compares them (`cd -P` and `pwd -P`, or `realpath` when that is unavailable). A clone reached through a symlink, including macOS `/tmp` (a link to `/private/tmp`), still applies `.harness-local/`.

If a managed root is not overlaid, the installer prints why. A root is skipped when that target was disabled, was not installed, or is the source checkout.

A `--local` install records project-relative paths where the tools accept them:

- `.claude/settings.json` sets `CLAUDE_CODE_PLUGIN_DIRS` to `./.claude/mods/autonomy-status`
- Monolith sets the `instructions` entry in `.opencode/opencode.jsonc` to `.opencode/instructions/monolith.md`

A global install keeps `~/.claude/mods/autonomy-status` and `~/.config/opencode/instructions/monolith.md`.

## `exclude`

UTF-8 text. One entry per line. Blank lines and lines starting with `#` are ignored.

- `angular-ddd` or `skills/angular-ddd` is a skill id. The installer does not leave that skill installed. Every run deletes `.claude/skills/angular-ddd`, `.opencode/skills/angular-ddd`, and `.agents/skills/angular-ddd` when they exist.
- `AGENTS.md`, or a relative path under `.claude/`, `.opencode/`, `.cursor/`, or `.agents/`, is deleted when it exists. A directory entry deletes that directory.

Absolute paths, `..`, and paths outside those roots are rejected. When any line is invalid, the installer deletes nothing and exits with status 2. A symlink under a managed path that points outside the project is not followed: the installer stops and leaves that outside target in place.

A project that replaced the harness skills `angular-ddd` and `dotnet-ddd` with its own `ddd` skill keeps the replacements across re-vendors with:

```text
# .harness-local/exclude
angular-ddd
dotnet-ddd
```

```text
.harness-local/.claude/skills/ddd/SKILL.md
.harness-local/.opencode/skills/ddd/SKILL.md
.harness-local/.agents/skills/ddd/SKILL.md
```

## Domain rules

`.harness-local/domain-rules.json` is JSON:

```json
{
  "enabled": false,
  "script": "scripts/check-domain-rules.sh"
}
```

`enabled` must be the boolean `true`. A missing file, a missing key, or any other value leaves the hook off. The hook does not run the script in that case.

`script` is optional. The default is `scripts/check-domain-rules.sh`, relative to the project root. The path must stay inside the project, including after resolving a symlink. The harness does not ship the script and does not contain project rules.

When the hook is enabled it runs that script with the project as the working directory and `HARNESS_PROJECT_ROOT` set. Claude Code passes the hook payload on stdin. OpenCode passes `{"tool","args"}`. A non-zero script status blocks the edit. The script has 30 seconds.

Claude runs `.claude/hooks/domain-rules.sh` before Edit, Write, and MultiEdit. OpenCode runs `plugins/domain-rules.ts` before `write`, `edit`, `patch`, and `multiedit`.

## Status

`./install.sh --local --status` prints the installed variant, then the overlay files, the exclude entries, and `domain-rules: disabled` or `domain-rules: enabled <script>`. It does not install and it does not write `.harness-local/`.

`bootstrap.ps1 -Local -Status` prints the same overlay report.
