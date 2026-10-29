#!/bin/bash -p
# Usage: worktree-rm.sh <path> [--confirmed]
# Exit: 0 removed, checkouts intact | 1 STOP/refused | 2 usage | 3 dry run | 4 removal failed or unrecoverable damage
set -euo pipefail
# shellcheck source=scripts/agent-harness/lib.sh
. "${BASH_SOURCE[0]%/*}/lib.sh"

usage() { echo "usage: agent-harness.sh worktree-rm <path> [--confirmed]" >&2; exit 2; }

p="" confirmed=0
for a in "$@"; do
  case "$a" in
    --confirmed) confirmed=1 ;;
    -*) usage ;;
    *) [ -z "$p" ] || usage; p="$a" ;;
  esac
done
[ -n "$p" ] || usage

# While autonomy is on, a clean worktree whose branch is already merged may be removed.
# wt_remove calls this only when origin/<base>..HEAD is non-zero (a squash is not an ancestor).
if autonomy_on; then
  # shellcheck disable=SC2329
  wt_autonomy_merged() {
    local t="$1" base="$2" ahead="$3" tip base_ref tip_tree base_tree branch upstream up_name
    local name raw state oid merged_at=""
    tip="$(git -C "$t" rev-parse HEAD)"
    base_ref="refs/remotes/origin/$base"
    tip_tree="$(git -C "$t" rev-parse "${tip}^{tree}")"
    base_tree="$(git -C "$t" rev-parse "${base_ref}^{tree}")"
    if git -C "$t" merge-base --is-ancestor "$tip" "$base_ref"; then
      echo "branch tip is reachable from origin/$base"
      return 0
    fi
    if [ "$tip_tree" = "$base_tree" ]; then
      echo "branch tip tree equals origin/$base"
      return 0
    fi
    if git -C "$t" rev-parse --verify -q "refs/heads/$base" >/dev/null; then
      if git -C "$t" merge-base --is-ancestor "$tip" "refs/heads/$base"; then
        echo "branch tip is reachable from $base"
        return 0
      fi
      if [ "$tip_tree" = "$(git -C "$t" rev-parse "refs/heads/${base}^{tree}")" ]; then
        echo "branch tip tree equals $base"
        return 0
      fi
    fi
    branch="$(git -C "$t" symbolic-ref --short -q HEAD || true)"
    upstream="$(git -C "$t" rev-parse --abbrev-ref '@{upstream}' 2>/dev/null || true)"
    up_name=""
    if [ -n "$upstream" ] && [ "$upstream" != "@{upstream}" ]; then
      up_name="${upstream#*/}"
      if [ "$up_name" = "$base" ] || [ "$up_name" = "$branch" ]; then up_name=""; fi
    fi
    if command -v jq >/dev/null 2>&1; then
      for name in ${branch:+"$branch"} ${up_name:+"$up_name"}; do
        [ -n "$name" ] && [ "$name" != "$base" ] || continue
        raw="$(gh_cmd pr view "$name" --json state,headRefOid 2>/dev/null || true)"
        [ -n "$raw" ] || continue
        state="$(jq -r '.state // empty' <<<"$raw" 2>/dev/null || true)"
        oid="$(jq -r '.headRefOid // empty' <<<"$raw" 2>/dev/null || true)"
        [ "$state" = MERGED ] || continue
        if [ -z "$oid" ] || [ "$oid" = "$tip" ]; then
          echo "pull request for $name is MERGED"
          return 0
        fi
        merged_at="$name at $oid"
      done
    fi
    if [ -n "$merged_at" ]; then
      echo "unmerged: pull request for $merged_at is MERGED but HEAD $tip is not that head, the tip is not reachable from $base, and the trees differ"
      return 1
    fi
    if [ -z "$branch" ]; then
      echo "unmerged: $ahead commits not on origin/$base; detached HEAD is not reachable from $base and its tree differs"
      return 1
    fi
    echo "unmerged: $ahead commits not on origin/$base; branch tip is not reachable from $base, trees differ, and no MERGED pull request for $branch"
    return 1
  }
fi

# shellcheck source=scripts/agent-harness/worktree-core.sh
. "$HARNESS_DIR/worktree-core.sh"
wt_remove "$p" "$confirmed" rm
