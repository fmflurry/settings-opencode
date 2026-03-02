---
name: bash-files-order-project-specific
title: Project-Specific Convention Pattern
signature: 5a519d62a706
version: 1.0.0
source: continuous-learning
category: project_specific
status: review-required
session_id: ses_3ad90ab6effeAHtCvfRFiURQXX
message_count: 318
tags: [project-conventions, consistency]
---

# Project-Specific Convention Pattern

## When to use
Use this pattern when handling recurring project specific workflows.

## Steps
1. Identify recurring project conventions applied during the session.
2. Translate each convention into a simple decision checklist.
3. Show one concrete example from this session.
4. List anti-patterns that should be rejected in future work.

## Examples
- I notice a potential issue. The translation message has interpolation placeholders that aren't being filled. Let me verify:
- However, I notice the translation message has **unfilled interpolation placeholders** (`{{customerTaxSituationCode}}`, etc.) that won't show actual values.

## Caveats
- Conventions evolve; revalidate periodically against source docs.
- Do not generalize project-specific rules to unrelated repositories.
