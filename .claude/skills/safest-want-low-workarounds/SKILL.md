---
name: safest-want-low-workarounds
description: Use this pattern when handling recurring workarounds workflows.
title: Safe Workaround Pattern
signature: 4abc94a1e787
version: 1.0.0
source: continuous-learning
category: workarounds
status: review-required
session_id: ses_2ffb31606ffefmU8KjKRc6i59b
message_count: 26
tags: [workaround, delivery]
---

# Safe Workaround Pattern

## When to use
Use this pattern when handling recurring workarounds workflows.

## Steps
1. Confirm the blocker and expected business impact.
2. Implement the smallest safe workaround behind clear boundaries.
3. Add validation or tests proving no regression in core paths.
4. Record follow-up to remove workaround when root fix is ready.

## Examples
- - safest fallback if you want low risk: `Sujet 05`
- - If data is missing, ask the minimum needed to unblock creation:

## Caveats
- Workarounds must be explicit and easy to remove.
- Avoid introducing hidden behavioral differences without documentation.
