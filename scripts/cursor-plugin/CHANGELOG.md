# Changelog

Versions of the fmflurry-harness Cursor plugin. The number lives in `scripts/cursor-plugin/config.json` and is copied into `.cursor-plugin/plugin.json` by `node scripts/build-cursor-plugin.mjs`.

## [0.4.28] - 2026-10-28

- `SessionStart` runs `.claude/hooks/cloud-session-bootstrap.sh` when `CLAUDE_CODE_REMOTE=true` and the project does not vendor the harness. Vendored means a `.claude/.harness-variant` file, or `.claude/CLAUDE.md` together with `.claude/hooks/autonomy-context.sh`, or a `plugin.json` that contains a `"version"` field (`.cursor-plugin/plugin.json` or `plugins/fmflurry-harness/.cursor-plugin/plugin.json`). The hook shallow-clones `https://github.com/fmflurry/settings-opencode` into a temp directory and runs `install.sh --yes monolith`. Success is quiet. A clone or install failure logs a warning and exits 0. The hook does nothing when `CLAUDE_CODE_REMOTE` is unset. The installer merges the command into Claude settings. The Cursor plugin build mirrors the script.
- `./install.sh --yes` with no variant installs Monolith, and so does `settings-sync` when no variant is passed and `HARNESS_VARIANT` is unset. The interactive prompt defaults to Monolith. `conductor` selects Conductor. `orchestration` remains an alias of Conductor. `bootstrap.ps1` with no variant installs Monolith.

## [0.4.27] - 2026-10-28

- `security-reviewer` reads three vendored attack-class references under `skills/security-review/references/` only when the diff touches that surface: `ATTACK-CLASSES.md` (injection, access control, SSRF, deserialization), `WEB-PROTOCOL-AND-AUTH.md` (sessions and identity protocols), and `CLIENT-SIDE.md` (DOM and browser trust). They are verbatim copies from cloudflare/security-audit-skill at `c1c8a8c1471069fb0e188eeaff69b8e8db6564a8`, MIT.
- Every finding cites `file:line`, the data flow from source to sink, and a repro or test, and is classified Confirmed, Needs validation, or Rejected. Only a Confirmed Important finding blocks. Needs validation is listed separately.
- Conductor and Monolith share the references and the agent text. The Cursor plugin build and the skill sync copy them into the install.

## [0.4.26] - 2026-10-28

- The git guard denies an unparsed command only when it contains a guarded git or gh operation the parser cannot resolve. A variable `-C` on `status`, `diff`, `log`, `ls-remote`, or `merge-base` is allowed. Heredoc bodies are not commands: a quoted body is literal, and an unquoted body is data except for `$(...)` and backticks. Quoted strings are not scanned as commands.
- Push ref parsing ignores redirections and pipes. `git push -u origin <branch> 2>&1` uses the branch as the review key.
- `ship-init` and `teardown-merged-worktree` have to be the only command. A chain with `&&`, `;`, or `|` is denied.
- A `guard_block` is written once when both the global hook and a project hook are installed. The global hook skips when the repo vendors `kpi-emit.sh`, and a second write of the same block is dropped. `agent-harness kpi report` also collapses duplicate guard blocks already in the log.
- `pr-visual-report` is stored as the guard name, with `git`, `ask`, `secret`, and `budget`.
- A command with no guarded token skips the parser. A quoted span longer than 4096 bytes is not walked character by character: short quotes stay as written, and a long literal becomes one marker. `$(...)` and backticks inside a long double quote are still checked.

## [0.4.25] - 2026-10-27

