# Proposal-learning governance record template

> **Template — the operator must complete every required field and obtain approval by the
> organization owner/controller and DPO or other qualified privacy reviewer before organizational
> activation. Not legal advice.**

Use one approved, versioned record per organizational deployment. Put its exact version and
SHA-256 hash into `bin/proposal-learning enable`; do not activate until every required field is
completed. This internal governance record is distinct from the personal Article 13 notice:
the notice gives data subjects transparency information and must be completed and delivered
before acknowledgement; this record documents organizational accountability and approval.
Both source documents are schema-validated from absolute regular, non-symlink JSON files, and
activation fails closed unless their validated content, version, controller, Article 6 reference,
and calculated SHA-256 digests match the activation arguments.

The CLI result is JSON on standard output. Render the notice for human review with `notice`; with
`--json`, human-readable notice text is written to standard error so JSON remains parseable on
standard output. Operationally, delivery/review of the notice precedes the separate explicit
digest acknowledgement supplied to `enable`. The digest records that acknowledgement; it is not
evidence that an identified data subject read the notice.

## Record identity and approval

- Governance-record title/ID: `[complete]`
- Version/date: `[YYYY-MM-DD]`
- SHA-256 hash of approved final record: `[sha256:...]`
- Controller legal name: `[complete]`
- Controller contact: `[complete]`
- Owner accountable for this deployment: `[complete]`
- DPO/privacy reviewer and approval date: `[complete or document why not applicable]`
- Risk owner: `[complete]`
- Approved Article 13 notice version/hash: `[complete]`
- Article 13 notice content completed (controller; purpose; Article 6 basis; recipients;
  processors; transfers; retention; rights and DPO/contact): `[complete]`
- Recorded Article 13 notice-delivery evidence before acknowledgement — audience: `[complete]`;
  method: `[complete]`; delivery date (ISO-8601): `[complete]`; reference: `[complete]`.
- Organizational activation command reviewed: `[complete]`

## Processing description

- Purpose: identify high-signal, non-sensitive interaction patterns and create reviewable,
  proposal-only suggestions; no automatic change, claim assertion, or materialization.
- Data categories: allowlisted descriptor kind and summary; proposal fields; proposal state;
  timestamps; harness label; salted/hashes used for quota and metadata-only audit.
- Explicit exclusions: raw prompts, transcripts, assistant messages, tool output, paths,
  secrets, PII, and uncertain/sensitive input.
- Data subjects: `[complete]`
- Article 6 lawful basis and documented assessment: `[complete]`
- Exact Article 6 reference (`GDPR Article 6(1)(a)`–`(f)`): `[complete]`
- Controller contact and data-subject-rights/DPO contact: `[complete]`
- Data provision status: `[mandatory or optional, complete]`.
- Consequences of not providing preference information: `[complete]`.
- Automated preference-pattern analysis disclosure: `[complete]`. It must state that analysis
  produces review proposals only and that no decision is based solely on automated processing.

## Retention, rights, and records

- Retention justification and approved duration: `[complete]` (implementation: proposals 30
  days; expiry tombstones 30 additional days; metadata-only audit events 30 days).
- Deletion/export process and responsible contact: `[complete]` (CLI supports `export`,
  `delete`, `delete-all`, and `purge`; deletion preserves only a metadata-only deletion event
  until its 30-day audit expiry).
- Data-subject rights intake, identity/authority verification, response workflow, and escalation:
  `[complete]`.
- ROPA / records of processing activities reference and owner: `[complete]`.

## Local runtime and suppliers

- Reviewer-platform assessment: `[complete]`. The trusted reviewer launch path is implemented
  only on macOS/Linux (supported POSIX platforms); native Windows fails closed and does not invoke
  a reviewer.
- On supported POSIX platforms, reviewer executable absolute path, version, SHA-256, trusted
  ownership/permissions and ancestor-directory review, non-symlink review, and model-artifact
  absolute path/SHA-256: `[complete]`. The runtime validates and stages both artifacts before
  launch; record the reviewed artifact values.
- Recipients, processors/subprocessors, and transfers assessment: `[complete]`. The
  implementation permits only the validated local executable and model artifact. Record any
  separate support, device-management, logging, or model-distribution supplier that may process
  data.
- Security/configuration review, including local executable logging/forwarding controls:
  `[complete]`. Artifact validation and a minimal child environment do not establish that the
  executable cannot use a network, log, or forward descriptors; assess those behaviors here.

## DPIA / Article 35 screening

- DPIA / Article 35 screening assessment, date, and decision for automated preference-pattern
  analysis: `[complete]`.
- Screening rationale, risks, safeguards, and residual-risk owner: `[complete]`.
- If a DPIA is required, reference, approval, and pre-activation conditions: `[complete]`.

## Incident and breach handling

- Incident and breach register reference, owner, and recording process: `[complete]`.
- Processor incident-notice obligation, contact, and escalation timeframe: `[complete]`.
- Assessment, containment, evidence preservation, and risk-owner escalation path: `[complete]`.
- CNIL/supervisory-authority notification decision path, including the GDPR 72-hour escalation
  deadline where notification is required: `[complete]`.
- Affected-person notification decision and delivery path where a high risk requires it:
  `[complete]`.

## Reapproval triggers

Reapprove and issue a new version/hash before activation after a purpose, data-category,
retention, model/runtime, supplier, controller, legal-basis, notice, or rights-process change.
