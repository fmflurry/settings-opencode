---
name: "design-compact-height-debugging-techniques-2"
description: "Use this pattern when handling recurring debugging techniques workflows."
version: "1.0.0"
source: "continuous-learning"
status: "review-required"
learned_from: "skills/learned/design-compact-height-debugging-techniques-2.draft.md"
title: "Structured Debugging Pattern"
signature: "48697bd23657"
category: "debugging_techniques"
session_id: "ses_33db3fcbdffeesrVQo6f7E3yXX"
message_count: "56"
tags: [debugging, analysis]
---

# Structured Debugging Pattern

## When to use
Use this pattern when handling recurring debugging techniques workflows.

## Steps
1. Form one hypothesis at a time from observable symptoms.
2. Instrument selectively (logs, runtime values, targeted reads).
3. Narrow scope until one causative change is identified.
4. Validate fix with focused and then broader checks.

## Examples
- assistant: I’m verifying the current branch and what will go into the PR, then I’ll push it and create the Azure DevOps PR with a conventional-commit title.
- assistant: I replaced the new magic values with design tokens and added a reusable compact-height breakpoint token for the viewport rule. I’m doing a quick d...

## Caveats
- Avoid noisy instrumentation that obscures signal.
- Prefer deterministic repro over probabilistic assumptions.
