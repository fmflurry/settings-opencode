---
description: Commit relevant changes and push through the git workflow
agent: git-specialist
---

# Push Changes Command

Delegate to the `git-specialist` agent (sonnet) to commit and push.

## Task

Commit the relevant changes with a compliant conventional commit message and push the current branch to its remote.

## Pre-push verification (mandatory)

Before pushing, inspect every local commit that would be published:

- Compare against the tracked upstream when one exists (`git log @{u}..HEAD`).
- Otherwise compare against the branch point from the repository default branch (`git log $(git merge-base HEAD origin/<default>)..HEAD`).
- **Stop and report** if unrelated committed work would also be published — do not push silently.

If no upstream exists and the published commit set is correct, push with upstream tracking (`git push -u origin <branch>`).

If there is nothing to commit, do not create an empty commit.

If hooks fail or the push is ambiguous, stop and report the blocker.

## Additional context

$ARGUMENTS

## Output

Return the standard `git-specialist` summary:

- `Branch`
- `Commit`
- `Push`
- `PR`
- `Notes`
