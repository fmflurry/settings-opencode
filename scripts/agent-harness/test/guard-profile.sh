#!/usr/bin/env bash
# Informational: shows where the autonomy git guard spends its time on the slowest perf inputs.
# It never fails; the gating timings live in run.sh.
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
HOOK="$HERE/.claude/hooks/autonomy-git-guard.sh"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/state"; : >"$TMP/state/autonomy.on"

profile() { # name, then the command that prints the hook input
  local name="$1"; shift
  "$@" >"$TMP/in.txt"
  jq -Rs --arg d "$HERE" '{cwd:$d,tool_input:{command:.}}' <"$TMP/in.txt" >"$TMP/in.json"
  echo "== $name"
  AGENT_HARNESS_GUARD_PROFILE=1 AGENT_HARNESS_TEST=1 AGENT_STATE_DIR="$TMP/state" CLAUDE_PROJECT_DIR="$HERE" \
    bash "$HOOK" <"$TMP/in.json" >/dev/null
}
distinct_cd() { perl -e 'for $i (1 .. 8000) { print "cd /tmp/d$i\n" }'; }
same_cd() { perl -e 'print "cd /tmp\n" x 5000'; }
quoted_body() { printf 'echo "\n'; perl -e 'print "aaaaa\n" x 200000'; printf '"'; }

if [ -z "${EPOCHREALTIME:-}" ]; then echo "guard profile: needs bash 5 (EPOCHREALTIME); skipped"; exit 0; fi
profile "8000 distinct cd lines" distinct_cd
profile "5000 identical cd lines" same_cd
profile "echo with a 200K-line quoted body" quoted_body
exit 0
