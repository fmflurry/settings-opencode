# Subagent Question Classification & Handling

## Blocking vs Non-Blocking

Subagents MUST classify every returned question as one of:

### BLOCKING
- Agent cannot make ANY further progress without answer
- Next implementation step is unknowable
- Choosing between mutually exclusive paths
- Clarifying a contradiction (spec vs codebase, two docs conflict)
- The answer changes which files get touched

Format: `[BLOCKING] <one dependency-safe question>`
Tag in output: `## Blocker: <question>`

### NON-BLOCKING
- Agent can continue with a reasonable default
- Question is about quality, preference, or future scope
- Agent wants confirmation of a choice already made
- "Nice to have" improvements spotted during work

Format: `[NON-BLOCKING] <question>  (default: <what agent assumed>)`
Tag in output: `## Note: <question> (assumed: <default>)`

## Question protocol

If the specialist agent that asked is installed, the conductor re-dispatches to that agent. Otherwise the main agent does the same steps inline.

### On receiving blocking question:
1. Attempt self-resolution: check repo (CodeMemory when it is on, otherwise grep/read; `codememory_claims` only when CodeMemory is on)
2. If resolvable from cited repo/CodeMemory evidence (never inferred intent) → answer it. If that specialist agent is installed, re-dispatch to that agent with the answer folded into the brief. Otherwise continue in this session with the answer.
3. If NOT resolvable → `AskUserQuestion` immediately

### On receiving non-blocking question:
1. Add to session accumulator (keep list in memory)
2. Do NOT interrupt flow
3. Continue with remaining tasks

### At job completion (ALL dispatches done):
1. Review accumulator
2. Report ALL accumulated non-blocking questions to user:
   ```
   ## Questions Collected During Execution
   | # | From | Question | Assumed Default |
   |---|------|----------|-----------------|
   | 1 | implementing session | Use fetch or axios? | axios |
   | 2 | planning session | Phase 2 needed before Phase 3? | Yes |

   Awaiting your input on any you'd like changed.
   ```

## Socratic-First Resolution

Before surfacing ANY blocking question to user. When CodeMemory is off, skip steps 1 and 2 and do not call it.
1. `codememory_retrieve` — semantic search for answer (only when CodeMemory is on)
2. `codememory_claims` — user preferences/decisions (only when CodeMemory is on)
3. `Grep`/`Read` — verify exact files if CodeMemory is suggestive, or as the first lookup when it is off
4. If REPO CAN ANSWER (cite the evidence; never infer intent) → answer it. If that specialist agent is installed, fold the answer into a re-dispatch to that agent. Otherwise continue in this session with the answer.
5. Only if REPO CANNOT ANSWER → `AskUserQuestion` with socratic-design shape:
   - Evidence: what you found
   - Question: single dependency-safe question
   - Recommended: your best answer
   - Why: reasoning
   - If opposite: what changes

Reversible work (edits on a branch, read-only checks) proceeds on the stated default; irreversible actions (push, delete, worktree removal, live-config sync, prod/DB mutation) need explicit user confirmation.

Exception: in autonomous mode (`agent-harness autonomy on`), the actions listed in [autonomy.md](autonomy.md) (`agent-harness ship-merge <pr>`, pushes to non-base branches, goal worktree creation via `agent-harness ship-init`, `agent-harness teardown-merged-worktree <pr>`, `agent-harness worktree-rm <path> --confirmed` for a clean merged worktree, and `agent-harness cleanup` after merge) proceed without asking. Ask is replaced by logging the assumption.

## Subagent Gate

If your brief is ambiguous:
1. Classify ambiguity as BLOCKING or NON-BLOCKING
2. Formulate exactly ONE dependency-safe question
3. Return with explicit tag — do not guess, do not implement
4. For non-blocking: state what default you assumed and continue
