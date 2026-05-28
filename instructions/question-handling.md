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

## Conductor Protocol

### On receiving blocking question:
1. Attempt self-resolution: check repo (CodeMemory, codememory_claims, grep, read)
2. If resolvable → answer it, re-dispatch with answer folded into brief
3. If NOT resolvable → `ask` tool immediately

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
   | 1 | coder | Use fetch or axios? | axios |
   | 2 | planner | Phase 2 needed before Phase 3? | Yes |

   Awaiting your input on any you'd like changed.
   ```

## Socratic-First Resolution

Before surfacing ANY blocking question to user:
1. `codememory_retrieve` — semantic search for answer
2. `codememory_claims` — user preferences/decisions
3. `grep`/`read` — verify exact files if CodeMemory is suggestive
4. If REPO CAN ANSWER → answer it, fold into re-dispatch brief
5. Only if REPO CANNOT ANSWER → `ask` tool with socratic-design shape:
   - Evidence: what you found
   - Question: single dependency-safe question
   - Recommended: your best answer
   - Why: reasoning
   - If opposite: what changes

## Subagent Gate

If your brief is ambiguous:
1. Classify ambiguity as BLOCKING or NON-BLOCKING
2. Formulate exactly ONE dependency-safe question
3. Return with explicit tag — do not guess, do not implement
4. For non-blocking: state what default you assumed and continue
