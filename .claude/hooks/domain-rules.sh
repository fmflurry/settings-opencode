#!/usr/bin/env bash
# Project domain-rules hook. Exits 0 unless .harness-local/domain-rules.json
# sets "enabled" to true, then runs that project's script. No project rules live here.
set -u
# The common case is a project with no config. Stay off without starting node.
config_dir="$PWD"
while [ ! -f "$config_dir/.harness-local/domain-rules.json" ]; do
  config_parent="$(dirname "$config_dir")"
  [ "$config_parent" = "$config_dir" ] && break
  config_dir="$config_parent"
done
if [ ! -f "$config_dir/.harness-local/domain-rules.json" ] \
  && { [ -z "${CLAUDE_PROJECT_DIR:-}" ] || [ ! -f "$CLAUDE_PROJECT_DIR/.harness-local/domain-rules.json" ]; }; then
  exit 0
fi
here="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
cli=""
if [ -f "$here/domain-rules.ts" ]; then
  cli="$here/domain-rules.ts"
elif [ -f "$here/../../plugins/lib/domain-rules.ts" ]; then
  cli="$here/../../plugins/lib/domain-rules.ts"
fi
if [ -z "$cli" ] || ! command -v node >/dev/null 2>&1; then
  printf '%s\n' "domain-rules: helper unavailable; skipping" >&2
  exit 0
fi
node --experimental-strip-types "$cli"
status=$?
if [ "$status" -eq 0 ]; then
  exit 0
fi
exit 2
