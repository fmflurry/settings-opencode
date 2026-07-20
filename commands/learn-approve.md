---
description: Approve a staged learning change by ID
agent: conductor
---

# Learn Approve

Approve and apply a staged learning change: $ARGUMENTS

## Your Task

The argument is a pending file ID (filename without extension). For example: `1712345678-mistral-pattern`.

1. Search both `~/.config/opencode/pending/skills/` and `~/.config/opencode/pending/memory/` for the file matching the ID
2. Read the JSON file
3. Based on the `type` field:

### If type === "skill"
- Action "create": Create the skill at the appropriate path under `~/.config/opencode/skills/` using `skill_manage` or file write
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
