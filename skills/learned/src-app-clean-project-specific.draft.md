---
name: src-app-clean-project-specific
title: Project-Specific Convention Pattern
signature: 156dbc742334
version: 1.0.0
source: continuous-learning
category: project_specific
status: review-required
session_id: ses_353cf4fd4ffejqs3ph0fJ2loZX
message_count: 32
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
- We currently have a 'mixed architecture', because this is an existing webapp with 'modules to refactor'.
- The architecture we want to promote is the 'Clean Architecture" such as implemented in @src/app/sales/

## Caveats
- Conventions evolve; revalidate periodically against source docs.
- Do not generalize project-specific rules to unrelated repositories.
