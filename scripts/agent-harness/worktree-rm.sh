#!/usr/bin/env bash
# Usage: worktree-rm.sh <path> [--confirmed]
# Exit: 0 removed, checkouts intact | 1 STOP/refused | 2 usage | 3 dry run | 4 removal failed or unrecoverable damage
set -euo pipefail
# shellcheck source=lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

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
if autonomy_on; then echo "worktree-rm: worktree removal is forbidden in autonomous mode" >&2; exit 1; fi

REFS=()
release_refs() { local r; for r in ${REFS[@]+"${REFS[@]}"}; do git -C "$M" update-ref -d "$r" 2>/dev/null || true; done; }
stop() { echo "worktree-rm: check $1 STOP ($2)"; release_refs; exit 1; }
ok() { echo "worktree-rm: check $1 ok${2:+ ($2)}"; }

T="$(cd "$p" 2>/dev/null && pwd -P)" || { M=.; stop target "path not found: $p"; }
LIST=()
while IFS= read -r l; do
  [ -d "$l" ] && l="$(cd "$l" && pwd -P)"
  LIST+=("$l")
done < <(git -C "$T" worktree list --porcelain | sed -n 's/^worktree //p')
M="${LIST[0]:-}"
[ -n "$M" ] || { M=.; stop listed "git worktree list failed"; }

listed=0
for l in "${LIST[@]}"; do [ "$l" = "$T" ] && listed=1; done
[ "$listed" = 1 ] && ok listed || stop listed "$T not in git worktree list"

if [ "$T" != "$M" ] && [ "$(git -C "$T" rev-parse --absolute-git-dir)" != "$(git -C "$T" rev-parse --path-format=absolute --git-common-dir)" ]; then
  ok not-main
else stop not-main "main checkout"; fi

