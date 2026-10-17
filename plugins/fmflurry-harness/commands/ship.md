---
description: Deliver one goal end to end (clarify, implement, PR, review, CI, merge) via the ship skill
---

# /ship — Autonomous goal delivery

Load the `ship` skill and follow it exactly for the goal below. The skill owns the stages, the stop
conditions and the hard limits. This command only passes the goal through.

Init is the first action, before the clarify round: `agent-harness ship-init <type> <scope> <desc> --goal "<goal>"`
(or `--adopt <pr>` to resume). Work only in the registered worktree.

Goal: $ARGUMENTS
