#!/usr/bin/env bash
set -euo pipefail

# OpenCode typically exposes the session transcript path or session id via env vars.
# Prefer transcript path if available; fall back to session id.
TRANSCRIPT_PATH="${OPENCODE_TRANSCRIPT_PATH:-}"
SESSION_ID="${OPENCODE_SESSION_ID:-}"

CONFIG="$HOME/.config/opencode/skills/continuous-learning/config.json"

if [[ -n "$TRANSCRIPT_PATH" && -f "$TRANSCRIPT_PATH" ]]; then
  node "$HOME/.config/opencode/skills/continuous-learning/bin/evaluate-session.js" \
    --config "$CONFIG" \
    --transcript "$TRANSCRIPT_PATH"
elif [[ -n "$SESSION_ID" ]]; then
  node "$HOME/.config/opencode/skills/continuous-learning/bin/evaluate-session.js" \
    --config "$CONFIG" \
    --session-id "$SESSION_ID"
else
  # Nothing to evaluate
  exit 0
fi
