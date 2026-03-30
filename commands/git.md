---
description: Handle git tasks with enforced branch and commit naming conventions
agent: git-specialist
subtask: true
---

# Git Command

Handle this git task: $ARGUMENTS

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

`scope` is required for branches. If it is ambiguous, ask one short question before creating the branch.
`scope` must be a single lowercase token with letters and numbers only. The first `-` after `/` separates `scope` from `short-description`.

3. Use `git-specialist` workflow:

- inspect repository state first
- use a compliant branch name for branch operations
- use a compliant conventional commit message for commit operations
- stage only relevant changes
- avoid destructive commands unless explicitly requested
- use `gh` and return the PR URL for pull request tasks
- use the repository default branch as PR base when available, otherwise prefer `main`, then `master`
- return an existing PR URL instead of creating a duplicate PR for the same branch

## Output

- `Branch`: created, current, or proposed branch name
- `Commit`: created or proposed commit message
- `Push`: yes or no
- `PR`: URL when a pull request exists or was created, otherwise `n/a`
- `Notes`: any ambiguity, blocker, or excluded changes
