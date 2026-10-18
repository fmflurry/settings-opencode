---
description: Generate and run end-to-end tests for this project
agent: e2e-runner
subtask: true
---

# E2E Command

Generate and run end-to-end tests for this project: $ARGUMENTS

## How This Command Works

- Load the `e2e` skill and run its `scripts/resolve.mjs` before writing a test. The script reads the project override `e2e.json` (version 1) or discovers the start command, ports, and test runner.
- `enabled: false` in `e2e.json` means this project opts out. Stop.
- Use the JSON fields `start`, `ports`, `baseUrl`, `test`, `cwd`, `runner`, and `skills`. Do not assume a framework, a port, or a process manager.
- Load a playbook skill only when the override names them.

## Output

- The resolved source (`override`, `discovered`, or `none`) and the commands that were run.
- Files created or modified.
- Passed, failed, and skipped counts, plus artifact paths the runner wrote.
