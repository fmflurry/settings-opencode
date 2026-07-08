---
description: Audit the codebase (or a given path/feature) for GDPR compliance and produce a prioritized findings report
agent: gdpr-specialist
subtask: true
---

# GDPR Compliance Review Command

Delegate to the `gdpr-specialist` agent to conduct a comprehensive GDPR/data-protection compliance audit.

## Task

Load the `gdpr-compliance` skill for reference knowledge and audit checklist. Conduct a **full-stack compliance review** across:

- **Frontend:** consent banners, cookies, forms, client-side PII storage, third-party scripts
- **Backend:** authentication, authorization, input validation, logging (sanitization), data-subject-rights endpoints, legal basis documentation
- **Database:** PII identification, sensitive-category data, encryption at rest, retention policies, audit logging
- **Infrastructure & Stack:** data residency, cross-border transfers, processor/vendor contracts, backups, incident response

Produce a **tiered, prioritized findings report** with:
1. Summary of critical, high, medium, and low issues
2. GDPR articles and principles breached (with citations)
3. Specific file:line evidence for each finding
4. Concrete remediation steps for the `coder` agent
5. Compliance scorecard against the audit checklist

## Scope

- If `$ARGUMENTS` is provided (e.g., `/gdpr-review src/consent`): audit that path or feature
- If `$ARGUMENTS` is empty: audit the entire codebase

$ARGUMENTS

## Output Format

Return a structured compliance report per the `gdpr-specialist` agent specification:

- **Severity tiers:** CRITICAL → HIGH → MEDIUM → LOW
- **Mapping:** Each finding → GDPR Article(s) + regulatory risk
- **Remediation:** Concrete, coder-ready fixes
- **Scorecard:** Compliance against 6 principles + 8 requirements table
- **Disclaimer:** Inform that this is informational, not legal advice; consult a DPO/legal counsel for final determination

## Legal Disclaimer

This audit is informational guidance based on GDPR articles and CNIL guidance. It is **NOT legal advice**. For jurisdiction-specific requirements and final compliance determination, consult a Data Protection Officer, legal counsel, or your national data protection authority (CNIL in France: +33 1 53 73 22 22).
