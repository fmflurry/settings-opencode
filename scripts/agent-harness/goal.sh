#!/bin/bash -p
# shellcheck disable=SC2016
# Usage: goal.sh [--goal <slug>] set "<goal>" [criteria...] | pr <n> | backup-add <branch> | sha <headsha> | review <code|security> <pass|fail> | bump (findings on stdin) | escalate "<reason>" | status
# The goal is the registry entry selected by --goal, else $AGENT_HARNESS_GOAL, else the branch checked out in the cwd.
set -euo pipefail
# shellcheck source=scripts/agent-harness/lib.sh
. "${BASH_SOURCE[0]%/*}/lib.sh"
explicit=""
if [ "${1:-}" = --goal ]; then
  [ $# -ge 2 ] || { echo "goal: --goal needs a slug" >&2; exit 2; }
  explicit="$2"
  shift 2
fi
escalate_goal() {
  goal_update --arg r "$1" '.status = "escalated" | .reason = $r'
}
cmd="${1:-status}"
[ $# -eq 0 ] || shift
if [ "$cmd" != status ]; then
  if ! goal_resolve "$explicit"; then
    named="${explicit:-${AGENT_HARNESS_GOAL:-}}"
    if [ -n "$named" ]; then
      echo "goal $cmd: no goal named $named" >&2
      exit 2
    fi
    # bump and backup-add stay no-ops while no goal is active at all.
    case "$cmd" in bump | backup-add) reg_any_active || exit 0 ;; esac
    echo "goal $cmd: no goal selected; pass --goal <slug>, set AGENT_HARNESS_GOAL, or run from the goal's worktree" >&2
    exit 2
  fi
fi
case "$cmd" in
  set)
    goal="${1:?goal text}"
    [ $# -eq 0 ] || shift
    criteria="$(jq -nc '$ARGS.positional' --args "$@")"
    goal_update --arg goal "$goal" --argjson criteria "$criteria" '(if .status == "done" then null else .pr end) as $pr
      | .goal = $goal | .criteria = $criteria | .pr = $pr | .head_sha = "" | .fix_iterations = 0 | .max_fix_iterations //= 10
      | .last_fingerprint = "" | .reviews = {} | .stop_blocks = 0 | .total_blocks = 0 | .status = "active" | .reason = "" | .backup_branches //= []'
    ;;
  pr)
    goal_update --argjson n "${1:?pr number}" '.pr = $n'
    [[ "$1" =~ ^[0-9]+$ ]] && kpi_emit pr_open "pr=$1"
    ;;
  backup-add)
    n="${1:?branch name}"
    [[ "$n" =~ ^backup/[a-z0-9]+(-[a-z0-9]+)*$ ]] || { echo "goal backup-add: '$n' must match backup/<kebab-slug>" >&2; exit 2; }
    git show-ref --verify --quiet "refs/heads/$n" || { echo "goal backup-add: local branch '$n' does not exist" >&2; exit 2; }
    goal_update --arg n "$n" '.backup_branches = ((.backup_branches // []) + [$n] | unique)'
    ;;
  sha)
    goal_update --arg s "${1:?head sha}" '.head_sha = $s | .head_oid = $s'
    ;;
  review)
    kind="${1:-}" verdict="${2:-}"
    [[ "$kind" =~ ^(code|security)$ && "$verdict" =~ ^(pass|fail)$ ]] || { echo "usage: goal.sh review <code|security> <pass|fail>" >&2; exit 2; }
    wt="$(goal_get '.path // empty')"
    [ -d "$wt" ] || { echo "goal review: the worktree of goal $GOAL_SLUG is missing" >&2; exit 2; }
    head_sha="$(git -C "$wt" rev-parse HEAD 2>/dev/null)" || { echo "goal review: $wt is not a git worktree" >&2; exit 2; }
    mb=""
    # Same recipe as gate_key in .claude/hooks/autonomy-git-guard.sh (hooks must not source lib.sh): keep both identical.
    cb="$(cfg_get '.base // empty')"
    if [ -n "$cb" ]; then ca="$cb"; else ca=main cb=master; fi
    for b in "$(goal_get '.base // empty')" "$(git -C "$wt" symbolic-ref -q --short refs/remotes/origin/HEAD 2>/dev/null | sed 's#^origin/##')" "$ca" "$cb"; do
      [ -n "$b" ] || continue
      mb="$(git -C "$wt" merge-base "origin/$b" HEAD 2>/dev/null)" && [ -n "$mb" ] && break
      mb=""
    done
    [ -n "$mb" ] || { echo "goal review: cannot compute review key (no origin/<base> to diff against); run git fetch origin" >&2; exit 2; }
    key="$(git -C "$wt" -c core.quotepath=true diff --no-ext-diff --no-textconv --binary --full-index --no-color --no-renames --no-relative -O/dev/null --src-prefix=a/ --dst-prefix=b/ --diff-algorithm=myers -U3 --inter-hunk-context=0 --submodule=short --ignore-submodules=none "$mb" HEAD -- ':/' ':(top,exclude)docs/agent-reports' 2>/dev/null | git -C "$wt" hash-object --stdin)" || { echo "goal review: cannot compute review key (git diff failed)" >&2; exit 2; }
    case "$key" in e69de29bb2d1d6434b8b29ae775ad8c2e48c5391 | 473a0f4c3be8a93681a267e3b1e9a7dcda1185436fe141f7749120a303721813) key=empty ;; esac
    at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    kpi_extra=()
    for arg in "${@:3}"; do
      case "$arg" in
        important=[0-9]*|nit=[0-9]*|pre_existing=[0-9]*) kpi_extra+=("$arg") ;;
      esac
    done
    set -- --arg k "$key" --arg kind "$kind" --arg v "$verdict" --arg s "$head_sha" --arg at "$at" '.reviews[$k][$kind] = {verdict:$v, sha:$s, at:$at}'
    goal_update "$@"
    prnum="$(goal_get '.pr // empty')"
    kpi_args=(review_round "review=$kind" "verdict=$verdict")
    [[ "$prnum" =~ ^[0-9]+$ ]] && kpi_args+=("pr=$prnum")
    kpi_emit "${kpi_args[@]}" ${kpi_extra[@]+"${kpi_extra[@]}"}
    ;;
  bump)
    findings="$(tr '[:upper:]' '[:lower:]' | sed -E 's/:[0-9]+(:[0-9]+)?$//; s/[#: ]l[0-9]+(-l?[0-9]+)?$//; s/[[:space:]]+$//; /^[[:space:]]*$/d' | sort -u)"
    [ -n "$findings" ] || { echo "goal bump: pipe the findings on stdin, one '<reviewer>:<path>' or 'ci:<check>' per line" >&2; exit 2; }
    fp="$(printf '%s\n' "$findings" | git hash-object --stdin)"
    prev="$(goal_get '.last_fingerprint // empty')"
    goal_update --arg f "$fp" '.fix_iterations += 1 | .last_fingerprint = $f'
    prnum="$(goal_get '.pr // empty')"
    fix_args=(fix_round "fix_iterations=$(goal_get '.fix_iterations')")
    [[ "$prnum" =~ ^[0-9]+$ ]] && fix_args+=("pr=$prnum")
    kpi_emit "${fix_args[@]}"
    reason=""
    if [ "$fp" = "$prev" ]; then
      reason="no progress: the same findings repeated after a fix round (fingerprint ${fp:0:12})"
    elif [ "$(goal_get '.fix_iterations')" -ge "$(goal_get '.max_fix_iterations // 10')" ]; then
      reason="fix iterations exhausted ($(goal_get '.max_fix_iterations // 10'))"
    fi
    if [ -n "$reason" ]; then
      escalate_goal "$reason"
      bash -p "$NOTIFY" failure "$reason: $(goal_get '.goal')" "$(goal_get '.pr // empty')"
      exit 3
    fi
    ;;
  escalate)
    reason="${1:?reason}"
    escalate_goal "$reason"
    bash -p "$NOTIFY" failure "$reason: $(goal_get '.goal')" "$(goal_get '.pr // empty')"
    ;;
  status)
    if goal_resolve "$explicit"; then
      jq -c . "$(reg_path "$GOAL_SLUG")"
    elif [ -n "$explicit" ]; then
      echo "goal status: no goal named $explicit" >&2
      exit 2
    else
      d="$(reg_dir 2>/dev/null)" || d=""
      found=0
      for f in "$d"/*.json; do
        [ -f "$f" ] || continue
        jq -ce 'select(.status == "active")' "$f" 2>/dev/null && found=1
      done
      [ "$found" = 1 ] || echo "no goal"
    fi
    ;;
  *) echo "usage: goal.sh [--goal <slug>] set|pr|backup-add|sha|review|bump|escalate|status" >&2; exit 2 ;;
esac
