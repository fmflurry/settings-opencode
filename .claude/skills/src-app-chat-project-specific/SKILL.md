---
name: src-app-chat-project-specific
description: Use this pattern when handling recurring project specific workflows.
title: Project-Specific Convention Pattern
signature: d9f13b9920f5
version: 1.0.0
source: continuous-learning
category: project_specific
status: review-required
session_id: ses_2f5449174ffeqyStiYR8u8wQIc
message_count: 52
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
- - Critical blockers: public APIM keys are committed and shipped to the browser via `src/assets/config/app-config.json:5`, `src/assets/config/app-config.json:...
- 2. Replace `localStorage` token handling with a BFF or `HttpOnly` cookies.

## Caveats
- Conventions evolve; revalidate periodically against source docs.
- Do not generalize project-specific rules to unrelated repositories.
