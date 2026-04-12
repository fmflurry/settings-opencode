When task done in this workspace, check:

1. Run relevant verification for changed area.
2. Prefer type check: `npx tsc --noEmit` when TypeScript files/config changed.
3. Run tests if project/repo under work defines them; TDD workflow expects tests first and >=80% coverage.
4. Run lint/build commands if available in target repo.
5. Perform code review for quality/security when change touches logic.
6. Perform security review for auth, user input, API, secrets, or sensitive data.
7. If git task involved, use `/git` or related git workflow command and keep conventional commit/branch naming.
8. Call out when command templates reference scripts that are not actually present in `package.json`.
