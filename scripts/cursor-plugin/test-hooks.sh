#!/usr/bin/env bash
set -u

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo="$(cd "$here/../.." && pwd)"
scripts="$repo/plugins/fmflurry-harness/hooks/scripts"
fixtures="$here/fixtures"

[ -x "$scripts/cursor-adapter.sh" ] || node "$repo/scripts/build-cursor-plugin.mjs" >/dev/null || exit 1

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
adapter() { "$scripts/cursor-adapter.sh" "$scripts/$1" "$2"; }

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

out="$("$scripts/cursor-adapter.sh" "$scripts/missing.sh" preToolUse < "$fixtures/pre-tool-use.json")"
check "missing script: allow" "$(jq -c . <<<"$out")" '{"permission":"allow"}'

out="$(adapter prefer-code-memory.sh preToolUse < "$fixtures/pre-tool-use.json")"
check "prefer-code-memory nudges once" "$(jq -r '.agent_message | test("code-memory")' <<<"$out")" "true"
out="$(adapter prefer-code-memory.sh preToolUse < "$fixtures/pre-tool-use.json")"
check "prefer-code-memory silent on repeat" "$(jq -c . <<<"$out")" '{"permission":"allow"}'

out="$(adapter tool-budget.sh preToolUse < "$fixtures/pre-tool-use.json")"
check "tool-budget allows" "$(jq -r .permission <<<"$out")" "allow"
out="$(adapter stop.sh stop < "$fixtures/stop.json")"; rc=$?
check "stop exit" "$rc" "0"
check "stop output" "$(jq -c . <<<"$out")" '{}'
out="$(adapter subagent-stop.sh subagentStop < "$fixtures/subagent-stop.json")"; rc=$?
check "subagentStop exit" "$rc" "0"
check "subagentStop output" "$(jq -c . <<<"$out")" '{}'

exit "$fail"
