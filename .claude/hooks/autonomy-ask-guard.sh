#!/usr/bin/env bash
set -u
input="$(cat)"
ROOT="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
STATE_DIR="$ROOT/.claude/state"
[ "${AGENT_HARNESS_TEST:-}" = 1 ] && STATE_DIR="${AGENT_STATE_DIR:-${TLTB_STATE_DIR:-$STATE_DIR}}"
NOTIFY="${AGENT_HARNESS_DIR:-$HOME/.claude/scripts/agent-harness}/notify.sh"
if [ -f "$STATE_DIR/autonomy.on" ]; then
  jq -n '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"deny",
    permissionDecisionReason:"Autonomous mode: decide yourself, log the assumption to .claude/state/decisions.tsv, continue."}}'
  exit 0
fi
[ -n "${ORCA_WORKTREE_ID:-}" ] || exit 0
question="$(jq -r '.tool_input.questions[0].question // .tool_input.question // "question pending"' <<<"$input" 2>/dev/null || echo "question pending")"
bash "$NOTIFY" question "$question" || true
exit 0
