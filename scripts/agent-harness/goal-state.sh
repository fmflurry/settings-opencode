#!/bin/bash -p
# Resolve one goal file per repo + worktree + branch. Source this; do not execute it.
# scripts/agent-harness/goal-state.sh and .claude/hooks/goal-state.sh are the same file.
# Hooks must not source lib.sh, so both sides source this instead.

goal_scope_clear() {
  GS_WT=""
  GS_BRANCH=""
  GS_REPO=""
  GS_KIND=none
}

goal_scope_resolve() {
  local start="$1" top repo branch
  goal_scope_clear
  [ -n "$start" ] || return 0
  top="$(git -C "$start" rev-parse --show-toplevel 2>/dev/null)" || return 0
  GS_WT="$(cd "$top" && pwd -P 2>/dev/null)" || { goal_scope_clear; return 0; }
  repo="$(git -C "$GS_WT" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)" || { goal_scope_clear; return 0; }
  GS_REPO="$(cd "$repo" && pwd -P 2>/dev/null)" || { goal_scope_clear; return 0; }
  if branch="$(git -C "$GS_WT" symbolic-ref --quiet --short HEAD 2>/dev/null)"; then
    GS_KIND=branch
    GS_BRANCH="$branch"
  elif git -C "$GS_WT" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    GS_KIND=detached
    GS_BRANCH=detached
  else
    goal_scope_clear
  fi
}

# primary is CLAUDE_PROJECT_DIR when set, otherwise the only directory.
# A non-git primary is the whole scope: an unrelated cwd must not replace it.
# A git primary uses that checkout, not the main worktree.
# When the process cwd is another worktree of the same repository, it wins.
goal_scope_select() {
  local primary="$1" secondary="${2:-}" p_repo p_wt p_branch p_kind
  goal_scope_resolve "$primary"
  [ "${GS_KIND:-none}" != none ] || return 0
  [ -n "$secondary" ] || return 0
  p_repo="$GS_REPO"
  p_wt="$GS_WT"
  p_branch="$GS_BRANCH"
  p_kind="$GS_KIND"
  goal_scope_resolve "$secondary"
  if [ "${GS_KIND:-none}" = none ] || [ "$GS_REPO" != "$p_repo" ]; then
    GS_REPO="$p_repo"
    GS_WT="$p_wt"
    GS_BRANCH="$p_branch"
    GS_KIND="$p_kind"
  fi
}

goal_state_id() {
  printf '%s\n%s\n%s\n' "$GS_REPO" "$GS_WT" "$GS_BRANCH" | git -C "$GS_WT" hash-object --stdin 2>/dev/null
}

goal_bind_file() {
  local dir="$1" id legacy dest branch
  if [ "${GS_KIND:-none}" = none ]; then
    GOAL_FILE="$dir/goal.json"
    return 0
  fi
  id="$(goal_state_id 2>/dev/null || true)"
  if [[ ! "$id" =~ ^[0-9a-f]{40}$ ]]; then
    mkdir -p "$dir/goals" 2>/dev/null || true
    GOAL_FILE="$dir/goals/invalid-key.json"
    return 0
  fi
  mkdir -p "$dir/goals" 2>/dev/null || true
  GOAL_FILE="$dir/goals/$id.json"
  legacy="$dir/goal.json"
  [ -f "$legacy" ] || return 0
  branch="$(jq -r '.branch // empty' "$legacy" 2>/dev/null || true)"
  dest="$dir/goal.shared.quarantine.json"
  if [ -e "$dest" ]; then
    dest="$dir/goal.shared.quarantine.$(date -u +%Y%m%dT%H%M%SZ).json"
  fi
  if [ -e "$dest" ]; then
    dest="$dir/goal.shared.quarantine.$$.json"
  fi
  mv "$legacy" "$dest" 2>/dev/null || return 0
  printf 'agent-harness: quarantined shared goal state %s -> %s (recorded branch %s; current %s at %s). It was not applied to this checkout.\n' \
    "$legacy" "$dest" "${branch:-unknown}" "$GS_BRANCH" "$GS_WT" >&2
}
