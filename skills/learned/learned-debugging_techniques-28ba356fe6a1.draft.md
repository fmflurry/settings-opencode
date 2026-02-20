---
name: learned-debugging_techniques-28ba356fe6a1
title: Structured Debugging Pattern
version: 1.0.0
source: continuous-learning
category: debugging_techniques
status: review-required
session_id: dry-run-session-home-001
message_count: 12
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
- user: I hit an error in checkout and now tests are failing with a stack trace.
- assistant: Let's reproduce the issue and inspect logs before applying a fix.

## Caveats
- Avoid noisy instrumentation that obscures signal.
- Prefer deterministic repro over probabilistic assumptions.
