---
name: fix-ci
description: Find failing PR checks, inspect logs or check links, and apply focused fixes. Routing depends on failure type (build/test/security).
---

# Fix CI

If the current project has `.claude/skills/fix-ci/SKILL.md` or `.opencode/skills/fix-ci/SKILL.md`, read it and its `references/`; project specifics override this generic version.

## Trigger

A branch or PR has failing CI checks and needs a fast, iterative path to green.

## Workflow

### 1. Resolve the PR

Extract PR metadata:

```bash
gh pr view --json number,url,headRefName,baseRefName
```

If `gh` cannot map the SSH host alias (e.g., `gh-pro`), provide `--repo <owner/repo>` derived from:

```bash
git remote get-url origin
```

### 2. Inspect Checks

List all PR-attached checks:

```bash
gh pr checks --json name,bucket,state,workflow,link
```

Identify the first failed or erroring check. Use `bucket` to filter to actionable states (not "completed" or "skipped").

### 3. Inspect Logs

For GitHub Actions runs, extract logs:

```bash
gh run view <run-id> --log-failed
```

For external checks (Sonarqube, etc.), follow the `link` field to the check's page.

### 4. Derive Routing from Workflow Files

Before applying a fix, read the workflow file(s) to understand the job structure and owner:

- **GitHub Actions:** Read `.github/workflows/*.yml`. For the failing job, extract:
  - Job name and `runs-on` platform
  - `steps` with `run:` commands (these are your repro steps)
  - `needs:` (job dependencies)
  - `secrets:` and Docker image requirements
  
- **Azure Pipelines:** Read `azure-pipelines.yml`. For the failing stage/job:
  - Stage name and job `pool` (platform)
  - `steps` with `script:` commands (these are your repro steps)
  - Service connections and Docker image requirements

From this analysis, build a job → repro command → owner map. Examples per tech stack:

| Stack | Repro Command | Owner |
|-------|---|---|
| TS/Angular/Node | `npx tsc --noEmit` | build-error-resolver |
| Node linting | `npm run lint` or `pnpm run lint` | build-error-resolver |
| .NET build | `dotnet build --nologo -clp:ErrorsOnly` | build-error-resolver |
| .NET test | `dotnet test` | tdd-guide or coder |
| Node tests | `npm test` or `pnpm test` | tdd-guide or coder |
| E2E (Playwright, Cypress, etc.) | `npm run e2e` (or project-specific) | e2e-runner |
| Secret scanning (gitleaks) | Workflow log excerpt | **STOP**, security-reviewer; rotate any exposed secret |
| SAST/Security scanner (opengrep, SonarQube, etc.) | Check logs | security-reviewer |
| Dependency/supply-chain gates | Check workflow output | Ask human (new dependencies need review) |
| Branch-name checks | Workflow rule output | Ask human (rename requires new PR) |

### 5. Reproduce Locally

Before applying a fix, reproduce the failure locally using the repro command extracted above. Verify the issue is real, not environmental.

### 6. Route the Fix

Determine the failure type and delegate appropriately:

| Failure Type | Route | Notes |
|---|---|---|
| Build, typecheck, lint (tsc, eslint, prettier, dotnet build, etc.) | build-error-resolver | Minimal fix, verify with same command locally |
| Unit tests or integration tests failing | tdd-guide or coder | Fix the test or implementation; do not disable tests |
| Comment gate, permissions, branch naming | Ask human | Inspect the workflow output for the gate rule |
| gitleaks (leaked secrets) | **STOP**, security-reviewer | Never allowlist; rotate the secret; abort immediately |
| opengrep / SAST security scanner | security-reviewer | Severity-based routing |
| supply-chain, check-added-deps | **STOP**, ask human | New dependencies need security review before approval |
| branch-name policy violation | ask human | Rename requires new PR; never force-push a rename onto an existing PR |

### 7. Push and Re-Check

After a fix is merged locally:

1. Stage relevant files and create a commit (or squash into an existing one per git-workflow conventions).
2. Push to the branch (via git-specialist, normal push, no force).
3. Re-run `gh pr checks --json …` to see the updated check set.
4. If all checks are green, report success.
5. If new failures appear, repeat from step 2 (root cause diagnosis).

## Guardrails

- **Never edit workflows** (`.github/workflows/*.yml`, `azure-pipelines.yml`) without explicit human consent. Workflow changes are infrastructure; they belong in a separate PR.
- **Never disable or skip tests.** If a test is failing legitimately, fix the code, not the test.
- **Never use `--no-verify`** to bypass hooks.
- **Routing is mandatory.** Do not attempt to fix build errors, tests, or security issues directly; dispatch to the appropriate specialist.

## Output

- PR URL and current branch
- First failing check: name, link, and root error or log excerpt
- Workflow file location and job analysis (repro command, owner)
- Fixes applied, iteration order, and result (green or still-failing)
- Next action (repeat if needed, or report success)
