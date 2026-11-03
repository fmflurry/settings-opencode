---
name: project-memory
description: "Use when a project has docs/memory, when running /memory-init, when a design decision is made (write an ADR), or when a change touches a bounded context whose memory file must stay true. Skip it when FMFLURRY_MEMORY=off."
---

# Project memory (split memory)

Project memory is split so that a session loads only what the task needs. It is on by default.
`FMFLURRY_MEMORY=off` turns it off: skip this skill, and `memory-lint` passes without checking.

## Layout

| Path | Holds | Loaded |
|---|---|---|
| `AGENTS.md` (root) | Stable rules and pointers only, about 80 lines at most | Every session |
| `docs/memory/INDEX.md` | One line per memory doc: path and what it covers | Every session, after `AGENTS.md` |
| `docs/memory/contexts/<bounded-context>.md` | How one bounded context works: language, invariants, entry points | Only when the task touches that bounded context |
| `docs/memory/decisions/NNNN-<slug>.md` | One ADR per decision | When a context or the task cites it |
| `docs/memory/glossary.md` | Shared terms, one line each | When a term is unclear |

The rule `instructions/project-memory.md` holds the loading rule.

## Frontmatter

Every file under `docs/memory/` starts with this frontmatter:

```yaml
---
owner: billing-team          # a person or team that answers for the doc
reviewed: 2026-11-03         # YYYY-MM-DD, the last time someone checked it against the code
refs:                        # files or file#symbol the doc describes; [] when none
  - src/billing/invoice.ts
  - src/billing/invoice.ts#InvoiceService
---
```

A ref is a path relative to the project root. `path#symbol` also needs the symbol as a whole word in that file.

## memory-lint

`agent-harness memory-lint [ROOT]` checks `docs/memory`. It fails on:

- a doc with no frontmatter, no `owner`, or no `reviewed`
- a `reviewed` date older than 90 days
- a dead ref: a missing path, a path outside the project, or a symbol not found in its file

ADRs under `decisions/` still need `owner` and a valid `reviewed`, but skip the age and ref checks: they are immutable records. A ref that resolves outside the project, including through a symlink, is dead. It warns when `AGENTS.md` is longer than 80 lines. A project without `docs/memory` passes. The PR hook lints the project of the session's working directory, so open the PR from the project it targets.
The ship stop gate puts lint findings in its block reason. `agent-harness pr-report-check` and the
`gh pr create` hook run it too. When `docs/memory` exists, they also require the PR body line below.

## /memory-init

Scaffold the layout in the target project. Do not overwrite a file that already exists. Report the files you created and the ones you skipped.

1. Read the existing root `AGENTS.md` (or `CLAUDE.md`). Keep stable rules and pointers there. Move bounded-context detail to `contexts/`, and decisions to `decisions/`. Keep it at 80 lines or fewer.
2. Find the bounded contexts from the source tree (modules, packages, top-level feature folders). Create one `contexts/<bounded-context>.md` per context, with refs to its entry points. Ask when the split is unclear. Do not guess.
3. Create `decisions/0001-record-architecture-decisions.md` from the ADR template.
4. Create `glossary.md` and `INDEX.md`. Write one INDEX line per doc.
5. Set `owner` from the user's answer or `CODEOWNERS`, and set `reviewed` to today.
6. Run `agent-harness memory-lint` and fix every finding.

`AGENTS.md` pointer block:

```markdown
## Project memory
- Index: `docs/memory/INDEX.md`. Read it first.
- Read `docs/memory/contexts/<bc>.md` only when the task touches that bounded context.
- Decisions: `docs/memory/decisions/`. ADRs are immutable.
```

`INDEX.md` line: `- [contexts/billing.md](contexts/billing.md): invoices, payment terms, credit notes`

## ADR template

```markdown
---
owner: <team>
reviewed: <YYYY-MM-DD>
refs: []
---
# NNNN. <Title>

Status: accepted          <!-- proposed | accepted | superseded by NNNN -->
Date: <YYYY-MM-DD>

## Context
## Decision
## Consequences
```

ADRs are immutable. To change a decision, write a new ADR. In the old one, change only `Status:` to `superseded by NNNN` and the frontmatter. Keep the old file. Number with the next free four-digit `NNNN`. Add the new ADR to `INDEX.md`.

## Upkeep

- A decision is made (architect, writer): write an ADR.
- A change touches a bounded context (doc-updater): update that context file so it matches the code, fix its refs, and set `reviewed` to today.
- A PR body states `mémoire : màj` when memory changed, or `mémoire : aucun changement` when it did not.
