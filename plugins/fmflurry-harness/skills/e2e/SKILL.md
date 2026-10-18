---
name: e2e
description: "Resolve this project's browser end-to-end stack before /e2e or e2e-runner writes tests. Reads the project e2e.json override, or discovers the start command, ports, and test runner. Use when running end-to-end tests, Playwright, or Cypress. A project sets enabled to false to opt out."
---

# E2E stack

why-not-tooled: choosing which journey to cover is a judgment. The start command, ports, and runner are read from the project file or the manifests.

`/e2e` and `e2e-runner` load this skill first. Run `scripts/resolve.mjs` from this skill's directory:

```bash
node scripts/resolve.mjs --root <repository-root> --harness <cursor|opencode|claude>
```

`--harness` is `cursor` in Cursor, `opencode` in OpenCode, and `claude` in Claude Code. Omit it and the script uses the same environment detection as `verify-this` (`VERIFY_HARNESS`, then Cursor, then Claude, then OpenCode). The script prints JSON. It does not start servers or run tests.

## Project override

The file is `e2e.json`, version 1. The loader checks the current harness first, then `.cursor/skills/e2e/e2e.json`, `.opencode/skills/e2e/e2e.json`, and `.claude/skills/e2e/e2e.json`. The first file that exists wins. A missing file is skipped. An unreadable file or a version other than 1 is an error and is not replaced by discovery.

```json
{
  "version": 1,
  "start": ["npm run dev"],
  "ports": [3000],
  "baseUrl": "http://127.0.0.1:3000",
  "test": "npm run test:e2e",
  "cwd": "e2e",
  "runner": "playwright",
  "skills": []
}
```

`start` may be one string. `startOwnedByRunner: true` means the test runner starts the app. `skills` names playbook skills to load. Load a playbook only when the override names them. Shipping `playwright-e2e-authoring` or `playwright-e2e-review` with the harness does not turn them on.

A project that does not want browser end-to-end tests opts out:

```json
{ "version": 1, "enabled": false }
```

`excluded: true` means stop. Do not create tests and do not start a stack. Consumers that do not want the optional Playwright playbooks omit `playwright-e2e-authoring` and `playwright-e2e-review` when they vendor the harness.

## Discovery

With no override, the script reads, in order:

- `package.json` scripts `test:e2e`, `e2e`, `e2e:ci` (package manager from the lockfile: bun, pnpm, yarn, then npm; the command is `<pm> run <script>`)
- a Playwright config at the repository root or `tests/playwright/playwright.config.*` (`baseURL`, `webServer.command`, `webServer.url`)
- `@playwright/test` or `playwright`, then `npx playwright test`
- Cypress, then `npx cypress run`
- a root `Makefile` target `e2e`, then `make e2e`
- `dev` or `start` as the start command when the Playwright config has no `webServer.command`

`source: "none"` means nothing runnable was found. Report that and stop. Do not invent a framework, a port, or a process manager.

Headed, UI, and report commands are set only when the package has `test:e2e:headed`, `test:e2e:ui`, or `test:e2e:report` (or the `e2e:*` names).

## What the agent does with the JSON

- `ok: false`: report `error` and stop.
- `excluded: true`: stop.
- `source: "none"`: stop.
- Otherwise run `start` unless `startOwnedByRunner` is true, write tests in `cwd` following the project's existing layout and any `CLAUDE.md` or `AGENTS.md` next to those tests, then run `test`.
