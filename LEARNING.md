# Proposal learning: local CLI operations

`~/Workspace/settings-opencode` is the canonical source for the synchronized OpenCode
installation at `~/.config/opencode` and Claude Code installation at `~/.claude`.
Proposal learning is optional, local, advisory, and proposal-only. The fixed
`bin/proposal-learning` wrapper is the **only** proposal-queue control plane for both
harnesses. There are no `/learn-*` commands, learning agent, state tool, or conductor/agent
route. Proposal content is never put in an OpenCode or Claude conversation, agent task, tool
call, or context. Its boundary is one **single-user local profile**, not identity verification.

## Notice, profiles, and activation

The purpose is to identify narrowly defined high-signal patterns and offer a human-reviewable
proposal. It never creates a durable claim or changes a skill, prompt, configuration, plugin,
or workspace. The queue starts disabled. Activation records the exact validated notice version and
calculated SHA-256 digest; the CLI rejects a different value. Re-activation after revocation requires a new
acknowledgement.

The CLI has a machine-readable contract: its command result is JSON on standard output. Notice
text is for a person to read, not JSON result data: `notice` writes it to standard output by
default, while `notice --json` (and `enable --json`) writes the human-readable notice to standard
error and retains JSON on standard output. Treat acknowledgement as an operational two-step
process: first deliver and review the rendered Article 13 notice (for example with `notice`), then
run `enable` with `--acknowledge-notice` set to that notice's calculated digest. `enable` renders
the validated notice before it accepts the acknowledgement, but the digest is evidence of an
explicit operator acknowledgement, not proof that a particular person read it.

### Personal or household activation

Use this profile only for a person's own personal or household activity. The required
`--lawful-basis "household activity"` value is a local profile-classification token enforced by
the CLI; it is **not** an Article 6 lawful basis and is not a legal determination. It records
the household context, not the identity of a user. Anyone able to run a harness as the same OS
user can access its local state. Personal-household activation is distinct from organizational
activation, which requires the organization's controller and documented Article 6 lawful basis.

```sh
bin/proposal-learning enable \
  --profile personal-household \
  --controller "Local profile owner" \
  --lawful-basis "household activity" \
  --household-context "personal household use" \
  --notice-version 2026-07-17 \
  --notice-hash sha256:<digest-of-personal-notice-json> \
  --acknowledge-notice sha256:<digest-of-personal-notice-json>
```

For either profile, omitting `--notice-file` uses the runtime's canonical notice record. When
`--notice-file` is supplied, it must be an absolute regular, non-symlink JSON file; the CLI
schema-validates it and computes the version/digest values from that file. A supplied digest is
compared with the computed digest, never trusted by itself.

### Organizational activation

An organization must complete and approve its governance record **and its separate Article 13
notice** before activation. Supply:

- the responsible controller's legal name;
- the documented applicable lawful basis and its exact `GDPR Article 6(1)(a)` through
  `GDPR Article 6(1)(f)` reference;
- the exact approved notice version/hash and a completed notice source file; and
- the exact approved governance-record version/hash and a completed governance-record source
  file.

The completed organizational notice must identify the controller and controller contact, state
whether provision of preference information is mandatory or optional and the consequences of not
providing it, and disclose automated preference-pattern analysis. That disclosure must state that
the analysis produces review proposals only and that no decision is based solely on automated
processing. The governance record must preserve notice-delivery evidence with its audience,
method, delivery date, and reference, and must record the DPIA screening assessment for that
analysis.

Use the owner/DPO-completed template in
[`PROPOSAL_LEARNING_GOVERNANCE_TEMPLATE.md`](PROPOSAL_LEARNING_GOVERNANCE_TEMPLATE.md) as the
governance record. The CLI fails closed: organizational activation remains disabled when any
required controller, Article 6 reference, notice, or governance-record field is missing or
malformed. It does not infer a controller, select a legal basis, or substitute an unapproved
record.

The template requires the organization to document its retention justification, ROPA (record of
processing activities) reference, data-subject-rights handling, processor/local-runtime record,
incident/breach path, notice delivery, and DPIA / Article 35 screening assessment and decision.

The Article 13 notice is the data subject's transparency information: it must be completed and
delivered before acknowledgement. The governance record is the organization's internal
accountability evidence: it records approval, ROPA, risk, processor, retention, DPIA, and
incident decisions. They are not interchangeable. The CLI schema-validates both JSON source
files and fails closed: each source must be an absolute, regular, non-symlink file; its required
fields must validate; and the supplied version, SHA-256 digest, controller, Article 6 reference,
and notice acknowledgement must exactly match the validated source. It calculates the digest
from the source content; a label or operator-supplied hash cannot substitute for it.

```sh
bin/proposal-learning enable \
  --profile organizational \
  --controller "Organization legal name" \
  --lawful-basis "Documented applicable lawful basis" \
  --legal-basis-reference "GDPR Article 6(1)(f)" \
  --notice-version 2026-07-17 \
  --notice-hash sha256:<digest-of-approved-notice-json> \
  --notice-file /absolute/path/to/article-13-notice.json \
  --acknowledge-notice sha256:<digest-of-approved-notice-json> \
  --governance-record-version 2026-07-17 \
  --governance-record-hash sha256:<digest-of-approved-governance-json> \
  --governance-record-file /absolute/path/to/completed-governance-record.json
```

This documentation is operational information, not legal advice. The organization remains
responsible for its controller, transparency information, lawful-basis assessment, records, and
data-subject-rights process.

## Data boundary and offline reviewer

