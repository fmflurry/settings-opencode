#!/bin/bash
# Notification hook: Claude Code needs permission or is waiting for input.
# Delegates delivery to the shared notify-gate (suppression + debounce).
INPUT=$(cat)
MSG=$(echo "$INPUT" | jq -r '.message // "Claude Code needs your attention"' 2>/dev/null)
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // empty' 2>/dev/null)

# Resolve the notify scripts dir: installed location first, repo-relative
# fallback last (so running out of the repo checkout still works).
NOTIFY_SCRIPTS_DIR="${NOTIFY_SCRIPTS_DIR:-}"
for _d in "$HOME/.claude/scripts" "$HOME/.config/opencode/scripts" "$(cd "$(dirname "${BASH_SOURCE[0]}")/../../scripts" 2>/dev/null && pwd)"; do
  [ -n "$NOTIFY_SCRIPTS_DIR" ] && break
  [ -f "$_d/notify-gate.sh" ] && NOTIFY_SCRIPTS_DIR="$_d"
done

CLASS=idle
echo "$MSG" | grep -qiE 'permission|approve|allow' && CLASS=permission

NOTIFY_GATE_SH="$NOTIFY_SCRIPTS_DIR/notify-gate.sh"
[ -f "$NOTIFY_GATE_SH" ] && "$NOTIFY_GATE_SH" claude-code Notification "$SESSION_ID" "$CLASS" "Claude Code" "$MSG"

exit 0
