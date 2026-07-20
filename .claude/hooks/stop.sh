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

# Guard against duplicate fires within the same turn (see anthropics/claude-code#54360:
# Stop can re-invoke with stop_hook_active=true when a prior Stop hook caused continuation).
STOP_HOOK_ACTIVE=$(echo "$INPUT" | jq -r '.stop_hook_active // false' 2>/dev/null)
if [ "$STOP_HOOK_ACTIVE" = "true" ]; then
  exit 0
fi

# macOS notification when attention is required
osascript -e 'display notification "Your attention is required" with title "Claude Code" sound name "Glass"' 2>/dev/null &
# Push to iPhone via Bark (shared OpenCode sender)
NOTIFY_IPHONE="$HOME/Workspace/settings-opencode/scripts/notify-iphone.sh"
if [ -x "$NOTIFY_IPHONE" ]; then
  if [ -z "$BARK_DEVICE_KEY" ] && [ -f "$HOME/.config/zsh/50-env-secrets.zsh" ]; then
    # shellcheck disable=SC1090
    source "$HOME/.config/zsh/50-env-secrets.zsh" 2>/dev/null
    export BARK_DEVICE_KEY
  fi
  "$NOTIFY_IPHONE" "Claude Code" "Task done — your attention is required" >/dev/null 2>&1 &
fi

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
