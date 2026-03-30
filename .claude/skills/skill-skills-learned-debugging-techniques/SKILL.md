---
name: skill-skills-learned-debugging-techniques
description: Use this pattern when handling recurring debugging techniques workflows.
title: Structured Debugging Pattern
signature: 4f3ce51fbaf5
version: 1.0.0
source: continuous-learning
category: debugging_techniques
status: review-required
session_id: ses_304fa9105ffeuZekV444qB00si
message_count: 72
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
- Investigate and tell me if we need to reference all learned skills in a SKILL.md file or if we're good like that already.
- - I created 26 top-level skill folders, each with a `SKILL.md`, for example `skills/app-design-input-user-corrections/SKILL.md`, `skills/ddd-type-duplication...

## Caveats
- Avoid noisy instrumentation that obscures signal.
- Prefer deterministic repro over probabilistic assumptions.
