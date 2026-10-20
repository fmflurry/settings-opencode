#!/bin/bash -p
# shellcheck disable=SC2016
# ship-merge.sh <pr> [--confirmed] [--method squash|rebase|merge] [--keep-branch]: merges only when GitHub-side rails pass; not a security boundary without branch protection.
set -euo pipefail
# shellcheck source=scripts/agent-harness/lib.sh
. "${BASH_SOURCE[0]%/*}/lib.sh"
usage="usage: ship-merge.sh <pr> [--confirmed] [--method squash|rebase|merge] [--keep-branch]"
pr="" confirmed="" method="" keep=""
while [ $# -gt 0 ]; do
  case "$1" in
    --confirmed) confirmed=--confirmed ;;
    --keep-branch) keep=1 ;;
    --method) [ $# -ge 2 ] || { echo "$usage" >&2; exit 2; }; method="$2"; shift ;;
    --method=*) method="${1#--method=}" ;;
    -*) echo "$usage" >&2; exit 2 ;;
    *) [ -z "$pr" ] || { echo "$usage" >&2; exit 2; }; pr="$1" ;;
  esac
  shift
done
[ -n "$pr" ] || { echo "$usage" >&2; exit 2; }

refuse() { echo "ship-merge refused: $1" >&2; exit 1; }

# Explicit choice (flag or config) is never silently replaced; only the unset case falls back to the repo's first allowed method.
resolve_merge_method() {
  local want="$1" repo flags s r c allowed=() m
  case "$want" in "" | squash | rebase | merge) ;; *) refuse "unknown merge method '$want'; use squash, rebase or merge" ;; esac
  repo="$(gh_cmd repo view --json nameWithOwner -q .nameWithOwner)" || refuse "cannot read repository for merge settings"
  flags="$(gh_cmd api "repos/$repo" --jq '"\(.allow_squash_merge) \(.allow_rebase_merge) \(.allow_merge_commit)"')" || refuse "cannot read merge settings of $repo"
  read -r s r c <<<"$flags"
  [ "$s" != true ] || allowed+=(squash)
  [ "$r" != true ] || allowed+=(rebase)
  [ "$c" != true ] || allowed+=(merge)
  [ "${#allowed[@]}" -gt 0 ] || refuse "$repo allows no merge method"
  [ -n "$want" ] || { echo "${allowed[0]}"; return 0; }
  for m in "${allowed[@]}"; do [ "$m" != "$want" ] || { echo "$want"; return 0; }; done
  refuse "merge method '$want' is not allowed by $repo; allowed: ${allowed[*]}"
}

if ! autonomy_on && [ "$confirmed" != "--confirmed" ]; then
  refuse "autonomy is off and --confirmed was not given"
fi

view="$(gh_cmd pr view "$pr" --json state,baseRefName,isDraft,headRefOid,headRefName,isCrossRepository,files)" || refuse "cannot read PR #$pr"
base="$(base_branch)" || refuse "cannot resolve the base branch"
head="$(jq -r .headRefOid <<<"$view")"
branch="$(jq -r .headRefName <<<"$view")"
[ "$(jq -r .state <<<"$view")" = OPEN ] || refuse "PR #$pr is not OPEN"
[ "$(jq -r .isDraft <<<"$view")" = false ] || refuse "PR #$pr is draft; run gh pr ready after review"
[ "$(jq -r .baseRefName <<<"$view")" = "$base" ] || refuse "PR #$pr base is not $base"
[ "$(jq -r .isCrossRepository <<<"$view")" = false ] || refuse "PR #$pr comes from a fork"
[ "$branch" != "$base" ] || refuse "PR #$pr head branch is the base branch"

re="$(protected_regex)"
if [ -n "$re" ] && { autonomy_on || [ "$confirmed" != "--confirmed" ]; }; then
  hit="$(jq -r '.files[]?.path' <<<"$view" | grep -E -m1 -- "$re" || true)"
  [ -z "$hit" ] || refuse "PR #$pr touches protected path $hit; merge it by hand"
fi

problems="$(pr_problems "$pr" "$head" "$base")" || refuse "cannot query GitHub for PR #$pr"
[ -z "$problems" ] || refuse "$(tr '\n' ';' <<<"$problems")"

merge_rc=0
method="$(resolve_merge_method "${method:-$(cfg_get '.mergeMethod // empty')}")" || exit 1
gh_cmd pr merge "$pr" --"$method" --match-head-commit "$head" || merge_rc=$?
state="$(gh_cmd pr view "$pr" --json state | jq -r .state)" || state=unknown
[ "$state" = MERGED ] || refuse "merge failed (exit $merge_rc); PR state is $state"

goal_update '.status = "done"'
bash -p "$NOTIFY" "done" "PR #$pr merged" "$pr"
if slug="$(reg_find_by_pr "$pr" 2>/dev/null)"; then
  reg_update "$slug" '.status = "merged"' || true
  bash -p "$HARNESS_DIR/teardown-merged-worktree.sh" "$pr" ${keep:+--keep-branch} || echo "teardown incomplete; rerun: agent-harness teardown-merged-worktree $pr" >&2
else
  bash -p "$HARNESS_DIR/cleanup.sh" "$pr" ${keep:+--keep-branch} || echo "cleanup incomplete; rerun: agent-harness cleanup $pr" >&2
fi
