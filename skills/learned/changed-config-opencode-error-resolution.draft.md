---
name: changed-config-opencode-error-resolution
title: Error Resolution Pattern
signature: 68cf42b5dee4
version: 1.0.0
source: continuous-learning
category: error_resolution
status: review-required
session_id: ses_3636de0c5ffeb9npORZrmfI454
message_count: 59
tags: [error-resolution, stability]
---

# Error Resolution Pattern

## When to use
Use this pattern when handling recurring error resolution workflows.

## Steps
1. Capture the exact failure and affected scope.
2. Identify the smallest reproducible scenario.
3. Patch the root cause, then verify with targeted tests.
4. Document guardrails to avoid recurrence.

## Examples
- What I changed to fix it
- - `~/.config/opencode/skills/learned/src-dialog-read-error-resolution.draft.md`

## Caveats
- Do not overfit to a single failing example if broader behavior differs.
- Avoid masking failures with broad catch-all handlers.