- Stale cached data is fixed by invalidating on the write, not by removing the cache. A path-scoped cache-invalidation rule (Claude paths, Cursor globs, OpenCode instruction off the always-on list) says: keep the decorator, TTL, HTTP cache, memory cache, or output cache; invalidate or update the affected entries in the same change; a cross-module write uses an explicit change signal; tests cover a refetch after the write.
- The flurryx skill and angular-cop's flurryx page record that anti-pattern and the invalidate-on-write idiom. The line that said to remove `@SkipIfCached` when a method always re-fetches now only covers a method that was never meant to hit the cache.
- code-reviewer and angular-cop rate as Important: a diff that drops or bypasses a cache without invalidation, and a write next to a cached read with no invalidation and no refresh-after-write test. dotnet-cop says the same for `IMemoryCache`, `HybridCache`, and output cache: evict or tag-invalidate on the write.
- `.claude/hooks/cache-invalidation.sh` warns when the branch diff (merge-base through the worktree; or `git diff HEAD` when no merge-base exists) removes `@SkipIfCached`, `CACHE_NO_TIMEOUT`, or another cache marker and adds no `invalidateCacheFor` or `onCacheInvalidate`. It exits 0. Cursor surfaces that warning as a preToolUse agent message and still allows the tool. It does not block the stop. Content checks in `stop.sh` are warn-only, and a real deletion of a cache must stay possible. `ship-stop-gate` blocks only an unfinished autonomous goal.
- A cache removal or bypass is allowed only when the task, spec, or PR description explicitly says so. An agent must not do it on its own to fix stale data. An instructed removal names knock-on effects. Review rates only an uninstructed removal as Important. The hook warning says the removal is fine when it was explicitly instructed, and otherwise says to invalidate on the write.

## [0.4.24] - 2026-10-27

- Claude Code's main agent (the session default) uses the settings model alias opus in `.claude/settings.json`, for Conductor and Monolith. A fresh global `~/.claude` install and a fresh project `.claude` install both get it. The settings merge writes that alias only when the key is missing or empty, and leaves a value that is already set.
- `/setup-harness` talks about the main agent chat. It no longer calls that chat the conductor.
- Shared Postgres skills name `postgres-dba` only when that agent is installed. Otherwise the work sits with `database-reviewer` or the main agent. Conductor still has `postgres-dba`. Monolith does not.
- The README separates the Conductor roster from Monolith: 9 agents, the main agent coordinates, and `/orchestrate` loads the `conductor` skill.

## [0.4.23] - 2026-10-27

- `agent-harness kpi feature` reports one feature (repo + branch, and the PR number once known): wall time, active time with gaps over 5 minutes excluded, sessions per host, top tools and skills, calls per agent, tool failures and durations, guard blocks, review and fix rounds, and tokens when the host sent them.
- The command writes a sanitised `docs/pr-reports/<slug>.metrics.json` with no prompts, arguments, or absolute paths. `pr-report` inserts that file as a Metrics panel in the show-me HTML and a short table in the PR body. `pr-report-check` warns when the metrics are missing or partial and still accepts a valid visual report.
- Conductor and Monolith both run `kpi feature` before rendering the visual report.

## [0.4.22] - 2026-10-27

- KPI lines record a sanitised `skill` (`^[a-z0-9:-]{1,64}$`) when the tool is Skill, and `agent` (`subagent_type`) on Task/Agent calls and on subagent spawn and stop. Claude reads the agent from the transcript when SubagentStop omits it. OpenCode uses the child session's parent and agent.
- Claude `PostToolUse`, Cursor `postToolUse`, and OpenCode `tool.execute.after` append `tool_result` with `tool_name`, `duration_ms`, and `ok`. The installer registers that hook for global and project installs, in Claude settings and the Cursor plugin. The hook never blocks the tool.
- Tokens: OpenCode sums input and output from `message.updated` onto the session end or the subagent stop. Claude sums input and output from the stop transcript (8 MiB cap). Cursor leaves `tokens` null. Prompts, arguments, and absolute paths stay out of the log. `AGENT_HARNESS_KPI=0` still disables writes.
- The field list is `docs/kpi-events.md`.

## [0.4.21] - 2026-10-27

- Monolith command output remaps `agent:` frontmatter that named a folded agent to `main`. `postgres-dba` commands remap to `database-reviewer`. Claude `subagent_type` delegation lines in those commands are rewritten the same way. Conductor sources are unchanged.
- Skills and rules that named a folded agent as a dispatch target now say: if that agent is installed, dispatch to it; otherwise the main agent does the work inline and loads the matching skill (`planner`, `tdd`, `coder`, `git-workflow`, `architect`, and the rest of the fold). `cop` stands in for `angular-cop` and `dotnet-cop` when those agents are absent.
- `code-reviewer`, `security-reviewer`, and `build-error-resolver` say the main agent applies the fixes when `coder` is not installed.
- `node scripts/cursor-plugin/check.mjs` and `scripts/variants/dangling-agents.test.mjs` build Monolith for the Cursor plugin, Claude, OpenCode, and a project install, and fail if a removed agent is still an `agent:`, `subagent_type`, or dispatch target. Lists of folded agents that are not installed, and the `conductor` skill loaded by `/orchestrate`, stay allowed.

