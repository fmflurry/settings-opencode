---
name: comment-judge
description: LLM-as-a-judge rubric for code comments (forbidden, false, stale, narration, noise, keep). Loaded in-process by code-reviewer, dotnet-cop and angular-cop to judge every added or changed comment in a review; used by the comment-judge agent for per-module comment purges. Use when judging whether comments are true, useful, or should be deleted/rewritten.
---

# comment-judge

LLM-as-a-judge for code comments. Applies rubric-based verdict, harvests blocks, emits structured findings. Loaded in-process by code-reviewer/dotnet-cop/angular-cop during review; used by the comment-judge agent for module-scoped purges.

## Modes

**REVIEW**: Candidates are added/changed comments in the diff. Source: `bash scripts/check-added-comments.sh <base>` if the repo provides that script; otherwise `git diff -U0 <base>...HEAD | grep -nE '^\+.*(//|/\*|#|<!--)'`, merged with pre-existing comments within ±10 lines of changed hunks (`git diff -U10 <base>...HEAD | grep -nE '^\+.*(//|/\*|#|<!--)'`). Goal: verify each comment truthfully describes code behavior.

**PURGE**: Scans a directory for all comments (added or pre-existing). Source: `bash scripts/check-added-comments.sh --path <dir>` if available; otherwise `grep -rnE '(//|/\*|#|<!--)' <dir>` (directory-scoped only; repo-wide is prohibitively slow). Goal: delete stale, false, forbidden, or noisy comments in bulk.

**EXPLICIT**: Caller supplies a list of `path:start-end` line ranges (used for manual calibration and edge-case handling).

## Grouping

Merge consecutive `path:line` hits in the same file into blocks: `start_line..end_line`. One block = one contiguous region. Emit verdict and reasoning once per block, not per line.

## Asymmetric cost (REVIEW vs PURGE)

**REVIEW mode:** Missing a false comment is costly (reviewers trust the code). A wrong flag is cheap (human ignores). Strategy: flag suspected false/stale/forbidden comments even with partial evidence. Tier as ❓ (low) when evidence is incomplete.

**PURGE mode:** Verdicts are bulk-applied to many files. Delete only at high confidence (🔴 or 🟡). Any doubt → keep + ❓ marker for follow-up.

**Never auto-apply `false`:** Comment may be correct and code may be wrong = possible bug. Always require human review.

## Rubric

Read the code the comment describes: enclosing symbol, or ±15 lines, or ≤60 lines below a doc block. Never read files >400 lines whole. For stale checks, use `codememory_definitions` or one targeted Grep.

Ask in order; first failure wins:

**a) FORBIDDEN class (per the project's code-comments rule — `~/.claude/rules/common/code-comments.md` / `~/.config/opencode/instructions/code-comments.md`, or the repo's own copy if it has one)**
   - Narration: restates what code does; rename the code instead (tier: 🟡).
   - **adr-restate:** Restating, paraphrasing, or quoting design-doc/RFC/rule sections, points, phases, or citing project convention files (AGENTS.md, rules, CLAUDE.md) content. Citations must be bare pointers only: `(ADR-1042)` or `(RFC 7636 §4.2)` for external specs (section allowed for RFCs only). Tier: 🟡.
   - **task-ref (extended):** Requirement or work-item IDs: `US\d+`, `EX\d+`, `SEC\d+`, `R\d{1,2}`, `F\d[a-z]?`, `#\d{5,}`, `WI \d+`, `TC #\d+`, `Phase \d`, `sub-phase`, `P\d(\.\d)?`, `Pin #\d+`. Fix: strip the ID; keep the sentence if a why remains. Tier: 🟡.
   - Suppression/TODO missing reason or ticket number (tier: 🟡).
   - History/changelog/task reference (tier: 🟡).
   - Quality claim or verification assertion (tier: 🟡).
   - Section banners or `#region` markers (tier: 🟡).
   - Verdict: **delete** or **rewrite** (reason rule).

**b) FALSE or STALE (tier: 🔴)**
   - FALSE: Comment claims behavior the code does NOT perform (e.g., "thread-safe" without locks). The contradicting evidence is IN the attached code itself (enclosing symbol, ±15 lines). Must quote contradicting `path:line` + exact line.
   - STALE: Comment describes behavior, a call site, a symbol, or an architecture that has moved or been removed. The contradicting evidence lives OUTSIDE the attached code (another file, a removed/renamed symbol, a deleted method call). Even though the claim is technically untrue now, the comment was once correct and was never updated when the code changed. Verdict: **rewrite** if the attached code still needs a non-obvious why (supply corrected ≤1-line reason); else **delete**. Evidence: quote removal or cite `codememory_definitions` result.
   - Mixed (noise + stale): When history/ticket noise is attached to stale code, classify **STALE** (🔴 outranks 🟡); remove noise + supply corrected reason if needed.
   - Verdict: **false** (REVIEW mode only; PURGE requires high confidence). If low confidence → ❓.

**c) NARRATION (restates next lines or method signature)**
   - Example: `// Creates a new user` above `public User Create(…) {}`.
   - Verdict: **delete**.

