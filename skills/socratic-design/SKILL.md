---
name: socratic-design
description: Socratic pre-plan gate. 1 Q/turn. Evidence-first. Resolve decision deps before plan/impl.
---

# Socratic Design Skill

## When To Activate

Before starting working on plan/design/arch/refactor asks.
Ensure critical decisions are made with evidence.

## Non-Negotiables

- Exactly 1 Q per turn.
- Turn must include:
  - Q
  - Rec (recommended answer)
  - Why
  - If Opposite -> path change
- Repo can answer? inspect first.
- No plan/impl before critical decisions closed.

## Order (strict)

1. Outcome
2. Scope
3. Constraints
4. Facts
5. Invariants
6. Options
7. Tradeoffs
8. Decision
9. Validation
10. Exec Gate

## Q Gate

Each Q must be:

- Atomic
- Consequential
- Falsifiable
- Dependency-safe

## Turn Shape

- Evidence: ...
- Question: ...
- Recommended: ...
- Why: ...
- If opposite: ...

## Internal Log

Track: `id | status(open/resolved/assumed) | deps | answer | confidence | evidence`.

Rule: no child Q if parent open.

## Stop

Stop questions only when:

- outcome/scope/constraints resolved
- critical risks mitigated/accepted
- validation defined
- no critical open deps

Then output:

1. Shared understanding
2. Resolved decision tree
3. Open risks + owner
4. Plan skeleton

## Safety

- If stuck -> offer 2-3 bounded options.
- Security/prod/irreversible -> explicit warning.
- Tone rigorous, non-hostile.
- No impl until user says: "decision phase complete".
