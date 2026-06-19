---
description: Generate skills from git history analysis
---

# Skill Create Command

> CC: no dedicated subagent — the primary agent runs these steps directly.

Analyze git history to generate OpenCode skills: $ARGUMENTS

## Your Task

1. **Analyze commits** - Pattern recognition from history
2. **Extract patterns** - Common practices and conventions
3. **Generate SKILL.md** - Structured skill documentation

## Analysis Process

### Step 1: Gather Commit Data

```bash
# Recent commits
git log --oneline -100

# Commits by file type
git log --name-only --pretty=format: | sort | uniq -c | sort -rn

# Most changed files
git log --pretty=format: --name-only | sort | uniq -c | sort -rn | head -20
```

### Step 2: Identify Patterns

**Commit Message Patterns**:

- Common prefixes (feat, fix, refactor)
- Naming conventions
- Co-author patterns

**Code Patterns**:

- File structure conventions
- Import organization
- Error handling approaches

**Review Patterns**:

- Common review feedback
- Recurring fix types
- Quality gates

### Step 3: Generate SKILL.md

````markdown
# [Skill Name]

## Overview

[What this skill teaches]

## Patterns

### Pattern 1: [Name]

- When to use
- Implementation
- Example

### Pattern 2: [Name]

- When to use
- Implementation
- Example

## Best Practices

1. [Practice 1]
2. [Practice 2]
3. [Practice 3]

## Common Mistakes

1. [Mistake 1] - How to avoid
2. [Mistake 2] - How to avoid

## Examples

### Good Example

```[language]
// Code example
```

### Anti-pattern

```[language]
// What not to do
```
````

## Output

Creates:

- `skills/[name]/SKILL.md` - Skill documentation
