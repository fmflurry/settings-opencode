#!/bin/bash -p
# Usage: notify.sh <question|waiting|done|failure> <message> [pr]
set -euo pipefail
# shellcheck source=scripts/agent-harness/lib.sh
. "${BASH_SOURCE[0]%/*}/lib.sh"
kind="${1:-}" msg="${2:-}" pr="${3:-}"

{
  if [ -n "${ORCA_WORKTREE_ID:-}" ] && command -v "$ORCA" >/dev/null 2>&1; then
    args=(worktree set --worktree "id:$ORCA_WORKTREE_ID" --unread --comment "$kind: $msg")
    case "$kind" in
      done) args+=(--workspace-status completed) ;;
      question | failure) args+=(--workspace-status in-review) ;;
    esac
    [ -z "$pr" ] || args+=(--pr "$pr")
    "$ORCA" "${args[@]}" >/dev/null 2>&1 || true
  elif [ "${GITHUB_ACTIONS:-}" = true ] && [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
    echo "**$kind**: $msg" >>"$GITHUB_STEP_SUMMARY" || true
  fi
} || true
exit 0
