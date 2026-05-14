# Verification Gate (mandatory before "done")

Agents have repeatedly reported "implementation done" while the build is red. This rule fixes that. Applies to anyone who wrote or edited source code in the current turn — main agent or subagent.

## Hard rule

You MAY NOT tell the user "done", "complete", "ready", "ready to merge", or render a green-status final message until you have:

1. Detected the project type from manifests present in cwd (search recursively, not only at root — `.csproj`, `pom.xml`, `build.gradle*`, etc. often live in subdirs):
   - `angular.json` / `tsconfig.json` / `package.json` → TS/Angular
   - `Cargo.toml` → Rust
   - `go.mod` → Go
   - `pyproject.toml` (with mypy/pyright config) → Python
   - `pom.xml` → Java/Maven
   - `build.gradle` / `build.gradle.kts` → Java or Kotlin/Gradle (check `settings.gradle*` + presence of `*.kt` vs `*.java` to disambiguate; Kotlin Multiplatform falls under Kotlin)
   - `*.sln` / `*.slnx` / `*.slnf` / `*.csproj` / `*.fsproj` / `*.vbproj` / `global.json` / `Directory.Build.props` → .NET (C#/F#/VB). `.slnx` is the XML-based format (default in .NET 10 SDK, supported since 9.0.200); `.slnf` is a solution filter referencing a `.sln`/`.slnx`
2. Run the matching independent verification yourself (do not trust a subagent's self-report):
   - TS/Angular: `npx tsc --noEmit --pretty false`
   - Rust: `cargo check --message-format=short`
   - Go: `go build ./...`
   - Python: `mypy .` or `pyright`
   - Java/Maven: `mvn -q -DskipTests compile` (multi-module: run from repo root, Maven recurses)
   - Java/Gradle: `./gradlew --offline compileJava compileTestJava -x test` (or `compileKotlin` for Kotlin)
   - .NET: `dotnet build --nologo -clp:ErrorsOnly --no-restore` (run `dotnet restore` first if `obj/` is missing); pass the explicit path for a solution: `dotnet build path/to/Solution.sln` or `dotnet build path/to/Solution.slnx` (SDK 9.0.200+ required for `.slnx`)
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
