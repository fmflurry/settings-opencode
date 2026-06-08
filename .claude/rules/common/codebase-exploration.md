# Codebase Exploration

**HARD DEFAULT: When `mcp__code-memory__*` tools are connected, they are the FIRST and REQUIRED choice for any code search, symbol lookup, callers/callees, definitions, dependencies, or importers. Grep/Glob/Bash are fallbacks ONLY — reach for them only when code-memory cannot answer (raw directory listing, filename glob, reading a known path region, or no index for the project). Do not "start with grep" or "try grep first". Start with code-memory.**

**Applies whenever the `code-memory` MCP server is connected (tools named `mcp__code-memory__*`). Skip entirely if the server is absent.**

## Priority

For any codebase exploration — search, callers, callees, definitions, dependencies, importers, "where is X used?", "what calls Y?", "find references to Z", semantic Q&A over the repo — **use `mcp__code-memory__*` tools first**.

Fall back to `rtk grep` / `rtk find` / `Grep` / `Glob` / `Bash` only when code-memory cannot answer the question:

- Raw directory listing (`ls`-style) — code-memory has no `list_files`.
- Globbing by filename pattern only (no symbol/content concern).
- Reading a file region whose path you already know — use `Read`.
- Code-memory has no index for the project (first call returns empty / project-not-ingested).

## Tool routing

| Question | Tool |
| --- | --- |
| "How does X work?" / "Where is X handled?" (semantic) | `mcp__code-memory__codememory_retrieve` |
| "Where is symbol `X` defined?" | `mcp__code-memory__codememory_definitions` |
| "Who calls `X`?" / impact analysis for rename | `mcp__code-memory__codememory_callers` |
| "What does `X` call?" | `mcp__code-memory__codememory_callees` |
| "What does file `F` import?" | `mcp__code-memory__codememory_dependencies` |
| "Who imports file `F`?" | `mcp__code-memory__codememory_importers` |
| "List files in dir `D`" | `Bash` (`rtk ls`, `find`) |
| "Find files matching glob `*.spec.ts`" | `Glob` or `Bash` |
| "Read lines 40-80 of `F`" | `Read` |

## Project slug

`mcp__code-memory__*` requires a `project` arg. Use the repo slug (typically the directory name of the current working dir). Do not use sentinels like `auto` or `default` — they are rejected.

If unsure of the slug, infer from cwd basename. If the first call returns empty results because the project isn't ingested, tell the user — do not silently fall back to grep and pretend code-memory had no answer.

## Anti-patterns

- Reaching for `rtk grep` / `find` / `Grep` before checking if a code-memory tool fits the question.
- Using `codememory_retrieve` for a question that has a precise topology answer (`_callers`, `_definitions`, etc.) — use the precise tool.
- Re-grepping after code-memory returned a ranked file list — read the top files instead.
- Searching the whole filesystem (`find /`) when the question is repo-scoped.
