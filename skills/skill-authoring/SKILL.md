---
name: skill-authoring
description: >-
  Guides writing and maintaining Claude Code skills with progressive disclosure and DRY principles.
  Use when creating a new skill, editing/adding content to an existing skill, restructuring or splitting skills,
  or asking "is this skill too large?" Encodes: 3-level disclosure (description + body + reference files),
  add-vs-split heuristic, anti-patterns, and maintenance checklist. Keeps skills under 500 lines + modular.
---

# Skill Authoring & Maintenance

Skills encode specialized knowledge for Claude Code's `/` command system. This guide ensures they stay modular, maintainable, and fast to load.

## Progressive Disclosure — 3 Levels

### Level 1: Frontmatter `description` (always loaded)

- **Max 100 words**. State **WHEN to trigger**, not how.
- Include concrete trigger phrases ("When creating…", "Use when…", "Ask when…").
- Avoid overlapping triggers with existing skills (check `/ls .claude/skills/*/SKILL.md`).
- Bad: "Scaffolds .NET architecture patterns." Good: "Use when creating a new bounded context or refactoring toward DDD + CQRS."

### Level 2: SKILL.md body (loaded on trigger)

- **Hard max 500 lines**. Target < 350.
- Include only info needed on **every** activation: overview, core concepts, mandatory rules, quick-start checklist.
- Section structure: When to use, core concepts, required conventions, checklist.
- Wiki-link to reference files for recipes, templates, detailed examples: `[reference-name.md](reference-name.md)` or `[[reference-name]]`.

### Level 3: Reference files (loaded on demand only)

- Live in the skill's directory: `skill-name/reference.md`, `skill-name/templates.md`, etc.
- Contain: recipes, SQL boilerplate, full code examples, edge cases, detailed checklists, FAQ.
- Linked from body via `[name](file.md)` or `[[wiki-link]]`.
- One skill may link to another's reference file (shared doctrine, not duplicated).

## Add vs Split Heuristic

| Info Type | Body | Reference | Another Skill |
|-----------|------|-----------|---------------|
| Core concept, rule on every use | Yes | — | — |
| "Only if…" workflow, edge case | — | Yes | — |
| Shared by several skills (DRY) | — | — | Yes, link to it |

Example: `dotnet-cop` and `security-review` both link to `dotnet-clean-architecture/postgres-schema-per-context.md` instead of copying the RLS doctrine.

## Description Quality (Trigger Activation)

- **Concrete triggers**: "When creating…", "Use when…", "Ask when…"
- **No overlaps**: Skill A triggers on `"new feature + tests"`, Skill B on `"refactor + tests"` → collision. Disambiguate ("ATDD outer loop" vs "TDD inner loop").
- **No content summaries** in description. Bad: "Explains progressive disclosure, add-vs-split, and anti-patterns." Good: "Use when writing a skill or asking if a skill is too large."
- **Test**: Would a user know when to invoke `/` based only on the description?

## Anti-Patterns

| Pattern | Risk | Fix |
|---------|------|-----|
| Duplicated doctrine that drifts | Two skills with RLS rules → contradiction | Link to single source-of-truth |
| SKILL.md > 500 lines | Slow load, hard to update, mixed concerns | Move recipes/examples to reference file |
| Description = content summary | User doesn't know when to trigger | Rewrite as trigger conditions |
| Orphan reference file | No skill links to it — dead code | Audit on edit: grep for filename, delete or link |
| One skill, two unrelated stacks | Confusing scope (e.g., "TypeScript + Rust patterns") | Split into two skills |
| Reference file no public path | User can't access it | Ensure skill body links it or mention in description |

## Maintenance Checklist: Editing a Skill

**Before committing changes:**

- [ ] Is the info in the right level? (Body for every use, reference for sometimes, another skill for shared doctrine)
- [ ] SKILL.md still < 500 lines?
- [ ] Description still accurate + states WHEN to trigger?
- [ ] Cross-links to other skills updated (`[[other-skill]]` syntax)?
- [ ] No new trigger overlap with existing skills (run `ls .claude/skills` and spot-check descriptions)?
- [ ] All reference files linked from body (orphan audit: `grep -r "skill-name" .claude/skills` finds no matches → orphan)?
- [ ] Spell-check + link validity (no `[text](nonexistent.md)`)?

## When to Split a Skill

A skill is too large if:
- Body exceeds 500 lines and you can't cut without losing context.
- Two unrelated stacks/domains (e.g., "frontend testing + backend caching") naturally separate.
- Description has two WHEN clauses joined by OR and audiences don't overlap.
- A reference file is longer than the body and covers a distinct topic.

**Example**: `openspec-*` skills — each handles a phase of a workflow (new, continue, verify). Splitting keeps each body < 300 lines and each trigger unambiguous.

## Checklist: Creating a New Skill

- [ ] Trigger phrase clear + unique (no collision with existing skills via grep on `description`).
- [ ] Frontmatter description < 100 words, starts with "Use when…" or "Guides…".
- [ ] Body covers core concepts, rules, mandatory workflows; < 500 lines.
- [ ] Create `reference-*.md` for edge cases, templates, detailed examples.
- [ ] All reference files listed in body with wiki-links or markdown links.
- [ ] No duplicated doctrine — link to shared sources instead (e.g., coding-standards, CLAUDE.md).
- [ ] Test: Show description to a user; do they know when to invoke it?
