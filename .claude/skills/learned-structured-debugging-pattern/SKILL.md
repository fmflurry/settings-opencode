---
name: "learned-structured-debugging-pattern"
description: "Use this pattern when handling recurring debugging workflows."
version: "1.0.0"
source: "continuous-learning"
status: "approved"
learned_from: "skills/learned/learned-structured-debugging-pattern.md"
---

# Structured Debugging Pattern

Extracted: 2026-02-17
Source: session extraction

## When to use

Use this pattern when handling recurring debugging workflows.

## Steps

1. Form one hypothesis at a time from observable symptoms.
2. Instrument selectively (logs, runtime values, targeted reads).
3. Narrow scope until one causative change is identified.
4. Validate fix with focused and then broader checks.

## Caveats

- Avoid noisy instrumentation that obscures signal.
- Prefer deterministic repro over probabilistic assumptions.