## [0.4.20] - 2026-10-27

- `./install.sh --local` applies a project-owned `.harness-local/` directory on top of the vendored `.claude/`, `.opencode/`, `AGENTS.md`, `.cursor/`, and `.agents` trees. Overlay files win. The installer never creates, edits, or deletes `.harness-local/`. Conductor and Monolith both do this. A local install with no variant stays Monolith.
- `.harness-local/exclude` lists skill ids and harness paths the installer must not install and must prune on every run. A skill id removes that skill from `.claude/skills`, `.opencode/skills`, and `.agents/skills`.
- The domain-rules hook stays off unless `.harness-local/domain-rules.json` sets `"enabled": true`. Claude runs `.claude/hooks/domain-rules.sh` before Edit, Write, and MultiEdit. OpenCode runs `plugins/domain-rules.ts` before write, edit, patch, and multiedit. The hook runs the project script (default `scripts/check-domain-rules.sh`). The harness ships no project rules.
- `./install.sh --local --status` prints the overlay files, the exclude entries, and whether domain-rules is enabled.
- A local install reached through a symlink, including macOS `/tmp`, still applies `.harness-local/` and prints why a root was skipped. Project settings use `./.claude/mods/autonomy-status`. Monolith records `.opencode/instructions/monolith.md`.

## [0.4.19] - 2026-10-26

- The Cursor plugin build defaults to Monolith. The primary agent may write, there is no first-tool gate, and `/orchestrate` is optional. `cop` and `comment-judge` are the merged reviewers. Folded specialists stay skills. The `threejs` and `openspec` umbrella skills stay in the plugin. Tier defaults stay Cursor models only: `grok-4.7`, `grok-4.6`, and `composer-2.5`.
- `./install-cursor.sh --variant conductor` and `HARNESS_VARIANT=conductor ./install-cursor.sh` build Conductor. `./install-cursor.sh --status` prints the installed variant from `.harness-variant`.
- `./install.sh --local` vendors `AGENTS.md`, `.cursor/rules`, and `.agents` into the project and defaults to Monolith. Global `./install.sh --yes` stays Conductor. `--variant` and `HARNESS_VARIANT` override both. `orchestration` remains an alias of Conductor.

## [0.4.18] - 2026-10-26

- Pull requests opened or updated by the harness include a show-me visual report. `agent-harness pr-report` writes `docs/pr-reports/<branch-slug>.html` and `.png` (offline HTML, one `@media` breakpoint) and copies both into `/opt/cursor/artifacts/pr-reports/` when that directory is writable. The PR template section `## Visual report` embeds the PNG and links the HTML.
- `.claude/hooks/pr-visual-report.sh` blocks `gh pr create`, `gh pr edit` / `gh pr new` body edits, and `az repos pr create` / `update` descriptions that omit the section. `agent-harness pr-report-check` checks the same rules. A docs typo or a version bump only may skip, with the reason on the skip line. Conductor and Monolith share the skill. OpenCode, Claude Code, and Cursor run the hook.

## [0.4.17] - 2026-10-26

- Local KPI log for Conductor vs Monolith. Hooks append JSON lines to `~/.agent-harness/kpi/events.jsonl` (`AGENT_HARNESS_KPI_LOG`, `AGENT_HARNESS_KPI=0` to disable). The log is separate from the OpenCode tok/s monitor. OpenCode, Claude Code, and Cursor write the same events. Tokens stay null unless the host sends a number.
- `agent-harness kpi report [--since 30d] [--by variant]` prints the comparison, with `--json` and `--html`. Sample sizes are shown. Fewer than 5 tasks or 3 PRs is flagged as too small to conclude. PR outcomes are read-only `gh` lookups.
- `agent-harness eval` runs `evals/tasks` in isolated worktrees. The default checkers do not call a model. `--run-model` is the paid Cursor-agent path.

