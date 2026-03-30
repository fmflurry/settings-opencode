---
name: server-verbose-cocopenlog-debugging-techniques
description: Use this pattern when handling recurring debugging techniques workflows.
title: Structured Debugging Pattern
signature: dead8a327dcb
version: 1.0.0
source: continuous-learning
category: debugging_techniques
status: review-required
session_id: ses_2f3dca64bffevgR1D9zYOl9Gwc
message_count: 20
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
- "trace.server": "verbose"
- - `:CocOpenLog` -> check why the server failed to start

## Caveats
- Avoid noisy instrumentation that obscures signal.
- Prefer deterministic repro over probabilistic assumptions.
