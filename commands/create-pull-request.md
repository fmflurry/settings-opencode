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

- Body: construct using the **PR body contract** below. Soft guidance — the model SHOULD follow this shape when composing the body, but missing sections do not block PR creation.

#### PR Body Contract

**Header line (always):**
```
<scope/BC one-liner> for <work item link AB#<id>> + <N commits> : <one-line what>
```
Commit count from `git rev-list --count <base>..HEAD`. Include work item ref when an `AB#<id>` exists in commits or branch; omit if none.

**Language (mandatory):** the PR title and PR body MUST be written in English — headers and prose — even when the user or conversation is French. Translate French input into an English summary; never paste French text. (Quoting user-facing verbatims from the product remains allowed.)

**Optional sections** — include ONLY when they carry real content; omit entirely if empty:
- `## Content` — bullets grouped by layers touched (Domain / Application / Infrastructure / Api). Quote user-facing verbatims exactly ("…"), never paraphrase.
- `## QA tests` — test-case IDs as `tc:<id>/<step>` with ✅/❌ status. Omit section if no QA work.
- `## Locked decisions` — locked decisions only; facts, not TODOs.
- `## Non-blocking follow-ups` — follow-ups; keep separate from blocking scope.

**Scale-to-size rule:**
- **Tiny PR** (≈1 file / trivial fix): header + short `## Content` only. Do NOT force QA / Locked decisions / Follow-ups sections.
- **Medium/large PR:** add sections as content justifies.
- **Golden rule:** a section exists iff it has ≥1 real bullet point. Omit empty sections rather than padding with "N/A".

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
