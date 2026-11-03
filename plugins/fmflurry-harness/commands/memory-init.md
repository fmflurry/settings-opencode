---
description: Scaffold split project memory (short AGENTS.md, docs/memory index, contexts, ADRs, glossary)
agent: main
subtask: true
---

# /memory-init

Scaffold split project memory in the current project: $ARGUMENTS

Load the `project-memory` skill and follow its `/memory-init` section. It creates:

- a short root `AGENTS.md` (about 80 lines at most: stable rules and pointers only)
- `docs/memory/INDEX.md` (one line per doc)
- `docs/memory/contexts/<bounded-context>.md` (read only when a task touches that bounded context)
- `docs/memory/decisions/NNNN-<slug>.md` (ADRs; immutable; a replaced ADR is marked `superseded` and kept)
- `docs/memory/glossary.md`

Each memory doc carries `owner`, `reviewed` (YYYY-MM-DD), and `refs` (files or `file#symbol`) frontmatter. Never overwrite an existing file. Finish with `agent-harness memory-lint` and paste its output.

When `FMFLURRY_MEMORY=off`, say that project memory is off and stop.
