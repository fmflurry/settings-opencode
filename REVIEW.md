# Review

This file is the single reference for finding tags in this repository. When it exists, the reviewer uses it for the tag mapping and for what blocks a merge, and does not apply a second mapping. Cite this file in the review report.

## Tags

| Tag | Blocks merge | When |
| --- | --- | --- |
| Important | yes | A change to observable behavior, a contract (API, DTO, schema, port, event), or persisted data. A measurable or exploitable drop in performance, security, or accessibility. A BLOCK rule of the cops, or a hard rule of `AGENTS.md` or this file. A broken or weakened test. A lint error. A failing format check. A checklist item headed Important. |
| Nit | no | Style, naming, readability, an unmeasured micro-optimization, a preference, a WARN rule of the cops, or a checklist item headed Nit. Fix a Nit only when it is trivial in the same change. |
| Pre-existing | no | On the base, not introduced by the diff, at any gravity. Still report a serious pre-existing security issue, tag it Pre-existing, say that it is a security issue, and raise it to Florian. It does not block. |

A measurable or exploitable slowdown is Important. An unmeasured micro-optimization is a Nit.

Badges: 🔴 Important, 🟡 Nit, ⚪ Pre-existing, ❓ question (never blocks). Category labels (`[bug]`, `[sec]`, `[arch]`, `[risk]`, `[nit]`, `[comment]`, `[format]`) follow the badge. BLOCK is Important. WARN is a Nit. A finding that cites an AGENTS.md hard rule is Important.

## Verdict

- **Approve** — no Important finding, lint passes, and no forbidden comments. Unconfirmed false or stale comments may remain.
- **Block** — one or more Important findings, a lint error, a forbidden comment, or a false comment confirmed by quoting a contradicting line from the repo.

There is no Warning verdict. Important blocks the merge. Nit never blocks. Pre-existing never blocks.
