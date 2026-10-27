#!/usr/bin/env bash
# Append one local KPI event as a single JSON line. Silent and fail-open.
# Never logs prompts, tool arguments, secrets, or absolute paths.
# AGENT_HARNESS_KPI=0 disables writes. The harness test suite sets that.
# AGENT_HARNESS_TEST=1 skips the default log unless AGENT_HARNESS_KPI_LOG is set.
set +e
[ "${AGENT_HARNESS_KPI:-}" = "0" ] && exit 0
if [ "${AGENT_HARNESS_TEST:-}" = "1" ] && [ -z "${AGENT_HARNESS_KPI_LOG:-}" ]; then
  exit 0
fi
command -v jq >/dev/null 2>&1 || exit 0

HARNESS_VERSION="${AGENT_HARNESS_VERSION:-0.4.21}"

log="${AGENT_HARNESS_KPI_LOG:-}"
if [ -z "$log" ]; then
  [ -n "${HOME:-}" ] || exit 0
  log="$HOME/.agent-harness/kpi/events.jsonl"
fi

short_hash() {
  if command -v sha256sum >/dev/null 2>&1; then
    printf '%s' "$1" | sha256sum | awk '{print substr($1,1,12)}'
  elif command -v shasum >/dev/null 2>&1; then
    printf '%s' "$1" | shasum -a 256 | awk '{print substr($1,1,12)}'
  else
    printf 'unknown'
  fi
}

safe_token() {
  if [[ "$1" =~ ^[A-Za-z0-9._:@+-]+$ ]] && [ "${#1}" -le 200 ]; then
    printf '%s' "$1"
  elif [ -n "$1" ]; then
    short_hash "$1"
  fi
}

read_variant() {
  local f v base
  if [ -n "${AGENT_HARNESS_VARIANT:-}" ]; then
    v="$(printf '%s' "$AGENT_HARNESS_VARIANT" | tr '[:upper:]' '[:lower:]' | tr -d '[:space:]')"
    case "$v" in
      conductor|orchestration) printf conductor; return ;;
      monolith) printf monolith; return ;;
    esac
  fi
  base="${HOME:-}"
  for f in \
    "${AGENT_HARNESS_VARIANT_FILE:-}" \
    "${PWD:-}/.harness-variant" \
    "${PWD:-}/.claude/.harness-variant" \
    "${PWD:-}/.opencode/.harness-variant" \
    "${CLAUDE_PROJECT_DIR:-}/.harness-variant" \
    "${CLAUDE_PROJECT_DIR:-}/.claude/.harness-variant" \
    "${CLAUDE_PROJECT_DIR:-}/.opencode/.harness-variant" \
    "$base/.claude/.harness-variant" \
    "$base/.config/opencode/.harness-variant"
  do
    [ -n "$f" ] && [ -f "$f" ] || continue
    v="$(tr -d '[:space:]' <"$f" 2>/dev/null | tr '[:upper:]' '[:lower:]')"
    case "$v" in
      conductor|orchestration) printf conductor; return ;;
      monolith) printf monolith; return ;;
    esac
  done
  printf unknown
}

read_tool() {
  case "${AGENT_HARNESS_TOOL:-}" in
    opencode|claude|cursor) printf '%s' "$AGENT_HARNESS_TOOL"; return ;;
  esac
  if [ -n "${CURSOR_PLUGIN_ROOT:-}${CURSOR_PROJECT_DIR:-}${CURSOR_SESSION_ID:-}" ]; then
    printf cursor
  elif [ -n "${OPENCODE:-}${OPENCODE_CLIENT:-}" ]; then
    printf opencode
  else
    printf claude
  fi
}

read_repo() {
  local root remote slug
  root="$(git rev-parse --show-toplevel 2>/dev/null)" || { printf unknown; return; }
  remote="$(git -C "$root" remote get-url origin 2>/dev/null || true)"
  if [ -n "$remote" ]; then
    slug="$(printf '%s' "$remote" | sed -E 's#^[A-Za-z][A-Za-z0-9+.-]*://##; s#^[^@]+@##; s#:[0-9]+/#/#; s#\.git$##; s#^[^/:]+[:/]##')"
    if [[ "$slug" =~ ^[A-Za-z0-9._-]+/[A-Za-z0-9._-]+$ ]]; then
      printf '%s' "$slug"
      return
    fi
  fi
  slug="$(basename "$root")"
  if [[ "$slug" =~ ^[A-Za-z0-9._-]+$ ]]; then
    printf '%s' "$slug"
  else
    short_hash "$root"
  fi
}