## [0.4.16] - 2026-10-25

- Two install variants share one skill tree. Conductor stays the conductor-led default. `orchestration` remains an alias of `--variant` and `HARNESS_VARIANT`. Monolith is an install-time overlay (`variants/monolith/`): a short baseline, seven review subagents plus `cop` and `comment-judge`, and folded roles loaded as skills. `./install.sh conductor` and `./install.sh monolith` switch variants; with no name, `./install.sh` asks. `./install.sh --status` prints the installed variant. A switch removes the other variant's agents, commands, and rules. `--yes` with neither set stays Conductor.
- `threejs-*` is one `threejs` skill and `openspec-*` is one `openspec` skill. Each family lives under `references/`. The Cursor plugin build stays the Conductor variant.

## [0.4.15] - 2026-10-25

- show-me renders full-page PNG screenshots via `skills/show-me/scripts/screenshot.sh`. Detection order: Playwright chromium, then Chrome/Chromium, then Firefox (`--no-remote`, throwaway `--profile`, `timeout 60`). Full height is measure-then-capture, capped at 12000px. A 390px phone PNG is made only when the layout differs. Without a browser the helper never fails.
- show-me attaches the PNGs and the HTML through the host's attach-files tool (OpenBot). When attaching, it writes to `~/OpenBot/Shared/show-me/`.
- show-me runs `xdg-open` only when a display is set.

## [0.4.14] - 2026-10-24

- REST fallback when GitHub GraphQL is unavailable (the Claude Code cloud 403 `GitHub GraphQL is not available`, or a transport failure to the `/graphql` endpoint). Only that gh error switches `ship-merge`, `cleanup`, `teardown-merged-worktree`, `ship-init --adopt` and the review-thread check to `gh api repos/...`; any other gh failure refuses exactly as before. Every gate is unchanged, and the normal path sends gh the same arguments.
- In the fallback the protected-path file list must be complete: REST lists at most 3000 files, so `ship-merge` refuses when the count is 3000 or more or differs from the list.
- In the fallback the review-thread gate refuses when the PR has any review comment, because REST cannot tell which threads are resolved. Merge where GraphQL works instead.
- Every REST read is validated and fails closed on a parse error. The stop-gate hook is unchanged.

## [0.4.13] - 2026-10-20

- Worktree activity check uses the most recent Orca timestamp per path; Orca lists each worktree twice and the null entry made every teardown stop.

## [0.4.12] - 2026-10-20

- Teardown after merge. `ship-merge` now records `merged` in the goal registry as well as `goal.json`, and `teardown-merged-worktree` no longer stops on an `escalated` or `blocked` registry status when the PR is MERGED (every other check still applies; an unmerged escalated or blocked goal is still never torn down).
- The stop gate allows the stop, without counting a block, when the PR state cannot be read (gh error or auth), as the autonomy rule documents. Before, an unreadable state counted as no progress and escalated the goal.
- `gh` runs through `direnv exec <repo-root> <pinned gh>` when the repo has an `.envrc` and `direnv` is on PATH, in `ship-merge`, `teardown-merged-worktree`, `cleanup`, `ship-init` and the stop gate, so the repo's gh account is used instead of the personal token. Only the environment comes from `.envrc`; the `gh` binary stays the pinned one, and a `gh` that is not an absolute path never goes through direnv. An approved `.envrc` and the files it sources (`.envrc.local`, `.env`) are trusted.
- The git guard protects `.envrc` like the other harness files (shell writes are denied while autonomy is on) and denies `direnv allow`, `direnv permit`, `direnv grant` and `direnv edit` (editing approves the file) while autonomy is on, so an agent cannot plant and approve code that the harness scripts would load.
- When the PR state is unreadable the stop gate also prints `ship-stop-gate: PR state unreadable; allowing stop` and sends a `waiting` notification.
- `goal set` never replaces the `branch` or `slug` of an existing goal (active, escalated or done) with the cwd's branch. Only `ship-init` binds a goal to a branch.

## [0.4.11] - 2026-10-20

