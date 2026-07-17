---
name: ai-ecosystem-audit
description: Use ONLY when executing `/ecosystem-audit` or when invoked by the `ecosystem-auditor` specialist.
---

# AI ecosystem audit rubric

Use this rubric only for the reusable, read-only audit of repository-controlled OpenCode and Claude Code assets.

## Inputs

```text
/ecosystem-audit [--scope=all|parity|skills|agents|commands|config] [--strict] [--relevance=gc-platform|portable]
```

Defaults: `--scope=all`, `--relevance=gc-platform`.

- `all` audits every dimension.
- `parity` audits mirrored OpenCode/Claude artifacts and necessary harness translations.
- `skills`, `agents`, `commands`, and `config` focus detailed analysis on that artifact class, retaining only reference checks necessary for interpretation.
- `--strict` promotes unverified references, incomplete mirrors, undocumented differences, and absent purpose/trigger/owner/output/mutation boundaries from risks/unknowns to findings. It never converts an inference into a confirmed fact.
- `--relevance=gc-platform` uses current repository stack markers and documented conventions. `portable` evaluates reusable harness design without requiring gc.platform-specific fit.

## Audit boundary

Audit repository-controlled assets under `.opencode/` and `.claude/`, plus project stack markers necessary to establish relevance. Exclude user-home configuration, secrets and secret-bearing files, `node_modules`, generated/build/cache directories, runtime state/runtime configuration, dependency lockfile contents, and product-source quality.

The audit is read-only: no edits, generated files, installs, hook execution, commits, remote actions, or delegation. Redact sensitive values.

## Evidence standard

1. Raw files in the current working tree are authoritative.
2. Use CodeMemory first for orientation only when it is both available and permitted; treat it only as navigation context because it may be stale or incomplete.
3. Cite every finding and factual inventory assertion as `path:line`.
4. Classify conclusions as **confirmed** (direct current-file evidence), **likely** (bounded inference with evidence), or **unknown** (not established; name the missing evidence).
5. Verify referenced paths, command routes, agents, prompts, skills, instruction links, and allowlists directly.

## Normalization and mirror logic

Normalize each asset as: `ecosystem`, `kind`, `logical name`, `path`, `purpose`, `trigger`, `owner/dispatcher`, `expected output`, `mutation boundary`, `references`, and `relevance evidence`.

Match mirrors by logical name and role, not by byte equality. Compare purpose, trigger, scope, inputs, output contract, evidence standard, and mutation boundary. Necessary OpenCode/Claude tool syntax, frontmatter, model, path, or dispatch translations are not defects when evidenced. Record evidenced translations under **Deliberate differences**; do not classify them as defects without contrary evidence.

## Classification definitions

- **Parity:** mirrored artifacts preserve the same audit contract, scope, evidence standard, output, and mutation boundary, allowing evidenced harness translations.
- **Duplicate mirror:** one logical artifact intentionally exists in both ecosystems; not a defect by itself.
- **Semantic overlap:** distinct artifacts substantially cover the same purpose or trigger.
- **Conflict:** artifacts prescribe incompatible purpose, trigger, owner, output, scope, or mutation boundary for the same situation.
- **Stale reference:** a repository-controlled reference targets something missing, renamed, incompatible, or no longer routed.
- **Coherence gap:** a required purpose, trigger, owner, output, mutation boundary, route, or evidence rule is absent, ambiguous, or inconsistent.
- **Relevance gap:** an artifact is unsupported by the selected relevance mode's current stack/conventions, or relevant stack/conventions lack a needed harness counterpart. This is not a product-source-quality judgment.

## gc.platform relevance criteria

In `gc-platform` mode, use only current repository evidence for relevance: project markers and documented conventions for the Angular frontend, .NET backend, tests, API specifications, and harness rules. Do not infer relevance from user-home assets or inspect application implementation quality. In `portable` mode, evaluate whether the artifact remains coherent as a generic OpenCode/Claude harness asset.

## Report output contract

Return exactly one Markdown document with no preamble or postamble. If a section has no items, write `None evidenced.`

```markdown
# AI Ecosystem Audit

## Audit identity
| Field | Value |
| --- | --- |
| Audit date | <date> |
| Revision | <SHA or unknown> |
| Scope | <parsed scope> |
| Strict mode | <on/off> |
| Relevance mode | <gc-platform/portable> |
| Included roots | <roots> |
| Exclusions | <exclusions> |

## Summary
| Status | Count | Evidence |
| --- | ---: | --- |
| Confirmed findings | <n> | <path:line links> |
| Likely findings | <n> | <path:line links> |
| Unknowns | <n> | <path:line links or `none`> |
| Deliberate differences | <n> | <path:line links> |

## Parity inventory
| Logical artifact | OpenCode | Claude Code | Parity | Evidence |
| --- | --- | --- | --- | --- |

## Findings
| ID | Classification | Confidence | Type | Evidence | Impact | Recommended next action |
| --- | --- | --- | --- | --- | --- | --- |

## Purpose map
| Artifact | Purpose | Trigger | Owner/dispatcher | Output | Mutation boundary | Relevance | Evidence |
| --- | --- | --- | --- | --- | --- | --- | --- |

## Duplicate/collision register
| Artifacts | Classification | Shared purpose/trigger | Disposition | Evidence |
| --- | --- | --- | --- | --- |

## Deliberate differences
| Difference | Why deliberate or evidenced | Evidence |
| --- | --- | --- |

## Risks and unknowns
| Item | Classification | Missing evidence / resolution path | Evidence |
| --- | --- | --- | --- |

## Prioritized backlog
| Priority | Item | Suggested owner | Validation | Evidence |
| --- | --- | --- | --- | --- |
```
