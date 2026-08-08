#!/bin/bash
# PreToolUse hook — exploratory-shell tool-budget enforcement.
#
# Authoritative classification rules: rules/common/tool-budget.md
# (VERIFICATION vs EXPLORATORY Bash lists). This hook mirrors
# pre-tool-use.sh's technique of classifying on the command's TOKEN SET
# (substrings), NOT the leading command name — rtk-rewrite.sh may already
# have rewritten the command by the time this hook sees it, so anchoring on
# argv[0] would silently stop matching.
#
# Matcher: Bash|Edit|Write|MultiEdit
#
# Two trip levels ONLY. L3 deny is deliberately NOT implemented — this hook
# never returns permissionDecision: "deny"; it only steers via
# hookSpecificOutput.additionalContext.
#
#   L1 — 3rd exploratory Bash call with 0 edits so far.
#   L2 — exploratory:edit ratio > 3 once >=5 edits have happened.
#
# Allowlist-first: unknown Bash commands default to NOT counted (under-enforce
# rather than block real work).
set -u

PAYLOAD="$(cat)"

if command -v jq >/dev/null 2>&1; then
  TOOL_NAME="$(printf '%s' "$PAYLOAD" | jq -r '.tool_name // empty' 2>/dev/null || true)"
  SESSION_ID="$(printf '%s' "$PAYLOAD" | jq -r '.session_id // empty' 2>/dev/null || true)"
  COMMAND="$(printf '%s' "$PAYLOAD" | jq -r '.tool_input.command // empty' 2>/dev/null || true)"
else
  # jq missing: degrade gracefully via env fallbacks; never block on this.
  TOOL_NAME="${CLAUDE_TOOL_NAME:-}"
  SESSION_ID=""
  COMMAND="${CLAUDE_TOOL_ARGS:-}"
fi

[[ -z "$SESSION_ID" ]] && SESSION_ID="unknown-$$"

SESSION_DIR="${CLAUDE_SESSION_DIR:-$HOME/.claude/session-env/${SESSION_ID}}"
mkdir -p "$SESSION_DIR" 2>/dev/null || true
BUDGET_FILE="${SESSION_DIR}/toolbudget.tsv"
touch "$BUDGET_FILE" 2>/dev/null || true

# --- VERIFICATION (uncapped, never counted, never nudged) ---
VERIFICATION_RE='(^|[|&;[:space:]])(tsc|npm[[:space:]]+run|pnpm[[:space:]]+run|bun[[:space:]]+run|yarn[[:space:]]+run|cargo|go[[:space:]]+build|mypy|pyright|mvn|gradlew|dotnet[[:space:]]+(build|test|format)|eslint|ruff|clippy)([[:space:]]|$)'
GIT_STATE_RE='(^|[|&;[:space:]])git[[:space:]]+(status|diff|log|stash|show)([[:space:]]|$)'
PROCESS_RE='(^|[|&;[:space:]])(lsof|netstat|ps)([[:space:]]|$)'

# --- EXPLORATORY (counted): directory listing / content search / file inspection ---
EXPLORATORY_RE='(^|[|&;[:space:]])(ls|find|tree|grep|rg|ag|cat|head|tail|wc|file|stat)([[:space:]]|$)'
RTK_EXPLORATORY_RE='rtk[[:space:]]+(ls|find|grep)([[:space:]]|$)'

is_verification() {
  local cmd="${1:-}"
  [[ -z "$cmd" ]] && return 1
  [[ "$cmd" =~ $VERIFICATION_RE ]] && return 0
  [[ "$cmd" =~ $GIT_STATE_RE ]] && return 0
  [[ "$cmd" =~ $PROCESS_RE ]] && return 0
  return 1
}

is_exploratory() {
  local cmd="${1:-}"
  [[ -z "$cmd" ]] && return 1
  [[ "$cmd" =~ $RTK_EXPLORATORY_RE ]] && return 0
  [[ "$cmd" =~ $EXPLORATORY_RE ]] && return 0
  return 1
}

CATEGORY=""

case "$TOOL_NAME" in
  Bash)
    if is_verification "$COMMAND"; then
      CATEGORY=""  # uncapped — never counted, never nudged
    elif is_exploratory "$COMMAND"; then
      CATEGORY="exploratory"
    fi
    # Allowlist-first: any other/unknown command stays uncounted.
    ;;
  Edit|Write|MultiEdit)
    CATEGORY="edit"
    ;;
esac

if [[ -n "$CATEGORY" ]]; then
  printf '%s\t%s\n' "$(date +%s)" "$CATEGORY" >> "$BUDGET_FILE"
fi

EXPLORATORY_COUNT="$(grep -c -- $'\texploratory$' "$BUDGET_FILE" 2>/dev/null || true)"
EDIT_COUNT="$(grep -c -- $'\tedit$' "$BUDGET_FILE" 2>/dev/null || true)"
[[ -z "$EXPLORATORY_COUNT" ]] && EXPLORATORY_COUNT=0
[[ -z "$EDIT_COUNT" ]] && EDIT_COUNT=0

CONTEXT=""

if [[ "$CATEGORY" == "exploratory" && "$EXPLORATORY_COUNT" -eq 3 && "$EDIT_COUNT" -eq 0 ]]; then
  CONTEXT="Exploratory budget hit (3, 0 edits). Next call must be code-memory, Glob, or an Edit. If the repo is not indexed, say so explicitly and continue."
elif [[ "$EDIT_COUNT" -ge 5 ]] && (( EXPLORATORY_COUNT > EDIT_COUNT * 3 )); then
  CONTEXT="Exploratory:edit ratio exceeds 3 at ${EDIT_COUNT} edits (${EXPLORATORY_COUNT} exploratory calls). Your next assistant message must contain one line: bash-budget: <why exploratory shell is still necessary>"
fi

if [[ -n "$CONTEXT" ]]; then
  ESCAPED="${CONTEXT//\"/\\\"}"
  printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","additionalContext":"%s"}}\n' "$ESCAPED"
fi

exit 0
