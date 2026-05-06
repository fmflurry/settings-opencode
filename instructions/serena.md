## Activation Order

1. Check `instructions/subagent-routing.md` first. Before any tool call, decide whether the user request matches a specialist. If yes, follow its first-tool gate: use Task and do not call Serena tools beforehand.
2. Activate Serena only when no specialist applies, or after specialist work completes and non-specialist work remains.

## Serena Setup

Connect to Serena by calling `serena_activate_project` with the current project path.
Then, use Serena MCP tools. Serena provides essential semantic code retrieval, editing and refactoring tools that are akin to an IDE's capabilities, operating at the symbol level and exploiting relational structure.
