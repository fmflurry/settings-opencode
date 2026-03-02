---
name: config-opencode-skills-debugging-techniques
title: Structured Debugging Pattern
signature: e59717f35e0c
version: 1.0.0
source: continuous-learning
category: debugging_techniques
status: review-required
session_id: ses_3636de0c5ffeb9npORZrmfI454
message_count: 59
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
- user: can you investigate to ensure that my 'learning' skill and scripts are running effectively when I end a session ?
- - `~/.config/opencode/skills/learned/dialog-mobile-info-debugging-techniques.draft.md`

## Caveats
- Avoid noisy instrumentation that obscures signal.
- Prefer deterministic repro over probabilistic assumptions.
