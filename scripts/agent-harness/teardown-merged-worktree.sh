#!/bin/bash -p
# shellcheck disable=SC2016
# teardown-merged-worktree.sh <pr> [--keep-branch]: remove the registered worktree of a merged PR, then its remote and
# local branch. Every check fails closed.
# Exit: 0 done | 1 STOP or partial result (registry kept as merged) | 2 usage | 3 no registered worktree | 4 removal failed
set -euo pipefail
# shellcheck source=scripts/agent-harness/lib.sh
. "${BASH_SOURCE[0]%/*}/lib.sh"
# shellcheck source=scripts/agent-harness/worktree-core.sh
. "$HARNESS_DIR/worktree-core.sh"
usage="usage: teardown-merged-worktree.sh <pr> [--keep-branch]"
pr="" keep=""
for a in "$@"; do
  case "$a" in
    --keep-branch) keep=1 ;;
    -*) echo "$usage" >&2; exit 2 ;;
    *) [ -z "$pr" ] || { echo "$usage" >&2; exit 2; }; pr="$a" ;;
  esac
done
[[ "$pr" =~ ^[0-9]+$ ]] || { echo "$usage" >&2; exit 2; }

say() { echo "teardown: $*"; }
stop() { say "STOP ($1)"; exit 1; }
norm() { local d="$1"; if [ -d "$d" ]; then d="$(cd "$d" && pwd -P)"; fi; printf '%s' "${d%/}"; }

M="$(main_checkout)" || stop "not inside a git repository"
cd "$M"
slug="$(reg_find_by_pr "$pr")" || { echo "teardown: no registered worktree for PR $pr" >&2; exit 3; }
status="$(reg_get "$slug" '.status // empty')"
recorded="$(reg_get "$slug" '.path // empty')"
rbranch="$(reg_get "$slug" '.branch // empty')"
[ -n "$recorded" ] || stop "registry entry $slug has no path"

view="$(gh_pr_view "$pr" state,headRefOid,headRefName)" || stop "cannot read PR #$pr"
if [ "$(jq -r .state <<<"$view")" != MERGED ]; then
  case "$status" in escalated | blocked) stop "goal $slug is $status; a human must review it" ;; esac
  stop "PR #$pr is not MERGED"
fi
oid="$(jq -r '.headRefOid // empty' <<<"$view")"
pbranch="$(jq -r '.headRefName // empty' <<<"$view")"
{ [ -n "$oid" ] && [ -n "$pbranch" ]; } || stop "PR #$pr head unknown"
[ "$rbranch" = "$pbranch" ] || stop "registered branch $rbranch is not the PR head $pbranch"
[ "$slug" = "$(reg_slug "$pbranch")" ] || stop "registry entry $slug is not the goal of PR head $pbranch"
via="$(reg_get "$slug" '.via // empty')"
case "$recorded" in
  "$(norm "$M")-wt/$slug") ;;
  */"$slug") [ "$via" = orca ] || stop "recorded path $recorded does not have the layout of a goal worktree for $slug" ;;
  *) stop "recorded path $recorded does not have the layout of a goal worktree for $slug" ;;
esac
ostate="$(orca_state)"
[ "$ostate" != error ] || stop "orca is installed but its repo list is unreadable"
if [ "$ostate" != managed ] && [[ "$(realp "$recorded")" == */orca/workspaces/* ]]; then stop "$recorded is under an Orca workspace but the repo is not Orca-managed"; fi

common="$(git -C "$M" rev-parse --path-format=absolute --git-common-dir)"
is_listed() {
  local l
  while IFS= read -r l; do [ "$(norm "$l")" = "$1" ] && return 0; done < <(git -C "$M" worktree list --porcelain | sed -n 's/^worktree //p')
  return 1
}

verify_target() {
  [ ! -L "$recorded" ] || { echo "recorded path $recorded is a symlink"; return 1; }
  [ "$(cd "$recorded" 2>/dev/null && pwd -P)" = "$recorded" ] || { echo "$recorded does not resolve to itself"; return 1; }
  [ "$recorded" != "$M" ] || { echo "target is the main checkout"; return 1; }
  is_listed "$recorded" || { echo "$recorded not in git worktree list"; return 1; }
  [ "$(git -C "$recorded" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)" = "$common" ] || { echo "$recorded is not a worktree of $M"; return 1; }
  [ "$(git -C "$recorded" rev-parse HEAD 2>/dev/null)" = "$oid" ] || { echo "worktree HEAD is not the merged head $oid"; return 1; }
  [ "$(git -C "$recorded" symbolic-ref --short -q HEAD 2>/dev/null)" = "$pbranch" ] || { echo "worktree branch is not $pbranch"; return 1; }
  [ -z "$(git -C "$recorded" status --porcelain --untracked-files=all)" ] || { echo "uncommitted or untracked content in $recorded"; return 1; }
}
# shellcheck disable=SC2329
wt_recheck() { verify_target; }

# A rerun after a partial result: the worktree is already gone and the earlier run verified its removal.
if [ "$status" = merged ] && [ ! -e "$recorded" ] && ! is_listed "$recorded"; then
  say "worktree $recorded already removed"
else
  reason="$(verify_target)" || stop "$reason"
  rc=0
  ( wt_remove "$recorded" 1 teardown ) || rc=$?
  [ "$rc" = 0 ] || exit "$rc"
  reg_update "$slug" '.status = "merged" | .reason = "worktree removed; branch cleanup pending"' || true
fi

out="$(CLAUDE_PROJECT_DIR="$M" bash -p "$HARNESS_DIR/cleanup.sh" "$pr" --no-checkout ${keep:+--keep-branch} 2>&1)" || true
[ -z "$out" ] || echo "$out"

remote="" local_state=""
if [ -n "$keep" ]; then
  remote=skipped local_state=skipped
else
  line="$(grep -F "cleanup: remote $pbranch " <<<"$out" | head -n1 || true)"
  case "$line" in *" deleted" | *" absent") remote="${line##* }" ;; esac
  if ! git -C "$M" show-ref --verify --quiet "refs/heads/$pbranch"; then
    if grep -qxF "cleanup: local $pbranch deleted" <<<"$out"; then local_state=deleted; else local_state=absent; fi
  fi
fi

if [ -n "$remote" ] && [ -n "$local_state" ]; then
  rm -f "$(reg_path "$slug")"
  say "worktree removed $recorded; remote $pbranch $remote; local $pbranch $local_state; registry removed"
  exit 0
fi
reason="branch cleanup incomplete (remote ${remote:-kept}, local ${local_state:-kept})"
reg_update "$slug" --arg r "$reason" '.status = "merged" | .reason = $r' || true
say "worktree removed $recorded; $reason; registry kept as merged"
say "rerun: agent-harness teardown-merged-worktree $pr"
exit 1
