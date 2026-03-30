---
name: provider-openai-proxy-user-corrections
description: Use this pattern when handling recurring user corrections workflows.
title: User Correction Integration Pattern
signature: 13885945a093
version: 1.0.0
source: continuous-learning
category: user_corrections
status: review-required
session_id: ses_2c26b5365ffe1ilud8caB0EXS2
message_count: 81
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
- The practical workaround is: do not use the built-in `openai/...` model id for this. Define a custom provider and point your agents at that provider instead.
- - If your proxy expects the OpenAI Responses API, use a custom provider backed by `@ai-sdk/openai` instead; the built-in `openai` provider appears to be the ...

## Caveats
- Do not partially apply corrections; update all relevant touchpoints.
- If corrections conflict, prefer latest explicit user instruction.
