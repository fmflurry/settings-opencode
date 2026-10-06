---
description: Generate and run E2E tests with Playwright
agent: e2e-runner
subtask: true
---

# E2E Command

Generate and run end-to-end tests using Playwright: $ARGUMENTS

## How This Command Works

- The `e2e-runner` agent loads the `playwright-e2e-authoring` skill to write tests, then the `playwright-e2e-review` skill to self-audit your work.
- The four hard rules—no mocks, Page Object Model, work by fixture, per-application-module—are canonical in `tests/playwright/CLAUDE.md` and enforced by the skills.
- Tests drive the **real gc.platform stack**: Angular frontend on `http://localhost:4200` + .NET backend on `http://localhost:5100`, orchestrated by `docker-compose`. No mocks, no stubs, no simulations.
- The suite runs against **system Chrome only** (browser CDN is firewall-blocked); do not expect Firefox/WebKit.

## Prerequisites

1. **Docker Compose stack running:** `docker-compose up` from the repo root. Both frontend and backend must be healthy.
2. **Chrome installed** on the host (system browser, not downloaded).
3. **Module name matches frontend structure:** `frontend/src/app/modules/<module>` → `tests/<module>/`.

## Run Commands

After the agent creates/updates your tests, use these commands (from `tests/playwright/`):

```bash
# Strict TypeScript check (must be clean before running)
npx tsc --noEmit --pretty false

# Run tests for your module
npm run test:e2e -- tests/<module>

# Run with visible browser (headed mode)
npm run test:e2e:headed -- tests/<module>

# Interactive UI mode for debugging
npm run test:e2e:ui -- tests/<module>

# View HTML report + traces after run
npm run test:e2e:report
```

## Output

You receive:

- **Files created/modified:** POMs under `tests/<module>/pages/`, fixture at `tests/<module>/fixtures/<module>.fixture.ts`, spec(s) at `tests/<module>/<feature>.spec.ts`.
- **TypeScript verification:** Last ~15 lines of `tsc --noEmit --pretty false` output (must be clean).
- **Test run result:** Passed/Failed/Skipped counts.
- **Artifacts:** HTML report and trace files in `test-results/` and `playwright-report/` (open via `npm run test:e2e:report`).
- **Rule compliance:** Any deviations from the four rules noted explicitly.
