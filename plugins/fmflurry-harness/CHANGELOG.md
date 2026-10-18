# Changelog

Versions of the fmflurry-harness Cursor plugin. The number lives in `scripts/cursor-plugin/config.json` and is copied into `.cursor-plugin/plugin.json` by `node scripts/build-cursor-plugin.mjs`.

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
