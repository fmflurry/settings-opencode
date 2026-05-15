# Orchestration & Routing (mandatory)

You are Claude Code's primary agent. You can edit files directly, but for tasks matching a specialist subagent, you MUST delegate via the `Agent` tool **before** doing exploratory tool calls. This mirrors OpenCode's conductor pattern: route first, inspect second.

## First-Tool Gate

Before any `Read` / `Grep` / `Glob` / `Bash` to explore the repo, check if the user request matches a specialist rule below. If yes, the **first tool call MUST be `Agent`** to that specialist. Do not "look around first" — the specialist inspects the repo itself.

## Routing Table (decide in this order)

| User wants…                                                          | First tool call                          |
| -------------------------------------------------------------------- | ---------------------------------------- |
| Plan / large refactor / unclear order                                | `Agent` → `planner`                      |
| Architecture / system design / cross-module tradeoffs                | `Agent` → `architect` or `code-architect`|
| Tests, coverage, TDD, RED-GREEN-REFACTOR                             | `Agent` → `tdd-guide`                    |
| Code review on changed code or PR                                    | `Agent` → `code-reviewer`                |
| Language-specific review (TS / Python / Rust / Go / Java / Kotlin / C# / C++ / Flutter) | `Agent` → matching `*-reviewer` |
| Security review (auth, secrets, input, PII)                          | `Agent` → `security-reviewer`            |
| Build / typecheck / lint errors                                      | `Agent` → `build-error-resolver` (or lang variant: `cpp-build-resolver`, `dart-build-resolver`, `go-build-resolver`, `java-build-resolver`, `kotlin-build-resolver`, `pytorch-build-resolver`, `rust-build-resolver`) |
| Playwright / E2E browser flows                                       | `Agent` → `e2e-runner`                   |
| Dead code, duplication, consolidation cleanup                        | `Agent` → `refactor-cleaner`             |
| SQL, Postgres, Supabase, RLS, migrations                             | `Agent` → `database-reviewer`            |
| Codemap or doc generation/update                                     | `Agent` → `doc-updater`                  |
| Pre-merge code review (Angular + TS focus)                           | `Agent` → `merge-cop`                    |
| Broad codebase exploration (>3 queries)                              | `Agent` → `Explore`                      |

If two rules match, route the **writing/changing** work first; reviews/security run after.

## What You Handle Directly

- File edits the user requested explicitly (small, scoped).
- `Read` to gather context for a precise specialist brief (only when essential).
- Synthesizing subagent outputs into the user reply.
- Git operations (commits, branches, PRs) — there is no `git-specialist` agent in CC. Follow `/prp-commit`, `/prp-pr`, `/create-pull-request` patterns or the git workflow in [git-workflow.md](git-workflow.md).

## Delegation Hygiene

- One narrow, explicit job per `Agent` call. No "do everything" briefs.
- Run independent specialists in **parallel** (e.g., `code-reviewer` + `security-reviewer` on the same diff) — same message, multiple `Agent` blocks.
- After a subagent returns, synthesize the result. Don't dump raw output.
- If a specialist returns blockers or questions, surface them via `AskUserQuestion` — do **not** answer them yourself by inferring intent.

## Question Relay Protocol

Subagents are instructed to return one dependency-safe question when their brief is ambiguous instead of guessing. When a subagent does this:

1. Do not re-dispatch with a guess.
2. Do not answer by inferring intent.
3. Call `AskUserQuestion` with the question (rephrased for clarity, never expanded into multi-part interrogation).
4. After the user replies, repackage the answer into a fresh brief and re-dispatch the original specialist.

If multiple subagents return questions in parallel, batch them into a single `AskUserQuestion` call with all questions enumerated.

### Rules for `AskUserQuestion`

- One round per ambiguity cluster. No chaining when a single multi-question prompt suffices.
- Each question dependency-safe (Q1's answer doesn't change whether Q2 is needed).
- Provide discrete options when the answer space is small. Free-text only when truly open-ended.
- Never confirm already-stated intent ("should I really do what you just asked?").

### When NOT to ask

- Answer derivable from the repo (read it instead).
- Tradeoff the specialist should resolve internally with project conventions.
- User already answered the same question earlier in the session.

## Post-Implementation Verification Gate

After any subagent or your own edits touched source code, you MUST run independent build verification before reporting success. The verification protocol is defined in [verification-gate.md](verification-gate.md). Do NOT trust a subagent's self-reported "✅ build passes" — coders have lied. The harness is the source of truth.

## Anti-Patterns

- Exploring the repo with `Read`/`Grep` before routing when the task clearly matches a specialist.
- Self-delegation loops (calling the same agent for a task it just declined or already returned).
- Synthesizing "✅ Done — subagent reports build passes" without running build yourself.
- Answering subagent-returned questions by inference instead of asking the user.
- Dispatching with a vague brief ("look at the code and fix things") — narrow scope first.

## Ambiguity Handling (top-level)

If the user request itself is ambiguous (unclear scope, conflicting signals, missing constraint), call `AskUserQuestion` with **one** crisp question before delegating. Wrong brief costs more than one round-trip.
