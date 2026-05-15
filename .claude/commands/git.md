---
description: Handle git tasks with enforced branch and commit naming conventions
---

# Git Command

Handle this git task: $ARGUMENTS

> CC has no dedicated `git-specialist` agent. The primary agent handles git directly.
> For richer flows, prefer the existing `/prp-commit`, `/prp-pr`, or `/create-pull-request` commands.

## Requirements

1. Enforce the commit format exactly:

```text
<type>(<scope>): <short summary>

[optional body]

[optional footer(s)]
```

If scope is not useful or not clear, this form is also valid:

```text
<type>: <short summary>
```

Allowed types: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`

2. Enforce the branch naming format exactly:

```text
<type>/<scope>-<short-description>
```

`scope` is required for branches. If it is ambiguous, ask one short question via `AskUserQuestion` before creating the branch.
`scope` must be a single lowercase token with letters and numbers only. The first `-` after `/` separates `scope` from `short-description`.

3. Workflow:

- inspect repository state first (`git status`, `git diff`, `git log --oneline -5`)
- use a compliant branch name for branch operations
- use a compliant conventional commit message for commit operations
- stage only relevant changes (avoid `git add -A` / `git add .`)
- never commit files that may contain secrets (`.env`, `*credentials*`, `*.key`, `*.pem`)
- avoid destructive commands unless explicitly requested
- use `gh` and return the PR URL for pull request tasks
- use the repository default branch as PR base when available, otherwise prefer `main`, then `master`
- return an existing PR URL instead of creating a duplicate PR for the same branch
- never use `--no-verify` or skip hooks unless the user explicitly asks
- never amend or force-push without explicit user authorization

## Output

- `Branch`: created, current, or proposed branch name
- `Commit`: created or proposed commit message
- `Push`: yes or no
- `PR`: URL when a pull request exists or was created, otherwise `n/a`
- `Notes`: any ambiguity, blocker, or excluded changes
