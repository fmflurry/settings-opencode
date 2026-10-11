#!/usr/bin/env bash
# Helpers for goal.sh, autonomy.sh, notify.sh and ship-merge.sh. Source it; do not execute it.
# Hooks must not source this file: it lives in the repo-independent install and hooks run it unattended.
HARNESS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
DEFAULT_STATE_DIR="$ROOT/.claude/state"
STATE_DIR="$DEFAULT_STATE_DIR"
GH=gh
ORCA=orca
if [ "${AGENT_HARNESS_TEST:-}" = 1 ]; then
  STATE_DIR="${AGENT_STATE_DIR:-${TLTB_STATE_DIR:-$DEFAULT_STATE_DIR}}"
  GH="${GH_BIN:-gh}"
  ORCA="${ORCA_BIN:-orca}"
fi
GOAL_FILE="$STATE_DIR/goal.json"
CONFIG_FILE="$ROOT/.claude/agent-harness.json"
# shellcheck disable=SC2034
NOTIFY="$HARNESS_DIR/notify.sh"

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
