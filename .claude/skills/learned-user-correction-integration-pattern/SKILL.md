---
name: "learned-user-correction-integration-pattern"
description: "Use this pattern when handling recurring user corrections workflows."
version: "1.0.0"
source: "continuous-learning"
status: "approved"
learned_from: "skills/learned/learned-user-correction-integration-pattern.md"
---

# User Correction Integration Pattern

Extracted: 2026-02-23
Source: session extraction

## When to use

Use this pattern when handling recurring user corrections workflows.

## Steps

1. Extract the correction as a concrete rule.
2. Apply the rule to current work and nearby decisions.
3. Re-validate outputs against updated expectations.
4. Capture the correction in reusable guidance.

## Caveats

- Do not partially apply corrections; update all relevant touchpoints.
- If corrections conflict, prefer latest explicit user instruction.
