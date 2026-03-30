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

exit 0
