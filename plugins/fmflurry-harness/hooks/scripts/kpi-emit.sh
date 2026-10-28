#!/usr/bin/env bash
# Append one local KPI event as a single JSON line. Silent and fail-open.
# Never logs prompts, tool arguments, secrets, or absolute paths.
# skill matches ^[a-z0-9:-]{1,64}$. agent matches ^[A-Za-z0-9._:-]{1,64}$.
# tool_result carries tool_name, duration_ms, and ok.
# Claude session_end sums input_tokens and output_tokens from transcript_path
# (files over 8 MiB are skipped). Cursor stdin usage and transcripts are ignored.
# AGENT_HARNESS_KPI=0 disables writes. The harness test suite sets that.
# AGENT_HARNESS_TEST=1 skips the default log unless AGENT_HARNESS_KPI_LOG is set.
set +e
[ "${AGENT_HARNESS_KPI:-}" = "0" ] && exit 0
if [ "${AGENT_HARNESS_TEST:-}" = "1" ] && [ -z "${AGENT_HARNESS_KPI_LOG:-}" ]; then
  exit 0
fi
command -v jq >/dev/null 2>&1 || exit 0

HARNESS_VERSION="${AGENT_HARNESS_VERSION:-0.4.28}"
TRANSCRIPT_MAX=8388608

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

