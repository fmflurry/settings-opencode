---
name: brief-contract
description: "Use when handing work to coder, writer, or tdd-guide. If that agent is installed, the dispatch includes a 6-field brief. Otherwise the main agent loads the matching skill and uses the same brief inline."
---

# Brief Contract (mandatory)

why-not-tooled: whether a brief is precise enough is a judgment; no linter sees the dispatch text.

If `coder`, `writer`, or `tdd-guide` is installed, every dispatch to that agent MUST include a 6-field brief. Otherwise the main agent loads the matching skill (`coder`, `writer`, or `tdd`) and fills the same brief before editing. Open-ended briefs cost 4.3× more tokens than precise briefs (447k vs 103k per edit). Precision gates cost savings.

## Template (copy-paste verbatim)

```
## TASK
<one imperative sentence, one outcome>

## FILES  (authoritative — this list is the scope)
- <abs/path/a.ts:120-180>  — <what changes here>
Escape hatch: you may touch at most 2 files not listed. Beyond that, stop and
return `## Blocker: scope exceeds brief — <files needed and why>`.

## CHANGE
<named symbols, named target state. "Replace X with Y in Z", not "improve Z".>

## DONE-WHEN  (mechanical; no judgement calls)
- `<exact command>` exits 0

## OUT OF SCOPE
- <adjacent code / files / concerns explicitly not to touch>

## CONTEXT ALREADY RESOLVED  (do NOT re-derive)
- <fact> — source: codememory_retrieve "<query>" | scout manifest | prior turn

## BUDGET
edits ≤ <N> | exploratory bash ≤ <M> | turns ≤ <T>
Over budget → stop and return `## Blocker: over budget — <what remains>`.
```

## Mandatory fields

- **`FILES`**: Must list at least one file with line range. If empty or lists directories only, the brief is not dispatchable. If `scout` is installed, dispatch to that agent before the brief. Otherwise the main agent loads the `scout` skill or uses grep/read.
- **`DONE-WHEN`**: Must contain an executable command (e.g., `npm run lint` exits 0, `npx tsc --noEmit` exits 0). No vague criteria like "looks good" or "builds successfully"; state the exact command.

## Recommended fields

- **`TASK`**: One sentence, imperative voice. Outcome is the state change, not the activity.
- **`CHANGE`**: Named symbols, named target state. Not "improve" or "refactor" — state what replaces what.
- **`OUT OF SCOPE`**: Prevents scope creep. Explicitly rule out adjacent files and concerns.
- **`CONTEXT ALREADY RESOLVED`**: Cites the source (codememory result, scout manifest, or prior turn). Uncited assumptions must be looked up. If `scout` is installed, dispatch to that agent. Otherwise the main agent loads the `scout` skill.

## Default budgets (when unknown)

```
edits ≤ 5 | exploratory bash ≤ 3 | turns ≤ 25
```

**Justification**: Cumulative context cost is quadratic ≈ N × (24k + N×325 tokens); 57 turns = 2.42M, 25 turns = 0.80M. Precision briefs and bounded budgets prevent token runaway.

## Conductor Scout Decision Rule

| Scenario | Action |
| --- | --- |
| Files are known, all fields present | If `coder`, `writer`, or `tdd-guide` is installed, emit the brief and dispatch to that agent. Otherwise the main agent loads the matching skill and does the work inline |
| Files unknown but ≤2 code-memory calls resolve it, and CodeMemory is on | The primary session resolves inline (within 2 calls), then emits the brief. If the specialist agent is installed, dispatch to that agent. When CodeMemory is off, if `scout` is installed, dispatch to that agent; otherwise the main agent loads the `scout` skill or uses grep/read. Do not call CodeMemory |
| Files unknown and broad OR ≥2 implementers will be dispatched | If `scout` is installed, dispatch to that agent once and embed the manifest. Otherwise the main agent loads the `scout` skill. Then if `coder`, `writer`, or `tdd-guide` is installed, dispatch to that agent. Otherwise the main agent loads the matching skill and does the work inline |
| Same task rejected twice by the same specialist | If `scout` is installed, dispatch to that agent to resolve ambiguity. Otherwise the main agent loads the `scout` skill. Do not guess a second brief |

## Loop Guard

Two rejections on the same task (for example the implementer rejects the brief twice) stop a second guess. If `scout` is installed, dispatch to that agent. Otherwise the main agent loads the `scout` skill. Before the next pass, write the premise both attempts shared into the brief's CONTEXT ALREADY RESOLVED field as "rejected premise: …".
