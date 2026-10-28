#!/usr/bin/env bash
# Warn-only diff check for a cache removed without invalidation.
# Exit 0 always. A real deletion of a cache must stay possible.
# PreToolUse prints hook JSON (Cursor turns that into an allow + agent_message).
# Stop prints the same text on stderr (Claude). It does not emit decision:block:
# stop.sh content checks are warn-only, and ship-stop-gate blocks only an
# unfinished autonomous goal, not a code pattern.
set -u

INPUT="$(cat 2>/dev/null || true)"
mode="hook"
if [ "${1:-}" = "--text" ]; then
  mode="text"
fi

event=""
session=""
if [ "$mode" = "hook" ] && command -v jq >/dev/null 2>&1; then
  event="$(printf '%s' "$INPUT" | jq -r '.hook_event_name // empty' 2>/dev/null || true)"
  session="$(printf '%s' "$INPUT" | jq -r '.session_id // .conversation_id // empty' 2>/dev/null || true)"
fi

emit="stderr"
case "$mode" in
  text) emit="text" ;;
  hook)
    case "$event" in
      PreToolUse|preToolUse) emit="json" ;;
    esac
    ;;
esac

if [ "$emit" = "json" ]; then
  [ -n "$session" ] || session="nosession"
  session="$(printf '%s' "$session" | tr -c 'A-Za-z0-9._-' '_')"
  marker="${TMPDIR:-/tmp}/fmflurry-cache-invalidation-${session}"
  if [ -f "$marker" ]; then
    exit 0
  fi
fi

if ! git rev-parse --git-dir >/dev/null 2>&1; then
  exit 0
fi

resolve_base() {
  local cand base
  if cand="$(git rev-parse --abbrev-ref --symbolic-full-name '@{upstream}' 2>/dev/null)"; then
    base="$(git merge-base HEAD "$cand" 2>/dev/null || true)"
    if [ -n "$base" ]; then
      printf '%s\n' "$base"
      return 0
    fi
  fi
  for cand in origin/master origin/main master main; do
    git rev-parse --verify --quiet "$cand" >/dev/null 2>&1 || continue
    base="$(git merge-base HEAD "$cand" 2>/dev/null || true)"
    if [ -n "$base" ]; then
      printf '%s\n' "$base"
      return 0
    fi
  done
  return 1
}

base=""
base="$(resolve_base || true)"
if [ -n "$base" ]; then
  diff_text="$(git --no-pager diff --no-color --unified=0 "$base" 2>/dev/null | head -c 2000000 || true)"
else
  diff_text="$(git --no-pager diff --no-color --unified=0 HEAD 2>/dev/null | head -c 2000000 || true)"
fi

# Code lines only. A commented-out decorator is a bypass, not a kept cache.
code_lines() {
  local side="$1"
  printf '%s\n' "$diff_text" | awk -v side="$side" '
    index($0, side) == 1 && substr($0, 1, 3) != side side side {
      line = substr($0, 2)
      sub(/\r$/, "", line)
      sub(/^[[:space:]]+/, "", line)
      if (line ~ /^\/\// || line ~ /^\/\*/ || line ~ /^\*/ || line ~ /^#/ || line ~ /^<!--/) next
      print line
    }
  '
}

token_count() {
  local side="$1" pattern="$2" n
  n="$(code_lines "$side" | grep -oE "$pattern" | wc -l | tr -d ' ')"
  printf '%s\n' "${n:-0}"
}

MARKER_RE='@SkipIfCached|CACHE_NO_TIMEOUT|@AppCache|\[OutputCache|\[ResponseCache|HybridCache|IMemoryCache'
INV_RE='invalidateCacheFor|onCacheInvalidate|EvictByTag|RemoveByTag|[A-Za-z0-9_]*[Cc]ache\.Remove(Async)?\('

removed="$(token_count '-' "$MARKER_RE")"
added="$(token_count '+' "$MARKER_RE")"
inv="$(token_count '+' "$INV_RE")"

if [ "$removed" -le "$added" ] || [ "$inv" -gt 0 ]; then
  exit 0
fi

msg="cache-invalidation: this diff removes a cache marker (@SkipIfCached, CACHE_NO_TIMEOUT, or another cache directive) and does not add invalidateCacheFor or onCacheInvalidate. Keep the cache. Invalidate it from the write that changes the data. Rule: rules/common/cache-invalidation.md (Cursor: rules/cache-invalidation.mdc)."

case "$emit" in
  json)
    touch "$marker"
    jq -nc --arg m "$msg" '{hookSpecificOutput:{hookEventName:"PreToolUse",additionalContext:$m}}'
    ;;
  text)
    printf '%s\n' "$msg"
    ;;
  *)
    printf '%s\n' "$msg" >&2
    ;;
esac
exit 0
