#!/usr/bin/env bash
set -u
cat >/dev/null
ROOT="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
STATE_DIR="$ROOT/.claude/state"
[ "${AGENT_HARNESS_TEST:-}" = 1 ] && STATE_DIR="${AGENT_STATE_DIR:-${TLTB_STATE_DIR:-$STATE_DIR}}"
GOAL_FILE="$STATE_DIR/goal.json"
[ -f "$STATE_DIR/autonomy.on" ] || exit 0
cat <<'MSG'
AUTONOMOUS MODE ON: never ask the user; decide from AGENTS.md + repo evidence; log every assumption to .claude/state/decisions.tsv (show-your-work format) and to the PR's `## Locked decisions`; merge ONLY via `agent-harness ship-merge <pr>`; this is the documented exception to the confirm-irreversible rule; branches are deleted only by `agent-harness ship-merge`/`agent-harness cleanup <pr>` after merge; record rebase backups with `agent-harness goal backup-add <name>`; continue until the goal is done.
MSG
if [ -f "$GOAL_FILE" ]; then
  jq -r '"Goal: \(.goal) | status=\(.status) pr=\(.pr // "none") fixes=\(.fix_iterations)/\(.max_fix_iterations)"' "$GOAL_FILE" 2>/dev/null || true
fi
exit 0
