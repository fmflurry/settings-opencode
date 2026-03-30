---
name: address-backend-tests-error-resolution
description: Use this pattern when handling recurring error resolution workflows.
title: Error Resolution Pattern
signature: 149025de3d30
version: 1.0.0
source: continuous-learning
category: error_resolution
status: review-required
session_id: ses_2fd054c09ffeVdaJXlRit5YlnV
message_count: 41
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
- assistant: The plan is to fix the auth flow so a successful Google sign-in actually persists the user in the database and creates the linked records in `User...
- - Then, fix backend persistence so first login creates rows, repeat logins stay idempotent, and address/link creation follows the intended business rule.

## Caveats
- Do not overfit to a single failing example if broader behavior differs.
- Avoid masking failures with broad catch-all handlers.
