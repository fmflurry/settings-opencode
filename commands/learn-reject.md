---
description: Reject a staged learning change by ID
agent: conductor
---

# Learn Reject

Reject and delete a staged learning change: $ARGUMENTS

## Your Task

The argument is a pending file ID (filename without extension). For example: `1712345678-mistral-pattern`.

1. Search both `~/.config/opencode/pending/skills/` and `~/.config/opencode/pending/memory/` for the file matching the ID
2. If found:
   - Read the file to confirm the type and reason
   - Delete the pending file
   - Report: "❌ Rejected and deleted pending change: <id> (<type>: <reason>)"
3. If not found:
   - Report: "❌ No pending change found with ID: <id>"
