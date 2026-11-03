# Project memory

why-not-tooled: `memory-lint` checks frontmatter, review age, refs, and the length of `AGENTS.md`. It cannot see which bounded context a task touches, or whether a session loaded a context file it did not need.

Skip this rule when `FMFLURRY_MEMORY=off`.

- Root `AGENTS.md` stays at about 80 lines at most. It holds stable rules and pointers only. Bounded-context detail goes to `docs/memory/contexts/`, and decisions go to `docs/memory/decisions/`.
- Read `AGENTS.md` and `docs/memory/INDEX.md` first. Read `docs/memory/contexts/<bounded-context>.md` only when the task touches that bounded context. Read an ADR only when a context or the task cites it.
- ADRs are immutable. A replaced ADR gets the status `superseded by NNNN` and stays in the tree.
- A change in a bounded context updates its context file, its `refs`, and its `reviewed` date in the same change.

Layout, frontmatter, templates, and `/memory-init` are in the `project-memory` skill.
