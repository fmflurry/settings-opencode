#!/usr/bin/env bash
# Decision table mirrored from plugins/code-memory-lib/mode.ts.
# Hooks run in bash, so this file is the shell copy of that module.

codememory_truthy() {
  local value
  value="$(printf '%s' "${1-}" | tr '[:upper:]' '[:lower:]' | tr -d '[:space:]')"
  case "$value" in
    true|1|yes) return 0 ;;
    *) return 1 ;;
  esac
}

codememory_present() {
  [[ -n "$(printf '%s' "${1-}" | tr -d '[:space:]')" ]]
}

# Prints enabled or disabled. Arguments match decideCodememory inputs:
# override runtime platform endpoint claude_remote claude_session
# github_actions gitlab_ci circleci buildkite tf_build jenkins_url
codememory_decide() {
  local override runtime platform endpoint
  local claude_remote claude_session github_actions gitlab_ci circleci buildkite tf_build jenkins_url
  override="$(printf '%s' "${1-}" | tr '[:upper:]' '[:lower:]' | tr -d '[:space:]')"
  runtime="${2-}"
  platform="${3-}"
  endpoint="${4-}"
  claude_remote="${5-}"
  claude_session="${6-}"
  github_actions="${7-}"
  gitlab_ci="${8-}"
  circleci="${9-}"
  buildkite="${10-}"
  tf_build="${11-}"
  jenkins_url="${12-}"

  case "$override" in
    on) printf 'enabled\n'; return 0 ;;
    off) printf 'disabled\n'; return 0 ;;
  esac

  if codememory_truthy "$claude_remote" || codememory_present "$claude_session"; then
    printf 'disabled\n'; return 0
  fi
  if [[ "$runtime" == "managed" ]]; then
    printf 'disabled\n'; return 0
  fi
  if codememory_truthy "$github_actions" || codememory_truthy "$gitlab_ci" \
    || codememory_truthy "$circleci" || codememory_truthy "$buildkite" \
    || codememory_present "$tf_build" || codememory_present "$jenkins_url"; then
    printf 'disabled\n'; return 0
  fi

  if [[ "$platform" == "darwin" ]]; then
    printf 'enabled\n'; return 0
  fi

  if [[ "$endpoint" == "1" ]]; then
    printf 'enabled\n'
  else
    printf 'disabled\n'
  fi
}

codememory_platform() {
  case "$(uname -s 2>/dev/null || true)" in
    Darwin) printf 'darwin\n' ;;
    Linux) printf 'linux\n' ;;
    MINGW*|MSYS*|CYGWIN*) printf 'win32\n' ;;
    *) uname -s 2>/dev/null || printf 'unknown\n' ;;
  esac
}

codememory_cache_get() {
  local cache="$1"
  [[ -f "$cache" ]] || return 1
  local now mtime
  now="$(date +%s)"
  mtime="$(stat -c %Y "$cache" 2>/dev/null || stat -f %m "$cache" 2>/dev/null || true)"
  [[ -n "$mtime" ]] || return 1
  [[ $((now - mtime)) -lt 60 ]] || return 1
  cat "$cache"
}

codememory_cursor_runtime() {
  local cache="${TMPDIR:-/tmp}/fmflurry-codememory-runtime"
  local cached
  if cached="$(codememory_cache_get "$cache")"; then
    printf '%s' "$cached"
    return 0
  fi
  local sock value=""
  sock="${CURSOR_AGENT_SOCKET:-/run/cursor/api.sock}"
  if [[ -S "$sock" ]] && command -v curl >/dev/null 2>&1; then
    value="$(curl -fsS --unix-socket "$sock" --max-time 1 \
      http://cursor-agent/v1/meta-data/agent/runtime 2>/dev/null || true)"
    value="$(printf '%s' "$value" | tr -d '[:space:]')"
  fi
  printf '%s' "$value" >"$cache" 2>/dev/null || true
  printf '%s' "$value"
}

codememory_port_open() {
  local host="$1" port="$2"
  command -v python3 >/dev/null 2>&1 || return 1
  python3 -c 'import socket, sys
s = socket.socket()
s.settimeout(0.3)
try:
    s.connect((sys.argv[1], int(sys.argv[2])))
except Exception:
    sys.exit(1)
finally:
    s.close()
' "$host" "$port"
}

# FalkorDB :6379 and Qdrant :6333, the local services code-memory health uses.
codememory_endpoint_reachable() {
  local cache="${TMPDIR:-/tmp}/fmflurry-codememory-endpoint"
  local cached
  if cached="$(codememory_cache_get "$cache")"; then
    [[ "$cached" == "1" ]]
    return
  fi
  local value=0
  if codememory_port_open 127.0.0.1 6379 && codememory_port_open 127.0.0.1 6333; then
    value=1
  fi
  printf '%s' "$value" >"$cache" 2>/dev/null || true
  [[ "$value" == "1" ]]
}

codememory_vendor_ci() {
  codememory_truthy "${GITHUB_ACTIONS-}" && return 0
  codememory_truthy "${GITLAB_CI-}" && return 0
  codememory_truthy "${CIRCLECI-}" && return 0
  codememory_truthy "${BUILDKITE-}" && return 0
  codememory_present "${TF_BUILD-}" && return 0
  codememory_present "${JENKINS_URL-}" && return 0
  return 1
}

codememory_enabled() {
  local override runtime platform endpoint=""
  override="${FMFLURRY_CODEMEMORY-}"
  local normalized
  normalized="$(printf '%s' "$override" | tr '[:upper:]' '[:lower:]' | tr -d '[:space:]')"
  if [[ "$normalized" == "on" || "$normalized" == "off" ]]; then
    runtime=""
  else
    runtime="$(codememory_cursor_runtime)"
  fi
  platform="$(codememory_platform)"

  if [[ "$normalized" != "on" && "$normalized" != "off" && "$platform" != "darwin" \
    && "$runtime" != "managed" ]] && ! codememory_truthy "${CLAUDE_CODE_REMOTE-}" \
    && ! codememory_present "${CLAUDE_CODE_REMOTE_SESSION_ID-}" \
    && ! codememory_vendor_ci; then
    if codememory_endpoint_reachable; then endpoint=1; else endpoint=0; fi
  fi

  local decision
  decision="$(codememory_decide "$override" "$runtime" "$platform" "$endpoint" \
    "${CLAUDE_CODE_REMOTE-}" "${CLAUDE_CODE_REMOTE_SESSION_ID-}" \
    "${GITHUB_ACTIONS-}" "${GITLAB_CI-}" "${CIRCLECI-}" "${BUILDKITE-}" \
    "${TF_BUILD-}" "${JENKINS_URL-}")"
  [[ "$decision" == "enabled" ]]
}
