#!/usr/bin/env bash
# Shared by install.sh and install-cursor.sh. Source this file; do not execute it.
if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  printf 'source scripts/lib/install-agent-harness.sh from install.sh or install-cursor.sh\n' >&2
  exit 2
fi

_ah_ok() {
  if declare -F ok >/dev/null 2>&1; then ok "$*"; else printf 'OK   %s\n' "$*"; fi
}

_ah_info() {
  if declare -F info >/dev/null 2>&1; then info "$*"; else printf '    %s\n' "$*"; fi
}

write_harness_marker() {
  local tool var
  : > "$1"
  for tool in gh orca jq; do
    var="$(printf '%s' "$tool" | tr '[:lower:]' '[:upper:]')"
    printf '%s=%s\n' "$var" "$(type -P "$tool" || true)" >> "$1"
  done
}

agent_harness_cursor_root() {
  printf '%s' "${AGENT_HARNESS_HOME:-$HOME/.local/share/fmflurry-harness}"
}

install_agent_harness_tree() {
  local dest="$1"
  local src_dir="${REPO_DIR:?}/scripts/agent-harness"
  local script base
  [ -f "$src_dir/agent-harness.sh" ] || return 0
  mkdir -p "$dest"
  for script in "$src_dir"/*.sh; do
    [ -f "$script" ] || continue
    base="$(basename "$script")"
    cp "$script" "$dest/$base"
    chmod +x "$dest/$base"
  done
  for script in "$src_dir"/*.mjs; do
    [ -f "$script" ] || continue
    cp "$script" "$dest/$(basename "$script")"
  done
  write_harness_marker "$dest/.installed"
  _ah_ok "installed agent-harness scripts into $dest"
}

install_agent_harness_wrapper() {
  local harness_root="$1"
  local bin_dir="${AGENT_HARNESS_BIN_DIR:-$HOME/.local/bin}"
  local link="$bin_dir/agent-harness"
  local target="$harness_root/scripts/agent-harness/agent-harness.sh"
  [ -f "$target" ] || return 0
  mkdir -p "$bin_dir"
  # A wrapper, not a symlink: agent-harness.sh resolves its siblings from its own dirname.
  [ -L "$link" ] && rm -f "$link"
  printf '#!/bin/bash -p\nbuiltin exec /bin/bash -p "%s/scripts/agent-harness/agent-harness.sh" "$@"\n' "$harness_root" > "$link"
  chmod +x "$link"
  _ah_ok "installed $link -> $target"
}

uninstall_agent_harness_cli() {
  local harness_root="$1"
  local bin_dir="${AGENT_HARNESS_BIN_DIR:-$HOME/.local/bin}"
  local link="$bin_dir/agent-harness"
  local dest="$harness_root/scripts/agent-harness"
  local target="$dest/agent-harness.sh"
  if [ -f "$link" ] && grep -F -q -- "$target" "$link"; then
    rm -f "$link"
    _ah_ok "removed $link"
  elif [ -e "$link" ] || [ -L "$link" ]; then
    _ah_info "left $link in place (it does not point at $target)"
  else
    _ah_info "agent-harness wrapper: nothing to remove at $link"
  fi
  if [ -d "$dest" ]; then
    rm -rf "$dest"
    _ah_ok "removed $dest"
    rmdir "$harness_root/scripts" 2>/dev/null || true
    rmdir "$harness_root" 2>/dev/null || true
  else
    _ah_info "agent-harness scripts: nothing to remove at $dest"
  fi
}
