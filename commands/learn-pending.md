---
description: List all staged learning changes awaiting approval
agent: conductor
---

# Learn Pending

List all staged learning changes awaiting approval: $ARGUMENTS

## Your Task

1. List all files in `~/.config/opencode/pending/skills/` and `~/.config/opencode/pending/memory/`
2. For each file, parse the JSON and display:
   - **ID**: filename (without extension)
   - **Type**: skill or memory
   - **Action**: create or patch
   - **Reason**: the stated reason for the change
   - **Timestamp**: when it was created
3. At the end, show:
   - Total pending count
   - Instructions for approving/rejecting

## Output Format

```
## Pending Learning Changes

### Skills (/pending/skills/)
| ID | Action | Reason | Created |
|----|--------|--------|---------|
| 1712345678-mistral-pattern | create | Mistral models need explicit tool reminders | 2026-04-05 14:32 |

### Memories (/pending/memory/)
| ID | Subject | Predicate | Object | Created |
|----|---------|-----------|--------|---------|
| 1712345680-react-18 | project | uses | React 18 | 2026-04-05 14:35 |

**Total: 2 pending**

### Usage
- `/learn-approve <id>` — Approve and apply a pending change
- `/learn-reject <id>` — Reject and delete a pending change
- `/learn-review` — Manually trigger a learning review of the current session
```
