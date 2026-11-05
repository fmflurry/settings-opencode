#!/usr/bin/env bash
set -euo pipefail
input="$(cat)"
session="$(jq -r '.session_id // empty' <<<"$input")"
[[ "$session" =~ ^[A-Za-z0-9._:-]{1,200}$ ]] || { printf 'commit-provenance: invalid session id\n' >&2; exit 1; }
[ -n "${CLAUDE_ENV_FILE:-}" ] || { printf 'commit-provenance: CLAUDE_ENV_FILE is unavailable\n' >&2; exit 1; }
target="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
hooks="$target/scripts/agent-harness/git-hooks"
[ -x "$hooks/prepare-commit-msg" ] || { printf 'commit-provenance: installed hooks are missing; reinstall the harness\n' >&2; exit 1; }
project="${CLAUDE_PROJECT_DIR:-}"
[ -n "$project" ] || project="$(git rev-parse --show-toplevel 2>/dev/null || pwd -P)"
project_claude="$(cd "$project/.claude" 2>/dev/null && pwd -P || true)"
scope=global
[ "$target" != "$project_claude" ] || scope=local
block="$(
  printf 'if [[ "${HARNESS_SESSION_ID:-}" != %q || "${HARNESS_PROVENANCE_SCOPE:-}" != local || %q = local ]]; then\n' "$session" "$scope"
  printf 'if [[ ! ${HARNESS_HOOK_CONFIG_INDEX+x} ]]; then HARNESS_HOOK_CONFIG_INDEX="${GIT_CONFIG_COUNT:-0}"; fi\n'
  printf 'export HARNESS_HOOK_CONFIG_INDEX\n'
  printf 'export "GIT_CONFIG_KEY_${HARNESS_HOOK_CONFIG_INDEX}=core.hooksPath"\n'
  printf 'HARNESS_HOOKS_PATH=%q\n' "$hooks"
  printf 'export "GIT_CONFIG_VALUE_${HARNESS_HOOK_CONFIG_INDEX}=$HARNESS_HOOKS_PATH"\n'
  printf 'export GIT_CONFIG_COUNT="$((HARNESS_HOOK_CONFIG_INDEX + 1))"\n'
  printf 'export HARNESS_SESSION_ID=%q\n' "$session"
  printf 'export HARNESS_PROVENANCE_SCOPE=%q\n' "$scope"
  printf 'export HARNESS_VERSION=@target\n'
  printf 'export HARNESS_SHA=%q\n' "$target"
  printf 'fi\n'
)"
printf '%s\n' "$block" >> "$CLAUDE_ENV_FILE"
