---
description: Approve a staged learning change by ID (project or global queue)
agent: conductor
---

# Learn Approve

Approve and apply a staged learning change: $ARGUMENTS

## Your Task

The argument is a pending file ID (filename without extension). For example: `1712345678-mistral-pattern`.

1. Search both pending queues for the file matching the ID, project first:
   - **Project** (when the current repository contains `.opencode/skills/`): `.opencode/pending/skills/` and `.opencode/pending/memory/`
   - **Global**: `~/.config/opencode/pending/skills/` and `~/.config/opencode/pending/memory/`
2. Read the JSON file
3. Based on the `type` field:

### If type === "skill"
- Action "create": Create the skill at the appropriate path using `skill_manage` or file write — `.opencode/skills/` when the pending file came from the project queue, otherwise `~/.config/opencode/skills/`
- Action "patch": Apply the content diff to the existing skill file
- On success: delete the pending file
- Report: "✅ Approved and applied skill: <name>"

### If type === "memory"
- Extract each claim from the `claims` array
- For each claim, call `codememory_assert_claim` with the subject/predicate/object/confidence
- On success: delete the pending file
- Report: "✅ Approved and applied <N> memory claim(s): <subjects>"

If the pending file is not found, report: "❌ No pending change found with ID: <id>"

## Important
- Do NOT use `codememory_assert_claim` for skill proposals — only for memory claims
- Delete the pending file ONLY after successful application
- If application fails, report the error and leave the file for retry