read_branch() {
  local b
  b="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
  if [[ "$b" =~ ^[A-Za-z0-9._/-]+$ ]] && [ "${#b}" -le 200 ]; then
    printf '%s' "$b"
  else
    printf unknown
  fi
}

num_or_blank() {
  case "$1" in
    ''|null) ;;
    [0-9]*) [[ "$1" =~ ^[0-9]+$ ]] && printf '%s' "$1" ;;
  esac
}

bool_or_blank() {
  case "$1" in
    true|false) printf '%s' "$1" ;;
  esac
}

kind="" session="" tool_name="" guard="" outcome="" pr="" review="" verdict=""
important="" nit="" pre_existing="" fix_iterations="" task="" task_kind="" pass=""
mode="" tool_calls="" tokens="" wall_ms="" source="" ci_first_pass="" review_rounds=""
time_to_merge_ms="" reverted_within_7d="" also_spawn=""

take_pair() {
  local key="${1%%=*}" val="${1#*=}"
  [ "$key" != "$1" ] || return 0
  case "$key" in
    session) session="$val" ;;
    tool_name) tool_name="$val" ;;
    guard) guard="$val" ;;
    outcome) outcome="$val" ;;
    pr) pr="$(num_or_blank "$val")" ;;
    review) review="$val" ;;
    verdict) verdict="$val" ;;
    important) important="$(num_or_blank "$val")" ;;
    nit) nit="$(num_or_blank "$val")" ;;
    pre_existing) pre_existing="$(num_or_blank "$val")" ;;
    fix_iterations) fix_iterations="$(num_or_blank "$val")" ;;
    task) task="$val" ;;
    task_kind) task_kind="$val" ;;
    pass) pass="$(bool_or_blank "$val")" ;;
    mode) mode="$val" ;;
    tool_calls) tool_calls="$(num_or_blank "$val")" ;;
    tokens) tokens="$(num_or_blank "$val")" ;;
    wall_ms) wall_ms="$(num_or_blank "$val")" ;;
    source) source="$val" ;;
    ci_first_pass) ci_first_pass="$(bool_or_blank "$val")" ;;
    review_rounds) review_rounds="$(num_or_blank "$val")" ;;
    time_to_merge_ms) time_to_merge_ms="$(num_or_blank "$val")" ;;
    reverted_within_7d) reverted_within_7d="$(bool_or_blank "$val")" ;;
  esac
}

if [ $# -eq 0 ]; then
  payload="$(cat 2>/dev/null || true)"
  [ -n "$payload" ] || exit 0
  printf '%s' "$payload" | jq -e 'type == "object"' >/dev/null 2>&1 || exit 0
  event="$(printf '%s' "$payload" | jq -r '.hook_event_name // empty' 2>/dev/null || true)"
  case "$event" in
    SessionStart) kind=session_start ;;
    Stop) kind=session_end ;;
    SubagentStop) kind=subagent_stop ;;
    PreToolUse) kind=tool_call ;;
    *) exit 0 ;;
  esac
  session="$(printf '%s' "$payload" | jq -r '.session_id // .conversation_id // .sessionID // empty' 2>/dev/null || true)"
  tool_name="$(printf '%s' "$payload" | jq -r '.tool_name // empty' 2>/dev/null || true)"
  source="$(printf '%s' "$payload" | jq -r '.source // empty' 2>/dev/null || true)"
  tokens="$(printf '%s' "$payload" | jq -r '
    def num: if type == "number" and . >= 0 and . < 1000000000000 then floor else null end;
    (.tokens | num) as $t
    | (.token_count | num) as $c
    | ((.usage.input_tokens // .input_tokens) | num) as $i
    | ((.usage.output_tokens // .output_tokens) | num) as $o
    | if $t != null then $t
      elif $c != null then $c
      elif $i != null or $o != null then (($i // 0) + ($o // 0))
      else empty end
  ' 2>/dev/null || true)"
  case "$tool_name" in
    Task|Agent) also_spawn=1 ;;
  esac
else
  kind="$1"
  shift
  for pair in "$@"; do
    take_pair "$pair"
  done
fi

case "$kind" in
  session_start|session_end|tool_call|subagent_spawn|subagent_stop|guard_block|review_round|fix_round|ship|pr_open|eval_result|pr_outcome) ;;
  *) exit 0 ;;
esac

case "$guard" in
  git|ask|secret|budget) ;;
  *) guard="" ;;
esac
case "$outcome" in
  merged|blocked|escalated|open) ;;
  *) outcome="" ;;
esac
case "$review" in
  code|security) ;;
  *) review="" ;;
