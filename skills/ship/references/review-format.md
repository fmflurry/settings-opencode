# Review summary format

The thorough local review (ship stage 8) ends with one PR comment. A human reads it to audit the run. Nothing in
the merge path reads it. `ship-merge` does not treat it as proof of review. It is not a GitHub status.

The agent posts the comment once, when the review ends (after the last round), with
`gh pr comment <n> --body-file <body-file>`.

## Verdict lines

| Verdict | First line | Marker (last line) |
|---|---|---|
| Pass | `✅ Review: no blocking concerns` | `<!-- agent-review sha=<head-sha> verdict=pass -->` |
| Concerns | `⚠️ Review: concerns` | `<!-- agent-review sha=<head-sha> verdict=concerns -->` |

- `pass` only when no CRITICAL or HIGH finding is open at the head SHA.
- `concerns` is posted when a CRITICAL or HIGH finding is still open after round 3. Escalate at the same time.
- `<head-sha>` is the SHA the review read, taken with `git rev-parse HEAD` at the start of the last round.

## Body

```markdown
✅ Review: no blocking concerns

- code-reviewer: <n> findings, <n> fixed, <n> open (non-blocking)
- security-reviewer: <clean | findings listed>
- angular-cop: <n/a, no Angular or TS changed | summary>
- dotnet-cop: <n/a, no .NET changed | summary>
- database-reviewer: <n/a, no SQL changed | summary>
- rounds: <n of 3>

Non-blocking follow-ups:
- <one line each, same list as the PR body>

<!-- agent-review sha=<head-sha> verdict=pass -->
```

Keep each reviewer line to one line. Put `file:line` pointers in the follow-up list, not in the verdict.

## Rules

- Each finding is one line: severity (CRITICAL, HIGH, MEDIUM or LOW), `file:line`, and the problem.
- Only confirmed findings appear. Findings dropped during verification are not listed.
- Non-blocking items go in the follow-up list. They never change the verdict.
- A new head gets its own review and its own comment. Do not edit an old comment. Push a fix, then review the new diff.
