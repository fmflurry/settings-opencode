---
description: Create a pull request (auto-detects GitHub `gh` or Azure DevOps `az`)
---

Your goal is to create a pull request. Detect the host from `origin` and use the matching CLI.

## 0. Detect Host

Run:

```bash
git remote get-url origin
```

Match the URL host:

| Host pattern                              | CLI to use | Detected as |
|-------------------------------------------|------------|-------------|
| `github.com`                              | `gh`       | `github`    |
| `dev.azure.com`, `visualstudio.com`       | `az`       | `azure`     |
| anything else                             | stop       | `unknown`   |

If `unknown`, stop and report: "Origin `<url>` is not GitHub or Azure DevOps. Cannot create PR."

If the chosen CLI is missing, stop:
- github → "GitHub CLI (`gh`) required. Install: <https://cli.github.com/>"
- azure  → "Azure CLI (`az`) required. Install: <https://aka.ms/InstallAzureCli>, then `az extension add --name azure-devops`."

Auth check before proceeding:
- github → `gh auth status`
- azure  → `az account show` (and `az devops configure --list` for org/project defaults)

## 1. Inputs

- Source branch: current branch (`git branch --show-current`).
- Target branch: from `$ARGUMENTS` if present, else repository default (`main`, `master`, or whatever Azure project defines).
- Title: **MUST** follow conventional commit:

  ```text
  <type>(<scope>): <short summary>
  ```

  Example: `feat(api): add user authentication endpoint`

- Body: concise `## Summary` section listing the change set.

## 2. Push current branch

```bash
git push -u origin HEAD
```

If push fails on divergence, rebase against the target then retry with `--force-with-lease` (never `--force`).

## 3. Create the PR

### github

```bash
gh pr create \
  --base "<target>" \
  --title "<conventional-title>" \
  --body  "<body>"
```

Add `--draft` if the user asks for a draft.

### azure

Reviewers default to group `PIXELS` unless the user overrides.

```bash
az repos pr create \
  --source-branch "<current>" \
  --target-branch "<target>" \
  --title         "<conventional-title>" \
  --description   "<body>" \
  --reviewers     "PIXELS" \
  --output        json
```

If the Azure CLI prompts for org/project, set them via `az devops configure --defaults organization=<url> project=<name>` or pass `--organization` / `--project` explicitly.

## 4. Verify & report

- github → `gh pr view --json number,url,title,state,baseRefName,headRefName`
- azure  → `az repos pr show --id <id> --output json` (id is in step 3 JSON output)

Report back:

```
Host:   github | azure
PR:     <number or id> — <title>
URL:    <url>
Branch: <head> → <base>
```

## Safety

- Never force-push to `main` / `master` / default branch.
- Never bypass hooks (`--no-verify`) unless the user explicitly asks.
- If a PR already exists for the current branch, return its URL instead of creating a duplicate:
  - github: `gh pr list --head "$(git branch --show-current)" --json number,url`
  - azure:  `az repos pr list --source-branch "$(git branch --show-current)" --status active --output json`
