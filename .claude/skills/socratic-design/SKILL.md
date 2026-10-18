---
name: socratic-design
description: Use when a planning, design, architecture, or refactor decision is still open. Spike a question a prototype under 30 minutes can settle, restate an L-sized goal in your own words before planning, otherwise ask exactly one dependency-safe question.
---

# Socratic Design Skill

why-not-tooled: whether a prototype under 30 minutes can settle a question, and whether a task is L-sized, is a judgment no linter can make.

## When to Activate

Use this skill before any planning, design, architecture, or refactor work when critical decisions are not yet closed.
Resolve those decisions with evidence before producing a plan or implementation.

## Spike before asking

Any question a spike under 30 minutes can settle is prototyped first. Present the result. Do not ask that question.

A spike is a throwaway prototype, script, or measurement. Keep it reversible. Do not start one that will not finish within 30 minutes. Past that bound, ask. Delete the prototype once the result is recorded. Do not commit it with the plan.

Order for a decision: the repo, then a spike, then one question. A spiked decision is `resolved`. The evidence is the spike result.

### Example: a question replaced by a spike result

Not asked: should the cache key include the tenant id.

Spike: a throwaway script writes one entity id for two tenants and reads it back. With no tenant id in the key, tenant B receives tenant A's payload. The run finishes in under 30 minutes.

Presented instead of the question:

- Evidence: the read returned tenant A's payload for tenant B.
- Resolved: the cache key includes the tenant id.
- Why: the two tenants collided on the shared key.
- If opposite: had that read returned tenant B's own payload, the key would omit the tenant id.

## In your own words (L-sized)

An L-sized task is one whose plan crosses modules and changes a contract, a migration, or other public behavior. S and M tasks skip this step.

Before planning an L-sized task, and before spiking or asking a design question about it:

1. Restate the goal in your own words. Do not quote the request back.
2. Restate the constraints in your own words.
3. Get confirmation of that restatement.

That confirmation is the one question of the turn. Do not plan until it is confirmed. A spike cannot close it: only the requester knows the goal.

## Non-Negotiables

- Exactly 1 Q per turn, and only for a decision a spike cannot settle.
- A spike turn has no Q. Present the result in the spike shape below.
- Harness MUST use the `ask` tool to surface a Q. No prose-only questions, no inline "?" in plain text. If `ask` is unavailable and a Q is still required, stop and report the missing capability.
- Ask turn must include:
  - Q (delivered via `ask`)
  - Rec (recommended answer)
  - Why
  - If Opposite -> path change
- Repo can answer? Inspect first. Spike second. Ask last.
- No plan or implementation before critical decisions are closed. An L-sized task also waits until the restatement is confirmed.

## Order (strict)

On an L-sized task, the in-your-own-words confirmation comes before this list.

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

Spike (the question is replaced by the result):

- Evidence: ...
- Resolved: ...
- Why: ...
- If opposite: ...

Ask (only when a spike cannot settle it):

- Evidence: ...
- Question: ...
- Recommended: ...
- Why: ...
- If opposite: ...

## Internal Log

Track: `id | status(open/resolved/assumed) | deps | answer | confidence | evidence`.

A spike sets `resolved`. Its evidence is the spike result. Rule: no child Q if parent open.

## Stop

Stop questions only when:

- outcome/scope/constraints resolved
- critical risks mitigated/accepted
- validation defined
- no critical open deps
- the L-sized restatement is confirmed, when the task is L

Then output:

1. Shared understanding (for an L-sized task, the confirmed restatement)
2. Resolved decision tree
3. Open risks + owner
4. Plan skeleton

## Safety

- If stuck -> offer 2-3 bounded options.
- Security/prod/irreversible -> explicit warning. A spike that would touch production, secrets, or an irreversible action is not a spike; ask.
- Tone rigorous, non-hostile.
