#!/bin/bash -p
# shellcheck disable=SC2016
# Usage: goal.sh set "<goal>" [criteria...] | pr <n> | backup-add <branch> | sha <headsha> | bump | escalate "<reason>" | status | clear
set -euo pipefail
# shellcheck source=scripts/agent-harness/lib.sh
. "${BASH_SOURCE[0]%/*}/lib.sh"
mkdir -p "$STATE_DIR"
cmd="${1:-status}"
[ $# -eq 0 ] || shift
case "$cmd" in
  set)
    goal="${1:?goal text}"
    [ $# -eq 0 ] || shift
    keep_branch="" keep_slug="" keep_pr=null
    if [ -f "$GOAL_FILE" ] && [ "$(goal_get '.status // empty')" = active ] && [ -n "$(goal_get '.slug // empty')" ]; then
      keep_branch="$(goal_get '.branch // empty')" keep_slug="$(goal_get '.slug')" keep_pr="$(goal_get '.pr // null')"
    fi
    branch="${keep_branch:-$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")}"
    jq -n --arg goal "$goal" --arg branch "$branch" --arg slug "${keep_slug:-$(reg_slug "$branch")}" --argjson pr "$keep_pr" \
      '{goal:$goal, criteria:$ARGS.positional, branch:$branch, slug:$slug, pr:$pr, head_sha:"",
        fix_iterations:0, max_fix_iterations:3, stop_blocks:0, total_blocks:0, status:"active", reason:"", backup_branches:[]}' \
      --args "$@" >"$GOAL_FILE"
    ;;
  pr)
    goal_update --argjson n "${1:?pr number}" '.pr = $n'
    reg_mirror --argjson n "$1" '.pr = $n'
    ;;
  backup-add)
    [ -f "$GOAL_FILE" ] || exit 0
    n="${1:?branch name}"
    [[ "$n" =~ ^backup/[a-z0-9]+(-[a-z0-9]+)*$ ]] || { echo "goal backup-add: '$n' must match backup/<kebab-slug>" >&2; exit 2; }
    git show-ref --verify --quiet "refs/heads/$n" || { echo "goal backup-add: local branch '$n' does not exist" >&2; exit 2; }
    goal_update --arg n "$n" '.backup_branches = ((.backup_branches // []) + [$n] | unique)'
    ;;
  sha)
    goal_update --arg s "${1:?head sha}" '.head_sha = $s'
    reg_mirror --arg s "$1" '.head_oid = $s'
    ;;
  bump)
    [ -f "$GOAL_FILE" ] || exit 0
    goal_update '.fix_iterations += 1'
    if [ "$(goal_get '.fix_iterations')" -ge "$(goal_get '.max_fix_iterations')" ]; then
      reason="fix iterations exhausted ($(goal_get '.max_fix_iterations'))"
      goal_update --arg r "$reason" '.status = "escalated" | .reason = $r'
      reg_mirror --arg r "$reason" '.status = "escalated" | .reason = $r'
      bash -p "$NOTIFY" failure "$reason: $(goal_get '.goal')" "$(goal_get '.pr // empty')"
      exit 3
    fi
    ;;
  escalate)
    reason="${1:?reason}"
    goal_update --arg r "$reason" '.status = "escalated" | .reason = $r'
    reg_mirror --arg r "$reason" '.status = "escalated" | .reason = $r'
    bash -p "$NOTIFY" failure "$reason: $(goal_get '.goal')" "$(goal_get '.pr // empty')"
    ;;
  status) if [ -f "$GOAL_FILE" ]; then jq -c . "$GOAL_FILE"; else echo "no goal"; fi ;;
  clear) rm -f "$GOAL_FILE" ;;
  *) echo "usage: goal.sh set|pr|backup-add|sha|bump|escalate|status|clear" >&2; exit 2 ;;
esac
