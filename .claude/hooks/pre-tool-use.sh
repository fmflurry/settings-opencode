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
case "$TASK_MARKER_TOOL_NAME" in
  Task|Agent)
    TASK_MARKER_SESSION_ID=$(echo "$TASK_MARKER_INPUT" | jq -r '.session_id // empty' 2>/dev/null)
    TASK_MARKER_USE_ID=$(echo "$TASK_MARKER_INPUT" | jq -r '.tool_use_id // empty' 2>/dev/null)
    [ -n "$TASK_MARKER_USE_ID" ] || TASK_MARKER_USE_ID="$(date +%s%N)-$$"
    TASK_MARKER_STATE="${NOTIFY_STATE_DIR:-$HOME/.claude/state/notify}/$TASK_MARKER_SESSION_ID"
    mkdir -p "$TASK_MARKER_STATE/inflight" 2>/dev/null
    touch "$TASK_MARKER_STATE/inflight/$TASK_MARKER_USE_ID" 2>/dev/null
    ;;
esac

KPI_SH="${BASH_SOURCE[0]%/*}/kpi-emit.sh"
KPI_TOOL="${TASK_MARKER_TOOL_NAME:-$TOOL_NAME}"
if [ -n "$KPI_TOOL" ] && [ -f "$KPI_SH" ]; then
  KPI_SESSION="$(printf '%s' "${TASK_MARKER_INPUT:-}" | jq -r '.session_id // empty' 2>/dev/null || true)"
  KPI_SKILL=""
  KPI_AGENT=""
  case "$KPI_TOOL" in
    Skill|skill|use_skill|load_skill)
      KPI_SKILL="$(printf '%s' "${TASK_MARKER_INPUT:-}" | jq -r '
        def text: if type == "string" then . else "" end;
        ((.tool_input.skill // .tool_input.skill_name // .tool_input.name // .skill // "") | text) as $n
        | ((.tool_input.command // .command // "") | text | sub("^/+"; "")) as $c
        | (if $n != "" then $n else $c end | ascii_downcase) as $s
        | if ($s | test("^[a-z0-9:-]{1,64}$")) then $s else "" end
      ' 2>/dev/null || true)"
      ;;
    Task|Agent|task|agent)
      KPI_AGENT="$(printf '%s' "${TASK_MARKER_INPUT:-}" | jq -r '
        (.tool_input.subagent_type // .tool_input.agent_type // .subagent_type // .agent_type // .tool_input.agent // "")
        | if type == "string" and test("^[A-Za-z0-9._:-]{1,64}$") then . else "" end
      ' 2>/dev/null || true)"
      ;;
  esac
  KPI_ARGS=(tool_call "tool_name=$KPI_TOOL")
  [ -n "$KPI_SESSION" ] && KPI_ARGS+=("session=$KPI_SESSION")
  [ -n "$KPI_SKILL" ] && KPI_ARGS+=("skill=$KPI_SKILL")
  [ -n "$KPI_AGENT" ] && KPI_ARGS+=("agent=$KPI_AGENT")
  "$KPI_SH" "${KPI_ARGS[@]}" >/dev/null 2>&1 || true
  case "$KPI_TOOL" in
    Task|Agent|task|agent)
      KPI_ARGS[0]=subagent_spawn
      "$KPI_SH" "${KPI_ARGS[@]}" >/dev/null 2>&1 || true
      ;;
  esac
fi

exit 0
