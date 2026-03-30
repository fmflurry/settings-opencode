---
name: "learned-error-resolution-pattern"
description: "Use this pattern when handling recurring error resolution workflows."
version: "1.0.0"
source: "continuous-learning"
status: "approved"
learned_from: "skills/learned/learned-error-resolution-pattern.md"
---

# Error Resolution Pattern

Extracted: 2026-02-17
Source: session extraction

## When to use

Use this pattern when handling recurring error resolution workflows.

## Steps

1. Capture the exact failure and affected scope.
2. Identify the smallest reproducible scenario.
3. Patch the root cause, then verify with targeted tests.
4. Document guardrails to avoid recurrence.

## Caveats

- Do not overfit to a single failing example if broader behavior differs.
- Avoid masking failures with broad catch-all handlers.
