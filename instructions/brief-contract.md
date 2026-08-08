# Brief Contract (mandatory)

Every dispatch to `coder`, `writer`, or `tdd-guide` MUST include a 6-field brief. Open-ended briefs cost 4.3× more tokens than precise briefs (447k vs 103k per edit). Precision gates cost savings.

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

- **`FILES`**: Must list at least one file with line range. If empty or lists directories only, the brief is not dispatchable. Conductor MUST scout before dispatching.
- **`DONE-WHEN`**: Must contain an executable command (e.g., `npm run lint` exits 0, `npx tsc --noEmit` exits 0). No vague criteria like "looks good" or "builds successfully"; state the exact command.

## Recommended fields

- **`TASK`**: One sentence, imperative voice. Outcome is the state change, not the activity.
- **`CHANGE`**: Named symbols, named target state. Not "improve" or "refactor" — state what replaces what.
- **`OUT OF SCOPE`**: Prevents scope creep. Explicitly rule out adjacent files and concerns.
- **`CONTEXT ALREADY RESOLVED`**: Cites the source (codememory result, scout manifest, or prior turn). Uncited assumptions = conductor must scout.

## Default budgets (when unknown)

```
edits ≤ 5 | exploratory bash ≤ 3 | turns ≤ 25
```

**Justification**: Cumulative context cost is quadratic ≈ N × (24k + N×325 tokens); 57 turns = 2.42M, 25 turns = 0.80M. Precision briefs and bounded budgets prevent token runaway.

## Conductor Scout Decision Rule

| Scenario | Action |
| --- | --- |
| Files are known, all fields present | Emit brief directly, dispatch coder/writer/tdd-guide |
| Files unknown but ≤2 code-memory calls resolve it | Conductor resolves inline (within 2 calls), then emits brief and dispatches |
| Files unknown and broad OR ≥2 coders will be dispatched | Dispatch `scout` once, embed manifest, then dispatch coder/writer/tdd-guide |
| Same task rejected twice by same specialist | Conductor MUST dispatch `scout` to resolve ambiguity, not re-dispatch coder |

## Loop Guard

Two rejections on the same task (e.g., coder rejects brief twice) → conductor MUST dispatch `scout`, not re-dispatch the same coder with a guess.
