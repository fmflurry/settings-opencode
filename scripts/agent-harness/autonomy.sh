#!/bin/bash -p
# Usage: autonomy.sh on|off|status
set -euo pipefail
# shellcheck source=scripts/agent-harness/lib.sh
. "${BASH_SOURCE[0]%/*}/lib.sh"

exclude_state_dir() {
  [ "$STATE_DIR" = "$DEFAULT_STATE_DIR" ] || return 0
  git -C "$ROOT" rev-parse --git-dir >/dev/null 2>&1 || return 0
  git -C "$ROOT" check-ignore -q .claude/state/autonomy.on && return 0
  local file
  file="$(git -C "$ROOT" rev-parse --path-format=absolute --git-path info/exclude)"
  grep -Fxq '.claude/state/' "$file" 2>/dev/null && return 0
  mkdir -p "$(dirname "$file")"
  echo '.claude/state/' >>"$file"
}

case "${1:-status}" in
  on) mkdir -p "$STATE_DIR" && : >"$STATE_DIR/autonomy.on"; exclude_state_dir; echo "autonomy: on" ;;
  off) rm -f "$STATE_DIR/autonomy.on"; echo "autonomy: off" ;;
  status) if autonomy_on; then echo "autonomy: on"; else echo "autonomy: off"; fi ;;
  *) echo "usage: autonomy.sh on|off|status" >&2; exit 2 ;;
esac
