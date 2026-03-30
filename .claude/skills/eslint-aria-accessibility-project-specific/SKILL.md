---
name: eslint-aria-accessibility-project-specific
description: Use this pattern when handling recurring project specific workflows.
title: Project-Specific Convention Pattern
signature: 3c82042c785d
version: 1.0.0
source: continuous-learning
category: project_specific
status: review-required
session_id: ses_2c0bb16f7ffeuj12Efdgi54Xw7
message_count: 23
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
- 10: 1. Run the ESLint accessibility check first:
- 12:    npx eslint "src/app/<feature>/**/*.html"

## Caveats
- Conventions evolve; revalidate periodically against source docs.
- Do not generalize project-specific rules to unrelated repositories.
