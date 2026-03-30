---
name: focus-dialogs-interactive-debugging-techniques-2
description: Use this pattern when handling recurring debugging techniques workflows.
title: Structured Debugging Pattern
signature: ee38255042ce
version: 1.0.0
source: continuous-learning
category: debugging_techniques
status: review-required
session_id: ses_2c0bb16f7ffeuj12Efdgi54Xw7
message_count: 23
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
- 179: After fixing, verify:
- 2. Or expand the skill to cover keyboard, focus, dialogs, headings, landmarks beyond `main`, contrast, live regions, images, and interactive semantics.

## Caveats
- Avoid noisy instrumentation that obscures signal.
- Prefer deterministic repro over probabilistic assumptions.
