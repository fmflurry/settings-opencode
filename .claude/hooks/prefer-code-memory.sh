#!/bin/bash
# PreToolUse nudge hook — code-memory first
# Emits a one-time-per-session model-facing reminder when Grep or Glob is invoked,
# nudging the agent to prefer mcp__code-memory__* tools for codebase exploration.
# NEVER blocks: always exits 0.

set -euo pipefail

# Read the full JSON payload from stdin
PAYLOAD="$(cat)"

# Extract session_id; degrade gracefully if jq is missing
SESSION_ID=""
if command -v jq >/dev/null 2>&1; then
  SESSION_ID="$(printf '%s' "$PAYLOAD" | jq -r '.session_id // empty' 2>/dev/null || true)"
fi

# Fall back to a fixed marker if session_id is empty (ensures at least one nudge per process)
if [[ -z "$SESSION_ID" ]]; then
  SESSION_ID="unknown-$$"
fi

MARKER_FILE="${TMPDIR:-/tmp}/cc-codememory-nudge-${SESSION_ID}"

# If the marker exists, this session already received the nudge — stay silent
if [[ -f "$MARKER_FILE" ]]; then
  exit 0
fi

# Create the marker so subsequent calls in the same session are silent
touch "$MARKER_FILE"

# Emit the model-facing nudge via hookSpecificOutput (additionalContext is injected into the prompt)
printf '%s\n' '{"hookSpecificOutput":{"hookEventName":"PreToolUse","additionalContext":"code-memory is the default for codebase exploration. When mcp__code-memory__* tools are connected, prefer codememory_retrieve / _definitions / _callers / _callees / _dependencies / _importers over Grep/Glob. Use Grep/Glob only for raw dir listing, filename globs, reading a known path, or when the project has no code-memory index."}}'

exit 0
