---
name: aria-issues-description-error-resolution-2
description: Use this pattern when handling recurring error resolution workflows.
title: Error Resolution Pattern
signature: 4b6a0494fb3e
version: 1.0.0
source: continuous-learning
category: error_resolution
status: review-required
session_id: ses_2c0bb16f7ffeuj12Efdgi54Xw7
message_count: 23
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
- 3: description: Audit and fix accessibility (a11y) issues in Angular templates for WCAG 2.1 AA compliance. Use when the user mentions Lighthouse, screen read...
- 15: 3. Fix each category below systematically.

## Caveats
- Do not overfit to a single failing example if broader behavior differs.
- Avoid masking failures with broad catch-all handlers.