esac
case "$verdict" in
  pass|fail) ;;
  *) verdict="" ;;
esac
case "$mode" in
  checker|model) ;;
  *) mode="" ;;
esac
case "$source" in
  startup|resume|clear|compact) ;;
  *) source="" ;;
esac
if [[ ! "$tool_name" =~ ^[A-Za-z0-9._:-]+$ ]] || [ "${#tool_name}" -gt 64 ]; then tool_name=""; fi
if [[ ! "$task" =~ ^[A-Za-z0-9._-]+$ ]] || [ "${#task}" -gt 80 ]; then task=""; fi
if [[ ! "$task_kind" =~ ^[A-Za-z0-9._-]+$ ]] || [ "${#task_kind}" -gt 40 ]; then task_kind=""; fi

session="$(safe_token "$session")"
[ -n "$session" ] || session=unknown
variant="$(read_variant)"
tool="$(read_tool)"
repo="$(read_repo)"
branch="$(read_branch)"
ts="$(date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || true)"
[ -n "$ts" ] || exit 0

write_event() {
  local line
  line="$(jq -nc \
    --arg ts "$ts" --arg kind "$1" --arg variant "$variant" --arg ver "$HARNESS_VERSION" \
    --arg tool "$tool" --arg repo "$repo" --arg branch "$branch" --arg session "$session" \
    --arg tokens "$tokens" --arg tool_name "$tool_name" --arg guard "$guard" --arg outcome "$outcome" \
    --arg pr "$pr" --arg review "$review" --arg verdict "$verdict" --arg important "$important" \
    --arg nit "$nit" --arg pre_existing "$pre_existing" --arg fix_iterations "$fix_iterations" \
    --arg task "$task" --arg task_kind "$task_kind" --arg pass "$pass" --arg mode "$mode" \
    --arg tool_calls "$tool_calls" --arg wall_ms "$wall_ms" --arg source "$source" \
    --arg ci_first_pass "$ci_first_pass" --arg review_rounds "$review_rounds" \
    --arg time_to_merge_ms "$time_to_merge_ms" --arg reverted_within_7d "$reverted_within_7d" '
      def num($s): if $s == "" then null else ($s | tonumber) end;
      def flag($s): if $s == "true" then true elif $s == "false" then false else null end;
      def keep($s): if $s == "" then empty else $s end;
      {
        ts: $ts, kind: $kind, variant: $variant, harness_version: $ver, tool: $tool,
        repo: $repo, branch: $branch, session_id: $session, tokens: num($tokens)
      }
      + (if $tool_name == "" then {} else {tool_name: $tool_name} end)
      + (if $guard == "" then {} else {guard: $guard} end)
      + (if $outcome == "" then {} else {outcome: $outcome} end)
      + (if $pr == "" then {} else {pr: num($pr)} end)
      + (if $review == "" then {} else {review: $review} end)
      + (if $verdict == "" then {} else {verdict: $verdict} end)
      + (if $important == "" and $nit == "" and $pre_existing == "" then {} else {
          important: num($important), nit: num($nit), pre_existing: num($pre_existing)
        } end)
      + (if $fix_iterations == "" then {} else {fix_iterations: num($fix_iterations)} end)
      + (if $task == "" then {} else {task: $task} end)
      + (if $task_kind == "" then {} else {task_kind: $task_kind} end)
      + (if $pass == "" then {} else {pass: flag($pass)} end)
      + (if $mode == "" then {} else {mode: $mode} end)
      + (if $tool_calls == "" then {} else {tool_calls: num($tool_calls)} end)
      + (if $wall_ms == "" then {} else {wall_ms: num($wall_ms)} end)
      + (if $source == "" then {} else {source: $source} end)
      + (if $ci_first_pass == "" then {} else {ci_first_pass: flag($ci_first_pass)} end)
      + (if $review_rounds == "" then {} else {review_rounds: num($review_rounds)} end)
      + (if $time_to_merge_ms == "" then {} else {time_to_merge_ms: num($time_to_merge_ms)} end)
      + (if $reverted_within_7d == "" then {} else {reverted_within_7d: flag($reverted_within_7d)} end)
    ' 2>/dev/null)" || return 0
  [ -n "$line" ] || return 0
  printf '%s\n' "$line"
}

mkdir -p "$(dirname "$log")" 2>/dev/null || exit 0
{
  write_event "$kind"
  if [ "$also_spawn" = 1 ]; then
    kind=subagent_spawn
    write_event subagent_spawn
  fi
} >>"$log" 2>/dev/null || exit 0
exit 0
