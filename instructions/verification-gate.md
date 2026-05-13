# Verification Gate (mandatory before "done")

Agents have repeatedly reported "implementation done" while the build is red. This rule fixes that. Applies to anyone who wrote or edited source code in the current turn — main agent or subagent.

## Hard rule

You MAY NOT tell the user "done", "complete", "ready", "ready to merge", or render a green-status final message until you have:

1. Detected the project type from manifests present in cwd:
   - `angular.json` / `tsconfig.json` / `package.json` → TS/Angular
   - `Cargo.toml` → Rust
   - `go.mod` → Go
   - `pyproject.toml` (with mypy/pyright config) → Python
   - `pom.xml` / `build.gradle*` → JVM
2. Run the matching independent verification yourself (do not trust a subagent's self-report):
   - TS/Angular: `npx tsc --noEmit --pretty false`
   - Rust: `cargo check --message-format=short`
   - Go: `go build ./...`
   - Python: `mypy .` or `pyright`
   - JVM: `mvn -q -DskipTests compile` or `./gradlew --offline compileJava`
3. Run lint on changed files when a project script exists.
4. Paste the last ~15 lines of each command's actual output into your reply, OR explicitly state `n/a — <reason>`. No paraphrasing.

## On failure

- Errors caused by the diff in this turn → fix or dispatch the build-error-resolver subagent. Re-verify. Loop until green.
- Errors pre-existing on the base branch → list under `## Pre-existing failures`, confirm via `git stash && <cmd>`, then proceed without claiming you fixed them.
- Two consecutive resolver passes that fail to reduce error count → stop, escalate to the user with the residual error log.

## Skip conditions

- Turn only touched docs / markdown / non-code → skip verification.
- No recognized manifest in cwd → tell the user; do not silently skip.
- User explicitly accepted skipping (e.g., "build is slow, don't run it") → mention "verification skipped at user request" in your final message.

## Anti-pattern

Synthesizing "✅ Build passes per subagent" without independently re-running the build. Subagent self-reports are evidence, not proof.
