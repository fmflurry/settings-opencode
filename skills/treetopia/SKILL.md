---
name: treetopia
description: Use ONLY when the user explicitly asks to create/use a worktree, isolated worktree, parallel feature branch, or avoid branch collision; immediately create an isolated OpenCode worktree for that task. Do not trigger for ordinary feature work.
---

# Treetopia

Create an isolated OpenCode worktree whenever the user explicitly wants branch isolation, parallel feature work, or protection from branch collisions.

## Trigger Rules

Use this skill only when the user explicitly says one of these intents:

- Create a worktree.
- Use a worktree.
- Use an isolated worktree.
- Create a parallel feature branch.
- Avoid branch collision.
- Keep two agents or two features from sharing one branch.

Do not use this skill merely because the user asks for normal implementation, refactor, testing, or feature work. Ordinary feature work stays in the current checkout unless the user explicitly requests isolation.

## Purpose

Prevent two primary agents or two active features from sharing the same branch and overwriting or colliding with each other's changes.

## Start Workflow

When triggered:

1. Derive a concise branch name from the user's task.
   - Use lowercase words separated by hyphens.
   - Prefer a short prefix such as `feature/`, `fix/`, or `chore/` when obvious.
   - Keep the name specific enough to identify the task.
2. Determine the base branch.
   - If the user names a base branch, use that branch.
   - Otherwise, default to the current branch.
3. Immediately call `worktree_create`.
   - Pass the derived branch name.
   - Pass the base branch only when the user named one or the tool requires it.
4. Continue development inside the new worktree/session created by the tool.

Example tool intent:

```text
worktree_create(branch: "feature/customer-import", baseBranch: "main")
```

If no base branch was named:

```text
worktree_create(branch: "fix/login-timeout")
```

## Development Guidance Inside Worktree

- Treat the worktree as the isolated task workspace.
- Follow normal project instructions, architecture rules, and verification gates.
- Do not assume the original checkout has your worktree changes.
- Avoid cross-worktree edits unless the user explicitly asks.
- Preserve the verification gate before proposing teardown, merge, or cleanup.

## Tool-Use Guidance

- Use `worktree_create` for worktree creation.
- Use `git-specialist` for git-only operations when available, including merge, branch creation, branch deletion, status checks, and cleanup.
- Ask before any destructive or shared-state action, including branch deletion, worktree deletion, force push, merge into shared branches, or overwriting files.
- Do not auto-delete a worktree.
- Do not auto-merge a branch.
- Do not bypass hooks or verification.

## Teardown Workflow

When development in the worktree is finished:

1. Run required verification first.
   - Build/typecheck/lint as appropriate for the project.
   - Run tests when behavior changed.
   - Fix failures caused by the worktree changes before offering teardown.
2. Offer a cleanup/merge path.
   - Merge back into the original branch, or
   - Merge into another user-named target branch.
3. If the user names a target branch that does not exist, offer to create it.
4. Ask for explicit confirmation before performing merge, branch creation, branch deletion, or worktree deletion.
5. After confirmation, use `git-specialist` for git-only operations when available.
6. After merge or cleanup, report what changed and what remains.

Suggested teardown prompt:

```text
Worktree verification passed. Merge/cleanup options:
1. Merge this branch back into the original branch.
2. Merge into another target branch. If it does not exist, I can create it first.
3. Keep worktree and branch for later.

Which path should I take?
```

## Safety Rules

- Never delete the worktree without explicit user confirmation.
- Never merge without explicit user confirmation.
- Never create a named target branch without explicit user confirmation.
- Never force-push unless the user explicitly asks in the same turn.
- Never skip verification before teardown unless the user explicitly waives it.
- If a merge conflict occurs, stop and report the conflict status before resolving unless the user already authorized conflict resolution.

## Activation Note

After this skill is installed and OpenCode is restarted, it becomes active. Running OpenCode sessions keep using the skills loaded at startup.
