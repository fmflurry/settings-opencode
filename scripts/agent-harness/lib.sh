#!/bin/bash -p
# Helpers for the agent-harness scripts. Source it; do not execute it.
# Hooks must not source this file: it lives in the repo-independent install and hooks run it unattended.
# Inherited (exported) shell functions could shadow gh, git or jq: drop them, then pin gh and orca to real binaries.
for _fn in $(builtin compgen -A function); do builtin unset -f "$_fn"; done
builtin unset _fn
HARNESS_DIR="$(builtin cd -P "${BASH_SOURCE[0]%/*}" && builtin pwd -P)"
# An installed copy carries the .installed marker written by install.sh; it never trusts the inherited environment.
HARNESS_INSTALLED=0
GH="" ORCA="" JQ=""
if [ -f "$HARNESS_DIR/.installed" ]; then
  HARNESS_INSTALLED=1
  PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
  while IFS='=' read -r _k _v; do
    case "$_k" in GH) GH="$_v" ;; ORCA) ORCA="$_v" ;; JQ) JQ="$_v" ;; esac
  done <"$HARNESS_DIR/.installed"
  builtin unset _k _v
  [ -z "$JQ" ] || [ ! -x "$JQ" ] || jq() { "$JQ" "$@"; }
  [ -n "$GH" ] && [ -x "$GH" ] || GH="$(type -P gh || echo gh)"
  [ -z "$ORCA" ] || [ -x "$ORCA" ] || ORCA=""
  [ -n "$ORCA" ] || ORCA="$(type -P orca || true)"
else
  GH="$(type -P gh || echo gh)"
  ORCA="$(type -P orca || true)"
fi
# The state lives in the main checkout so every worktree of the repo sees the same goal and autonomy flag.
ROOT="$(git -C "${CLAUDE_PROJECT_DIR:-$PWD}" worktree list --porcelain 2>/dev/null | sed -n '1s/^worktree //p' || true)"
[ -n "$ROOT" ] || ROOT="${CLAUDE_PROJECT_DIR:-$PWD}"
DEFAULT_STATE_DIR="$ROOT/.claude/state"
STATE_DIR="$DEFAULT_STATE_DIR"
if [ "$HARNESS_INSTALLED" = 0 ] && [ "${AGENT_HARNESS_TEST:-}" = 1 ]; then
  STATE_DIR="${AGENT_STATE_DIR:-${TLTB_STATE_DIR:-$DEFAULT_STATE_DIR}}"
  GH="${GH_BIN:-$GH}"
  ORCA="${ORCA_BIN:-$ORCA}"
fi
GOAL_FILE="$STATE_DIR/goal.json"
CONFIG_FILE="$ROOT/.claude/agent-harness.json"
# shellcheck disable=SC2034
NOTIFY="$HARNESS_DIR/notify.sh"

main_checkout() {
  local d first
  for d in "${CLAUDE_PROJECT_DIR:-}" "$PWD"; do
    [ -n "$d" ] || continue
    first="$(git -C "$d" worktree list --porcelain 2>/dev/null | sed -n '1s/^worktree //p')"
    [ -z "$first" ] || { printf '%s\n' "$first"; return 0; }
  done
  return 1
}

realp() { if [ -d "$1" ]; then (cd "$1" && pwd -P); else printf '%s\n' "${1%/}"; fi; }

# orca_state: absent (no orca binary) | managed | unmanaged | error (orca present but its repo list is unreadable).
orca_state() {
  local main out q paths
  command -v "$ORCA" >/dev/null 2>&1 || { echo absent; return 0; }
  main="$(main_checkout)" || { echo error; return 0; }
  out="$("$ORCA" repo list --json 2>/dev/null)" || { echo error; return 0; }
  paths="$(jq -r '.. | objects | .path? | strings' <<<"$out" 2>/dev/null)" || { echo error; return 0; }
  main="$(realp "$main")"
  while IFS= read -r q; do
    [ -n "$q" ] && [ "$(realp "$q")" = "$main" ] && { echo managed; return 0; }
  done <<<"$paths"
  echo unmanaged
}
orca_managed() { [ "$(orca_state)" = managed ]; }

orca_worktrees() { "$ORCA" worktree list --repo "path:$(main_checkout)" --json; }

# Registry: one JSON file per goal in <git-common-dir>/agent-harness/goals, so it is never tracked and outlives the worktree.
reg_dir() {
  local main common
  main="$(main_checkout)" || return 1
  common="$(git -C "$main" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)" || return 1
  printf '%s/agent-harness/goals\n' "$common"
}
reg_slug() { printf '%s' "${1//\//-}"; }
reg_path() {
  local d
  [[ "$1" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]] || return 1
  d="$(reg_dir)" || return 1
  printf '%s/%s.json\n' "$d" "$1"
}
reg_get() { local f; f="$(reg_path "$1")" || return 1; jq -r "$2" "$f" 2>/dev/null; }

# reg_update <slug> <jq args...> <filter>: atomic rewrite; a missing entry is not an error.
reg_update() {
  local slug="$1" f tmp; shift
  f="$(reg_path "$slug")" || return 0
  [ -f "$f" ] || return 0
  tmp="$(mktemp "$f.XXXXXX")" || return 1
  if jq "$@" "$f" >"$tmp"; then mv "$tmp" "$f"; else rm -f "$tmp"; return 1; fi
}

# goal_slug: registry name of the goal in goal.json (its slug, else the slug of its branch). Never the cwd's HEAD.
goal_slug() {
  local s b
  s="$(goal_get '.slug // empty')"
  if [ -z "$s" ]; then
    b="$(goal_get '.branch // empty')"
    [ -z "$b" ] || s="$(reg_slug "$b")"
  fi
  printf '%s' "$s"
}

# reg_find_by_pr <pr>: prints the slug of the registered goal bound to the PR, else the goal.json goal when it tracks that PR.
reg_find_by_pr() {
  local d f s
  d="$(reg_dir)" || return 1
  for f in "$d"/*.json; do
    [ -f "$f" ] || continue
    if jq -e --argjson n "$1" '.pr == $n' "$f" >/dev/null 2>&1; then basename "$f" .json; return 0; fi
  done
  [ "$(goal_get '.pr // empty')" = "$1" ] || return 1
  s="$(goal_slug)"
  { [ -n "$s" ] && [ -f "$d/$s.json" ]; } || return 1
  printf '%s\n' "$s"
}

# reg_mirror <jq args...> <filter>: update the registry entry of the goal in goal.json, if it has one.
reg_mirror() {
  local slug
  slug="$(goal_slug)"
  [ -n "$slug" ] || return 0
  reg_update "$slug" "$@" || true
}

autonomy_on() { [ -f "$STATE_DIR/autonomy.on" ]; }

goal_get() { jq -r "$1" "$GOAL_FILE" 2>/dev/null; }

goal_update() {
  [ -f "$GOAL_FILE" ] || return 0
  local tmp
  tmp="$(mktemp "$STATE_DIR/goal.XXXXXX")" || return 1
  if jq "$@" "$GOAL_FILE" >"$tmp"; then mv "$tmp" "$GOAL_FILE"; else rm -f "$tmp"; return 1; fi
}

cfg_get() { [ -f "$CONFIG_FILE" ] || return 0; jq -r "$1" "$CONFIG_FILE" 2>/dev/null || true; }

base_branch() {
  local b
  b="$(cfg_get '.base // empty')"
  [ -n "$b" ] || b="$("$GH" repo view --json defaultBranchRef -q .defaultBranchRef.name)" || return 1
  [ -n "$b" ] || return 1
  echo "$b"
}

protected_regex() {
  cfg_get '(.protectedPaths // []) | join("|")'
}

# pr_problems <pr> <head-sha> <base>: one line per unmet rail; empty output means all green.
# Returns 2 when GitHub cannot be queried.
pr_problems() {
  local pr="$1" head="$2" base="$3" repo runs statuses threads bad review behind name rs who
  repo="$("$GH" repo view --json nameWithOwner -q .nameWithOwner)" || return 2

  runs="$("$GH" api "repos/$repo/commits/$head/check-runs" --paginate --jq '.check_runs[]' | jq -s .)" || return 2
  bad="$(jq -r '[.[] | select(.status != "completed" or (.conclusion | IN("success", "skipped", "neutral") | not)) | .name]
    | unique | join(", ")' <<<"$runs")"
  [ -z "$bad" ] || echo "checks failing or pending: $bad"
  while IFS= read -r name; do
    [ -n "$name" ] || continue
    jq -e --arg n "$name" 'any(.[]; .name == $n and .status == "completed" and (.conclusion | IN("success", "skipped", "neutral")))' \
      <<<"$runs" >/dev/null || echo "required check '$name' missing or not passing"
  done <<<"$(cfg_get '(.requiredChecks // [])[]')"

  rs="$(cfg_get '.reviewStatus // empty')"
  if [ -n "$rs" ]; then
    who="$(cfg_get '.reviewStatusCreator // empty')"
    statuses="$("$GH" api "repos/$repo/commits/$head/statuses" --paginate --jq '.[]' | jq -s .)" || return 2
    review="$(jq -r --arg c "$rs" --arg who "$who" '[.[] | select(.context == $c)] | sort_by(.id) | last
      | if . == null then "missing" elif ($who != "" and .creator.login != $who) then "posted by \(.creator.login)"
        elif .state != "success" then "state \(.state)" else "ok" end' <<<"$statuses")"
    [ "$review" = ok ] || echo "$rs status not green for head ${head:0:8}: $review"
  fi

  threads="$("$GH" api graphql -F owner="${repo%%/*}" -F name="${repo##*/}" -F pr="$pr" -f query='
query($owner:String!,$name:String!,$pr:Int!){repository(owner:$owner,name:$name){pullRequest(number:$pr){reviewThreads(first:100){pageInfo{hasNextPage}nodes{isResolved}}}}}')" || return 2
  if [ "$(jq -r '.data.repository.pullRequest.reviewThreads.pageInfo.hasNextPage' <<<"$threads")" = true ]; then
    echo "more than 100 review threads: resolve some, then retry"
  else
    bad="$(jq '[.data.repository.pullRequest.reviewThreads.nodes[] | select(.isResolved | not)] | length' <<<"$threads")"
    [ "$bad" = 0 ] || echo "unresolved review threads: $bad"
  fi

  behind="$("$GH" api "repos/$repo/compare/$base...$head" --jq .behind_by)" || return 2
  [[ "$behind" =~ ^[0-9]+$ ]] || return 2
  [ "$behind" = 0 ] || echo "head is behind $base by $behind commits; rebase first"
  return 0
}
