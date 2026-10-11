---
name: autonomous
description: Turn autonomous mode on, off, or check its status with /autonomous on|off|status. User-invoked only.
disable-model-invocation: true
---

# Autonomous

Runs the autonomy toggle for the current repo:

```bash
agent-harness autonomy $ARGUMENTS
```

`$ARGUMENTS` is `on`, `off`, or `status`. Show the script's output as is. If no argument is given, run `status`.

## What changes when it is on

- The flag file `.claude/state/autonomy.on` exists. It is gitignored and local to this machine.
- On Claude Code, the `autonomy-context` hook injects the autonomy rules into each session. On OpenCode, the
  instructions in `instructions/autonomy.md` apply instead.
- On Claude Code, the `autonomy-ask-guard` hook denies AskUserQuestion. Log the assumption and continue instead.
- `agent-harness ship-merge` runs without `--confirmed`. The merge gate still applies in full.
- Notifications stay quiet except for the events in the autonomy rule.

When it is off, AskUserQuestion works again and `agent-harness ship-merge` needs `--confirmed`. On Claude Code, the
hook notifies you instead of denying the question.

## Notes

- Turning it on does not start any work. Use `/ship <goal>` for that.
- Turning it on does not change the deny list or the worktree rules. Those stay in force.
- The toggle is per machine. In a cloud run, a workflow sets the flag, not this command.
