# CodeMemory First (mandatory after routing)

**ROUTING PRECEDENCE:** The mandatory first-tool routing gate (when your harness has one) runs first. Once that gate is satisfied, the CodeMemory-first mandate below applies to exploration within whichever agent is executing — including the primary agent when no specialist matches.

**HARD DEFAULT: When the `code-memory` MCP server is connected (tools named `code-memory_*`), those tools are the FIRST and REQUIRED choice for any code search, symbol lookup, callers/callees, definitions, dependencies, or importers. `grep` / `glob` / `bash` are fallbacks ONLY — reach for them only when code-memory cannot answer (raw directory listing, filename glob, reading a known path region, or no index for the project). Do not "start with grep" or "try grep first". Start with code-memory.**

**Skip entirely if the `code-memory` server is absent.**

## Priority

For any codebase exploration — search, callers, callees, definitions, dependencies, importers, "where is X used?", "what calls Y?", "find references to Z", semantic Q&A over the repo — **use `code-memory_*` tools first**.

Fall back to `grep` / `find` / `glob` / `bash` only when code-memory cannot answer the question:

- Raw directory listing (`ls`-style) — code-memory has no `list_files`.
- Globbing by filename pattern only (no symbol/content concern).
- Reading a file region whose path you already know — use `read`.
- Code-memory has no index for the project (first call returns empty / project-not-ingested).

## Tool routing

| Question | Tool |
| --- | --- |
| "How does X work?" / "Where is X handled?" (semantic) | `code-memory_codememory_retrieve` |
| "Where is symbol `X` defined?" | `code-memory_codememory_definitions` |
| "Who calls `X`?" / impact analysis for rename | `code-memory_codememory_callers` |
| "What does `X` call?" | `code-memory_codememory_callees` |
| "What does file `F` import?" | `code-memory_codememory_dependencies` |
| "Who imports file `F`?" | `code-memory_codememory_importers` |
| "List files in dir `D`" | `bash` (`find`) or `glob` |
| "Find files matching glob `*.spec.ts`" | `glob` or `bash` |
| "Read lines 40-80 of `F`" | `read` |

## Project slug

`code-memory_*` requires a `project` arg. Use the repo slug (typically the directory name of the current working dir). Do not use sentinels like `auto` or `default` — they are rejected.

If unsure of the slug, infer from cwd basename. If the first call returns empty results because the project isn't ingested, tell the user — do not silently fall back to grep and pretend code-memory had no answer.

## Anti-patterns

- Reaching for `grep` / `find` before checking if a code-memory tool fits the question.
- Using `codememory_retrieve` for a question that has a precise topology answer (`_callers`, `_definitions`, etc.) — use the precise tool.
- Re-grepping after code-memory returned a ranked file list — read the top files instead.
- Searching the whole filesystem when the question is repo-scoped.
