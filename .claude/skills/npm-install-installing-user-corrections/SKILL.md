---
name: "npm-install-installing-user-corrections"
description: "Use this pattern when handling recurring user corrections workflows."
version: "1.0.0"
source: "continuous-learning"
status: "review-required"
learned_from: "skills/learned/npm-install-installing-user-corrections.draft.md"
title: "User Correction Integration Pattern"
signature: "e5c642b1f0e2"
category: "user_corrections"
session_id: "ses_34d530828ffeY0wm25qd0k1tm3"
message_count: "67"
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
- 1. Prefer installing a packed tarball (`npm pack`) over `file:` symlinks, or
- 2. Install with `--install-links=false` so npm copies instead of symlinking.

## Caveats
- Do not partially apply corrections; update all relevant touchpoints.
- If corrections conflict, prefer latest explicit user instruction.
