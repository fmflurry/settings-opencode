#!/bin/bash
# SubagentStop Hook — decrement the in-flight subagent counter used by
# notify-gate.sh to suppress notifications while subagents are running.
#
# Deletes the OLDEST marker file in the session's inflight directory.
# Deliberately NOT id-matched: the SubagentStop payload's tool_use_id cannot
# be verified against the PreToolUse tool_use_id from this repo, so we pop
# one marker FIFO rather than risk a silent no-op that never decrements.

INPUT=$(cat 2>/dev/null)
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // empty' 2>/dev/null)

# Resolve the notify scripts dir: installed location first, repo-relative
# fallback last (so running out of the repo checkout still works).
NOTIFY_SCRIPTS_DIR="${NOTIFY_SCRIPTS_DIR:-}"
for _d in "$HOME/.claude/scripts" "$HOME/.config/opencode/scripts" "$(cd "$(dirname "${BASH_SOURCE[0]}")/../../scripts" 2>/dev/null && pwd)"; do
  [ -n "$NOTIFY_SCRIPTS_DIR" ] && break
  [ -f "$_d/notify-gate.sh" ] && NOTIFY_SCRIPTS_DIR="$_d"
done

NOTIFY_LOG_SH="$NOTIFY_SCRIPTS_DIR/notify-log.sh"
[ -f "$NOTIFY_LOG_SH" ] && source "$NOTIFY_LOG_SH"

STATE="${NOTIFY_STATE_DIR:-$HOME/.claude/state/notify}/$SESSION_ID"
INFLIGHT_DIR="$STATE/inflight"

if [ -d "$INFLIGHT_DIR" ]; then
  OLDEST=$(ls -t "$INFLIGHT_DIR" 2>/dev/null | tail -1)
  [ -n "$OLDEST" ] && rm -f "$INFLIGHT_DIR/$OLDEST" 2>/dev/null
fi

REMAINING=0
if [ -d "$INFLIGHT_DIR" ]; then
  REMAINING=$(find "$INFLIGHT_DIR" -mindepth 1 -maxdepth 1 2>/dev/null | wc -l | tr -d ' ')
fi

type notify_log >/dev/null 2>&1 && notify_log claude-code SubagentStop "$SESSION_ID" subagent "SUBAGENT_STOP:remaining=$REMAINING" "Subagent finished"

exit 0
