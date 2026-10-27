#!/usr/bin/env bash
set -u

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo="$(cd "$here/../.." && pwd)"
scripts="$repo/plugins/fmflurry-harness/hooks/scripts"
fixtures="$here/fixtures"

[ -f "$scripts/cursor-adapter.sh" ] || node "$repo/scripts/build-cursor-plugin.mjs" >/dev/null || exit 1

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
export TMPDIR="$work" XDG_CACHE_HOME="$work/cache"

mkdir -p "$work/stub" "$work/nortk"
cat > "$work/stub/rtk" <<'STUB'
#!/bin/sh
case "$1" in
  --version) echo "rtk 0.30.0" ;;
  rewrite) echo "rtk $2" ;;
esac
STUB
chmod +x "$work/stub/rtk"
for tool in jq bash env cat mktemp rm mkdir touch date grep sed awk tr head tail wc dirname ls find; do
  src="$(command -v "$tool")" && ln -s "$src" "$work/nortk/$tool"
done

fail=0
check() {
  local name="$1" got="$2" want="$3"
  if [ "$got" = "$want" ]; then echo "ok   $name"; else echo "FAIL $name: got [$got] want [$want]"; fail=1; fi
}
adapter() { "$BASH" "$scripts/cursor-adapter.sh" "$scripts/$1" "$2"; }

out="$(adapter pre-tool-use.sh beforeShellExecution < "$fixtures/before-shell-execution.json")"; rc=$?
check "rm -rf / is warn-only -> allow (exit)" "$rc" "0"
check "rm -rf / is warn-only -> allow (decision)" "$(jq -r .permission <<<"$out")" "allow"

out="$(adapter pre-tool-use.sh preToolUse < "$fixtures/pre-tool-use-secret.json")"
check "secret exposure warns via agent_message" "$(jq -r '.agent_message | test("Security")' <<<"$out")" "true"

out="$(PATH="$work/stub:$PATH" adapter rtk-rewrite.sh preToolUse < "$fixtures/pre-tool-use.json")"
check "rtk present: git status rewritten" "$(jq -r .updated_input.command <<<"$out")" "rtk git status"
check "rtk present: allow" "$(jq -r .permission <<<"$out")" "allow"

out="$(PATH="$work/nortk" adapter rtk-rewrite.sh preToolUse < "$fixtures/pre-tool-use.json")"; rc=$?
check "rtk absent: exit 0" "$rc" "0"
check "rtk absent: allow unchanged" "$(jq -c . <<<"$out")" '{"permission":"allow"}'

out="$(PATH="$work/stub:$PATH" adapter rtk-rewrite.sh beforeShellExecution < "$fixtures/before-shell-execution.json")"
check "beforeShellExecution never rewrites" "$(jq -r 'has("updated_input")' <<<"$out")" "false"

out="$(printf 'not json' | adapter pre-tool-use.sh preToolUse)"; rc=$?
check "malformed stdin preToolUse: exit 0" "$rc" "0"
check "malformed stdin preToolUse: allow" "$(jq -c . <<<"$out")" '{"permission":"allow"}'
out="$(printf 'not json' | adapter stop.sh stop)"; rc=$?
check "malformed stdin stop: exit 0" "$rc" "0"
check "malformed stdin stop: empty object" "$(jq -c . <<<"$out")" '{}'
out="$(printf '' | adapter rtk-rewrite.sh preToolUse)"
check "empty stdin: allow" "$(jq -c . <<<"$out")" '{"permission":"allow"}'

out="$(bash "$scripts/cursor-adapter.sh" "$scripts/missing.sh" preToolUse < "$fixtures/pre-tool-use.json")"
check "missing script: allow" "$(jq -c . <<<"$out")" '{"permission":"allow"}'

out="$(FMFLURRY_CODEMEMORY=off adapter prefer-code-memory.sh preToolUse < "$fixtures/pre-tool-use.json")"
check "prefer-code-memory quiet when off" "$(jq -c . <<<"$out")" '{"permission":"allow"}'
out="$(FMFLURRY_CODEMEMORY=on adapter prefer-code-memory.sh preToolUse < "$fixtures/pre-tool-use.json")"
check "prefer-code-memory nudges once" "$(jq -r '.agent_message | test("code-memory")' <<<"$out")" "true"
out="$(FMFLURRY_CODEMEMORY=on adapter prefer-code-memory.sh preToolUse < "$fixtures/pre-tool-use.json")"
check "prefer-code-memory silent on repeat" "$(jq -c . <<<"$out")" '{"permission":"allow"}'