Raw direct prompt/user input is processed locally only long enough to derive an allowlisted,
non-reversible structured descriptor, then discarded. It is never stored, queued, exported,
audited, or sent to the reviewer. Transcripts, assistant messages, tool output, paths, secrets,
PII, and uncertain or sensitive input are excluded rather than redacted and retained.

Only these deterministic descriptors can reach the reviewer: an explicit correction, a repeated
preference (at least two occurrences), or verified recurring friction (at least three
occurrences). The reviewer receives only descriptor `kind` and allowlisted `summary`; it does
not receive proposal state, raw input, session IDs, or harness context. Session identifiers are
salted and hashed locally only for quotas and are not exported.

The reviewer is only a configured, owner-controlled **offline executable** and a separately
configured **model-artifact** file on supported POSIX platforms (macOS and Linux). “Offline”
describes this local launch contract, not a claim that the executable is network-sandboxed. The
runtime verifies the configured SHA-256 digest of each artifact. Configure all four values:

```sh
OPENCODE_LEARNING_REVIEWER_EXECUTABLE=/absolute/path/to/reviewer
OPENCODE_LEARNING_REVIEWER_EXECUTABLE_SHA256=<64-hex-character-sha256>
OPENCODE_LEARNING_REVIEWER_MODEL_ARTIFACT=/absolute/path/to/model.artifact
OPENCODE_LEARNING_REVIEWER_MODEL_SHA256=<64-hex-character-sha256>
```

On supported POSIX platforms, the runtime validates trusted ownership and non-group/world-writable
permissions for the files and ancestor directories, rejects symlinks, verifies both digests,
copies the verified file descriptors into a private staging directory, and revalidates the staged
files before spawning the executable. It supplies the staged artifact only through the fixed
`--model-artifact` argument, without a shell, with a minimal environment including `NO_PROXY=*`.
Any missing, malformed, changed, unavailable, or untrusted executable/artifact fails closed and
produces no proposal. Native Windows is unsupported by this validation path and therefore fails
closed: no reviewer is invoked and no proposal is produced. These controls validate the local
launch artifact; they do not independently prove that a reviewer executable has no network,
logging, or forwarding behavior. Operators must assess that behavior separately.

## Queue contract and lifecycle

- High-signal proposal kinds are only `preference`, `skill`, and `prompt`. Configuration,
  plugin, filesystem, installer, shell, and path proposals are rejected.
- Quotas are at most two proposals per session and ten per rolling day. Duplicate content is
  merged locally across harnesses.
- Proposals remain queued, accepted, or rejected for 30 days from creation. Expiry removes the
  proposal and retains only its ID-only tombstone for a further 30 days; the tombstone then
  expires. Audit retention: metadata-only audit events expire 30 days after their event time.
- `purge` runs expiry cleanup immediately. `delete <id>` atomically removes that proposal and
  any tombstone. `delete-all` atomically disables the queue, removes all proposal content,
  tombstones, and acknowledgement, and cancels active reviews. A metadata-only `deletion` audit
  event is retained for 30 days; it contains event time, event type, profile/scope, and salted
  controller/session hashes only—never proposal content or the acknowledgement.
- State, audit event, deletion, and export projection share one serialized, locked transactional
  boundary with durable state replacement. `export` therefore returns a consistent local
  snapshot: without an ID it includes enabled state, stored proposals, ID-only tombstones, and
  metadata-only audit; with an ID it returns only that stored proposal. `list` returns stored
  proposals; `show <id>` may return an ID-only tombstone.
- `disable` writes disabled state before cancellation and waits for every in-flight review,
  including a review reserved by another process, to acknowledge cancellation before reporting
  success. A subsequent capture fails preflight before prompt inspection or inference. If that
  acknowledgement cannot be obtained, disable fails closed and state remains disabled.
- `accept`/`approve` and `reject` change queue state only. Even an accepted proposal is
  materialized only as normal human-authored, reviewed PR/change material; never automatically.

## CLI

Run the wrapper from either canonical installed root (`~/.config/opencode/bin/proposal-learning`
or `~/.claude/bin/proposal-learning`) or this repository. Command results are JSON on standard
output; use `notice` to render the human notice before the explicit acknowledgement step.

```sh
bin/proposal-learning status
bin/proposal-learning notice --profile personal-household
bin/proposal-learning list
bin/proposal-learning show <uuid>
bin/proposal-learning accept <uuid>       # approve is an alias
bin/proposal-learning reject <uuid>
bin/proposal-learning export [uuid]
bin/proposal-learning delete <uuid>
bin/proposal-learning delete-all
bin/proposal-learning purge
bin/proposal-learning disable
```

## Deployment, restart, and maintenance

Node.js **>=22.6** is required because the wrapper runs TypeScript with
`--experimental-strip-types`. Install or update canonically from this repository, then restart
OpenCode and start a new Claude Code session so both harnesses load the synchronized runtime:

```sh
cd ~/Workspace/settings-opencode
./install.sh --yes
# Restart OpenCode; close and reopen Claude Code.
```

The state root is `${XDG_STATE_HOME:-~/.local/state}/settings-opencode/proposal-learning/v1`.
The installed daily maintenance job preserves a custom `XDG_STATE_HOME` on Linux and uses the
same state root across platforms: launchd on macOS, a user scheduler on Linux, and Task
Scheduler on Windows. Its command is fixed to `state-cli.ts purge`; it cannot accept arbitrary
arguments or call a model. If Node, the platform scheduler, or safe scheduler registration is
unavailable, installation reports an error rather than claiming maintenance is installed.
Queue-access cleanup remains a secondary safeguard. Activation and revocation are local state
changes and need no restart.
