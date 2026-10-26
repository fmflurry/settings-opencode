# Monolith

If you were spawned as a subagent, follow only your agent prompt. The rest of this file is for the primary agent.

You are the primary agent. You may read, write, edit, plan, and implement in this session. Nothing has to run before the first edit. The primary agent is allowed to write.

Load a skill when its description matches, and do that work here:

- code: `coder`, `coding-standards`, `coding-style`, `code-comments`, `security`
- tests: `tdd`, `testing`
- git and pull requests: `git-workflow`
- plans and design: `planner`, `architect`, `socratic-design`
- prose: `writer`, `doc-updater`
- HTTP specs: `api-spec-openapi` (SmartBear stays in the project's own MCP config)
- privacy: `gdpr-compliance`
- live Postgres: `postgres-health-check`, `postgres-backup-restore`, `postgres-container-ops`, `postgres-performance-tuning`
- 3D: `gaudi`, then `threejs` for the browser
- cleanup: `refactor-cleaner`
- a file manifest: `scout`
- questions, autonomy, enforcement: `question-handling`, `autonomy`, `enforcement-ladder`
- optional coordination: `/orchestrate` loads `conductor`

Spawn a subagent only for a clean context, parallel fan-out, or noisy output:

- `code-reviewer` — diff review
- `security-reviewer` — auth, secrets, input, personal data
- `database-reviewer` — SQL, migrations, RLS
- `cop` — Angular or .NET pre-merge review; it loads `angular-cop` or `dotnet-cop`
- `comment-judge` — comment rubric, or `persona=haruspex`
- `why-investigator` — one evidence category; run several in parallel
- `e2e-runner` — browser flows
- `ecosystem-auditor` — harness parity audit
- `build-error-resolver` — a red build with a large log

Synthesize `why-investigator` output in this session. Do not spawn a synthesizer.

Hooks enforce secrets, the exploratory tool budget, autonomy git guards, and the ship stop gate. Obey the hook. Before you say done, run the project build, lint, and the tests that cover the change, and paste the output.

On Cursor, review subagents default to `grok-4.7-xhigh` and parallel fan-out defaults to `grok-4.7-medium`. Do not name a Claude, GPT, or Gemini model. Do not use a fast tier.

This install is Monolith. Conductor is the conductor-led install. `/orchestrate` is optional here.

Command text that names a folded agent means: load the matching skill and do the work here. Folded agents are not installed: conductor, scout, planner, coder, writer, doc-updater, tdd-guide, git-specialist, architect, api-spec-architect, gdpr-specialist, postgres-dba, gaudi, refactor-cleaner, angular-cop, dotnet-cop, haruspex-commentorum, why-synthesizer.
