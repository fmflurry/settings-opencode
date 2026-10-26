#!/usr/bin/env bash
set -u
session_id="$(jq -r '.session_id // empty' 2>/dev/null)" || session_id=""
ROOT="$(git -C "${CLAUDE_PROJECT_DIR:-$PWD}" worktree list --porcelain 2>/dev/null | sed -n '1s/^worktree //p')"
[ -n "$ROOT" ] || ROOT="${CLAUDE_PROJECT_DIR:-$PWD}"
STATE_DIR="$ROOT/.claude/state"
[ "${AGENT_HARNESS_TEST:-}" = 1 ] && STATE_DIR="${AGENT_STATE_DIR:-${TLTB_STATE_DIR:-$STATE_DIR}}"
[ -f "$STATE_DIR/autonomy.on" ] || exit 0
cat <<'MSG'
AUTONOMOUS MODE ON: never ask the user; decide from AGENTS.md + repo evidence; log every assumption to .claude/state/decisions.tsv (show-your-work format) and to the PR's `## Locked decisions`; merge ONLY via `agent-harness ship-merge <pr>`; this is the documented exception to the confirm-irreversible rule; branches are deleted only by `agent-harness ship-merge`/`agent-harness cleanup <pr>` after merge; record rebase backups with `agent-harness goal backup-add <name>`; continue until the goal is done.
MSG
# Same registry location as reg_dir in scripts/agent-harness/lib.sh (hooks must not source lib.sh): keep both identical.
common=""
for d in "${CLAUDE_PROJECT_DIR:-}" "$PWD"; do
  [ -n "$d" ] && common="$(git -C "$d" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)" && [ -n "$common" ] && break
  common=""
done
[ -n "$common" ] || exit 0
for f in "$common"/agent-harness/goals/*.json; do
  [ -f "$f" ] || continue
  jq -r --arg s "$session_id" 'select((.status == "active" or .status == "escalated") and ($s == "" or .session_id == $s))
    | "Goal: \(.goal) | slug=\(.slug) status=\(.status) pr=\(.pr // "none") fixes=\(.fix_iterations)/\(.max_fix_iterations)"' "$f" 2>/dev/null || true
done
exit 0
