#!/usr/bin/env bash
# shellcheck disable=SC2016
# Stop: while autonomous, block stopping until the PR of every active goal bound to this session is merged. Fails open when GitHub is unreadable.
set -u
session_id="$(jq -r '.session_id // empty' 2>/dev/null)" || session_id=""
ROOT="$(git -C "${CLAUDE_PROJECT_DIR:-$PWD}" worktree list --porcelain 2>/dev/null | sed -n '1s/^worktree //p')"
[ -n "$ROOT" ] || ROOT="${CLAUDE_PROJECT_DIR:-$PWD}"
STATE_DIR="$ROOT/.claude/state"
[ "${AGENT_HARNESS_TEST:-}" = 1 ] && STATE_DIR="${AGENT_STATE_DIR:-${TLTB_STATE_DIR:-$STATE_DIR}}"
HARNESS_HOME="${CURSOR_PLUGIN_ROOT:-/nonexistent}/scripts/agent-harness"
GH=gh
[ "${AGENT_HARNESS_TEST:-}" = 1 ] && GH="${GH_BIN:-gh}"
# Hooks must not source lib.sh, so this repeats its gh_cmd: .envrc selects the gh account, not the personal token.
# Only its environment is used; the gh binary is pinned before direnv can change PATH.
gh_cmd() {
  local bin
  bin="$(type -P "$GH" 2>/dev/null)" || bin="$GH"
  case "$bin" in
    /*) if [ -f "$ROOT/.envrc" ] && command -v direnv >/dev/null 2>&1; then direnv exec "$ROOT" "$bin" "$@"; else "$bin" "$@"; fi ;;
    *) "$bin" "$@" ;;
  esac
}
MAX_BLOCKS=5
MAX_TOTAL_BLOCKS=30

[ -f "$STATE_DIR/autonomy.on" ] || exit 0
if [ -z "$session_id" ]; then
  echo "ship-stop-gate: no session_id in the hook input; acting on every active goal" >&2
fi
notify() {
  local dir="$HARNESS_HOME" ah
  [ "${AGENT_HARNESS_TEST:-}" != 1 ] || dir="${AGENT_HARNESS_DIR:-$dir}"
  if [ -f "$dir/notify.sh" ]; then bash -p "$dir/notify.sh" "$@"
  elif ah="$(type -P agent-harness)"; then "$ah" notify "$@"
  fi >/dev/null
}
# Same registry location as reg_dir in scripts/agent-harness/lib.sh (hooks must not source lib.sh): keep both identical.
common=""
for d in "${CLAUDE_PROJECT_DIR:-}" "$PWD"; do
  [ -n "$d" ] && common="$(git -C "$d" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)" && [ -n "$common" ] && break
  common=""
done
[ -n "$common" ] || exit 0
GOALS_DIR="$common/agent-harness/goals"

GOAL_FILE=""
goal_get() { jq -r "$@" "$GOAL_FILE" 2>/dev/null; }
goal_update() {
  local tmp
  tmp="$(mktemp "$GOAL_FILE.XXXXXX")" || return 1
  if jq "$@" "$GOAL_FILE" >"$tmp"; then mv "$tmp" "$GOAL_FILE"; else rm -f "$tmp"; return 1; fi
}
kpi_ship() {
  local k="${BASH_SOURCE[0]%/*}/kpi-emit.sh"
  [ -f "$k" ] || return 0
  "$k" ship "$@" >/dev/null 2>&1 || true
}
escalate() {
  goal_update --arg r "$1" '.status = "escalated" | .reason = $r'
  kpi_ship outcome=escalated ${pr:+pr=$pr}
  notify failure "$1: $(goal_get '.goal')" "$(goal_get '.pr // empty')" || true
}

# Prints a block reason on stdout when this goal must keep the session going.
gate_goal() {
  local pr view="" head="" state="" reason
  pr="$(goal_get '.pr // empty')"
  if [ -n "$pr" ]; then
    view="$(gh_cmd pr view "$pr" --json state,headRefOid 2>/dev/null)" || view=""
    state="$(jq -r '.state // empty' <<<"$view" 2>/dev/null)"
    head="$(jq -r '.headRefOid // empty' <<<"$view" 2>/dev/null)"
    if [ -z "$state" ]; then
      echo "ship-stop-gate: PR state unreadable; allowing stop" >&2
      notify waiting "PR state unreadable" "$pr" || true
      return 0
    fi
  fi
  if [ "$state" = MERGED ]; then
    goal_update '.status = "done"'
    kpi_ship outcome=merged ${pr:+pr=$pr}
    notify "done" "PR #$pr merged" "$pr" || true
    return 0
  fi

  if [ -n "$head" ] && [ "$head" != "$(goal_get '.head_sha')" ]; then
    goal_update --arg h "$head" '.head_sha = $h | .total_blocks = ((.total_blocks // 0) + 1)'
  else
    goal_update '.stop_blocks += 1 | .total_blocks = ((.total_blocks // 0) + 1)'
  fi

  if [ -z "$pr" ]; then
    reason="no PR yet: push the branch, open a PR to the base branch and record it with goal.sh pr <n>"
  else
    reason="PR #$pr is not merged: wait for checks to pass, then run agent-harness ship-merge $pr"
  fi

  if [ "$(goal_get '.total_blocks')" -ge "$MAX_TOTAL_BLOCKS" ]; then
    escalate "total stop blocks reached $MAX_TOTAL_BLOCKS: $reason"
    return 0
  fi
  if [ "$(goal_get '.stop_blocks')" -ge "$MAX_BLOCKS" ]; then
    escalate "no progress after $MAX_BLOCKS stop blocks: $reason"
    return 0
  fi
  printf '%s' "$reason"
}

reasons=""
for GOAL_FILE in "$GOALS_DIR"/*.json; do
  [ -f "$GOAL_FILE" ] || continue
  st="$(goal_get '.status // ""')"
  { [ "$st" = active ] || [ -z "$st" ]; } && [ "$(goal_get --arg sid "$session_id" '(.session_id // "") as $g | $g == "" or $sid == "" or $g == $sid')" = true ] || continue
  r="$(gate_goal)"
  [ -z "$r" ] || reasons="${reasons:+$reasons; }$r"
done

if [ -n "$reasons" ]; then
  kpi_ship outcome=blocked
  jq -n --arg r "Goal not done. $reasons" '{decision:"block",reason:$r}'
fi
exit 0
