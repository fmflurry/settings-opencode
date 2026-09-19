---
description: Reject a staged learning change by ID (project or global queue)
agent: conductor
---

# Learn Reject

Reject and delete a staged learning change: $ARGUMENTS

## Your Task

The argument is a pending file ID (filename without extension). For example: `1712345678-mistral-pattern`.

1. Search both pending queues for the file matching the ID, project first:
   - **Project** (when the current repository contains `.opencode/skills/`): `.opencode/pending/skills/` and `.opencode/pending/memory/`
   - **Global**: `~/.config/opencode/pending/skills/` and `~/.config/opencode/pending/memory/`
2. If found:
   - Read the file to confirm the type and reason
   - Delete the pending file
   - Report: "❌ Rejected and deleted pending change: <id> (<type>: <reason>)"
3. If not found:
   - Report: "❌ No pending change found with ID: <id>"
