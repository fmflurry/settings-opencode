---
name: setup-harness
description: "Write the per-tier Cursor model files used by the conductor. Defaults are Grok 4.7."
disable-model-invocation: true
---

# Setup harness

Write one Cursor model per tier to both:

- `~/.cursor/rules/{{ruleFile}}`
- `~/.agents/fmflurry-harness-models.md`

## Tiers

{{tierTable}}

## Allowed models

Only Cursor models: `grok-4.7`, `grok-4.6`, `grok-4.5`, and `composer-2.5`, with an optional effort suffix (`max`, `xhigh`, `high`, `medium`, `low`). Never third-party models. Never `-fast` variants. `inherit` and `auto` are allowed aliases: they run on the parent model and omit `model`.

If a slug is not in that set, ignore it and use the tier default. Log why: the slug, the tier, and that it is not a Cursor model.

## Procedure

1. Use these defaults. Do not pick a third-party slug even if one is advertised:
   - coding: `{{codingDefault}}`. Fallbacks: {{codingFallbacks}}.
   - smart: `{{smartDefault}}`. Fallbacks: {{smartFallbacks}}.
   - cheap: `{{cheapDefault}}`. Fallbacks: {{cheapFallbacks}}.
   If the user asks for a different slug, accept it only when it is an allowed Cursor model or `inherit`/`auto`. Otherwise ignore it, keep the tier default, and log why.
2. Show the three slugs. Then write both files. Overwrite the tier lines so re-runs are idempotent. Keep custom lines that are not model assignments. If an existing tier line names a third-party or `-fast` slug, replace it with the tier default and log why.

   `~/.cursor/rules/{{ruleFile}}`:

   ```
   ---
   description: fmflurry-harness per-tier model choices (overrides plugin defaults)
   alwaysApply: true
   ---
   # Re-run /setup-harness to change. Cursor models only, or `inherit`/`auto` (omit Task model).
   coding: {{codingDefault}}
   smart: {{smartDefault}}
   cheap: {{cheapDefault}}
   ```

   `~/.agents/fmflurry-harness-models.md`:

   ```
   # fmflurry-harness per-tier model choices. Cursor models only.
   # Re-run /setup-harness to change. `inherit` or `auto` omits the Task model.
   coding: {{codingDefault}}
   smart: {{smartDefault}}
   cheap: {{cheapDefault}}
   ```

3. Tell the user both files apply to new chats, and to pick Grok 4.7 xhigh in the model picker for the main (conductor) chat, because a plugin cannot set the parent model.
