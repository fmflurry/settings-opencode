---
name: turn-workflow-tools-user-corrections
description: Use this pattern when handling recurring user corrections workflows.
title: User Correction Integration Pattern
signature: b2ce81d7d421
version: 1.0.0
source: continuous-learning
category: user_corrections
status: review-required
session_id: ses_2ffb31606ffefmU8KjKRc6i59b
message_count: 26
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
- - tools that assist experts instead of replacing them
- - create a `draft` or `pending clarification` case instead

## Caveats
- Do not partially apply corrections; update all relevant touchpoints.
- If corrections conflict, prefer latest explicit user instruction.