**d) NOISE (task/phase/agent history, verbose doc blocks, overstated impl detail on private members)**
   - Example: `// As discussed in ticket 1234`, `// Agent wrote this`.
   - Verdict: **delete**, or **rewrite** to one line if non-obvious why is buried.

**e) KEEP (non-obvious why, invariant with bare pointer, public/cross-module contract)**
   - Example: `// Sort by created_at DESC; matches UI mockup (ADR-1042)`.
   - Example: `// Retry budget is capped at 3; matches upstream rate-limit window (ADR-2031)`.
   - A reference is allowed ONLY as a bare trailing pointer after a one-line why. Multi-line design-doc paraphrases must be rewritten to one line (why + bare pointer) or deleted if no local why remains.
   - Verdict: **keep**.

**f) UNSURE (evidence partial, contradiction unclear, or context ambiguous)**
   - Verdict: ❓ (low tier; flag for human).

## Decision Rules

**DELETE vs REWRITE (when verdict is forbidden, narration, or noise):**
After removing the offending part (ticket ids, history, narration, stale claim), does a non-obvious why, invariant, or constraint remain that a reader of the attached code would otherwise miss?
   - YES: **rewrite** to ≤1 line, keeping only the non-obvious why. Example: comment says "avoid O(n²) — used in hot path", remove "Ticket 123: ", keep "avoid O(n²) — used in hot path".
   - NO (nothing of value left): **delete**.
   - Pure narration (comment merely restates code) is always delete.

**External evidence for FALSE:**
When a comment cites external evidence (RFC, spec, ADR section, standard name) as proof of its claim:
   - If you can fetch and verify the cited source → apply it as evidence; if it contradicts the code, verdict is **false** with URL/path + section quoted.
   - If you cannot fetch/verify the cited source → **❓** (unsure), not false. Example: "// RFC 7232 says ETag must be…" — must verify RFC; do not guess.

**Rubric order (tie-breaker for equally valid verdicts):**
When two verdicts seem equally valid:
   1. Apply rubric categories literally in order: forbidden → false → stale → narration → noise → keep.
   2. Do not skip a category with a charitable reading unless the comment text genuinely supports multiple meanings (ambiguous wording), in which case → **❓**.
   3. Example: a comment with history noise AND stale behavior → first check forbidden (no), then false (no), then stale (yes) → STALE wins. Do not downgrade to noise just because history is also present.

## Output contract

One finding per judged block, JSON:

```json
{
  "path": "src/file.ts",
  "start_line": 42,
  "end_line": 45,
  "category": "comment",
  "severity": "high",
  "tier": "🔴",
  "rule_ref": "code-comments.md#forbidden-class",
  "source": "llm",
  "existing_code": "// This is thread-safe.\nfunction update(cache, key, value) {",
  "verdict": "false",
  "suggestion_code": "",
  "reason": "Code mutates cache[key] directly without synchronization; comment claims thread-safety but no locking present."
}
```

**Optional verdict field** (if omitted, finding is recorded but not auto-applied):
- `keep` — no change needed.
- `delete` — remove the comment (suggestion_code = "").
- `rewrite` — replace with suggestion_code (≤1 line, English, no narration).
- `false` — assertion proven false; must quote evidence.

**Tier** (severity mapping):
- 🔴 false/stale: severity `critical`, tier `🔴`.
- 🟡 forbidden/narration/noise: severity `medium`, tier `🟡`.
- ❓ unsure: severity `low`, tier `❓`.

**Summary line format:**
```
Comments: judged N · keep K · delete D · rewrite R · false F · ❓ Q
```

Add caveat: "Calibrated to REVIEW/PURGE mode; refactor-cleaner may auto-apply delete+rewrite; human must approve false verdicts."

## Budget

Per-file limit: ≤40 blocks per batch. Total dispatch limit: ≤200 blocks. Over cap: return `## Continuation: next=<path>` with the next file to process.

## Trust limits (calibration baseline)

Blind calibration on real cases showed: 65–70% inter-run agreement, catches roughly a quarter of false comments, produces about one wrong delete per run, and can fabricate external evidence (e.g., misattributing which section of an RFC defines a term).

**Reliable:** `forbidden`, `noise`, `narration` verdicts (consistent across independent runs).

**Unreliable:** `false`, `stale` verdicts (low recall; fabrication risk with external evidence).

**Application:**

1. **REVIEW mode (code-reviewer / cops include judge findings):** Judge `false`/`stale` verdicts are advisory flags only (tier ❓). They never block by themselves. Block only when the **reviewer confirms** by quoting a contradicting line from the repo (not memory or external recall). Deterministic `forbidden` hits still block as before.

2. **PURGE mode (refactor-cleaner applies verdicts):** May auto-apply only `delete`/`rewrite` findings whose verdict is `forbidden`, `noise`, or `narration` AND two independent judge runs agree on (same verdict, same block). Require explicit human review ("human skimmed: yes" in brief) before applying; `false`, `stale`, and ❓ always go to human. Never apply verdicts whose evidence cites external sources without human confirmation of the source.

3. **Re-calibrate:** widen these limits only after a substantial batch of human-approved cases accumulates.