sum_usage() {
  local f="$1" size summed
  [ -n "$f" ] && [ -f "$f" ] && [ -r "$f" ] || return 0
  case "$f" in
    *$'\n'*) return 0 ;;
  esac
  size="$(wc -c <"$f" 2>/dev/null | tr -d '[:space:]')"
  [[ "$size" =~ ^[0-9]+$ ]] || return 0
  [ "$size" -le "$TRANSCRIPT_MAX" ] || return 0
  summed="$(jq -n -R -r '
    def num: if type == "number" and . >= 0 and . < 1000000000000 then floor else null end;
    [ inputs | fromjson? | (.message.usage // .usage // empty)
      | ((.input_tokens // .input) | num) as $i
      | ((.output_tokens // .output) | num) as $o
      | select($i != null or $o != null)
      | (($i // 0) + ($o // 0))
    ] | if length == 0 then empty else add end
  ' -- "$f" 2>/dev/null | head -n 1)"
  [[ "$summed" =~ ^[0-9]+$ ]] && printf '%s' "$summed"
}

agent_from_chunk() {
  local mode="$1"
  jq -n -R -r --arg mode "$mode" '
    def ok: if type == "string" and test("^[A-Za-z0-9._:-]{1,64}$") then . else empty end;
    [ inputs | fromjson?
      | (.subagent_type // .agent_type // .agentType // empty | ok),
        (.message.subagent_type // .message.agent_type // .message.agentType // empty | ok),
        (.message.content[]?
          | select(.type == "tool_use" and (((.name // "") | ascii_downcase) == "agent" or ((.name // "") | ascii_downcase) == "task"))
          | (.input.subagent_type // .input.agent_type // .input.agent // empty) | ok)
    ] | if length == 0 then empty elif $mode == "head" then .[0] else .[-1] end
  '
}

agent_from_file() {
  local f="$1" mode="$2" chunk
  [ -n "$f" ] && [ -f "$f" ] && [ -r "$f" ] || return 0
  case "$f" in
    *$'\n'*) return 0 ;;
  esac
  if [ "$mode" = "head" ]; then
    chunk="$(head -c 65536 -- "$f" 2>/dev/null || true)"
  else
    chunk="$(tail -c 262144 -- "$f" 2>/dev/null || true)"
  fi
  [ -n "$chunk" ] || return 0
  printf '%s\n' "$chunk" | agent_from_chunk "$mode" 2>/dev/null | head -n 1
}

kind="" session="" tool_name="" guard="" outcome="" pr="" review="" verdict=""
important="" nit="" pre_existing="" fix_iterations="" task="" task_kind="" pass=""
mode="" tool_calls="" tokens="" wall_ms="" source="" ci_first_pass="" review_rounds=""
time_to_merge_ms="" reverted_within_7d="" also_spawn="" skill="" agent=""
duration_ms="" ok=""

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
    skill) skill="$val" ;;
    agent) agent="$val" ;;
    duration_ms) duration_ms="$(num_or_blank "$val")" ;;
    ok) ok="$(bool_or_blank "$val")" ;;
  esac
}

if [ $# -eq 0 ]; then
  payload="$(cat 2>/dev/null || true)"
  [ -n "$payload" ] || exit 0
  meta="$(printf '%s' "$payload" | jq -c '
    def num: if type == "number" and . >= 0 and . < 1000000000000 then floor else null end;
    def text: if type == "string" then . else "" end;
    def skill_of:
      ((.tool_input.skill // .tool_input.skill_name // .tool_input.name // .skill // "") | text) as $n
      | ((.tool_input.command // .command // "") | text | sub("^/+"; "")) as $c
      | (if $n != "" then $n else $c end | ascii_downcase) as $s
      | if ($s | test("^[a-z0-9:-]{1,64}$")) then $s else "" end;
    def agent_of:
      (.subagent_type // .agent_type // .tool_input.subagent_type // .tool_input.agent_type // .tool_input.agent // .agent // "")
      | if type == "string" and test("^[A-Za-z0-9._:-]{1,64}$") then . else "" end;
    def tokens_of:
      (.tokens | num) as $t
      | (.token_count | num) as $c
      | ((.usage.input_tokens // .input_tokens) | num) as $i
      | ((.usage.output_tokens // .output_tokens) | num) as $o
      | if $t != null then $t
        elif $c != null then $c
        elif $i != null or $o != null then (($i // 0) + ($o // 0))
        else null end;
    def dur_of:
      (.duration_ms // .duration // .elapsed_ms // null) | num;
    def ok_of:
      if .is_error == true or .ok == false or .success == false
         or ((.status // "") == "error") or ((.status // "") == "failed") or ((.status // "") == "failure")
         or ((.error | type) == "string" and .error != "")
         or ((.error | type) == "object")
         or ((.tool_response | type) == "object" and .tool_response.is_error == true)
      then false else true end;
    if type != "object" then empty else
      (.tool_name // "" | text) as $tool
      | ($tool | ascii_downcase) as $tl
      | {
          event: (.hook_event_name // "" | text),
          session: (.session_id // .conversation_id // .sessionID // "" | text),
          tool_name: $tool,
          source: (.source // "" | text),
          tokens: tokens_of,
          skill: (if ($tl == "skill" or $tl == "use_skill" or $tl == "load_skill") then skill_of else "" end),
          agent: agent_of,
          duration_ms: dur_of,
          ok: ok_of,
          transcript_path: (.transcript_path // "" | text),
          agent_transcript_path: (.agent_transcript_path // "" | text)
        }
    end
  ' 2>/dev/null || true)"
  [ -n "$meta" ] || exit 0
  event="$(printf '%s' "$meta" | jq -r '.event // empty' 2>/dev/null || true)"
  case "$event" in
    SessionStart) kind=session_start ;;
    Stop) kind=session_end ;;
    SubagentStop) kind=subagent_stop ;;
    PreToolUse) kind=tool_call ;;
    PostToolUse) kind=tool_result ;;
    *) exit 0 ;;
  esac
  session="$(printf '%s' "$meta" | jq -r '.session // empty' 2>/dev/null || true)"
  tool_name="$(printf '%s' "$meta" | jq -r '.tool_name // empty' 2>/dev/null || true)"
  source="$(printf '%s' "$meta" | jq -r '.source // empty' 2>/dev/null || true)"
  skill="$(printf '%s' "$meta" | jq -r '.skill // empty' 2>/dev/null || true)"
  agent="$(printf '%s' "$meta" | jq -r '.agent // empty' 2>/dev/null || true)"
  tokens="$(printf '%s' "$meta" | jq -r 'if .tokens == null then "" else (.tokens | tostring) end' 2>/dev/null || true)"
  duration_ms="$(printf '%s' "$meta" | jq -r 'if .duration_ms == null then "" else (.duration_ms | tostring) end' 2>/dev/null || true)"
  ok="$(printf '%s' "$meta" | jq -r 'if .ok == false then "false" else "true" end' 2>/dev/null || true)"
  transcript_path="$(printf '%s' "$meta" | jq -r '.transcript_path // empty' 2>/dev/null || true)"
  agent_transcript_path="$(printf '%s' "$meta" | jq -r '.agent_transcript_path // empty' 2>/dev/null || true)"
  tool="$(read_tool)"
  if [ "$tool" = "cursor" ]; then
    tokens=""
  elif [ "$kind" = "session_end" ]; then
    summed="$(sum_usage "$transcript_path")"
    [ -n "$summed" ] && tokens="$summed"
  fi
  if [ "$tool" != "cursor" ] && [ -z "$agent" ] && [ "$kind" = "subagent_stop" ]; then
    agent="$(agent_from_file "$agent_transcript_path" head)"
    [ -n "$agent" ] || agent="$(agent_from_file "$transcript_path" tail)"
    [ -n "$agent" ] || agent="$(agent_from_file "$transcript_path" head)"
  fi
  unset payload meta transcript_path agent_transcript_path summed
  case "$tool_name" in
    Task|Agent|task|agent)
      if [ "$kind" = "tool_call" ]; then also_spawn=1; fi
      ;;
  esac
  if [ "$kind" != "tool_result" ]; then
    duration_ms=""
    ok=""
  fi
else
  kind="$1"
  shift
  for pair in "$@"; do
    take_pair "$pair"
  done
  tool="$(read_tool)"
fi

case "$kind" in
  session_start|session_end|tool_call|tool_result|subagent_spawn|subagent_stop|guard_block|review_round|fix_round|ship|pr_open|eval_result|pr_outcome) ;;
  *) exit 0 ;;
esac

case "$guard" in
  git|ask|secret|budget|pr-visual-report) ;;
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
if [[ ! "$skill" =~ ^[a-z0-9:-]{1,64}$ ]]; then skill=""; fi
if [[ ! "$agent" =~ ^[A-Za-z0-9._:-]{1,64}$ ]]; then agent=""; fi
if [ "$kind" = "tool_result" ] && [ -z "$ok" ]; then ok=true; fi

session="$(safe_token "$session")"
[ -n "$session" ] || session=unknown
variant="$(read_variant)"
repo="$(read_repo)"
branch="$(read_branch)"
if [ -n "${AGENT_HARNESS_KPI_TS:-}" ]; then ts="$AGENT_HARNESS_KPI_TS"; else ts="$(date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || true)"; fi
[ -n "$ts" ] || exit 0

# A global hook and a project-vendored hook both see the same block. The project copy writes it.
project_hook_owns_emit() {
  local self top proj pdir
  self="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P 2>/dev/null)" || return 1
  case "$self" in
    "${HOME:-}/.claude/hooks" | "${HOME:-}/.config/opencode/scripts/agent-harness/hooks") ;;
    *) return 1 ;;
  esac
  top="$(git rev-parse --show-toplevel 2>/dev/null)" || return 1
  for proj in "$top/.claude/hooks/kpi-emit.sh" "$top/.opencode/hooks/kpi-emit.sh"; do
    [ -f "$proj" ] || continue
    pdir="$(cd "$(dirname "$proj")" && pwd -P 2>/dev/null)" || continue
    [ "$pdir" != "$self" ] && return 0
  done
  return 1
}
project_hook_owns_emit && exit 0

guard_block_seen() {
  [ "$kind" = guard_block ] || return 1
  [ -f "$log" ] || return 1
  awk -v ts="$ts" -v guard="$guard" -v repo="$repo" -v branch="$branch" -v session="$session" -v variant="$variant" -v tool="$tool" '
    index($0, "\"kind\":\"guard_block\"") && index($0, "\"ts\":\"" ts "\"") && index($0, "\"guard\":\"" guard "\"") && index($0, "\"repo\":\"" repo "\"") && index($0, "\"branch\":\"" branch "\"") && index($0, "\"session_id\":\"" session "\"") && index($0, "\"variant\":\"" variant "\"") && index($0, "\"tool\":\"" tool "\"") { found = 1; exit }
    END { exit found ? 0 : 1 }
  ' "$log"
}

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
    --arg time_to_merge_ms "$time_to_merge_ms" --arg reverted_within_7d "$reverted_within_7d" \
    --arg skill "$skill" --arg agent "$agent" --arg duration_ms "$duration_ms" --arg ok "$ok" '
      def num($s): if $s == "" then null else ($s | tonumber) end;
      def flag($s): if $s == "true" then true elif $s == "false" then false else null end;
      {
        ts: $ts, kind: $kind, variant: $variant, harness_version: $ver, tool: $tool,
        repo: $repo, branch: $branch, session_id: $session, tokens: num($tokens)
      }
      + (if $tool_name == "" then {} else {tool_name: $tool_name} end)
      + (if $skill == "" then {} else {skill: $skill} end)
      + (if $agent == "" then {} else {agent: $agent} end)
      + (if $kind == "tool_result" then
          {
            duration_ms: (if $duration_ms == "" then null else ($duration_ms | tonumber) end),
            ok: (if $ok == "false" then false else true end)
          }
        else
          (if $duration_ms == "" then {} else {duration_ms: ($duration_ms | tonumber)} end)
          + (if $ok == "" then {} else {ok: flag($ok)} end)
        end)
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
held=0
if [ "$kind" = guard_block ]; then
  lock="${log}.guard.lock"
  _i=0
  while [ "$_i" -lt 20 ]; do
    if mkdir "$lock" 2>/dev/null; then held=1; break; fi
    _i=$((_i + 1))
    sleep 0.02
  done
  if [ "$held" = 1 ] && guard_block_seen; then
    rmdir "$lock" 2>/dev/null || true
    exit 0
  fi
fi
{
  write_event "$kind"
  if [ "$also_spawn" = 1 ]; then
    write_event subagent_spawn
  fi
} >>"$log" 2>/dev/null || true
[ "$held" = 1 ] && rmdir "$lock" 2>/dev/null || true
exit 0
