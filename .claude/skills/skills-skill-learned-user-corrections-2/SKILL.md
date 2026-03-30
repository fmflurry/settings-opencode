---
name: skills-skill-learned-user-corrections-2
description: Use this pattern when handling recurring user corrections workflows.
title: User Correction Integration Pattern
signature: 1ab612aaaf98
version: 1.0.0
source: continuous-learning
category: user_corrections
status: review-required
session_id: ses_304fa9105ffeuZekV444qB00si
message_count: 76
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
- - A learned file like `skills/learned/app-design-input-user-corrections.draft.md:1` is just a standalone markdown artifact; it is not in the normal built-in ...
- - I created 26 top-level skill folders, each with a `SKILL.md`, for example `skills/app-design-input-user-corrections/SKILL.md`, `skills/ddd-type-duplication...

## Caveats
- Do not partially apply corrections; update all relevant touchpoints.
- If corrections conflict, prefer latest explicit user instruction.
