#!/bin/bash
# Notification hook: Claude Code needs permission or is waiting for input.
# Delegates the actual push to the shared OpenCode Bark sender.
INPUT=$(cat)
MSG=$(echo "$INPUT" | jq -r '.message // "Claude Code needs your attention"' 2>/dev/null)

NOTIFY_IPHONE="$HOME/Workspace/settings-opencode/scripts/notify-iphone.sh"
[ -x "$NOTIFY_IPHONE" ] || exit 0

# notify-iphone.sh needs BARK_DEVICE_KEY in env; load it if the hook env lacks it.
if [ -z "$BARK_DEVICE_KEY" ] && [ -f "$HOME/.config/zsh/50-env-secrets.zsh" ]; then
  # shellcheck disable=SC1090
  source "$HOME/.config/zsh/50-env-secrets.zsh" 2>/dev/null
  export BARK_DEVICE_KEY
fi

"$NOTIFY_IPHONE" "Claude Code" "$MSG" >/dev/null 2>&1 &
exit 0
