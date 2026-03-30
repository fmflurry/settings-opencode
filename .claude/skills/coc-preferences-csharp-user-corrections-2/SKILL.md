---
name: coc-preferences-csharp-user-corrections-2
description: Use this pattern when handling recurring user corrections workflows.
title: User Correction Integration Pattern
signature: 04b113eab904
version: 1.0.0
source: continuous-learning
category: user_corrections
status: review-required
session_id: ses_2f3dca64bffevgR1D9zYOl9Gwc
message_count: 20
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
- - `csharp-ls` is not actually starting inside Vim
- - `:echo &filetype` -> should be `cs`

## Caveats
- Do not partially apply corrections; update all relevant touchpoints.
- If corrections conflict, prefer latest explicit user instruction.
