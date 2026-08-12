#!/bin/bash
# notify-gate.sh — single delivery gate for Claude Code hook notifications.
#
# Suppresses delivery while subagents are in flight (except class=permission,
# which always delivers immediately) and debounces bursts of the same session.
# Always exits 0 — a gate failure must never break the calling hook.
#
# Usage: notify-gate.sh <harness> <event> <session> <class> <title> <body>
#
# Env:
#   NOTIFY_STATE_DIR             default $HOME/.claude/state/notify
#   NOTIFY_INFLIGHT_TTL_SECONDS  default 900 (stale inflight marker prune window)
#   NOTIFY_DEBOUNCE_SECONDS      default 90
#   NOTIFY_DESKTOP=1             also emit an osascript desktop notification

HARNESS="$1"
EVENT="$2"
SESSION="$3"
CLASS="$4"
TITLE="$5"
BODY="$6"

_gate_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd)"
NOTIFY_LOG_SH="${NOTIFY_LOG_SH:-$_gate_dir/notify-log.sh}"
[ -f "$NOTIFY_LOG_SH" ] && source "$NOTIFY_LOG_SH"

STATE="${NOTIFY_STATE_DIR:-$HOME/.claude/state/notify}/$SESSION"
INFLIGHT_DIR="$STATE/inflight"
TTL="${NOTIFY_INFLIGHT_TTL_SECONDS:-900}"
DEBOUNCE="${NOTIFY_DEBOUNCE_SECONDS:-90}"

mkdir -p "$STATE" 2>/dev/null

# Portable mtime-epoch lookup: BSD stat (macOS) vs GNU stat (Linux).
file_mtime_epoch() {
  stat -f %m "$1" 2>/dev/null || stat -c %Y "$1" 2>/dev/null
}

# 1. Prune stale inflight markers. Mandatory: without this a crashed subagent
#    (one that never fires SubagentStop) mutes notifications forever.
if [ -d "$INFLIGHT_DIR" ]; then
  NOW=$(date +%s)
  for marker in "$INFLIGHT_DIR"/*; do
    [ -e "$marker" ] || continue
    MTIME=$(file_mtime_epoch "$marker")
    if [ -n "$MTIME" ] && [ $(( NOW - MTIME )) -gt "$TTL" ]; then
      rm -f "$marker" 2>/dev/null
    fi
  done
fi

# 2. Count remaining inflight markers.
INFLIGHT=0
if [ -d "$INFLIGHT_DIR" ]; then
  INFLIGHT=$(find "$INFLIGHT_DIR" -mindepth 1 -maxdepth 1 2>/dev/null | wc -l | tr -d ' ')
fi

# 3. Suppress non-permission notifications while subagents are in flight.
if [ "$INFLIGHT" -gt 0 ] && [ "$CLASS" != "permission" ]; then
  type notify_log >/dev/null 2>&1 && notify_log "$HARNESS" "$EVENT" "$SESSION" "$CLASS" "SUPPRESSED:subagents-inflight" "$TITLE"
  exit 0
fi

# 4. Debounce bursts.
LAST_SENT="$STATE/last-sent"
if [ -f "$LAST_SENT" ]; then
  NOW=$(date +%s)
  LAST_MTIME=$(file_mtime_epoch "$LAST_SENT")
  if [ -n "$LAST_MTIME" ] && [ $(( NOW - LAST_MTIME )) -lt "$DEBOUNCE" ]; then
    type notify_log >/dev/null 2>&1 && notify_log "$HARNESS" "$EVENT" "$SESSION" "$CLASS" "SUPPRESSED:debounce" "$TITLE"
    exit 0
  fi
fi

# 5. Deliver. Best-effort lock (flock is unavailable on stock macOS; mkdir is
#    the atomic primitive there) — non-fatal if it can't be acquired.
LOCK="$STATE/.lock"
LOCKED=0
for _ in 1 2 3 4 5; do
  if mkdir "$LOCK" 2>/dev/null; then
    LOCKED=1
    break
  fi
  sleep 0.1
done
[ "$LOCKED" -eq 1 ] && trap 'rmdir "$LOCK" 2>/dev/null' EXIT

touch "$LAST_SENT" 2>/dev/null
type notify_log >/dev/null 2>&1 && notify_log "$HARNESS" "$EVENT" "$SESSION" "$CLASS" SENT "$TITLE"

osascript_escape() {
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

if [ "${NOTIFY_DESKTOP:-0}" = "1" ]; then
  ESC_TITLE=$(osascript_escape "$TITLE")
  ESC_BODY=$(osascript_escape "$BODY")
  osascript -e "display notification \"$ESC_BODY\" with title \"$ESC_TITLE\" sound name \"Glass\"" 2>/dev/null &
fi

# Push to iPhone via Bark (shared OpenCode sender). BARK_DEVICE_KEY sourcing
# lives here only — both hooks now delegate delivery to this one file.
NOTIFY_IPHONE="$_gate_dir/notify-iphone.sh"
if [ -x "$NOTIFY_IPHONE" ]; then
  if [ -z "$BARK_DEVICE_KEY" ] && [ -f "$HOME/.config/zsh/50-env-secrets.zsh" ]; then
    # shellcheck disable=SC1090
    source "$HOME/.config/zsh/50-env-secrets.zsh" 2>/dev/null
    export BARK_DEVICE_KEY
  fi
  "$NOTIFY_IPHONE" "$TITLE" "$BODY" >/dev/null 2>&1 &
fi

exit 0
