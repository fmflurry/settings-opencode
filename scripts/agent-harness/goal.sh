#!/bin/bash -p
# shellcheck disable=SC2016
# Usage: goal.sh set "<goal>" [criteria...] | pr <n> | backup-add <branch> | sha <headsha> | review <code|security> <pass|fail> | bump (findings on stdin) | escalate "<reason>" | status | clear
set -euo pipefail
# shellcheck source=scripts/agent-harness/lib.sh
. "${BASH_SOURCE[0]%/*}/lib.sh"
mkdir -p "$STATE_DIR"
escalate_goal() {
  goal_update --arg r "$1" '.status = "escalated" | .reason = $r'
  reg_mirror --arg r "$1" '.status = "escalated" | .reason = $r'
}
cmd="${1:-status}"
[ $# -eq 0 ] || shift
case "$cmd" in
  set)
    goal="${1:?goal text}"
    [ $# -eq 0 ] || shift
    keep_branch="" keep_slug="" keep_pr=null
    # Only ship-init may bind goal.json to a branch: the cwd's HEAD here is often the main checkout's.
    if [ -f "$GOAL_FILE" ] && [ -n "$(goal_get '.slug // empty')" ]; then
      keep_branch="$(goal_get '.branch // empty')" keep_slug="$(goal_get '.slug')"
      [ "$(goal_get '.status // empty')" = done ] || keep_pr="$(goal_get '.pr // null')"
    fi
    branch="${keep_branch:-$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")}"
    jq -n --arg goal "$goal" --arg branch "$branch" --arg slug "${keep_slug:-$(reg_slug "$branch")}" --argjson pr "$keep_pr" \
      '{goal:$goal, criteria:$ARGS.positional, branch:$branch, slug:$slug, pr:$pr, head_sha:"",
        fix_iterations:0, max_fix_iterations:10, last_fingerprint:"", reviews:{}, stop_blocks:0, total_blocks:0, status:"active", reason:"", backup_branches:[]}' \
      --args "$@" >"$GOAL_FILE"
    ;;
  pr)
    goal_update --argjson n "${1:?pr number}" '.pr = $n'
    reg_mirror --argjson n "$1" '.pr = $n'
    [[ "$1" =~ ^[0-9]+$ ]] && kpi_emit pr_open "pr=$1"
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
  review)
    kind="${1:-}" verdict="${2:-}"
    [[ "$kind" =~ ^(code|security)$ && "$verdict" =~ ^(pass|fail)$ ]] || { echo "usage: goal.sh review <code|security> <pass|fail>" >&2; exit 2; }
    [ -f "$GOAL_FILE" ] || { echo "goal review: no goal" >&2; exit 2; }
    wt="$(reg_get "$(goal_slug)" '.path // empty' 2>/dev/null || true)"
    [ -d "$wt" ] || wt="$PWD"
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
    reg_mirror "$@"
    prnum="$(goal_get '.pr // empty')"
    kpi_args=(review_round "review=$kind" "verdict=$verdict")
    [[ "$prnum" =~ ^[0-9]+$ ]] && kpi_args+=("pr=$prnum")
    kpi_emit "${kpi_args[@]}" ${kpi_extra[@]+"${kpi_extra[@]}"}
    ;;
  bump)
    [ -f "$GOAL_FILE" ] || exit 0
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
  status) if [ -f "$GOAL_FILE" ]; then jq -c . "$GOAL_FILE"; else echo "no goal"; fi ;;
  clear) rm -f "$GOAL_FILE" ;;
  *) echo "usage: goal.sh set|pr|backup-add|sha|review|bump|escalate|status|clear" >&2; exit 2 ;;
esac
