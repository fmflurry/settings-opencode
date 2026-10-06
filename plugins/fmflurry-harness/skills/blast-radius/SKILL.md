---
name: blast-radius
description: "Find what a change could break somewhere else before it ships, beyond the diff, and prove the one fact it's safe because of by running real code instead of writing it up. Use for 'blast radius of X', 'what could this break', or reviewing a small diff you don't trust."
---

# Blast Radius

If the current project has `.claude/skills/blast-radius/SKILL.md` or `.opencode/skills/blast-radius/SKILL.md`, read it and its `references/`; project specifics override this generic version.

Find what a change breaks somewhere else, before it ships. Use for "blast radius of X", "what could this break", or reviewing a small diff you don't trust yet.

Listing the callers is not the job. The agent can find those in a second. The job is the breakage grep won't show you.

## Don't trust your own writeup

A blast-radius writeup that sounds right is worthless. It reads as convincing whether or not it's true. So don't hand back the writeup. Find the one or two facts the whole thing depends on and prove them by running code.

### How sure are you

For each fact the change's safety depends on, get it as far down this list as is cheap, and say where it stopped.

1. You said so. Worthless on its own.
2. You pointed at the line. A real `file:line`, or the library's own source.
3. You showed the bad case can't happen. You walked the failure step by step and it doesn't reach.
4. You ran it. A script or test that calls the real code and fails loud if you're wrong.
5. You reproduced it in the running app.

Step 4 is usually one small script that imports the same library the app ships and calls the exact function you're worried about.

## Steps

1. **Read the change.** The diff, the symbols it adds, changes, and deletes, and what it now does differently, including the part the diff doesn't spell out. Use code-memory: run `codememory_definitions` to pin each modified symbol, then `codememory_callers` (depth 2–3) to find call sites. Use `codememory_importers` and `codememory_dependencies` to map module boundaries. For DI tokens (Angular providers, .NET IModule implementations, Razor @inject), use `codememory_injectors` to find all consumers. For deleted symbols, use `codememory_callers_at_sha` against the prior commit to see what used to call them.

2. **Find the one fact it's safe because of.** PR/commit archaeology: pull the PR and commits using the `why` skill Step 2 to understand intent and prior art. Most changes that look risky are safe because of a single fact, like "this call only drops already-dead cache entries and does nothing else". Find that fact. If it holds, most risky cases are cleared at once. Spend your time here, not on a long list of maybes.

3. **Look where grep stops.** Read the source of the library you call, and check its pinned version and any local patch. Work out when things run: microtasks, unmount and teardown, component lifecycle. Use code-memory: `codememory_importers` for module reverse-dependencies, `codememory_layer_violations` to spot boundary breaks. Follow what a symbol search misses: the JSON an API returns, a DB column, a wire format, another language reading the same bytes, a feature flag, code three hops downstream.

   **Where grep stops in most repos (areas without good symbol indexing):**
   - Database migrations, schema-as-code, generated schema snapshots
   - RLS policies, bootstrap SQL, schema test fixtures
   - Message/event contracts between modules (event names, signatures, serialization)
   - OpenAPI specs and JSON schema definitions
   - i18n translation keys and resource files
   - Frontend DTOs at serialization boundaries (request/response types)
   - HTTP test collections (manual test cases, not code-under-test)
   - E2E test page object models and selectors
   - Runtime configuration files (environment vars, docker-compose, docker files)
   - String-keyed routes and configuration keys
   - Harness registries (opencode.jsonc, CLAUDE.md @-imports, .claude/settings.json, .opencode/settings.json)
   - CI/CD workflow files (.github/workflows, gitlab-ci.yml, azure-pipelines.yml)

4. **Be honest about each risk.** Give it a real chance of happening and a real cost if it does. Keep the risks you confirmed. List the ones you checked and cleared separately. Use the same citation rules as the `why` skill. Cite a real `file:line`, a search that finds nothing is still an answer, and never make up a caller or an API.

5. **Prove the one fact.** Write a script or test that runs the real code, run it, and paste what happened. Store proof scripts in `/tmp` (ephemeral; no commit). If a proof is worth keeping, dispatch to `tdd-guide` to write a permanent test.

6. **For a big or wide change, run multiple reviewers in parallel.** Different reviewers catch different real bugs:
   - `code-reviewer` — code quality, logic errors, maintainability
   - `architect` — system design, module boundaries, scalability
   - `security-reviewer` — auth, data, secrets, trust boundaries (if auth/tenant involved)
   
   Then merge their findings. Note: OpenCode can bind these to different `OPENCODE_MODEL_SUBAGENT_*` models for diverse perspectives.

## What to hand back

- **What it does.** What changed, including the part that isn't obvious.
- **The one fact it's safe because of.** State it, say which step you got it to, and show the proof. If you couldn't prove it, write unproven.
- **Risks.** Each names how it breaks, the `file:line`, how likely and how bad, and how to check. Paste the proof for the ones that matter.
- **Cleared.** What you checked and why it's fine.
- **Before you merge.** The cheapest test or repro that catches the real bug, including the script you wrote.

Write it through `humanizer`, cite real code, and strip anything private before it goes anywhere public.

**Reply:** the writeup above, with the one safety fact either proven or marked unproven.
