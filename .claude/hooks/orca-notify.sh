#!/usr/bin/env bash
set -u
input="$(cat)"
NOTIFY="${AGENT_HARNESS_DIR:-$HOME/.claude/scripts/agent-harness}/notify.sh"
case "$(jq -r '.notification_type // ""' <<<"$input" 2>/dev/null)" in
  permission_prompt | idle_prompt)
    bash "$NOTIFY" waiting "$(jq -r '.message // "waiting for input"' <<<"$input")" || true ;;
esac
exit 0
