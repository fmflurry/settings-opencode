#!/bin/bash
# Stop Hook - Notification + Session Verification + Auto-Compact
# Runs when Claude Code stops and waits for user input

# Read hook input from stdin
INPUT=$(cat)
TRANSCRIPT_PATH=$(echo "$INPUT" | jq -r '.transcript_path // empty' 2>/dev/null)

# Auto-compact: check if Claude is asking about compacting the conversation
if [ -n "$TRANSCRIPT_PATH" ] && [ -f "$TRANSCRIPT_PATH" ]; then
  LAST_CONTENT=$(tail -c 8000 "$TRANSCRIPT_PATH" 2>/dev/null)
  if echo "$LAST_CONTENT" | grep -qi \
    -e "compact" \
    -e "context.*running low" \
    -e "running low.*context" \
    -e "context window" \
    -e "conversation.*long" \
    -e "summarize.*conversation" \
    -e "should I summarize"; then
    # Auto-answer yes - tell Claude to proceed with compaction
    echo '{"continue":true}'
    echo "Auto-compact: automatically continuing with compaction" >&2
    exit 0
  fi
fi

# macOS notification when attention is required
osascript -e 'display notification "Your attention is required" with title "Claude Code" sound name "Glass"' 2>/dev/null &

# Check for uncommitted secrets (warn only)
if git rev-parse --git-dir > /dev/null 2>&1; then
  if git diff --name-only 2>/dev/null | grep -qE "\.env$|secrets\."; then
    echo "⚠️  Warning: Uncommitted sensitive files detected" >&2
  fi
fi

# Check for console.log statements in TypeScript/JavaScript (warn only)
if git rev-parse --git-dir > /dev/null 2>&1; then
  CONSOLE_LOGS=$(git diff --cached 2>/dev/null | grep -c "console\.log" || true)
  if [ "$CONSOLE_LOGS" -gt 0 ]; then
    echo "⚠️  Warning: $CONSOLE_LOGS console.log statements in staged changes" >&2
  fi
fi

exit 0
