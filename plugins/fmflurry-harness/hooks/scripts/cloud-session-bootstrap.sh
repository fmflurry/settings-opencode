#!/usr/bin/env bash
# SessionStart for a remote Claude Code host. A local session never installs.
# A project that already vendors this harness does not install again: either a
# .claude tree stamped by the installer (or CLAUDE.md plus the autonomy hook),
# or a plugin.json that carries a version field. Otherwise shallow-clone the
# settings repo and run install.sh --yes monolith. The install is idempotent.
# Clone and install failures warn and exit 0 so the session still starts.
set -u

warn() {
  printf 'cloud-session-bootstrap: warning: %s\n' "$*" >&2
}

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

root=""
if [ -n "${CLAUDE_PROJECT_DIR:-}" ] && [ -d "$CLAUDE_PROJECT_DIR" ]; then
  root="$CLAUDE_PROJECT_DIR"
elif [ -n "${PWD:-}" ] && [ -d "$PWD" ]; then
  root="$PWD"
fi

version_marker() {
  local file="$1"
  [ -f "$file" ] || return 1
  grep -q '"version"' "$file" 2>/dev/null
}

if [ -n "$root" ]; then
  if [ -f "$root/.claude/.harness-variant" ]; then
    exit 0
  fi
  if [ -f "$root/.claude/CLAUDE.md" ] && [ -f "$root/.claude/hooks/autonomy-context.sh" ]; then
    exit 0
  fi
  if version_marker "$root/.cursor-plugin/plugin.json"; then
    exit 0
  fi
  if version_marker "$root/plugins/fmflurry-harness/.cursor-plugin/plugin.json"; then
    exit 0
  fi
fi

repo_url="https://github.com/fmflurry/settings-opencode"
if ! command -v git >/dev/null 2>&1; then
  warn "git is not available"
  exit 0
fi

workdir=""
cleanup() {
  if [ -n "$workdir" ] && [ -d "$workdir" ]; then
    rm -rf "$workdir"
  fi
}
trap cleanup EXIT

workdir="$(mktemp -d "${TMPDIR:-/tmp}/cloud-session-bootstrap.XXXXXX")" || {
  warn "could not create a temporary directory"
  exit 0
}

if ! git clone --depth 1 --quiet "$repo_url" "$workdir" >/dev/null 2>&1; then
  warn "shallow clone of ${repo_url} failed"
  exit 0
fi

installer="$workdir/install.sh"
if [ ! -f "$installer" ]; then
  warn "cloned tree has no install.sh"
  exit 0
fi

if ! bash "$installer" --yes monolith >/dev/null 2>&1; then
  warn "install.sh --yes monolith failed"
  exit 0
fi

exit 0
