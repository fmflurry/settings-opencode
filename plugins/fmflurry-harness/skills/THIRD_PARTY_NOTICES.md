# Third-party skills — attribution

## Ported from cursor/plugins

The following skills in this directory are ported, with modifications for harness neutrality, from:

- **Repository:** https://github.com/cursor/plugins
- **Source commit:** `2eb7ed4` (Merge pull request #468)
- **Ported on:** 2026-10-02
- **License:** MIT, modified

### Ported skills

- `verify-this`
- `blast-radius`
- `show-your-work`
- `fix-merge-conflicts`
- `fix-ci`
- `loop-on-ci`
- `get-pr-comments`

### Generic modifications

All ported skills have been modified to remove references to harness-specific tooling, paths, and vendor-specific implementations:

- Removed Cursor-specific UI/CLI invocations and configuration files
- Replaced platform-specific references with generic stack-detection logic (TypeScript/Angular, .NET, PostgreSQL)
- Integrated code-memory tooling for symbol lookup and impact analysis
- Generalized "where grep stops" / vendor-specific knowledge sections to apply across projects
- Updated tool dispatch patterns to use generic agent names (code-reviewer, architect, security-reviewer, e2e-runner, tdd-guide)

Individual skills may document further specific modifications in their respective SKILL.md files.

### MIT License (Cursor)

```
MIT License

Copyright (c) 2026 Cursor

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

## Project-specific overrides

Project-specific or org-specific versions of these skills may exist under `.claude/skills/` (Claude Code) or `.opencode/skills/` (OpenCode). When present, these override the generic versions in this directory.

To maintain consistency, ensure any modifications to these generic skills are reflected in local overrides where they apply.
