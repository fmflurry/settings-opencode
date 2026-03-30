---
name: "summary-routing-spec-error-resolution-3"
description: "Use this pattern when handling recurring error resolution workflows."
version: "1.0.0"
source: "continuous-learning"
status: "review-required"
learned_from: "skills/learned/summary-routing-spec-error-resolution-3.draft.md"
title: "Error Resolution Pattern"
signature: "484c1ada0553"
category: "error_resolution"
session_id: "ses_33d47bcb0ffeP0Dt8pg5g7n3Kx"
message_count: "49"
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
- user: There are currently failing tests, you can use wallaby MCP to analyze what is failing.
- I guess most of the failing tests are related to the refactoring we made with the addition of the new library flurryx

## Caveats
- Do not overfit to a single failing example if broader behavior differs.
- Avoid masking failures with broad catch-all handlers.
