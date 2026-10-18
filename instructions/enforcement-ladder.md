# Enforcement ladder

why-not-tooled: choosing the level is a judgment; no linter can see that a prose rule should have been code.

The pyramid is inverted: enforcement is wide in code and tooling, and thin in prose and human review. Put a fix at the first level that can hold it.

1. **Code** — make the wrong state unrepresentable (types, API, structure, shared helper).
2. **Lint, test, or static analysis** — fail the build or the suite.
3. **Prose rule** — a rule, instruction, or skill mandate.
4. **Human review** — only when the three above cannot catch it.

A prose rule includes `why-not-tooled:` naming the level that cannot enforce it. Prefer a description trigger or a `paths` / `globs` rule over always-on text. Adding always-on prose means deleting or shortening overlapping always-on prose in the same change, so the always-loaded line count does not rise.

The same failure twice means encode it in code or tooling and delete the extra prose. A one-off slip can stay a note.
