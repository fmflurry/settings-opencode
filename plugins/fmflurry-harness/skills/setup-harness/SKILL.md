---
name: setup-harness
description: "Detect the model slugs available to Task subagents and write the per-tier model rule used by the conductor."
disable-model-invocation: true
---

# Setup harness

Choose one model per tier and persist the choice in `~/.cursor/rules/fmflurry-harness-models.mdc`.

## Tiers

| Tier | Default slug | Use | Agents |
| --- | --- | --- | --- |
| coding | `grok-4.7-xhigh` | implementation, tests, build fixes | coder, tdd-guide, build-error-resolver, refactor-cleaner, e2e-runner, api-spec-architect, gaudi |
| smart | `claude-opus-5-5-high` | planning, architecture, review, security; expensive, so dispatch it only when needed | planner, architect, code-reviewer, security-reviewer, angular-cop, dotnet-cop, database-reviewer, postgres-dba, gdpr-specialist, ecosystem-auditor, why-synthesizer |
| cheap | `composer-2.5` | git, codebase search, docs, comment triage | git-specialist, scout, writer, doc-updater, why-investigator, comment-judge, haruspex-commentorum |

## Procedure

1. Enumerate the model slugs you can pass to a `Task` subagent in this session (see the Task tool's `model` parameter). If Cursor exposes a models list, prefer it. If none are detectable, ask the user to paste the slugs. Never write a slug you have not confirmed is available. The aliases `inherit` and `auto` are always valid; they run on the parent model and omit `model`.
2. Propose one slug per tier:
   - coding: implementation, tests, build fixes. Default `grok-4.7-xhigh`, the non-fast variant; `-fast` costs about 2x.
   - smart: planning, architecture, review, security. Expensive. Default `claude-opus-5-5-high`.
   - cheap: git, codebase search, docs, comment triage. Pick the cheapest detected model, preferring non-fast `composer-*`. Never use `-fast` variants or the `fast` alias for cheap.
   If a default is not detected, use the same family's detected slug at the highest effort at or below the target, on the ladder max > xhigh > high > medium > low. Families go by prefix (`claude-*`, `gpt-*`, `grok-*`, `composer-*`). If nothing fits, ask the user.
3. Show the proposal; the user may edit it. Then write `~/.cursor/rules/fmflurry-harness-models.mdc`. Overwrite the whole file so re-runs are idempotent, and keep any custom lines the user already had in it. Format:

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

4. Tell the user the rule applies to new chats, and to pick Grok 4.7 xhigh in the model picker for the main (conductor) chat, because a plugin cannot set the parent model.
