#!/usr/bin/env bash
# shellcheck disable=SC2016
# Stop: while autonomous with an active goal, block stopping until the PR is merged. Fails open when GitHub is unreadable.
set -u
cat >/dev/null
ROOT="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
STATE_DIR="$ROOT/.claude/state"
[ "${AGENT_HARNESS_TEST:-}" = 1 ] && STATE_DIR="${AGENT_STATE_DIR:-${TLTB_STATE_DIR:-$STATE_DIR}}"
NOTIFY="${AGENT_HARNESS_DIR:-$HOME/.claude/scripts/agent-harness}/notify.sh"
GOAL_FILE="$STATE_DIR/goal.json"
GH=gh
[ "${AGENT_HARNESS_TEST:-}" = 1 ] && GH="${GH_BIN:-gh}"
MAX_BLOCKS=5
MAX_TOTAL_BLOCKS=30

[ -f "$STATE_DIR/autonomy.on" ] || exit 0
goal_get() { jq -r "$1" "$GOAL_FILE" 2>/dev/null; }
goal_update() {
  local tmp
  tmp="$(mktemp "$STATE_DIR/goal.XXXXXX")" || return 1
  if jq "$@" "$GOAL_FILE" >"$tmp"; then mv "$tmp" "$GOAL_FILE"; else rm -f "$tmp"; return 1; fi
}
escalate() {
  goal_update --arg r "$1" '.status = "escalated" | .reason = $r'
  bash "$NOTIFY" failure "$1: $(goal_get '.goal')" "$(goal_get '.pr // empty')" || true
}
[ -f "$GOAL_FILE" ] && [ "$(goal_get '.status')" = active ] || exit 0

pr="$(goal_get '.pr // empty')"
view="" head="" state=""
if [ -n "$pr" ]; then
  view="$("$GH" pr view "$pr" --json state,headRefOid 2>/dev/null)" || view=""
  state="$(jq -r '.state // empty' <<<"$view" 2>/dev/null)"
  head="$(jq -r '.headRefOid // empty' <<<"$view" 2>/dev/null)"
fi
if [ "$state" = MERGED ]; then
  goal_update '.status = "done"'
  bash "$NOTIFY" "done" "PR #$pr merged" "$pr" || true
  exit 0
fi

if [ -n "$head" ] && [ "$head" != "$(goal_get '.head_sha')" ]; then
  goal_update --arg h "$head" '.head_sha = $h | .total_blocks = ((.total_blocks // 0) + 1)'
else
  goal_update '.stop_blocks += 1 | .total_blocks = ((.total_blocks // 0) + 1)'
fi

if [ -z "$pr" ]; then
  reason="no PR yet: push the branch, open a PR to the base branch and record it with goal.sh pr <n>"
elif [ -n "$state" ]; then
  reason="PR #$pr is not merged: wait for checks to pass, then run agent-harness ship-merge $pr"
else
  reason=""
fi

if [ "$(goal_get '.total_blocks')" -ge "$MAX_TOTAL_BLOCKS" ]; then
  escalate "total stop blocks reached $MAX_TOTAL_BLOCKS: ${reason:-PR state unavailable}"
  exit 0
fi
if [ "$(goal_get '.stop_blocks')" -ge "$MAX_BLOCKS" ]; then
  escalate "no progress after $MAX_BLOCKS stop blocks: ${reason:-PR state unavailable}"
  exit 0
fi
[ -n "$reason" ] || exit 0

jq -n --arg r "Goal not done. $reason" '{decision:"block",reason:$r}'
exit 0
