---
name: conductor
description: "Use when the user runs /orchestrate or asks to split one job across specialists. Optional. The primary agent still writes."
disable-model-invocation: true
---

# Orchestrate

This mode is optional. Ordinary work stays in the main loop.

1. Split the request into subtasks and name the dependency order.
2. Do the writing here. Load `planner`, `tdd`, `coder`, `git-workflow`, or `writer` when that is the work.
3. Spawn a subagent only for review isolation (`code-reviewer`, `security-reviewer`, `database-reviewer`, `cop`, `comment-judge`), parallel `why-investigator` runs, or noisy output (`e2e-runner`, `ecosystem-auditor`, `build-error-resolver`).
4. Synthesize the results in this session.
