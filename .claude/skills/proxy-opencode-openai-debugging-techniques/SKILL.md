---
name: proxy-opencode-openai-debugging-techniques
description: Use this pattern when handling recurring debugging techniques workflows.
title: Structured Debugging Pattern
signature: 98c693c6798c
version: 1.0.0
source: continuous-learning
category: debugging_techniques
status: review-required
session_id: ses_2c26b5365ffe1ilud8caB0EXS2
message_count: 81
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
- 88:       "description": "Test-Driven Development specialist enforcing write-tests-first methodology. Use when writing new features, fixing bugs, or refactor...
- 232:     "verify": {

## Caveats
- Avoid noisy instrumentation that obscures signal.
- Prefer deterministic repro over probabilistic assumptions.
