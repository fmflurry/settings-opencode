---
description: Manually trigger a learning review of the current session
agent: conductor
---

# Learn Review

Manually trigger a learning review of the current session: $ARGUMENTS

## Your Task

Perform a one-time learning review of the current session:

1. Fetch the last 10 messages from the current session
2. Analyze the conversation for durable learnings:

### What to look for
- **Project patterns** — Architecture decisions, tech stack choices, coding conventions the user stated or implied
- **Preferences** — User preferences about code style, testing approach, naming conventions
- **Self-improvement** — Recurring mistakes, patterns the agent handles poorly, opportunities for new skills
- **Domain knowledge** — Facts about the project domain that should be remembered

### Output format

For each learning found, output in this format:

**Memory claims** — Use `codememory_assert_claim` directly with:
- subject, predicate, object, confidence

**Skill proposals** — Save to pending files:
- Write to `~/.config/opencode/pending/skills/<timestamp>-<slug>.json`
- The JSON should include: type, action, name, reason, description, content fields

**If nothing learned**: Report "Nothing to save."

### Important
- Be conservative — only capture durable patterns, not one-off instructions
- For project-level facts, call `codememory_assert_claim` directly
- For self-improvement (skills), write pending files for user approval