out="$(adapter tool-budget.sh preToolUse < "$fixtures/pre-tool-use.json")"
check "tool-budget allows" "$(jq -r .permission <<<"$out")" "allow"
out="$(adapter stop.sh stop < "$fixtures/stop.json")"; rc=$?
check "stop exit" "$rc" "0"
check "stop output" "$(jq -c . <<<"$out")" '{}'
out="$(adapter subagent-stop.sh subagentStop < "$fixtures/subagent-stop.json")"; rc=$?
check "subagentStop exit" "$rc" "0"
check "subagentStop output" "$(jq -c . <<<"$out")" '{}'
out="$(AGENT_HARNESS_TEST=1 adapter kpi-emit.sh postToolUse < "$fixtures/post-tool-use.json")"; rc=$?
check "postToolUse exit" "$rc" "0"
check "postToolUse output" "$(jq -c . <<<"$out")" '{}'
check "postToolUse hides the tool output" "$(grep -c SUPER_SECRET_OUTPUT <<<"$out" || true)" "0"
out="$(printf 'not json' | AGENT_HARNESS_TEST=1 adapter kpi-emit.sh postToolUse)"; rc=$?
check "malformed stdin postToolUse: exit 0" "$rc" "0"
check "malformed stdin postToolUse: empty object" "$(jq -c . <<<"$out")" '{}'

cat > "$work/ask-hook.sh" <<'HOOK'
#!/bin/sh
cat >/dev/null
printf '{"hookSpecificOutput":{"permissionDecision":"ask","permissionDecisionReason":"confirm this merge"}}'
HOOK
out="$(bash "$scripts/cursor-adapter.sh" "$work/ask-hook.sh" beforeShellExecution < "$fixtures/before-shell-execution.json")"
check "ask on beforeShellExecution -> ask (not allow)" "$(jq -r .permission <<<"$out")" "ask"
check "ask on beforeShellExecution carries the reason" "$(jq -r .user_message <<<"$out")" "confirm this merge"
out="$(bash "$scripts/cursor-adapter.sh" "$work/ask-hook.sh" preToolUse < "$fixtures/pre-tool-use.json")"
check "ask on preToolUse -> deny (Cursor preToolUse has no ask)" "$(jq -r .permission <<<"$out")" "deny"
check "ask on preToolUse carries the reason" "$(jq -r .user_message <<<"$out")" "confirm this merge"

guard="$repo/.claude/hooks/autonomy-git-guard.sh"
rg="$work/review-gate"; rgs="$work/review-gate-state"
mkdir -p "$rgs"
git init -q --bare "$rg.git"
git clone -q "$rg.git" "$rg" 2>/dev/null
( cd "$rg" && git config user.email t@t && git config user.name t && git checkout -q -b master && echo a >a && git add a && git commit -qm A \
  && git push -q origin master && git checkout -q -b feat && echo b >b && git add b && git commit -qm B ) >/dev/null 2>&1
: >"$rgs/autonomy.on"
( cd "$rg" && AGENT_HARNESS_TEST=1 AGENT_STATE_DIR="$rgs" CLAUDE_PROJECT_DIR="$rg" bash "$repo/scripts/agent-harness/goal.sh" set "review gate goal" ) >/dev/null 2>&1
payload="$(jq -nc --arg c "git push -u origin feat" --arg d "$rg" '{command:$c,cwd:$d,hook_event_name:"beforeShellExecution",conversation_id:"c"}')"
out="$(printf '%s' "$payload" | AGENT_HARNESS_TEST=1 AGENT_STATE_DIR="$rgs" CLAUDE_PROJECT_DIR="$rg" "$BASH" "$scripts/cursor-adapter.sh" "$guard" beforeShellExecution)"
check "unreviewed active goal: push denied through the cursor adapter" "$(jq -r .permission <<<"$out")" "deny"
check "unreviewed active goal: cursor denial names the review" "$(jq -r '.user_message | test("review"; "i")' <<<"$out")" "true"

exit "$fail"
