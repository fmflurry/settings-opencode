---
name: security-review-says-user-corrections
description: Use this pattern when handling recurring user corrections workflows.
title: User Correction Integration Pattern
signature: b5b7c06b7b20
version: 1.0.0
source: continuous-learning
category: user_corrections
status: review-required
session_id: ses_2f5449174ffeqyStiYR8u8wQIc
message_count: 52
tags: [feedback-loop, alignment]
---

# User Correction Integration Pattern

## When to use
Use this pattern when handling recurring user corrections workflows.

## Steps
1. Extract the correction as a concrete rule.
2. Apply the rule to current work and nearby decisions.
3. Re-validate outputs against updated expectations.
4. Capture the correction in reusable guidance.

## Examples
- assistant: The security review says this release should be blocked.
- assistant: I updated `docs/security/REMAINING-SECURITY-BLOCKERS.md` to match your corrections.

## Caveats
- Do not partially apply corrections; update all relevant touchpoints.
- If corrections conflict, prefer latest explicit user instruction.
