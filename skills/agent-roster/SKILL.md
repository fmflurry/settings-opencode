---
name: agent-roster
description: "Use when choosing a specialist agent, running several agents in parallel, or splitting one problem across roles."
---

# Agent Orchestration

why-not-tooled: picking a specialist is routing judgment; the orchestration rule stays the always-on gate.

## Available Agents

Located in `~/.claude/agents/` (project scope: `<project>/.claude/agents/`):

| Agent | Purpose | When to Use |
|-------|---------|-------------|
| planner | Implementation planning | Complex features, refactoring |
| architect | System design | Architectural decisions |
| tdd-guide | Test-driven development | New features, bug fixes |
| code-reviewer | Code review | After writing code |
| coder | Implementation | Non-test code writing and edits |
| conductor | Primary orchestrator | Routing and delegation |
| writer | Documentation | Writing markdown, docs, README, ADRs |
| security-reviewer | Security analysis | Before commits |
| build-error-resolver | Fix build errors | When build fails |
| e2e-runner | E2E testing | Critical user flows |
| refactor-cleaner | Dead code cleanup | Code maintenance |
| doc-updater | Generated docs | Codemaps, doc generation |
| database-reviewer | SQL/database | Postgres, migrations, RLS |
| angular-cop | Angular code review | Pre-merge Angular + TS |
| dotnet-cop | .NET code review | Pre-merge .NET Minimal API |
| git-specialist | Git operations | Commits, branches, PRs |
| gdpr-specialist | GDPR compliance | Data protection review |
| comment-judge | Comment judging | Judge/purge comments (read-only) |

Folded agents are not installed on Monolith. If an agent in this table is not installed, the main agent loads that role's skill and does the work in this session. When `angular-cop` or `dotnet-cop` is not installed and `cop` is installed, dispatch to `cop` (it loads that skill).

## Immediate Agent Usage

No user prompt needed. If the named agent is installed, dispatch to it. Otherwise the main agent does the work inline and loads that role's skill.

1. Complex feature requests — if `planner` is installed, dispatch to that agent. Otherwise the main agent loads the `planner` skill and plans inline.
2. Code just written or modified — use the `code-reviewer` agent.
3. Bug fix or new feature — if `tdd-guide` is installed, dispatch to that agent. Otherwise the main agent loads the `tdd` skill and writes the tests inline.
4. Architectural decision — if `architect` is installed, dispatch to that agent. Otherwise the main agent loads the `architect` skill and does the design inline.

## Parallel Task Execution

ALWAYS use parallel Task execution for independent operations:

```markdown
# GOOD: Parallel execution
Launch 3 agents in parallel:
1. Agent 1: Security analysis of auth module
2. Agent 2: Performance review of cache system
3. Agent 3: Type checking of utilities

# BAD: Sequential when unnecessary
First agent 1, then agent 2, then agent 3
```

## Multi-Perspective Analysis

For complex problems, use split role sub-agents:
- Factual reviewer
- Senior engineer
- Security expert
- Consistency reviewer
- Redundancy checker
