#!/bin/bash -p
# shellcheck disable=SC2016
# ship-init.sh <type> <scope> <desc> [--goal "<text>"] | --adopt <pr> [--goal "<text>"]: create the goal's worktree from the
# default branch (or the PR head), record it in the goal registry and print its path.
set -euo pipefail
# shellcheck source=scripts/agent-harness/lib.sh
. "${BASH_SOURCE[0]%/*}/lib.sh"
usage='usage: ship-init.sh <type> <scope> <desc> [--goal "<text>"] | --adopt <pr> [--goal "<text>"]'
die() { echo "ship-init: $1" >&2; exit 1; }

adopt="" goal="" pos=()
while [ $# -gt 0 ]; do
  case "$1" in
    --goal) [ $# -ge 2 ] || { echo "$usage" >&2; exit 2; }; goal="$2"; shift ;;
    --adopt) [ $# -ge 2 ] && [[ "$2" =~ ^[0-9]+$ ]] || { echo "$usage" >&2; exit 2; }; adopt="$2"; shift ;;
    -*) echo "$usage" >&2; exit 2 ;;
    *) pos+=("$1") ;;
  esac
  shift
done
if [ -n "$adopt" ]; then
  [ "${#pos[@]}" -eq 0 ] || { echo "$usage" >&2; exit 2; }
else
  [ "${#pos[@]}" -eq 3 ] || { echo "$usage" >&2; exit 2; }
  [[ "${pos[0]}" =~ ^(feat|fix|refactor|docs|test|chore|perf|ci)$ ]] || die "bad type '${pos[0]}'"
  [[ "${pos[1]}" =~ ^[a-z0-9]+$ ]] || die "bad scope '${pos[1]}'"
  [[ "${pos[2]}" =~ ^[a-z0-9]+(-[a-z0-9]+)*$ ]] || die "bad description '${pos[2]}'"
  branch="${pos[0]}/${pos[1]}-${pos[2]}"
fi

sid="$(session_id_cur)"
if autonomy_on && [ -z "$sid" ]; then
  die "autonomous mode needs a session id to bind the goal: run it from a Claude Code or OpenCode session (AGENT_HARNESS_SESSION or CLAUDE_CODE_SESSION_ID)"
fi

M="$(main_checkout)" || die "not inside a git repository"
g() { git -C "$M" "$@"; }
common="$(g rev-parse --path-format=absolute --git-common-dir)" || die "cannot resolve the git dir"

base="$(cfg_get '.base // empty')"
[ -n "$base" ] || base="$(g symbolic-ref --short -q refs/remotes/origin/HEAD 2>/dev/null | sed 's@^origin/@@' || true)"
[ -n "$base" ] || base="$(base_branch)" || die "cannot resolve the default branch"

pr=null
if [ -n "$adopt" ]; then
  view="$(gh_pr_view "$adopt" headRefName,isCrossRepository)" || die "cannot read PR #$adopt"
  [ "$(jq -r '.isCrossRepository' <<<"$view")" = false ] || die "PR #$adopt comes from a fork"
  branch="$(jq -r '.headRefName // empty' <<<"$view")"
  { [ -n "$branch" ] && [ "$branch" != "$base" ]; } || die "PR #$adopt head branch is '${branch:-empty}'"
  g fetch origin "$branch" >/dev/null 2>&1 || die "cannot fetch $branch"
  if g worktree list --porcelain | grep -qx "branch refs/heads/$branch"; then die "$branch is checked out in another checkout"; fi
  start="origin/$branch" pr="$adopt"
else
  g fetch origin "$base" >/dev/null 2>&1 || die "cannot fetch origin $base"
  start="origin/$base"
fi

slug="$(reg_slug "$branch")"
[[ "$slug" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]] || die "branch '$branch' does not give a safe registry name"
reg="$(reg_path "$slug")"
if [ -f "$reg" ]; then
  existing="$(jq -r '.path // empty' "$reg" 2>/dev/null || true)"
  [ "$(jq -r '.status // empty' "$reg" 2>/dev/null || true)" != active ] || die "goal $slug is already active ($existing)"
  { [ -z "$existing" ] || [ ! -d "$existing" ]; } || die "goal $slug still records worktree $existing"
fi

if orca_managed; then
  via=orca
  "$ORCA" worktree create --repo "path:$M" --name "$slug" --base-branch "$start" --setup skip --json >/dev/null || die "orca worktree create failed"
  listing="$(orca_worktrees)" || die "cannot list orca worktrees"
  cands="$(jq -r --arg n "$slug" --arg r "$M" '
    .result.worktrees[]? | select(.isMainWorktree != true and .path != $r)
      | select((.path | endswith("/" + $n)) or ((.branch // "") | sub("^refs/heads/"; "") | (. == $n or endswith("/" + $n))))
      | .path' <<<"$listing")"
  path="$cands"
  if [ -z "$cands" ] || [ "$(wc -l <<<"$cands")" -ne 1 ] || [ ! -d "$path" ]; then
    while IFS= read -r p; do [ -z "$p" ] || echo "ship-init: orphan worktree, not recorded: $p" >&2; done <<<"$cands"
    die "orca does not list exactly one worktree named $slug"
  fi
  [ "$(git -C "$path" rev-parse --path-format=absolute --git-common-dir)" = "$common" ] || die "$path is not a worktree of $M"
  git -C "$path" branch -m "$branch" || die "cannot rename branch in $path to $branch"
  [ -z "$adopt" ] || git -C "$path" branch --set-upstream-to="origin/$branch" "$branch" >/dev/null
else
  via=git
  path="$M-wt/$slug"
  mkdir -p "$(dirname "$path")"
  if [ -n "$adopt" ]; then
    if g show-ref --verify --quiet "refs/heads/$branch"; then
      g worktree add "$path" "$branch" >/dev/null 2>&1 || die "git worktree add failed"
      git -C "$path" merge --ff-only "origin/$branch" >/dev/null 2>&1 || die "local $branch diverges from origin/$branch (worktree left at $path)"
    else
      g worktree add --track -b "$branch" "$path" "origin/$branch" >/dev/null 2>&1 || die "git worktree add failed"
    fi
  else
    g worktree add "$path" -b "$branch" "$start" >/dev/null 2>&1 || die "git worktree add failed"
  fi
fi

path="$(cd "$path" && pwd -P)" || die "cannot resolve $path"
mkdir -p "$(dirname "$reg")"
old_sid="$(jq -r '.session_id // empty' "$reg" 2>/dev/null || true)"
tmp="$(mktemp "$reg.XXXXXX")"
jq -n --arg goal "${goal:-$branch}" --arg branch "$branch" --arg slug "$slug" --arg path "$path" --arg base "$base" --arg via "$via" \
  --argjson pr "$pr" --arg at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" --arg sid "$sid" \
  '{v:1, goal:$goal, criteria:[], slug:$slug, branch:$branch, path:$path, base:$base, via:$via, pr:$pr, head_oid:"", head_sha:"",
    status:"active", reason:"", report:"", fix_iterations:0, max_fix_iterations:10, last_fingerprint:"", reviews:{},
    stop_blocks:0, total_blocks:0, backup_branches:[], session_id:$sid, created_at:$at}' \
  >"$tmp" || { rm -f "$tmp"; die "cannot write the registry entry $reg"; }
if [ -n "$adopt" ] && [ -n "$old_sid" ] && [ "$old_sid" != "$sid" ]; then
  echo "goal $slug rebound from session $old_sid to $sid" >&2
fi
mv "$tmp" "$reg"

mkdir -p "$STATE_DIR"
echo "$path"
echo "slug=$slug" >&2
