#!/usr/bin/env bash
set -u
input="$(cat)"
ROOT="$(git -C "${CLAUDE_PROJECT_DIR:-$PWD}" worktree list --porcelain 2>/dev/null | sed -n '1s/^worktree //p')"
[ -n "$ROOT" ] || ROOT="${CLAUDE_PROJECT_DIR:-$PWD}"
STATE_DIR="$ROOT/.claude/state"
[ "${AGENT_HARNESS_TEST:-}" = 1 ] && STATE_DIR="${AGENT_STATE_DIR:-${TLTB_STATE_DIR:-$STATE_DIR}}"
NOTIFY="${AGENT_HARNESS_DIR:-$HOME/.claude/scripts/agent-harness}/notify.sh"
if [ -f "$STATE_DIR/autonomy.on" ]; then
  _kpi="${BASH_SOURCE[0]%/*}/kpi-emit.sh"
  [ -f "$_kpi" ] && "$_kpi" guard_block guard=ask >/dev/null 2>&1 || true
  jq -n '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"deny",
    permissionDecisionReason:"Autonomous mode: decide yourself, log the assumption to .claude/state/decisions.tsv, continue."}}'
  exit 0
fi
[ -n "${ORCA_WORKTREE_ID:-}" ] || exit 0
question="$(jq -r '.tool_input.questions[0].question // .tool_input.question // "question pending"' <<<"$input" 2>/dev/null || echo "question pending")"
bash -p "$NOTIFY" question "$question" || true
exit 0
