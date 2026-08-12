#!/bin/bash
# Shared append-only trigger logger for notification emitters.
# Log-only: never affects notification delivery. Meant to be sourced.
#
# Usage: notify_log <harness> <event> <session> <class> <decision> <title>
#
# Writes one TAB-separated line to "${NOTIFY_LOG:-$HOME/.claude/logs/notify.log}":
#   iso8601-ms  harness  event  session_id  class  decision  pid  ppid  inflight_count  title
#
# inflight_count is the number of entries in
# "${NOTIFY_STATE_DIR:-$HOME/.claude/state/notify}/<session>/inflight" (0 when absent).
#
# Always returns 0 — a failure here must never break the caller.

notify_log() {
  local harness="$1" event="$2" session="$3" class="$4" decision="$5" title="$6"

  {
    local log_file="${NOTIFY_LOG:-$HOME/.claude/logs/notify.log}"
    local state_dir="${NOTIFY_STATE_DIR:-$HOME/.claude/state/notify}"
    local max_lines="${NOTIFY_LOG_MAX_LINES:-5000}"

    mkdir -p "$(dirname "$log_file")"

    local inflight_dir="$state_dir/$session/inflight"
    local inflight_count=0
    if [ -d "$inflight_dir" ]; then
      inflight_count=$(find "$inflight_dir" -mindepth 1 -maxdepth 1 2>/dev/null | wc -l | tr -d ' ')
    fi

    local ts
    ts="$(date -u +%Y-%m-%dT%H:%M:%S).000Z"

    local clean_title
    clean_title=$(printf '%s' "$title" | tr -d '\t\n\r')

    printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
      "$ts" "$harness" "$event" "$session" "$class" "$decision" "$$" "$PPID" "$inflight_count" "$clean_title" \
      >> "$log_file"

    local line_count
    line_count=$(wc -l < "$log_file" | tr -d ' ')
    if [ -n "$line_count" ] && [ "$line_count" -gt "$max_lines" ]; then
      local keep=$((max_lines / 2))
      tail -n "$keep" "$log_file" > "${log_file}.tmp" && mv "${log_file}.tmp" "$log_file"
    fi
  } 2>/dev/null

  return 0
}
