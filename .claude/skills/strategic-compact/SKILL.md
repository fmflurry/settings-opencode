---
name: strategic-compact
description: Make compaction safe for fully autonomous multi-phase work. The agent prepares durable state so auto-compaction never requires user input and never breaks flow.
---

# Strategic Compact (OpenCode) — Autonomous Agent Edition

## Purpose

This skill ensures that automatic compaction does not break an agent’s flow.

CRITICAL: compaction is treated as a **background checkpoint**:

- It can happen at any time near phase boundaries or context pressure.
- The agent must proactively encode durable state so compaction is always safe.
- The agent must not ask the user for confirmation just because compaction might occur.

This skill is about **compaction-readiness**, not manual compaction.

---

## Operating Rules (Non-Negotiable)

1. **Never require user input for compaction.**
   - Do not ask “Should I compact?” or “Do you want a checkpoint?”
   - Assume compaction is automatic and proceed.

2. **Never rely on chat history as the only source of truth.**
   - If something must survive compaction, it must be recorded in files (or a dedicated session log) as durable state.

3. **Prefer compaction-safe boundaries.**
   - A compaction boundary is “safe” only when work is in a stable sub-state (see “Stability Conditions”).

4. **Always include evidence.**
   - Record file paths, commands run, and results (tests/build output summary). If unknown, write “unknown”.

---

## Stability Conditions

Compaction is considered safe when ALL are true:

- Work is not mid-refactor with broken code paths (or the refactor scope is bounded and documented).
- The current goal and plan are written down durably.
- Key decisions/assumptions are explicitly recorded.
- There is a clear next-action checklist.

If conditions are not met, the agent must **stabilize first**:

- Finish the smallest coherent chunk
- Or save a WIP plan + current diff summary + immediate next steps into durable state

---

## Durable State Checklist (Write This Before Any Likely Boundary)

The agent should maintain a single “durable state” artifact during long work:

- `./docs/dev/session-log.md` (repo-local)

MUST at minimum, record:

- Current goal
- Current phase (research / plan / implement / test / debug)
- Key decisions & constraints
- Files touched / to be touched
- Commands run + results (summary)
- What worked / didn’t work
- Next steps checklist (concrete, executable)

CRITICAL: this is not optional; it is how the agent remains autonomous across compaction.

---

## Phase Boundaries (Where Auto-Compaction Is Expected)

Treat these transitions as “high probability compaction moments”:

1. Research → Plan
2. Plan → Implementation
3. Implementation milestone → Testing
4. Debugging resolved → Return to feature work
5. Failed approach → Start alternate approach
6. Context pressure signs (looping, losing thread, repeated questions)

At these boundaries, the agent should automatically:

- Update durable state
- Ensure a clean, resumable plan exists
- Make the next steps explicit and minimal

---

## Autonomous Behavior by Phase

### Research Phase

Goal: explore without contaminating future context.

Autonomous rules:

- Keep raw exploration short-lived.
- Promote conclusions into durable state as soon as they are stable:
  - hypotheses that were tested
  - constraints discovered
  - final recommendation

Before leaving research:

- Write a “Plan” section in durable state (even if brief).
- Record which approaches were tried and what evidence supports conclusions.

### Planning Phase

Goal: produce a stable, compaction-proof execution plan.

Autonomous rules:

- Convert intent into a checklist and file targets.
- Record invariants and guardrails (constraints, definitions, acceptance criteria).

Before implementation:

- Durable state must contain:
  - target files/modules
  - sequencing (step 1/2/3)
  - risks/unknowns
  - how success will be verified (tests/commands)

### Implementation Phase

Goal: make progress while keeping work bounded.

Autonomous rules:

- Work in coherent increments.
- Avoid leaving the repo in an ambiguous state without recording it.

If work is mid-change and a boundary is approaching:

- Write a WIP checkpoint:
  - what changed so far
  - what remains
  - how to complete safely
  - how to verify

### Testing/Validation Phase

Goal: convert changes into verified outcomes.

Autonomous rules:

- Record commands run and outcomes into durable state.
- If tests fail, record:
  - first failing signal
  - suspected root cause
  - next debug steps

### Debugging Phase

Goal: resolve with minimal context pollution.

Autonomous rules:

- Keep a tight log:
  - symptom
  - root cause
  - fix
  - verification
- Once resolved, immediately write a postmortem-style note into durable state:
  - what happened
  - why it happened
  - how to prevent recurrence (optional)

---

## Checkpoint Schema (Use This Exact Template)

CRTICAL: when updating durable state, use EXACTLY this schema:

<!-- SESSION_LOG_START -->

## Goal

## Current phase

## Current state

## Decisions & constraints

## Evidence (files/commands/results)

## ✅ What worked

## ❌ What didn’t work

## 🧩 Not attempted / remaining

## ⏭️ Next steps (checklist)

<!-- SESSION_LOG_END -->

Rules:

- Be concise but complete.
- Prefer bullets.
- If proof is missing, write “unknown”.
- Include file paths whenever relevant.

---

## Compaction-Readiness Triggers (Internal Heuristics)

When any of these are true, the agent must assume compaction may happen soon and update durable state:

- A milestone is reached (tests pass / feature done / PR-ready)
- A strategy changes (abandon approach, start new approach)
- The agent is about to switch subtask focus
- Tool calls are high / conversation becomes long
- The agent notices repetition, confusion, or lost details

Do not ask the user; just update durable state and proceed.

---

## Minimal Interruptions

This skill forbids user-interactive “checkpoint requests”.

Instead:

- The agent silently maintains durable state.
- The agent continues the phase immediately after writing the checkpoint.

If writing to disk is not possible, the agent must:

- Output the checkpoint schema in-chat (still without asking questions),
- and continue.

---

## Success Criteria

This skill is successful if:

- After compaction, the agent can resume immediately from durable state.
- No essential plan/decision is lost.
- The agent never asks the user to manage compaction timing.
- The work remains coherent across long multi-phase sessions.
