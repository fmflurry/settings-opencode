---
name: setup-harness
description: "Detect the model slugs available to Task subagents and write the per-tier model config files used by the conductor."
disable-model-invocation: true
---

# Setup harness

Choose one model per tier and persist the choice in **two locations** for maximum compatibility:
1. `~/.cursor/rules/fmflurry-harness-models.mdc` (Cursor desktop only)
2. `~/.agents/fmflurry-harness-models.md` (all environments, including cloud agents)

The conductor reads from the first file that exists (rule wins, then plain-file, then inline defaults).

## Tiers

Each agent declares its tier via `tier:` frontmatter. The three tiers are:

| Tier | Primary default | Fallback order | Use |
| --- | --- | --- | --- |
| coding | `grok-4.7-xhigh` | `grok-4.7-high`, `claude-opus-5-5-high` | implementation, tests, build fixes |
| smart | `claude-opus-5-5-high` | `claude-opus-5-5-medium`, `grok-4.7-xhigh` | planning, architecture, review, security; expensive |
| cheap | `composer-2.5` | `claude-sonnet-5-5-medium`, `grok-4.7-medium` | git, codebase search, docs, comment triage |

## Procedure

1. Enumerate the model slugs you can pass to a `Task` subagent in this session (see the Task tool's `model` parameter). If Cursor exposes a models list, prefer it. If none are detectable, ask the user to paste the slugs. Never write a slug you have not confirmed is available. The aliases `inherit` and `auto` are always valid; they run on the parent model and omit `model`.

2. Propose one slug per tier:
   - **coding**: implementation, tests, build fixes. Default `grok-4.7-xhigh` (non-fast variant). If unavailable, try the fallback order: `grok-4.7-high`, `claude-opus-5-5-high`. Never use `-fast` variants.
   - **smart**: planning, architecture, review, security. Default `claude-opus-5-5-high`. If unavailable, try the fallback order: `claude-opus-5-5-medium`, `grok-4.7-xhigh`.
   - **cheap**: git, codebase search, docs, comment triage. Default `composer-2.5`. If unavailable, try the fallback order: `claude-sonnet-5-5-medium`, `grok-4.7-medium`. Never use `-fast` variants or the `fast` alias for cheap.
   
   If all fallbacks are exhausted, ask the user to choose from the available slugs. Never propose GPT models.

3. Show the proposal; the user may edit it. Then write **both config files**:

   **File 1: `~/.cursor/rules/fmflurry-harness-models.mdc`** (Cursor rule)
   
   ```
   ---
   description: fmflurry-harness per-tier model choices (overrides plugin defaults)
   alwaysApply: true
   ---
   # Re-run /setup-harness to change. Values: a Task slug, or `inherit`/`auto` (omit Task model).
   coding: <slug>
   smart: <slug>
   cheap: <slug>
   ```

   **File 2: `~/.agents/fmflurry-harness-models.md`** (plain-file fallback)
   
   Create `~/.agents/` if it doesn't exist, then write:
   
   ```
   # fmflurry-harness per-tier model choices
   # Re-run /setup-harness to change. Values: a Task slug, or `inherit`/`auto` (omit Task model).
   coding: <slug>
   smart: <slug>
   cheap: <slug>
   ```

   Overwrite the whole file so re-runs are idempotent, and keep any custom lines the user already had in it.

4. Tell the user the config applies to new chats, and to pick Grok 4.7 xhigh in the model picker for the main (conductor) chat, because a plugin cannot set the parent model.