here="$(pwd -P)"
case "$here/" in "$T"/*) stop not-cwd "cwd is inside $T" ;; *) ok not-cwd ;; esac

is_clean() { [ -z "$(git -C "$T" status --porcelain)" ]; }
is_clean && ok clean || stop clean "uncommitted or untracked content"

base="$(cfg_get '.base // empty')"
[ -n "$base" ] || base="$(git -C "$T" symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null | sed 's@^origin/@@')" || true
[ -n "$base" ] || stop ahead "cannot resolve base branch"
git -C "$T" rev-parse --verify -q "refs/remotes/origin/$base" >/dev/null || stop ahead "origin/$base missing"
ahead="$(git -C "$T" rev-list --count "origin/$base..HEAD")"
[ "$ahead" = 0 ] && ok ahead "0 commits not on origin/$base" || stop ahead "$ahead commits not on origin/$base"

use_orca=0
if command -v "$ORCA" >/dev/null 2>&1 && olist="$("$ORCA" worktree list --json 2>/dev/null)"; then
  last="$(jq -r --arg t "$T" '[.. | objects | select(.path? == $t) | .lastActivityAt // 0] | max // empty' <<<"$olist" 2>/dev/null || true)"
  if [ -n "$last" ]; then
    use_orca=1
    idle_min="$(cfg_get '.worktreeIdleMinutes // empty')"; idle_min="${idle_min:-60}"
    now_ms=$(( $(date +%s) * 1000 ))
    if [ "$last" -gt $(( now_ms - idle_min * 60000 )) ]; then stop activity "active within ${idle_min} min"; fi
    ok activity "idle over ${idle_min} min"
  else echo "worktree-rm: check activity skipped (not Orca-managed)"; fi
else echo "worktree-rm: check activity skipped (orca absent)"; fi

DIRTY=()
for c in "${LIST[@]}"; do
  [ "$c" != "$T" ] && [ -d "$c" ] || continue
  git -C "$c" rev-parse --verify -q HEAD >/dev/null || stop others "$c has unborn HEAD"
  st="$(git -C "$c" status --porcelain)"
  if grep -qE '^(UU|AA|DD|AU|UA|DU|UD) ' <<<"$st"; then stop others "$c has unmerged entries"; fi
  [ -z "$st" ] || DIRTY+=("$c")
done
ok others "${#DIRTY[@]} dirty"

if [ "$confirmed" = 0 ]; then
  for c in ${DIRTY[@]+"${DIRTY[@]}"}; do echo "worktree-rm: would snapshot $c"; done
  echo "worktree-rm: dry run, pass --confirmed to remove $T"
  exit 3
fi

snapshot() {
  local c="$1" head itree wtree utree i u="" w tmp
  head="$(git -C "$c" rev-parse --verify -q HEAD)" || return 1
  tmp="$(mktemp -d)"
  cp "$(git -C "$c" rev-parse --path-format=absolute --git-path index)" "$tmp/i"
  itree="$(GIT_INDEX_FILE="$tmp/i" git -C "$c" write-tree)" || return 1
  i="$(git -C "$c" commit-tree "$itree" -p "$head" -m "index on harness snapshot")"
  GIT_INDEX_FILE="$tmp/i" git -C "$c" add -u -- :/ || return 1
  wtree="$(GIT_INDEX_FILE="$tmp/i" git -C "$c" write-tree)"
  if [ -n "$(git -C "$c" ls-files -o --exclude-standard -- :/)" ]; then
    git -C "$c" ls-files -z -o --exclude-standard --full-name -- :/ |
      (cd "$c" && GIT_INDEX_FILE="$tmp/u" git update-index --add -z --stdin) || return 1
    utree="$(GIT_INDEX_FILE="$tmp/u" git -C "$c" write-tree)"
    u="$(git -C "$c" commit-tree "$utree" -m "untracked files on harness snapshot")"
  fi
  w="$(git -C "$c" commit-tree "$wtree" -p "$head" -p "$i" ${u:+-p "$u"} -m "harness-worktree-rm snapshot $c")"
  rm -rf "$tmp"; echo "$w"
}

S_C=() S_HEAD=() S_W=() S_U=() S_REF=()
ts="$(date +%s)"; n=0
for c in ${DIRTY[@]+"${DIRTY[@]}"}; do
  n=$((n + 1))
  head="$(git -C "$c" rev-parse HEAD)"
  w="$(snapshot "$c")" || { echo "worktree-rm: snapshot of $c failed"; release_refs; exit 1; }
  ref="refs/harness/snapshots/$ts-$n"
  git -C "$M" update-ref "$ref" "$w" "" || { echo "worktree-rm: cannot create $ref"; release_refs; exit 1; }
  REFS+=("$ref")
  S_C+=("$c") S_HEAD+=("$head") S_W+=("$w") S_REF+=("$ref")
  S_U+=("$(git -C "$M" rev-parse -q --verify "$w^3" 2>/dev/null || true)")
  echo "worktree-rm: snapshot $c $ref"
done

is_clean && ok clean-recheck || stop clean-recheck "target changed during snapshot"

if [ "$use_orca" = 1 ] && out="$("$ORCA" worktree rm --worktree "path:$T" --json 2>&1)" && jq -e '.ok == true' <<<"$out" >/dev/null 2>&1; then
  echo "worktree-rm: route orca"
else
  echo "worktree-rm: route git"
  git -C "$M" worktree remove -- "$T" || true
fi

# Orca removes asynchronously and always force-removes
rc=0
wait_s="${AGENT_HARNESS_WORKTREE_RM_WAIT:-60}"; waited=0
while :; do
  if [ ! -d "$T" ] && ! git -C "$M" worktree list --porcelain | grep -qxF "worktree $T"; then
    echo "worktree-rm: removed $T"; break
  fi
  if [ "$waited" -ge "$wait_s" ]; then echo "worktree-rm: removal of $T failed or timed out"; rc=4; break; fi
  sleep 1; waited=$((waited + 1))
done
[ "$rc" = 4 ] || sleep "${AGENT_HARNESS_WORKTREE_RM_SETTLE:-20}"

is_intact() {
  local c="$1" head="$2" w="$3" u="$4" f
  while IFS= read -r -d '' f; do
    if git -C "$c" cat-file -e "$w:$f" 2>/dev/null; then
      [ -e "$c/$f" ] && [ "$(cd "$c" && git hash-object -- "$f")" = "$(git -C "$c" rev-parse "$w:$f")" ] || return 1
    else [ ! -e "$c/$f" ] && [ ! -L "$c/$f" ] || return 1; fi
  done < <(git -C "$c" diff --name-only -z "$head" "$w")
  [ -z "$u" ] && return 0
  while IFS= read -r -d '' f; do
    [ -e "$c/$f" ] && [ "$(cd "$c" && git hash-object -- "$f")" = "$(git -C "$c" rev-parse "$u:$f")" ] || return 1
  done < <(git -C "$c" ls-tree -r -z --name-only "$u")
}

for k in "${!S_C[@]}"; do
  c="${S_C[$k]}"
  if [ ! -d "$c" ]; then echo "worktree-rm: damaged $c (directory gone; refs kept: ${S_REF[$k]})"; rc=4; continue; fi
  if is_intact "$c" "${S_HEAD[$k]}" "${S_W[$k]}" "${S_U[$k]}"; then echo "worktree-rm: intact $c"; continue; fi
  if [ -z "$(git -C "$c" status --porcelain)" ]; then
    git -C "$c" stash apply --index "${S_W[$k]}" >/dev/null 2>&1 || git -C "$c" stash apply "${S_W[$k]}" >/dev/null 2>&1 || true
    if is_intact "$c" "${S_HEAD[$k]}" "${S_W[$k]}" "${S_U[$k]}"; then echo "worktree-rm: restored $c from ${S_REF[$k]}"; continue; fi
  fi
  echo "worktree-rm: damaged $c (restore manually: git -C $c stash apply --index ${S_REF[$k]})"; rc=4
done

if [ "$rc" = 0 ]; then
  for k in "${!S_REF[@]}"; do
    git -C "$M" update-ref -d "${S_REF[$k]}" "${S_W[$k]}"; echo "worktree-rm: snapshot released ${S_REF[$k]}"
  done
else
  for r in ${REFS[@]+"${REFS[@]}"}; do echo "worktree-rm: kept $r"; done
fi
exit "$rc"
