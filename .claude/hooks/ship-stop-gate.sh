#!/usr/bin/env bash
# shellcheck disable=SC2016
# Stop: while autonomous with an active goal, block stopping until the PR is merged.
# A bounded goal wait, or a still-running background test, review, or subagent, is not counted.
# Fails open when GitHub is unreadable.
set -u
INPUT="$(cat 2>/dev/null || true)"
ROOT="$(git -C "${CLAUDE_PROJECT_DIR:-$PWD}" worktree list --porcelain 2>/dev/null | sed -n '1s/^worktree //p')"
[ -n "$ROOT" ] || ROOT="${CLAUDE_PROJECT_DIR:-$PWD}"
STATE_DIR="$ROOT/.claude/state"
[ "${AGENT_HARNESS_TEST:-}" = 1 ] && STATE_DIR="${AGENT_STATE_DIR:-${TLTB_STATE_DIR:-$STATE_DIR}}"
HARNESS_HOME="$HOME/.claude/scripts/agent-harness"
GH=gh
[ "${AGENT_HARNESS_TEST:-}" = 1 ] && GH="${GH_BIN:-gh}"
# Hooks must not source lib.sh, so this repeats its gh_cmd: .envrc selects the gh account, not the personal token.
# Only its environment is used; the gh binary is pinned before direnv can change PATH.
gh_cmd() {
  local bin
  bin="$(type -P "$GH" 2>/dev/null)" || bin="$GH"
  case "$bin" in
    /*) if [ -f "$ROOT/.envrc" ] && command -v direnv >/dev/null 2>&1; then direnv exec "$ROOT" "$bin" "$@"; else "$bin" "$@"; fi ;;
    *) "$bin" "$@" ;;
  esac
}
MAX_BLOCKS=5
MAX_TOTAL_BLOCKS=30
WT_PATH=""
LOCAL_SHA=""

[ -f "$STATE_DIR/autonomy.on" ] || exit 0
# shellcheck source=goal-state.sh
. "${BASH_SOURCE[0]%/*}/goal-state.sh"
goal_scope_select "${CLAUDE_PROJECT_DIR:-$PWD}" "$PWD"
goal_bind_file "$STATE_DIR"
notify() {
  local dir="$HARNESS_HOME" ah
  [ "${AGENT_HARNESS_TEST:-}" != 1 ] || dir="${AGENT_HARNESS_DIR:-$dir}"
  if [ -f "$dir/notify.sh" ]; then bash -p "$dir/notify.sh" "$@"
  elif ah="$(type -P agent-harness)"; then "$ah" notify "$@"
  fi
}
goal_get() { jq -r "$1" "$GOAL_FILE" 2>/dev/null; }
goal_update() {
  local tmp
  tmp="$(mktemp "$STATE_DIR/goal.XXXXXX")" || return 1
  if jq "$@" "$GOAL_FILE" >"$tmp"; then mv "$tmp" "$GOAL_FILE"; else rm -f "$tmp"; return 1; fi
}
reg_mirror() {
  local slug common f tmp
  slug="$(goal_get '.slug // empty')"
  [ -n "$slug" ] || slug="$(goal_get '.branch // empty')"
  slug="${slug//\//-}"
  [[ "$slug" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]] || return 0
  common="$(git -C "$ROOT" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)" || return 0
  f="$common/agent-harness/goals/$slug.json"
  [ -f "$f" ] || return 0
  tmp="$(mktemp "$f.XXXXXX")" || return 0
  if jq "$@" "$f" >"$tmp"; then mv "$tmp" "$f"; else rm -f "$tmp"; fi
}
kpi_ship() {
  local k="${BASH_SOURCE[0]%/*}/kpi-emit.sh"
  [ -f "$k" ] || return 0
  "$k" ship "$@" >/dev/null 2>&1 || true
}
escalate() {
  goal_update --arg r "$1" '.status = "escalated" | .reason = $r | .gate = "escalated" | .gate_reason = $r'
  reg_mirror --arg r "$1" '.status = "escalated" | .reason = $r'
  kpi_ship outcome=escalated ${pr:+pr=$pr}
  notify failure "$1: $(goal_get '.goal')" "$(goal_get '.pr // empty')" || true
}
digits() { case "$1" in ''|*[!0-9]*) printf '0' ;; *) printf '%s' "$1" ;; esac; }
# The registered worktree is the only place a local commit counts. An empty stored local_sha is the first look, not progress.
read_worktree_tip() {
  local slug common f path branch sha
  WT_PATH=""
  LOCAL_SHA=""
  slug="$(goal_get '.slug // empty')"
  [ -n "$slug" ] || slug="$(goal_get '.branch // empty')"
  slug="${slug//\//-}"
  [[ "$slug" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]] || return 0
  common="$(git -C "$ROOT" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)" || return 0
  f="$common/agent-harness/goals/$slug.json"
  [ -f "$f" ] || return 0
  path="$(jq -r '.path // empty' "$f" 2>/dev/null)"
  branch="$(jq -r '.branch // empty' "$f" 2>/dev/null)"
  [ -n "$branch" ] || branch="$(goal_get '.branch // empty')"
  [ -d "$path" ] && [ -n "$branch" ] || return 0
  sha="$(git -C "$path" rev-parse --verify "$branch" 2>/dev/null)" || return 0
  [[ "$sha" =~ ^[0-9a-fA-F]{7,64}$ ]] || return 0
  WT_PATH="$path"
  LOCAL_SHA="$sha"
}
input_busy() {
  [ -n "$INPUT" ] || return 1
  jq -e '
    def running:
      if type == "array" then any(.[];
        if type == "object" then
          ((.status // .state // "running") | tostring | ascii_downcase) as $s
          | ($s | test("^(completed|complete|done|failed|error|killed|cancelled|canceled|success|exited|stopped|idle)$") | not)
        elif type == "number" then . > 0
        elif type == "boolean" then .
        elif type == "string" then length > 0 and (. != "0") and (. != "false")
        else false end)
      elif type == "number" then . > 0
      elif type == "boolean" then .
      else false end;
    [ .background_tasks, .backgroundTasks, .subagents, .active_subagents, .running_subagents, .tasks ]
    | any(. != null and running)
  ' <<<"$INPUT" >/dev/null 2>&1
}
pid_busy() {
  local pid
  [ -n "$INPUT" ] || return 1
  while IFS= read -r pid; do
    [[ "$pid" =~ ^[0-9]+$ ]] || continue
    [ "$pid" -gt 0 ] 2>/dev/null || continue
    kill -0 "$pid" 2>/dev/null && return 0
  done < <(jq -r '
    (.background_pids // .pids // []) | if type == "array" then .[] else empty end | tostring
  ' <<<"$INPUT" 2>/dev/null)
  return 1
}
inflight_busy() {
  local sid dir now ttl mtime f
  sid="$(jq -r '.session_id // empty' <<<"${INPUT:-}" 2>/dev/null || true)"
  [[ "$sid" =~ ^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$ ]] || return 1
  dir="${NOTIFY_STATE_DIR:-$HOME/.claude/state/notify}/$sid/inflight"
  [ -d "$dir" ] || return 1
  now="$(date +%s)"
  ttl="${NOTIFY_INFLIGHT_TTL_SECONDS:-900}"
  for f in "$dir"/*; do
    [ -e "$f" ] || continue
    mtime="$(stat -c %Y "$f" 2>/dev/null || stat -f %m "$f" 2>/dev/null || echo 0)"
    [ "$(( now - mtime ))" -le "$ttl" ] && return 0
  done
  return 1
}
proc_busy() {
  local pid cwd cmd
  [ -n "$WT_PATH" ] && [ -d /proc ] || return 1
  for pid in /proc/[0-9]*; do
    [ -d "$pid" ] || continue
    pid="${pid#/proc/}"
    if [ "$pid" = "$$" ] || [ "$pid" = "$PPID" ]; then continue; fi
    cwd="$(readlink "/proc/$pid/cwd" 2>/dev/null || true)"
    [ "$cwd" = "$WT_PATH" ] || continue
    cmd="$(tr '\0' ' ' <"/proc/$pid/cmdline" 2>/dev/null || true)"
    case "$cmd" in
      *'npm test'*|*'npm run test'*|*'pnpm test'*|*'yarn test'*|*'node --test'*|*'npx jest'*|*'npx vitest'*|*'pytest'*|*'cargo test'*|*'go test'*|*'dotnet test'*|*'playwright test'*|*'agent-harness/test/run.sh'*|*'code-reviewer'*|*'security-reviewer'*)
        return 0 ;;
    esac
  done
  return 1
}
wait_active() {
  local until now
  until="$(jq -r '.wait_until // empty' "$GOAL_FILE" 2>/dev/null || true)"
  [[ "$until" =~ ^[0-9]+$ ]] || return 1
  now="$(date +%s)"
  [ "$now" -lt "$until" ]
}
holding() {
  wait_active && return 0
  input_busy && return 0
  pid_busy && return 0
  inflight_busy && return 0
  proc_busy && return 0
  return 1
}
reviews_ready() {
  [ -n "$LOCAL_SHA" ] || return 1
  jq -e --arg sha "$LOCAL_SHA" '
    (.reviews // {}) | to_entries | any(
      .value.code.verdict == "pass" and .value.security.verdict == "pass"
      and (.value.code.sha == $sha) and (.value.security.sha == $sha)
    )
  ' "$GOAL_FILE" >/dev/null 2>&1
}
[ -f "$GOAL_FILE" ] && [ "$(goal_get '.status')" = active ] || exit 0

pr="$(goal_get '.pr // empty')"
view="" head="" state=""
if [ -n "$pr" ]; then
  view="$(gh_cmd pr view "$pr" --json state,headRefOid 2>/dev/null)" || view=""
  state="$(jq -r '.state // empty' <<<"$view" 2>/dev/null)"
  head="$(jq -r '.headRefOid // empty' <<<"$view" 2>/dev/null)"
  if [ -z "$state" ]; then
    echo "ship-stop-gate: PR state unreadable; allowing stop" >&2
    notify waiting "PR state unreadable" "$pr" || true
    exit 0
  fi
fi
if [ "$state" = MERGED ]; then
  goal_update '.status = "done" | del(.gate, .gate_reason)'
  reg_mirror '.status = "done"'
  kpi_ship outcome=merged ${pr:+pr=$pr}
  notify "done" "PR #$pr merged" "$pr" || true
  exit 0
fi

read_worktree_tip
if holding; then
  goal_update 'del(.gate, .gate_reason)' || true
  exit 0
fi

stored_head="$(goal_get '.head_sha // empty')"
stored_local="$(goal_get '.local_sha // empty')"
stored_reviews="$(goal_get '.reviews_fp // empty')"
cur_reviews="$(jq -c -S '.reviews // {}' "$GOAL_FILE" 2>/dev/null || echo '{}')"
cur_fix="$(digits "$(goal_get '.fix_iterations // 0')")"
seen_fix="$(jq -r 'if has("seen_fix_iterations") then (.seen_fix_iterations | tostring) else "" end' "$GOAL_FILE" 2>/dev/null || true)"
progress=0
if [ -n "$head" ] && [ "$head" != "$stored_head" ]; then progress=1; fi
if [ -n "$LOCAL_SHA" ] && [ -n "$stored_local" ] && [ "$LOCAL_SHA" != "$stored_local" ]; then progress=1; fi
if [ -n "$stored_reviews" ] && [ "$stored_reviews" != "$cur_reviews" ]; then progress=1; fi
if [ -z "$stored_reviews" ] && [ "$cur_reviews" != "{}" ]; then progress=1; fi
if [ -n "$seen_fix" ]; then
  seen_fix="$(digits "$seen_fix")"
  [ "$cur_fix" -gt "$seen_fix" ] && progress=1
elif [ "$cur_fix" -gt 0 ]; then
  progress=1
fi

common='.total_blocks = ((.total_blocks // 0) + 1) | .head_sha = $h | if $l != "" then .local_sha = $l else . end | .reviews_fp = $r | .seen_fix_iterations = $f | del(.wait_until, .wait_reason)'
if [ "$progress" = 1 ]; then
  goal_update --arg h "$head" --arg l "$LOCAL_SHA" --arg r "$cur_reviews" --argjson f "$cur_fix" ".stop_blocks = 0 | $common"
else
  goal_update --arg h "$head" --arg l "$LOCAL_SHA" --arg r "$cur_reviews" --argjson f "$cur_fix" ".stop_blocks += 1 | $common"
fi

if [ -z "$pr" ]; then
  if reviews_ready; then
    reason="no PR yet: push the branch, open a PR to the base branch and record it with goal.sh pr <n>"
  else
    reason="no PR yet: finish local review and record both verdicts with agent-harness goal review code|security pass|fail"
  fi
else
  reason="PR #$pr is not merged: wait for checks to pass, then run agent-harness ship-merge $pr"
fi

if [ "$(goal_get '.total_blocks')" -ge "$MAX_TOTAL_BLOCKS" ]; then
  escalate "total stop blocks reached $MAX_TOTAL_BLOCKS: $reason"
  exit 0
fi
if [ "$(goal_get '.stop_blocks')" -ge "$MAX_BLOCKS" ]; then
  escalate "no progress after $MAX_BLOCKS stop blocks: $reason"
  exit 0
fi

kpi_ship outcome=blocked ${pr:+pr=$pr}
goal_update --arg r "$reason" '.gate = "block" | .gate_reason = $r' || true
jq -n --arg r "Goal not done. $reason" '{decision:"block",reason:$r}'
exit 0
