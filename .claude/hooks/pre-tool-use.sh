#!/bin/bash
# PreToolUse Security Hook
# Validates tool usage before execution for security-sensitive operations
# This hook only warns - it does not execute any destructive commands

# Get the tool name from the hook environment
TOOL_NAME="${CLAUDE_TOOL_NAME:-}"

# Security checks for dangerous operations - WARNINGS ONLY
case "$TOOL_NAME" in
  Bash)
    # Check for potentially dangerous bash commands
    if [[ -n "${CLAUDE_TOOL_ARGS}" ]]; then
      # Warn about commands that might expose secrets
      if echo "${CLAUDE_TOOL_ARGS}" | grep -qiE "(\.env|secret|key|token|password).*\|(cat|less|more|print|echo)"; then
        echo "⚠️  Security: Potential secret exposure in command" >&2
        echo "Consider using environment variables instead" >&2
      fi

      # Warn about destructive operations (pattern matching, NOT execution)
      if echo "${CLAUDE_TOOL_ARGS}" | grep -qE "(overwrite|truncate)"; then
        echo "⚠️  Security: Destructive operation detected" >&2
      fi
    fi
    ;;

  Write|Edit)
    # Warn about writing to sensitive files
    SENSITIVE_PATHS=("\.env$" "secrets\." "\.key$" "\.pem$")
    FILE_PATH="${CLAUDE_FILE_PATH:-}"

    for pattern in "${SENSITIVE_PATHS[@]}"; do
      if echo "$FILE_PATH" | grep -qE "$pattern"; then
        echo "⚠️  Security: Writing to sensitive file pattern: $pattern" >&2
      fi
    done
    ;;
esac

# Task-marker increment: track in-flight subagents so notify-gate.sh can
# suppress notifications until the last dispatched subagent has stopped.
TASK_MARKER_INPUT=$(cat 2>/dev/null)
TASK_MARKER_TOOL_NAME=$(echo "$TASK_MARKER_INPUT" | jq -r '.tool_name // empty' 2>/dev/null)
if [ "$TASK_MARKER_TOOL_NAME" = "Task" ]; then
  TASK_MARKER_SESSION_ID=$(echo "$TASK_MARKER_INPUT" | jq -r '.session_id // empty' 2>/dev/null)
  TASK_MARKER_USE_ID=$(echo "$TASK_MARKER_INPUT" | jq -r '.tool_use_id // empty' 2>/dev/null)
  [ -n "$TASK_MARKER_USE_ID" ] || TASK_MARKER_USE_ID="$(date +%s%N)-$$"
  TASK_MARKER_STATE="${NOTIFY_STATE_DIR:-$HOME/.claude/state/notify}/$TASK_MARKER_SESSION_ID"
  mkdir -p "$TASK_MARKER_STATE/inflight" 2>/dev/null
  touch "$TASK_MARKER_STATE/inflight/$TASK_MARKER_USE_ID" 2>/dev/null
fi

exit 0
