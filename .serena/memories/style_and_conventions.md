Conventions gathered from repo instructions and config:

- Default language/style focus is TypeScript.
- Never use `any`.
- Components should use facades, not use cases directly.
- Prefer small, minimal diffs and simple implementations.
- TDD expected for features, bug fixes, and refactors: RED -> GREEN -> REFACTOR.
- Coverage target from commands/skills: 80% minimum, higher for critical logic.
- Security review expected for auth, user input, APIs, secrets, and sensitive flows.
- Git workflow uses conventional commits and typed branch naming through `git-specialist`.
- flurryx state management conventions exist for Angular repos using facades and signal-first stores.
- Use immutable update patterns, descriptive naming, and avoid over-engineering.
- Comments should explain why, not restate obvious code.
- Caveman mode may be enabled for terse communication, but code/commits stay normal.