- Removed the `compress` skill (`/caveman:compress`). Its bundled scripts were flagged for reading credentials (#40), and nothing else in the harness used it.

## [0.4.10] - 2026-10-19

- Review gate before push. While autonomy is on and the goal is active, the git guard denies `git push` and `gh pr create` unless `agent-harness goal review code pass` and `agent-harness goal review security pass` are both recorded for the exact diff being pushed (a hash of the diff against `origin/<base>`, ignoring `docs/agent-reports/`). Pushes to `backup/*` are allowed, `gh pr create --head` and `-H` are denied, and the guard fails closed when it cannot compute the key or cannot read `goal.json`. The key is a hash of the byte-exact diff (`--binary --full-index`, no external diff or textconv, diff config overridden), so whitespace-only and binary changes need a new review. A push with no explicit refspec is denied while `remote.<name>.push` is set or `push.default` is `matching`. `gh pr new` is gated like `gh pr create`. Writes to `goal.json` and `autonomy.on` by relative path from `.claude/state`, or through `sponge`, are denied.
- New `agent-harness goal review <code|security> <pass|fail>` records a verdict for the current diff in `goal.json` (and the registry). The latest verdict per kind wins.
- `agent-harness goal bump` now reads the findings on stdin (`<reviewer>:<path>` or `ci:<check>`, one per line; empty stdin exits 2). It escalates with exit 3 when the same findings come back after a fix round, and the fix-round ceiling is 10 instead of 3 for new goals (an existing `goal.json` keeps its stored `max_fix_iterations`; a missing value means 10). `ship-init` writes `base`, `last_fingerprint` and `reviews` into `goal.json`.
- The ship loop reviews locally before the first push, opens the PR ready (not draft), and reviews every CI or comment fix locally before its push. CI, `loop-on-ci`, `fix-ci`, `ship-merge` and teardown are unchanged.
- `pushd` with no argument, `pushd +N` and `pushd -N` rotate the directory stack, so the directory becomes unknown, like `popd`.
- `agent-harness ship-merge <pr> 2>&1 | tail` is no longer denied; `gh pr merge | tail` still is.

## [0.4.9] - 2026-10-19

- The autonomy git guard scan is rewritten as linear awk passes with a bounded number of forks. Commands of 200K characters or 5000 lines are decided in under a second, and decisions are unchanged except two: a relative path with `..` is resolved correctly under bash 3.2 (see below), and `popd` now makes the directory unknown, so a later `git push` is judged as after an unresolvable `cd`.
- The guard denies with "cannot parse" when `awk` is missing, when an awk pass fails or is killed, and when its output is empty or truncated.
- The guard converts Windows path spellings (`C:\a\b`, `C:/a/b`) and asks a native `jq.exe` for LF output under Git Bash, and its branch-lookup cache only keys plain-ASCII paths.
- Hooks are registered as `bash <script>` in `.claude/settings.json`, in the settings the installer merges (existing direct entries are migrated) and in the Cursor hooks, and the git guard is tracked executable, so a lost exec bit can no longer silently disable a guard. The installer migrates only this repo's own hook scripts (a user's own hook command is left as written), marks copied hooks executable, and stops when a registered hook script is missing.
- Under bash 3.2 (the macOS system bash) a relative path with `..` was resolved wrongly, so `rm -rf ../<worktree>` could be allowed. It is now resolved correctly; the 0.4.8 guard has the same flaw.
- Under Git Bash the guard recognises `git.exe` and `gh.exe`, case-insensitive command names, `C:\...`, `//?/C:/...` and `/cygdrive/c/...` paths, and compares paths without case.
- A `git-guard` CI workflow runs the guard tests and `test-hooks.sh` on Linux (mawk and gawk), macOS and Windows Git Bash, and a seeded differential against the 0.4.8 guard on the Linux and macOS runners.

## [0.4.8] - 2026-10-18

- `/tdd refactor` pins current behavior with characterization tests that pass immediately. The restructure does not edit those tests. Planner, blast-radius, and `/verify` use that pin as the baseline.
- `install-cursor.sh` installs the agent-harness CLI with the same helper as `install.sh`.
- `/e2e` and `e2e-runner` read a project `e2e.json` override or discover the start command, ports, and test runner. `"enabled": false` opts out.
- The autonomy git guard applies the quote-aware scan to `gh`, so a quoted assignment can no longer hide `gh pr merge`.

