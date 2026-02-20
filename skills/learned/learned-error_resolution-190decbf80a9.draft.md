---
name: learned-error_resolution-190decbf80a9
title: Error Resolution Pattern
version: 1.0.0
source: continuous-learning
category: error_resolution
status: review-required
session_id: dry-run-session-home-001
message_count: 12
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
- user: I hit an error in checkout and now tests are failing with a stack trace.
- assistant: Let's reproduce the issue and inspect logs before applying a fix.

## Caveats
- Do not overfit to a single failing example if broader behavior differs.
- Avoid masking failures with broad catch-all handlers.
