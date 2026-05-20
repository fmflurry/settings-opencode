# CodeMemory First

For repo understanding, research, and debugging, prefer CodeMemory before raw text tools.

- After mandatory first-tool routing is satisfied, call `code-memory_codememory_retrieve` for semantic orientation.
- Use returned paths, symbols, and episodes for next checks.
- Only then use `grep`, `glob`, `read`, or `bash`/`rg` for exact verification.
- Do not start broad repo exploration with `grep` or `read` when CodeMemory tools are available.

Exceptions:

- Exact file path user request.
- Exact current contents needed after CodeMemory points to a file.
- Verification after edits.
- CodeMemory unavailable or fails.
- Mandatory subagent first-tool gate applies.

When delegating repo research to subagents, include: “Use CodeMemory for orientation before grep/read unless exact file verification is needed.”
