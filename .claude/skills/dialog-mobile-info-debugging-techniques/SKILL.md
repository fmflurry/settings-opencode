---
name: "dialog-mobile-info-debugging-techniques"
description: "Use this pattern when handling recurring debugging techniques workflows."
version: "1.0.0"
source: "continuous-learning"
status: "review-required"
learned_from: "skills/learned/dialog-mobile-info-debugging-techniques.draft.md"
title: "Structured Debugging Pattern"
signature: "56513d414ed9"
category: "debugging_techniques"
session_id: "ses_3ad90ab6effeAHtCvfRFiURQXX"
message_count: "318"
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
- user: We are in the process of adding a dialogue in the purchase order creation process. When we select an article, a product which has different information...
- assistant: [tool:grep] dialog|Dialog

## Caveats
- Avoid noisy instrumentation that obscures signal.
- Prefer deterministic repro over probabilistic assumptions.