## [0.4.7] - 2026-10-18

- The autonomy git guard denies a git or rm command it cannot parse: command substitution, backticks, ANSI-C quoting, brace expansion of a git word, and a base ref hidden by a line continuation. While autonomous, `git -c` and `GIT_CONFIG_*` are rejected; `--config-env` and `alias.*` are rejected in every mode. `--git-dir`, `--work-tree`, `GIT_DIR`, and `GIT_WORK_TREE` count when deciding which branch a push updates. Removing a worktree's `.git` metadata is denied, including without `-r`.

## [0.4.6] - 2026-10-18

- `socratic-design` prototypes any question a spike under 30 minutes can settle, and presents that result instead of asking. An L-sized task is restated in the agent's own words, and that restatement is confirmed, before planning.

## [0.4.5] - 2026-10-18

- Cop and comment-judge badges match the review tags: Important, Nit, Pre-existing, and a question. Only Important blocks, and a finding that cites an AGENTS.md hard rule also blocks. Questions never block. Pre-existing does not block. The APPROVE-WITH-CHANGES verdict and the five-color category ladder are gone. Category labels stay after the tag. The comment-judge JSON `tier` is `Important`, `Nit`, or `❓`.

## [0.4.4] - 2026-10-18

- `create-verification-skill` writes a project `verify-this` override from the repository's package.json, Makefile, .NET project, and CI workflow commands.
- `verify-this` runs that override when the project has one, and otherwise keeps its generic surfaces. Claude Code keeps the installed skill in front of a project skill, OpenCode v2 replaces it from `.opencode/skills`, and Cursor does not document same-name order, so the loader reads the file itself.

## [0.4.3] - 2026-10-18

- Always-applied Cursor rules drop from 21 files (1438 lines) to 7 files (502 lines). Domain rules load by path or by skill description. ESLint, secret scanners, and `npm audit` are named where prose used to restate them.
- `performance`, `patterns`, and `hooks` are skills. File-bound rules (`code-comments`, `testing`, `coding-style`, `security`) use `paths`. The `ai-ecosystem-audit` skill checks the always-on budget.

## [0.4.2] - 2026-10-18

- Pull request template with Risk, How to revert, and Tier. `/setup-harness` offers that template to a project that does not have one.
- The reviewer reads `REVIEW.md` when the repository has one and uses it as the single reference for the tag mapping. Otherwise it uses the default tag rules.

## [0.4.1] - 2026-10-17

- Enforcement ladder: code, then lint, tests, or static analysis, then a prose rule, then human review. A prose rule carries `why-not-tooled:`.
- From this version on, plugin changes bump the patch number only.

## [0.4.0] - 2026-10-17

- Review findings use the tags Important, Nit, and Pre-existing. Only Important blocks the merge. The Warning verdict is gone: Approve means no Important finding is open, and Block means at least one is.
- `check.mjs` rejects the old review severities in harness sources. GDPR, database, and plan risk levels stay, as do npm audit and CVE severities.

## [0.3.0] - 2026-10-17

- CodeMemory is skipped in cloud and remote agent sessions. `FMFLURRY_CODEMEMORY=on|off|auto` overrides detection (`auto` is the default). Hooks no-op when it is off. A local macOS session is unchanged.
- Ship review/fix rounds stop at 3. The no-progress rule is unchanged. Hitting the cap escalates with the remaining findings.

## [0.2.0] - 2026-10-17

- Semver is enforced. A change to plugin sources must bump `version` strictly above the base branch, and this file needs a heading for that version.
- Before 0.4.1: patch for fixes, chores, and doc tweaks; minor for new agents, skills, commands, rules, or behavior; major for breaking changes (renamed or removed agents or skills, tier key changes, installer contract changes). From 0.4.1 on, bump the patch only.

## [0.1.0] - 2026-10-07

- Initial plugin: conductor routing, specialist agents, skills, commands, rules, hooks, and the code-memory MCP server.
- Cursor models only (PR #24, 2026-10-15): tier defaults are Grok 4.7, with Grok 4.6 and Composer 2.5 fallbacks. Third-party slugs and `-fast` variants are rejected. That change shipped without a version bump, so the manifest stayed 0.1.0.
