#!/usr/bin/env bash
# shellcheck disable=SC2016
# cleanup.sh <pr> [--keep-branch]: post-merge tidy of the remote head branch, local checkout, local head and goal backup branches. Never removes worktrees.
set -euo pipefail
# shellcheck source=scripts/agent-harness/lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
usage="usage: cleanup.sh <pr> [--keep-branch]"
pr="" keep=""
while [ $# -gt 0 ]; do
  case "$1" in
    --keep-branch) keep=1 ;;
    -*) echo "$usage" >&2; exit 2 ;;
    *) [ -z "$pr" ] || { echo "$usage" >&2; exit 2; }; pr="$1" ;;
  esac
  shift
done
[ -n "$pr" ] || { echo "$usage" >&2; exit 2; }

refuse() { echo "cleanup refused: $1" >&2; exit 1; }
say() { echo "cleanup: $*"; }
g() { git -C "$ROOT" "$@"; }

view="$("$GH" pr view "$pr" --json state,headRefName,headRefOid,isCrossRepository)" || refuse "cannot read PR #$pr"
base="$(base_branch)" || refuse "cannot resolve the base branch"
branch="$(jq -r .headRefName <<<"$view")"
oid="$(jq -r .headRefOid <<<"$view")"
cross="$(jq -r .isCrossRepository <<<"$view")"
[ "$(jq -r .state <<<"$view")" = MERGED ] || refuse "PR #$pr is not MERGED"
{ [ -n "$branch" ] && [ "$branch" != null ] && [ "$branch" != "$base" ]; } || refuse "PR #$pr head branch is empty or the base branch"
if autonomy_on; then
  gpr="$(goal_get '.pr // empty' || true)"
  [ -z "$gpr" ] || [ "$gpr" = "$pr" ] || refuse "goal tracks PR #$gpr, not #$pr"
fi

if [ -z "$keep" ] && [ "$cross" != true ]; then
  repo="$("$GH" repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null)" || repo=""
  if [ -z "$repo" ]; then
    say "remote $branch skipped (repo unknown)"
  elif ! info="$("$GH" api "repos/$repo/branches/$branch" 2>/dev/null)"; then
    say "remote $branch absent"
  elif [ "$(jq -r '.protected // false' <<<"$info")" = true ]; then
    say "remote $branch kept (protected)"
  elif [ -n "$("$GH" pr list --state open --base "$branch" --json number --jq '.[].number' 2>/dev/null)" ] ||
    [ -n "$("$GH" pr list --state open --head "$branch" --json number --jq '.[].number' 2>/dev/null)" ]; then
    say "remote $branch kept (open PR uses it)"
  elif "$GH" api -X DELETE "repos/$repo/git/refs/heads/$branch" >/dev/null 2>&1; then
    say "remote $branch deleted"
  else
    say "remote $branch kept (delete failed)"
  fi
fi

if [ "${GITHUB_ACTIONS:-}" = true ]; then
  say "checkout skipped (ci)"
else
  g fetch --prune origin >/dev/null 2>&1 || say "fetch skipped"
  if err="$(g switch "$base" 2>&1)"; then
    if err="$(g pull --ff-only 2>&1)"; then
      say "checkout $base @ $(g rev-parse --short HEAD)"
    else
      say "checkout $base (pull skipped: $(head -n1 <<<"$err"))"
    fi
  elif g worktree list --porcelain | grep -qx "branch refs/heads/$base"; then
    if err="$(g switch --detach "origin/$base" 2>&1)"; then
      say "checkout detached at origin/$base"
    else
      say "checkout skipped ($(head -n1 <<<"$err"))"
    fi
  else
    say "checkout skipped ($(head -n1 <<<"$err"))"
  fi
fi

current="$(g rev-parse --abbrev-ref HEAD 2>/dev/null || true)"

if [ -z "$keep" ] && [ "$branch" != "$current" ] && g show-ref --verify --quiet "refs/heads/$branch"; then
  tip="$(g rev-parse "refs/heads/$branch")"
  if [ "$tip" = "$oid" ] || g merge-base --is-ancestor "$tip" "$oid" 2>/dev/null; then
    g branch -D "$branch" >/dev/null && say "local $branch deleted"
  else
    say "local $branch kept (unpushed commits)"
  fi
fi

if [ "$(goal_get '.pr // empty')" = "$pr" ]; then
  deleted=()
  while IFS= read -r b; do
    [[ "$b" =~ ^backup/[a-z0-9]+(-[a-z0-9]+)*$ ]] || continue
    { [ "$b" != "$base" ] && [ "$b" != "$current" ]; } || continue
    g show-ref --verify --quiet "refs/heads/$b" || continue
    if g branch -D "$b" >/dev/null; then say "backup $b deleted"; deleted+=("$b"); fi
  done < <(goal_get '(.backup_branches // [])[]')
  if [ "${#deleted[@]}" -gt 0 ]; then
    goal_update --argjson d "$(printf '%s\n' "${deleted[@]}" | jq -R . | jq -sc .)" \
      '.backup_branches = ((.backup_branches // []) - $d)'
  fi
fi

gd="$(cd "$ROOT" && cd "$(g rev-parse --git-dir)" && pwd -P)"
gc="$(cd "$ROOT" && cd "$(g rev-parse --git-common-dir)" && pwd -P)"
[ "$gd" = "$gc" ] || say "worktree $(g rev-parse --show-toplevel) kept"
exit 0
