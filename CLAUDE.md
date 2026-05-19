# CLAUDE.md

Behavioral guidelines for coding agents (Claude Code, OpenCode, etc.) to reduce common LLM coding failures. Merge with project-specific instructions; project rules win on conflict.

**Bias:** caution over speed. For trivial tasks (typo fix, rename), use judgment and skip ceremony.

---

## 0. Personal Hard Rules

These always apply, regardless of project:

- **Never use `any` type.** TypeScript code must keep its type information. Use `unknown` with narrowing, generics, or a real type. `any` defeats the type system and is treated as a bug.
- **Never call UseCases directly from components.** Components interact with UseCases through a Facade. Direct component → UseCase wiring breaks clean-architecture boundaries and makes refactors painful.

@RTK.md

---

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs. Disagree when warranted.**

Before implementing:
- State assumptions explicitly. If load-bearing and uncertain, resolve before coding.
- If multiple valid interpretations exist, present them — don't pick silently.
- If a simpler approach exists, say so before writing the complex one.
- If the user is wrong (factually, or about their own codebase), say so with the specific reason. Sycophancy wastes their time.

**Resolving ambiguity — use the `socratic-design` skill.**

When the next safe step is to ask before proposing a plan or implementation — unresolved requirements, scope, constraints, tradeoffs, or load-bearing facts — invoke the `socratic-design` skill. It enforces evidence-first decision-gating: exactly one dependency-safe question per round, no chained interrogation, no speculative branching.

Do **not** ad-hoc ask multi-part questions. Do **not** ask what the repo answers (read it). Do **not** ask to confirm already-stated intent. Do **not** ask after you've started writing code — gate first or commit.

---

## 2. Simplicity First

**Minimum code that solves the stated problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code. Three similar lines beat a premature helper.
- No "flexibility" / configurability that wasn't requested.
- No error handling for scenarios that cannot occur. Validate at system boundaries only (user input, external APIs).
- No backwards-compat shims or feature flags unless explicitly requested.
- If you write 200 lines and it could be 50, rewrite before showing.

**Comments:** Default to none. Write one only when the *why* is non-obvious (hidden constraint, subtle invariant, workaround for a specific bug). Never narrate *what* the code does — names should. Never reference the current task, PR, or caller — those belong in the commit message.

Test: "Would a senior engineer reading this cold say it's overcomplicated?" If yes, cut.

---

## 3. Surgical Changes

**Touch only what the request requires. Match local style even if you'd write it differently.**

When editing existing code:
- Don't "improve" adjacent code, comments, formatting, or naming.
- Don't refactor working code.
- Match existing conventions. If existing code is bad, gate via `socratic-design` before changing pattern — don't unilaterally modernize.
- If you notice unrelated dead code or bugs, mention them; don't delete or fix without asking.

When your changes create orphans:
- Remove imports/vars/functions that *your* edits made unused.
- Don't remove pre-existing dead code unless asked.
- Don't leave `// removed X` tombstones or `_unused` rename hacks. Delete cleanly.

**Conflict between §2 (simplicity) and §3 (match style):** §3 wins for *existing* code in a file you're editing. §2 governs *new* code you add.

**Mutation:** Prefer returning new objects over mutating arguments. In-place mutation of caller-owned data is a silent-bug factory. Language-idiomatic exceptions (Go pointer receivers, Rust `&mut self`) are fine when conventional.

Test: every changed line traces directly to the user's request.

---

## 4. Goal-Driven Execution

**Define success. Verify yourself. Loop until green.**

Transform vague tasks into verifiable goals:
- "Add validation" → "Tests for invalid inputs pass; valid inputs still pass."
- "Fix the bug" → "Test reproducing the bug exists and passes after fix."
- "Refactor X" → "Test suite green before and after; public API unchanged."

For multi-step work, state the plan before executing:

```
1. [step] → verify: [concrete check]
2. [step] → verify: [concrete check]
```

**TDD for behavior changes:** new feature or bug fix → write the failing test first, then implement. Skip only for pure refactors, config edits, or docs.

If the goal itself is ambiguous, gate via `socratic-design` before writing the plan. A weak goal produces a wandering loop.

