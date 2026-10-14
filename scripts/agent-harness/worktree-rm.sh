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
norm() { local d="$1"; if [ -d "$d" ]; then d="$(cd "$d" && pwd -P)"; fi; printf '%s' "${d%/}"; }

LIST=()
while IFS= read -r l; do LIST+=("$(norm "$l")"); done < <(git -C "$T" worktree list --porcelain | sed -n 's/^worktree //p')
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
  command -v jq >/dev/null 2>&1 || stop activity "activity unknown (jq missing)"
  last=""
  while IFS=$'\t' read -r q ts; do
    [ -n "$q" ] && [ "$(norm "$q")" = "$T" ] || continue
    use_orca=1
    [[ "$ts" =~ ^[0-9]+$ ]] || stop activity "activity unknown (lastActivityAt: $ts)"
    if [ -z "$last" ] || [ "$ts" -gt "$last" ]; then last="$ts"; fi
  done < <(jq -r '.. | objects | select(has("path")) | [(.path | tostring), (.lastActivityAt | tostring)] | @tsv' <<<"$olist" 2>/dev/null || true)
fi
if [ "$use_orca" = 1 ]; then
  idle_min="$(cfg_get '.worktreeIdleMinutes // empty')"
  if [[ "$idle_min" =~ ^[0-9]+$ ]] && [ "$((10#$idle_min))" -ge 15 ]; then idle_min=$((10#$idle_min)); else idle_min=60; fi
  now_ms=$(( $(date +%s) * 1000 ))
  if [ "$last" -gt $(( now_ms - idle_min * 60000 )) ]; then stop activity "active within ${idle_min} min"; fi
  ok activity "idle over ${idle_min} min"
else echo "worktree-rm: check activity skipped (not Orca-managed)"; fi

wait_s=60 settle_s=20
if [ "${AGENT_HARNESS_TEST:-}" = 1 ]; then
  wait_s="${AGENT_HARNESS_WORKTREE_RM_WAIT:-60}"; settle_s="${AGENT_HARNESS_WORKTREE_RM_SETTLE:-20}"
  [[ "$wait_s" =~ ^[0-9]+$ ]] || wait_s=60
  [[ "$settle_s" =~ ^[0-9]+$ ]] || settle_s=20
fi

DIRTY=() O_C=() O_HEAD=() O_DIRTY=()
for c in "${LIST[@]}"; do
  [ "$c" != "$T" ] && [ -d "$c" ] || continue
  git -C "$c" rev-parse --verify -q HEAD >/dev/null || stop others "$c has unborn HEAD"
  st="$(git -C "$c" status --porcelain)"
  if grep -qE '^(UU|AA|DD|AU|UA|DU|UD) ' <<<"$st"; then stop others "$c has unmerged entries"; fi
  O_C+=("$c") O_HEAD+=("$(git -C "$c" rev-parse HEAD)")
  if [ -z "$st" ]; then O_DIRTY+=(0); else O_DIRTY+=(1); DIRTY+=("$c"); fi
done
ok others "${#DIRTY[@]} dirty"

ign="$(git -C "$T" ls-files -o -i --exclude-standard --directory 2>/dev/null | head -5 | paste -sd, - || true)"
[ -z "$ign" ] || echo "worktree-rm: note $T has ignored files that will be deleted: $ign"

if [ "$confirmed" = 0 ]; then
  for c in ${DIRTY[@]+"${DIRTY[@]}"}; do echo "worktree-rm: would snapshot $c"; done
  echo "worktree-rm: dry run, pass --confirmed to remove $T"
  exit 3
fi

snapshot() {
  local c="$1" head itree wtree utree i u="" w tmp f
  head="$(git -C "$c" rev-parse --verify -q HEAD)" || return 1
  tmp="$(mktemp -d)" || return 1
  trap 'rm -rf "$tmp"' RETURN
  cp "$(git -C "$c" rev-parse --path-format=absolute --git-path index)" "$tmp/i" || return 1
  itree="$(GIT_INDEX_FILE="$tmp/i" git -C "$c" write-tree)" || return 1
  i="$(git -C "$c" commit-tree "$itree" -p "$head" -m "index on harness snapshot")" || return 1
  GIT_INDEX_FILE="$tmp/i" git -C "$c" add -u -- :/ || return 1
  wtree="$(GIT_INDEX_FILE="$tmp/i" git -C "$c" write-tree)" || return 1
  git -C "$c" ls-files -z -o --exclude-standard --full-name -- :/ >"$tmp/ul" || return 1
  : >"$tmp/ul2"
  while IFS= read -r -d '' f; do
    if [ -e "$c/$f/.git" ]; then echo "worktree-rm: note $c nested repo ${f%/} not snapshotted" >&2; continue; fi
    printf '%s\0' "$f" >>"$tmp/ul2"
  done <"$tmp/ul"
  if [ -s "$tmp/ul2" ]; then
    (cd "$c" && GIT_INDEX_FILE="$tmp/u" git update-index --add -z --stdin) <"$tmp/ul2" || return 1
    utree="$(GIT_INDEX_FILE="$tmp/u" git -C "$c" write-tree)" || return 1
    u="$(git -C "$c" commit-tree "$utree" -m "untracked files on harness snapshot")" || return 1
  fi
  w="$(git -C "$c" commit-tree "$wtree" -p "$head" -p "$i" ${u:+-p "$u"} -m "harness-worktree-rm snapshot $c")" || return 1
  echo "$w"
}

S_C=() S_HEAD=() S_W=() S_U=() S_REF=()
ts="$(date +%s)"; n=0
for c in ${DIRTY[@]+"${DIRTY[@]}"}; do
  n=$((n + 1))
  head="$(git -C "$c" rev-parse HEAD)"
  w="$(snapshot "$c")" || { echo "worktree-rm: snapshot of $c failed"; release_refs; exit 1; }
  git -C "$c" cat-file -e "$w^{commit}" 2>/dev/null || stop snapshot "snapshot of $c is not a commit"
  ref="refs/harness/snapshots/$ts-$n"
  git -C "$M" update-ref "$ref" "$w" "" || { echo "worktree-rm: cannot create $ref"; release_refs; exit 1; }
  REFS+=("$ref")
  S_C+=("$c") S_HEAD+=("$head") S_W+=("$w") S_REF+=("$ref")
  S_U+=("$(git -C "$M" rev-parse -q --verify "$w^3" 2>/dev/null || true)")
  echo "worktree-rm: snapshot $c $ref"
done

is_clean && ok clean-recheck || stop clean-recheck "target changed during snapshot"

errf="$(mktemp)"
if [ "$use_orca" = 1 ] && out="$("$ORCA" worktree rm --worktree "path:$T" --json 2>"$errf")" && jq -e '.ok == true' <<<"$out" >/dev/null 2>&1; then
  echo "worktree-rm: route orca"
else
  if [ "$use_orca" = 1 ]; then echo "worktree-rm: orca rm failed: ${out:-}"; cat "$errf"; fi
  echo "worktree-rm: route git"
  git -C "$M" worktree remove -- "$T" || true
fi
rm -f "$errf"

is_listed() {
  local l
  while IFS= read -r l; do [ "$(norm "$l")" = "$T" ] && return 0; done < <(git -C "$M" worktree list --porcelain | sed -n 's/^worktree //p')
  return 1
}

# Orca removes asynchronously and always force-removes
rc=0 waited=0
while :; do
  if [ ! -d "$T" ] && ! is_listed; then echo "worktree-rm: removed $T"; break; fi
  if [ "$waited" -ge "$wait_s" ]; then echo "worktree-rm: removal of $T failed or timed out"; rc=4; break; fi
  sleep 1; waited=$((waited + 1))
done
[ "$rc" = 4 ] || sleep "$settle_s"

# same_as <checkout> <path> <treeish>: worktree entry matches treeish entry in mode and content
same_as() {
  local c="$1" f="$2" t="$3" line m sha
  line="$(git -C "$c" ls-tree "$t" -- "$f")" || return 1
  [ -n "$line" ] || return 1
  m="${line%% *}"; sha="${line#* * }"; sha="${sha%%$'\t'*}"
  case "$m" in
    160000) [ -d "$c/$f" ]; return ;;
    120000) [ -L "$c/$f" ] && [ "$(printf '%s' "$(readlink "$c/$f")" | git -C "$c" hash-object --stdin)" = "$sha" ]; return ;;
  esac
  [ -f "$c/$f" ] && [ ! -L "$c/$f" ] || return 1
  if [ "$m" = 100755 ]; then [ -x "$c/$f" ] || return 1; elif [ -x "$c/$f" ]; then return 1; fi
  [ "$(cd "$c" && git hash-object -- "$f")" = "$sha" ]
}

