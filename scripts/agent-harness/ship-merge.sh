#!/usr/bin/env bash
# shellcheck disable=SC2016
# ship-merge.sh <pr> [--confirmed]: merges only when GitHub-side rails pass; not a security boundary without branch protection.
set -euo pipefail
# shellcheck source=scripts/agent-harness/lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
pr="${1:?usage: ship-merge.sh <pr> [--confirmed]}"
confirmed="${2:-}"

refuse() { echo "ship-merge refused: $1" >&2; exit 1; }

if ! autonomy_on && [ "$confirmed" != "--confirmed" ]; then
  refuse "autonomy is off and --confirmed was not given"
fi

view="$("$GH" pr view "$pr" --json state,baseRefName,isDraft,headRefOid,headRefName,isCrossRepository,files)" || refuse "cannot read PR #$pr"
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
"$GH" pr merge "$pr" --squash --match-head-commit "$head" || merge_rc=$?
state="$("$GH" pr view "$pr" --json state | jq -r .state)" || state=unknown
[ "$state" = MERGED ] || refuse "merge failed (exit $merge_rc); PR state is $state"

repo="$("$GH" repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null)" || repo=""
if [ -n "$repo" ] && [ -n "$branch" ]; then
  "$GH" api -X DELETE "repos/$repo/git/refs/heads/$branch" >/dev/null 2>&1 || true
fi
goal_update '.status = "done"'
bash "$NOTIFY" "done" "PR #$pr merged" "$pr"
