#!/usr/bin/env bash
#
# settings-sync.sh — propagate settings-opencode config from anywhere on disk.
#
# Locates the settings-opencode repo regardless of cwd (via
# SETTINGS_OPENCODE_REPO, then well-known clone locations) and runs the
# installer or the skills-only fast path against it.
#
# Usage:
#   settings-sync [flags]
#
# Flags:
#   (none)            Full install: install.sh --yes. Monolith is the default.
#   --skills-only      Fast path: sync-skills.sh into both harness targets
#   --opencode-only     install.sh --yes --no-claude. Monolith unless a variant is set.
#   --claude-only       install.sh --yes --no-opencode. Monolith unless a variant is set.
#   --where             Print the resolved repo path and exit
#   --help, -h          Show this message
#   <anything else>     Forwarded verbatim to install.sh after --yes.
#                       conductor selects Conductor. orchestration is an alias.
#
set -euo pipefail

print_help() {
    cat <<EOF
settings-sync — update settings-opencode config from anywhere

Usage: settings-sync [flags]

Flags:
  (none)           Full install: install.sh --yes. Monolith is the default.
  --skills-only    Fast path: sync-skills.sh into both harness targets
  --opencode-only  install.sh --yes --no-claude. Monolith unless a variant is set.
  --claude-only    install.sh --yes --no-opencode. Monolith unless a variant is set.
  --where          Print the resolved repo path and exit
  --help, -h       Show this message

Any other flags are forwarded verbatim to install.sh after --yes.
With no variant, Monolith is the default. conductor selects Conductor.
orchestration is an alias of conductor. HARNESS_VARIANT still wins when set.

Repo resolution order:
  1. \$SETTINGS_OPENCODE_REPO (if set and it has an executable install.sh)
  2. \$HOME/Workspace/settings-opencode
  3. \$HOME/.local/share/settings-opencode
EOF
}

resolve_repo() {
    if [ -n "${SETTINGS_OPENCODE_REPO:-}" ] && [ -x "$SETTINGS_OPENCODE_REPO/install.sh" ]; then
        printf '%s\n' "$SETTINGS_OPENCODE_REPO"
        return 0
    fi
    if [ -d "$HOME/Workspace/settings-opencode" ]; then
        printf '%s\n' "$HOME/Workspace/settings-opencode"
        return 0
    fi
    if [ -d "$HOME/.local/share/settings-opencode" ]; then
        printf '%s\n' "$HOME/.local/share/settings-opencode"
        return 0
    fi
    err "cannot locate settings-opencode repo; set SETTINGS_OPENCODE_REPO"
    return 1
}

err() { printf "%s\n" "$*" >&2; }

forwards_variant() {
    local arg
    for arg in "$@"; do
        case "$arg" in
            --variant|--variant=*)
                return 0
                ;;
            conductor|Conductor|CONDUCTOR|monolith|Monolith|MONOLITH|orchestration|Orchestration|ORCHESTRATION|1|2)
                return 0
                ;;
        esac
    done
    return 1
}

ensure_monolith_default() {
    if forwards_variant "$@"; then
        return 0
    fi
    if [ -z "${HARNESS_VARIANT:-}" ]; then
        export HARNESS_VARIANT=monolith
    fi
}

case "${1:-}" in
    -h|--help)
        print_help
        exit 0
        ;;
esac

REPO="$(resolve_repo)"

case "${1:-}" in
    --where)
        printf '%s\n' "$REPO"
        exit 0
        ;;
    --skills-only)
        SYNC_SCRIPT="$REPO/scripts/sync-skills.sh"
        [ -x "$SYNC_SCRIPT" ] || { err "sync-skills.sh not found or not executable at $SYNC_SCRIPT"; exit 1; }
        exec bash "$SYNC_SCRIPT" "$HOME/.config/opencode/skills" "$HOME/.claude/skills"
        ;;
    --opencode-only)
        INSTALL_SCRIPT="$REPO/install.sh"
        [ -x "$INSTALL_SCRIPT" ] || { err "install.sh not found or not executable at $INSTALL_SCRIPT"; exit 1; }
        ensure_monolith_default
        exec bash "$INSTALL_SCRIPT" --yes --no-claude
        ;;
    --claude-only)
        INSTALL_SCRIPT="$REPO/install.sh"
        [ -x "$INSTALL_SCRIPT" ] || { err "install.sh not found or not executable at $INSTALL_SCRIPT"; exit 1; }
        ensure_monolith_default
        exec bash "$INSTALL_SCRIPT" --yes --no-opencode
        ;;
    *)
        INSTALL_SCRIPT="$REPO/install.sh"
        [ -x "$INSTALL_SCRIPT" ] || { err "install.sh not found or not executable at $INSTALL_SCRIPT"; exit 1; }
        ensure_monolith_default "$@"
        exec bash "$INSTALL_SCRIPT" --yes "$@"
        ;;
esac