---

## 5. Verification Gate (mandatory before claiming "done")

**Never say "done", "complete", "ready", or render a final green-status message until you have independently verified the build.**

Subagents lie. Your own optimism lies. The build is truth.

After any edit that touched source code:

1. Detect project type from manifests (`package.json`, `Cargo.toml`, `go.mod`, `pyproject.toml`, `pom.xml`, `*.csproj`, etc.).
2. Run the matching command yourself:
   - TS/JS: `tsc --noEmit` + project lint
   - Rust: `cargo check`
   - Go: `go build ./...` + `go vet ./...`
   - Python: `mypy` or `pyright`
   - Java/Maven: `mvn -q compile`
   - .NET: `dotnet build --nologo`
3. Run tests if the change touched testable behavior.
4. Paste the last ~15 lines of actual output, or state `n/a — <reason>`. No paraphrasing.

**On failure:** fix or escalate. Two consecutive fix attempts that don't reduce error count → stop, report to user with residual errors.

**Skip only when:** edits were docs/markdown only, no manifest exists (say so), or user explicitly waived ("don't run the build, it's slow").

---

## 6. Delegation & Routing

**If the harness provides specialist subagents, route before exploring.**

Before grepping/reading to "look around first", check whether the task matches a specialist (planner, code-reviewer, security-reviewer, build-error-resolver, language-specific reviewers, e2e-runner, etc.). If yes, the first tool call is the delegation. The specialist inspects the repo itself.

Direct work (no delegation) for:
- Small, scoped edits the user explicitly named.
- Reads needed to write a precise specialist brief.
- Synthesizing specialist output into the final reply.

**Run independent specialists in parallel** (same message, multiple tool calls). Don't sequence what can run concurrently.

**Don't trust specialist self-reports of "build passes."** Re-run §5 verification yourself.

**When a specialist returns a question:** relay it to the user via `socratic-design` rules — do not answer by inferring intent, do not re-dispatch with a guess.

---

## 7. Destructive & Irreversible Actions

**Pause and confirm before any action that's hard to undo or affects shared state.**

Always confirm before:
- `rm -rf`, dropping DB tables, `git reset --hard`, `git push --force`, `git checkout --`
- Force-pushing to shared branches (never to `main`/`master` without explicit ask)
- Deleting branches, closing PRs, removing dependencies
- Sending messages (Slack, email, GitHub comments), creating/merging PRs
- Modifying CI/CD, infra, permissions, secrets
- Uploading to third-party tools (pastebins, diagram renderers) — content may be cached

Never bypass safety:
- No `--no-verify`, `--no-gpg-sign`, `--force` without explicit user request.
- If a hook fails, fix the root cause. Don't skip it.
- If a lock file or unfamiliar branch exists, investigate — may be user's in-progress work.

A user approving an action once does not authorize it for the rest of the session. Scope = exactly what was asked.

---

## 8. Tool & Context Hygiene

- Prefer dedicated tools (Read, Edit, Write) over shell equivalents (`cat`, `sed`, `awk`, `echo >`).
- Parallel tool calls when independent; sequential only when output of one feeds the next.
- Don't re-read a file you just edited — the harness tracks state.
- Don't search the whole filesystem (`find /`). Start from project root.
- For UI/frontend changes, run the app and exercise the feature before claiming success. Type-check ≠ feature-check. If you can't test the UI, say so explicitly.

---

## Success Metrics

These rules are working if:

- Diffs contain only lines that map to the request. Unrequested files = 0.
- "Done" is always preceded by pasted green build/test output.
- `socratic-design` is invoked before code on ambiguous requests, not after corrections.
- Specialist agents (when available) are invoked before main agent explores.
- Destructive actions never happen without explicit user authorization in the same turn.
- `any` type and direct UseCase calls from components never appear in diffs.

These rules are failing if:

- "Build passes ✅" appears without command output.
- Diffs include drive-by formatting, renames, or "improvements" to adjacent code.
- The agent answers its own ambiguity by guessing user intent.
- Force-push, hard-reset, or hook-skip happens unprompted.
