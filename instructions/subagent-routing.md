# Subagent Routing Rule

## Scope

This rule applies to primary agents that have the Task tool available. If you are already running as a specialist subagent, or if Task is unavailable, do not delegate again; perform your assigned specialist task directly.

**Exception:** `tdd-guide` is permitted to Task `coder` (and only `coder`) to obtain the GREEN implementation after writing failing tests. No other subagent may re-delegate.

## First-Tool Gate

Before any direct inspection or work, decide whether the user request matches a specialist below. If it matches and Task is available, your first tool call MUST be Task to that specialist.

Do not use `bash`, `read`, `write`, `edit`, or MCP tools, including Serena, before that first Task call. This rule overrides inspect-first habits and other tool-use guidance. If Task is unavailable or fails, then fall back to direct tools and report the blocker.

## Task Must Be First When

- Implementation work: write/port/scaffold/apply-spec non-test code -> `coder`
- Writing or editing docs, README, markdown, HTML reports, release notes, ADRs, prose -> `writer`
- Git, commit, branch, push, pull request creation/status, PR creation/status -> `git-specialist`
- Code review, PR review, pull request review, current-change review, "does this need review" -> `code-reviewer` (read-only; fixes go to `coder`)
- Security review, auth, secrets, user input, API endpoints -> `security-reviewer` (read-only; fixes go to `coder`)
- Build, lint, typecheck, or TypeScript errors -> `build-error-resolver`
- Planning, complex features, unclear order, large refactors -> `planner`
- Architecture, design, scalability, cross-module tradeoffs -> `architect`
- TDD, tests, coverage, test strategy -> `tdd-guide` (writes tests; delegates impl to `coder` itself)
- E2E/browser journeys/Playwright -> `e2e-runner`
- Codemap or generated-doc updates -> `doc-updater`
- Dead code, unused exports, duplication cleanup -> `refactor-cleaner`
- SQL, PostgreSQL, Supabase, RLS, migrations -> `database-reviewer`

## Conductor Cannot Write Directly

The primary `conductor` agent has `write` and `edit` disabled (permissions + hook enforced). Every file change MUST go through a subagent:

- Source code -> `coder`
- Tests -> `tdd-guide` (which itself delegates impl to `coder`)
- Docs/markdown/HTML/text -> `writer`
- Generated docs/codemaps -> `doc-updater`
- Refactor cleanup -> `refactor-cleaner`
- Git operations (commit/push/PR) -> `git-specialist`

There is no "direct trivial edit" escape hatch for the primary anymore. If you find yourself wanting to edit, pick a subagent.
