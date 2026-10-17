#!/usr/bin/env bash
# shellcheck disable=SC2016
# Stop: while autonomous with an active goal, block stopping until the PR is merged. Fails open when GitHub is unreadable.
set -u
cat >/dev/null
ROOT="$(git -C "${CLAUDE_PROJECT_DIR:-$PWD}" worktree list --porcelain 2>/dev/null | sed -n '1s/^worktree //p')"
[ -n "$ROOT" ] || ROOT="${CLAUDE_PROJECT_DIR:-$PWD}"
STATE_DIR="$ROOT/.claude/state"
[ "${AGENT_HARNESS_TEST:-}" = 1 ] && STATE_DIR="${AGENT_STATE_DIR:-${TLTB_STATE_DIR:-$STATE_DIR}}"
HARNESS_HOME="${CURSOR_PLUGIN_ROOT:-/nonexistent}/scripts/agent-harness"
GOAL_FILE="$STATE_DIR/goal.json"
GH=gh
[ "${AGENT_HARNESS_TEST:-}" = 1 ] && GH="${GH_BIN:-gh}"
MAX_BLOCKS=5
MAX_TOTAL_BLOCKS=30

[ -f "$STATE_DIR/autonomy.on" ] || exit 0
notify() {
  local dir="$HARNESS_HOME" ah
  [ "${AGENT_HARNESS_TEST:-}" != 1 ] || dir="${AGENT_HARNESS_DIR:-$dir}"
  if [ -f "$dir/notify.sh" ]; then bash -p "$dir/notify.sh" "$@"
  elif ah="$(type -P agent-harness)"; then "$ah" notify "$@"
  fi
}
goal_get() { jq -r "$1" "$GOAL_FILE" 2>/dev/null; }
goal_update() {
  local tmp
  tmp="$(mktemp "$STATE_DIR/goal.XXXXXX")" || return 1
  if jq "$@" "$GOAL_FILE" >"$tmp"; then mv "$tmp" "$GOAL_FILE"; else rm -f "$tmp"; return 1; fi
}
reg_mirror() {
  local slug common f tmp
  slug="$(goal_get '.slug // empty')"
  [ -n "$slug" ] || slug="$(goal_get '.branch // empty')"
  slug="${slug//\//-}"
  [[ "$slug" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]] || return 0
  common="$(git -C "$ROOT" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)" || return 0
  f="$common/agent-harness/goals/$slug.json"
  [ -f "$f" ] || return 0
  tmp="$(mktemp "$f.XXXXXX")" || return 0
  if jq "$@" "$f" >"$tmp"; then mv "$tmp" "$f"; else rm -f "$tmp"; fi
}
escalate() {
  goal_update --arg r "$1" '.status = "escalated" | .reason = $r'
  reg_mirror --arg r "$1" '.status = "escalated" | .reason = $r'
  notify failure "$1: $(goal_get '.goal')" "$(goal_get '.pr // empty')" || true
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
  reg_mirror '.status = "done"'
  notify "done" "PR #$pr merged" "$pr" || true
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
