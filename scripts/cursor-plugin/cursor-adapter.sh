#!/usr/bin/env bash
set -u

SCRIPT="${1:-}"
EVENT="${2:-}"

allow_and_exit() {
  case "$EVENT" in
    preToolUse|beforeShellExecution) printf '{"permission":"allow"}\n' ;;
    *) printf '{}\n' ;;
  esac
  exit 0
}

INPUT="$(cat 2>/dev/null || true)"

command -v jq >/dev/null 2>&1 || allow_and_exit
[ -n "$SCRIPT" ] && [ -f "$SCRIPT" ] || allow_and_exit
case "$SCRIPT" in
  *rtk-rewrite.sh) command -v rtk >/dev/null 2>&1 || allow_and_exit ;;
esac

case "$EVENT" in
  beforeShellExecution)
    PAYLOAD="$(printf '%s' "$INPUT" | jq -ce '{
      session_id: (.conversation_id // ""), cwd: (.cwd // ""), hook_event_name: "PreToolUse",
      tool_name: "Bash", tool_use_id: "", tool_input: {command: (.command // "")}
    }' 2>/dev/null)" || allow_and_exit ;;
  preToolUse)
    PAYLOAD="$(printf '%s' "$INPUT" | jq -ce '{
      session_id: (.conversation_id // ""), cwd: (.cwd // ""), hook_event_name: "PreToolUse",
      tool_name: ((.tool_name // "") | if . == "Shell" then "Bash" else sub("^MCP:"; "") end),
      tool_use_id: (.tool_use_id // ""), tool_input: (.tool_input // {})
    }' 2>/dev/null)" || allow_and_exit ;;
  stop|subagentStop)
    PAYLOAD="$(printf '%s' "$INPUT" | jq -ce --arg ev "$EVENT" '{
      session_id: (.conversation_id // ""), transcript_path: (.transcript_path // ""),
      hook_event_name: (if $ev == "stop" then "Stop" else "SubagentStop" end),
      stop_hook_active: ((.loop_count // 0) > 0)
    }' 2>/dev/null)" || allow_and_exit ;;
  *) allow_and_exit ;;
esac
[ -n "$PAYLOAD" ] || allow_and_exit

CLAUDE_TOOL_NAME="$(printf '%s' "$PAYLOAD" | jq -r '.tool_name // empty' 2>/dev/null)"
CLAUDE_TOOL_ARGS="$(printf '%s' "$PAYLOAD" | jq -c '.tool_input // empty' 2>/dev/null)"
CLAUDE_FILE_PATH="$(printf '%s' "$PAYLOAD" | jq -r '.tool_input.file_path // .tool_input.path // empty' 2>/dev/null)"
export CLAUDE_TOOL_NAME CLAUDE_TOOL_ARGS CLAUDE_FILE_PATH

ERR_FILE="$(mktemp 2>/dev/null)" || allow_and_exit
OUT="$(printf '%s' "$PAYLOAD" | bash "$SCRIPT" 2>"$ERR_FILE")"
RC=$?
ERR="$(cat "$ERR_FILE" 2>/dev/null)"
rm -f "$ERR_FILE"

case "$EVENT" in
  stop|subagentStop)
    jq -nc --arg out "$OUT" '
      ($out | try fromjson catch {}) | if type == "object" then . else {} end
      | if (.followup_message // "") != "" then {followup_message}
        elif .decision == "block" and (.reason // "") != "" then {followup_message: .reason}
        else {} end' 2>/dev/null || printf '{}\n'
    exit 0 ;;
esac

if [ "$RC" -eq 2 ]; then
  jq -nc --arg m "${ERR:-Blocked by harness hook}" '{permission: "deny", user_message: $m, agent_message: $m}' 2>/dev/null \
    || printf '{"permission":"deny"}\n'
  exit 0
fi
[ "$RC" -eq 0 ] || allow_and_exit

jq -nc --arg out "$OUT" --arg err "$ERR" --arg ev "$EVENT" '
  ($out | try fromjson catch {}) | if type == "object" then . else {} end
  | (.hookSpecificOutput // {}) as $h
  | ([$h.additionalContext, $err] | map(select(. != null and . != "")) | join("\n")) as $msg
  | ($h.permissionDecision == "deny") as $deny
  | {permission: (if $deny then "deny" else "allow" end)}
    + (if $deny then {user_message: ($h.permissionDecisionReason // $msg)} else {} end)
    + (if $msg != "" then {agent_message: $msg} else {} end)
    + (if $ev == "preToolUse" and ($h.updatedInput | type) == "object" then {updated_input: $h.updatedInput} else {} end)
' 2>/dev/null || allow_and_exit