is_intact() {
  local c="$1" head="$2" w="$3" u="$4" f tmp
  git -C "$c" cat-file -e "$w^{commit}" || return 1
  tmp="$(mktemp -d)" || return 1
  trap 'rm -rf "$tmp"' RETURN
  git -C "$c" diff --no-renames --name-only -z "$head" "$w" >"$tmp/d" || return 1
  while IFS= read -r -d '' f; do
    if git -C "$c" cat-file -e "$w:$f" 2>/dev/null; then same_as "$c" "$f" "$w" || return 1
    else [ ! -e "$c/$f" ] && [ ! -L "$c/$f" ] || return 1; fi
  done <"$tmp/d"
  cp "$(git -C "$c" rev-parse --path-format=absolute --git-path index)" "$tmp/ci" || return 1
  [ "$(GIT_INDEX_FILE="$tmp/ci" git -C "$c" write-tree)" = "$(git -C "$c" rev-parse "$w^2^{tree}")" ] || return 1
  [ -z "$u" ] && return 0
  git -C "$c" ls-tree -r -z --name-only "$u" >"$tmp/ut" || return 1
  while IFS= read -r -d '' f; do same_as "$c" "$f" "$u" || return 1; done <"$tmp/ut"
}

for k in "${!S_C[@]}"; do
  c="${S_C[$k]}" w="${S_W[$k]}"
  if [ ! -d "$c" ]; then echo "worktree-rm: damaged $c (directory gone; refs kept: ${S_REF[$k]})"; rc=4; continue; fi
  if is_intact "$c" "${S_HEAD[$k]}" "$w" "${S_U[$k]}"; then echo "worktree-rm: intact $c"; continue; fi
  if [ "$(git -C "$c" rev-parse HEAD 2>/dev/null)" = "${S_HEAD[$k]}" ] && [ -z "$(git -C "$c" status --porcelain)" ]; then
    git -C "$c" stash apply --index "$w" >/dev/null 2>&1 || true
    if is_intact "$c" "${S_HEAD[$k]}" "$w" "${S_U[$k]}"; then echo "worktree-rm: restored $c from ${S_REF[$k]}"; continue; fi
  fi
  echo "worktree-rm: damaged $c (HEAD moved/unclean; inspect: git -C $c diff HEAD $w; restore: git -C $c stash apply --index $w)"; rc=4
done

for k in "${!O_C[@]}"; do
  c="${O_C[$k]}"
  [ -d "$c" ] || continue
  if [ "$(git -C "$c" rev-parse HEAD 2>/dev/null)" != "${O_HEAD[$k]}" ] \
    || { [ "${O_DIRTY[$k]}" = 0 ] && [ -n "$(git -C "$c" status --porcelain)" ]; }; then
    echo "worktree-rm: changed during removal $c"
  fi
done

if [ "$rc" = 0 ]; then
  for k in "${!S_REF[@]}"; do
    echo "worktree-rm: snapshot ${S_REF[$k]} = ${S_W[$k]} (recoverable until gc)"
    git -C "$M" update-ref -d "${S_REF[$k]}" "${S_W[$k]}"; echo "worktree-rm: snapshot released ${S_REF[$k]}"
  done
else
  for r in ${REFS[@]+"${REFS[@]}"}; do echo "worktree-rm: kept $r"; done
fi
exit "$rc"
