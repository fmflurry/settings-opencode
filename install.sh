#!/usr/bin/env bash
#
# settings-opencode installer
#
# Default: interactive, prompts each step.
# Flags:
#   --yes, -y       Non-interactive, accept all defaults
#   --no-claude     Skip ~/.claude mirror install
#   --uninstall     Remove env-var block and symlinks (does not delete the repo)
#   --help, -h      Show usage
#
set -euo pipefail

# ------------------------------ constants ------------------------------------

MARKER_START="# >>> settings-opencode >>>"
MARKER_END="# <<< settings-opencode <<<"
TARGET_OPENCODE="$HOME/.config/opencode"
TARGET_CLAUDE="$HOME/.claude"
REPO_DIR="$( cd "$( dirname "${BASH_SOURCE[0]:-$0}" )" && pwd )"

ASSUME_YES=0
SKIP_CLAUDE=0
DO_UNINSTALL=0

# ------------------------------ presentation ---------------------------------

if [ -t 1 ]; then
    BOLD=$'\033[1m'; DIM=$'\033[2m'
    RED=$'\033[31m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; BLUE=$'\033[34m'
    RESET=$'\033[0m'
else
    BOLD=""; DIM=""; RED=""; GREEN=""; YELLOW=""; BLUE=""; RESET=""
fi

step() { printf "\n${BOLD}${BLUE}==>${RESET} ${BOLD}%s${RESET}\n" "$*"; }
info() { printf "    %s\n" "$*"; }
ok()   { printf "    ${GREEN}OK${RESET}   %s\n" "$*"; }
warn() { printf "    ${YELLOW}WARN${RESET} %s\n" "$*"; }
err()  { printf "    ${RED}ERR${RESET}  %s\n" "$*" >&2; }

# Ask yes/no with default. $1 = prompt, $2 = default (Y or N)
ask() {
    local prompt="$1" default="${2:-Y}" hint reply
    if [ "$ASSUME_YES" = "1" ]; then
        [ "$default" = "Y" ] && return 0 || return 1
    fi
    if [ "$default" = "Y" ]; then hint="[Y/n]"; else hint="[y/N]"; fi
    while :; do
        printf "    ${BOLD}?${RESET} %s %s " "$prompt" "$hint"
        read -r reply || reply=""
        reply="${reply:-$default}"
        case "$reply" in
            Y|y|Yes|yes) return 0 ;;
            N|n|No|no)   return 1 ;;
            *) printf "    please answer y or n\n" ;;
        esac
    done
}

# ------------------------------ usage ----------------------------------------

print_help() {
    cat <<EOF
${BOLD}settings-opencode installer${RESET}

Usage: ./install.sh [flags]

Flags:
  --yes, -y       Non-interactive (accept all defaults)
  --no-claude     Skip the ~/.claude mirror install
  --uninstall     Remove the env-var block and symlinks created by this script
                  (does not delete the cloned repo or your data)
  --help, -h      Show this message

What it does (interactive by default):
  1. Verifies prerequisites (git, bun or npm).
  2. Links this repo into ~/.config/opencode (or uses it in place).
  3. Installs JS deps with bun (if available) or npm.
  4. Adds OPENCODE_MODEL_* and OPENCODE_REASONING_* defaults to your shell rc,
     fenced with markers so re-runs and uninstalls are idempotent.
  5. Optionally symlinks the .claude/ mirror into ~/.claude.
  6. Prints next steps for MCP servers and a smoke test.
EOF
}

# ------------------------------ helpers --------------------------------------

detect_shell_rc() {
    case "${SHELL:-}" in
        */zsh)  printf "%s\n" "$HOME/.zshrc" ;;
        */bash) [ -f "$HOME/.bashrc" ] && printf "%s\n" "$HOME/.bashrc" || printf "%s\n" "$HOME/.bash_profile" ;;
        */fish) printf "%s\n" "$HOME/.config/fish/config.fish" ;;
        *)      printf "" ;;
    esac
}

backup_path() {
    local target="$1" backup
    backup="${target}.bak.$(date +%Y%m%d-%H%M%S)"
    info "moving existing $target -> $backup"
    mv "$target" "$backup"
    ok "backed up to $backup"
}

# ------------------------------ env-var block --------------------------------

env_block_content() {
    cat <<'EOF'
# Added by settings-opencode installer. Edit values to match your provider.
# To remove this block, run: ~/.config/opencode/install.sh --uninstall
export OPENCODE_MODEL_PRIMARY="anthropic/claude-sonnet-4-6"
export OPENCODE_MODEL_SUBAGENT_PLANNER="anthropic/claude-opus-4-7"
export OPENCODE_MODEL_SUBAGENT_WORKER="anthropic/claude-sonnet-4-6"
export OPENCODE_MODEL_SUBAGENT_MINI="anthropic/claude-haiku-4-5"
export OPENCODE_REASONING_PRIMARY="high"
export OPENCODE_REASONING_SECONDARY="medium"
export OPENCODE_REASONING_TERTIARY="low"
EOF
}

# Insert or replace the marker-fenced block in $1 (rc file).
write_env_block() {
    local rc="$1"
    [ -f "$rc" ] || : >"$rc"

    if grep -qF "$MARKER_START" "$rc" 2>/dev/null; then
        info "updating existing settings-opencode block in $rc"
        # Strip old block (portable awk: skip lines between markers, inclusive)
        local tmp
        tmp="$(mktemp)"
        awk -v s="$MARKER_START" -v e="$MARKER_END" '
            $0 == s { skip = 1; next }
            $0 == e { skip = 0; next }
            !skip   { print }
        ' "$rc" > "$tmp"
        mv "$tmp" "$rc"
    else
        info "adding settings-opencode block to $rc"
    fi

    {
        printf "\n%s\n" "$MARKER_START"
        env_block_content
        printf "%s\n" "$MARKER_END"
    } >> "$rc"
    ok "wrote env block to $rc"
}

remove_env_block() {
    local rc="$1"
    [ -f "$rc" ] || { info "$rc not found, skipping"; return 0; }
    if ! grep -qF "$MARKER_START" "$rc" 2>/dev/null; then
        info "no settings-opencode block in $rc, skipping"
        return 0
    fi
    local tmp
    tmp="$(mktemp)"
    awk -v s="$MARKER_START" -v e="$MARKER_END" '
        $0 == s { skip = 1; next }
        $0 == e { skip = 0; next }
        !skip   { print }
    ' "$rc" > "$tmp"
    mv "$tmp" "$rc"
    ok "removed env block from $rc"
}

# ------------------------------ steps ----------------------------------------

check_prereqs() {
    step "Checking prerequisites"

    local missing=0
    if ! command -v git >/dev/null 2>&1; then
        err "git not found"; missing=1
    else
        ok "git $(git --version | awk '{print $3}')"
    fi

    local pm=""
    if command -v bun >/dev/null 2>&1; then
        pm="bun"
        ok "bun $(bun --version)"
    elif command -v npm >/dev/null 2>&1; then
        pm="npm"
        ok "npm $(npm --version) (bun not found, will use npm)"
    else
        err "neither bun nor npm found — install one before continuing"
        missing=1
    fi
    PKG_MANAGER="$pm"

    [ "$missing" = "0" ] || { err "missing required tools"; exit 1; }
}

install_repo_link() {
    step "Linking repo into $TARGET_OPENCODE"

    if [ "$REPO_DIR" = "$TARGET_OPENCODE" ]; then
        ok "repo already lives at $TARGET_OPENCODE"
        return 0
    fi
    if [ -L "$TARGET_OPENCODE" ] && [ "$(readlink "$TARGET_OPENCODE")" = "$REPO_DIR" ]; then
        ok "$TARGET_OPENCODE already symlinks to this repo"
        return 0
    fi

    if [ -e "$TARGET_OPENCODE" ] || [ -L "$TARGET_OPENCODE" ]; then
        info "$TARGET_OPENCODE exists"
        if ask "back it up and replace with a symlink to $REPO_DIR?" Y; then
            backup_path "$TARGET_OPENCODE"
        else
            warn "skipping link step — you'll need to point OpenCode at this repo manually"
            return 0
        fi
    fi

    mkdir -p "$(dirname "$TARGET_OPENCODE")"
    ln -s "$REPO_DIR" "$TARGET_OPENCODE"
    ok "symlinked $TARGET_OPENCODE -> $REPO_DIR"
}

install_deps() {
    step "Installing JS dependencies ($PKG_MANAGER)"
    cd "$REPO_DIR"
    if [ "$PKG_MANAGER" = "bun" ]; then
        bun install
    else
        npm ci || npm install
    fi
    ok "deps installed"
}

install_env_vars() {
    step "Configuring shell environment variables"

    local rc
    rc="$(detect_shell_rc)"
    if [ -z "$rc" ]; then
        warn "couldn't detect a known shell rc for SHELL=${SHELL:-unset}"
        info "add the following to your shell profile manually:"
        printf "\n"
        env_block_content | sed 's/^/        /'
        printf "\n"
        return 0
    fi

    info "target rc file: $rc"
    if ask "write the OPENCODE_MODEL_* and OPENCODE_REASONING_* defaults there?" Y; then
        write_env_block "$rc"
        info "open a new shell or run: source \"$rc\""
    else
        info "skipped. Here's the block to paste manually:"
        printf "\n"
        env_block_content | sed 's/^/        /'
        printf "\n"
    fi
}

install_claude_mirror() {
    if [ "$SKIP_CLAUDE" = "1" ]; then
        step "Claude Code mirror — skipped (--no-claude)"
        return 0
    fi

    step "Claude Code mirror"
    if ! ask "install the .claude mirror into $TARGET_CLAUDE?" Y; then
        info "skipped"
        return 0
    fi

    local source_claude="$REPO_DIR/.claude"
    if [ ! -d "$source_claude" ]; then
        warn ".claude/ not found in repo, skipping"
        return 0
    fi

    if [ -L "$TARGET_CLAUDE" ] && [ "$(readlink "$TARGET_CLAUDE")" = "$source_claude" ]; then
        ok "$TARGET_CLAUDE already symlinks here"
        return 0
    fi

    if [ -e "$TARGET_CLAUDE" ] || [ -L "$TARGET_CLAUDE" ]; then
        info "$TARGET_CLAUDE exists"
        if ask "back it up before linking?" Y; then
            backup_path "$TARGET_CLAUDE"
        else
            warn "skipping (would clobber existing $TARGET_CLAUDE)"
            return 0
        fi
    fi

    ln -s "$source_claude" "$TARGET_CLAUDE"
    ok "symlinked $TARGET_CLAUDE -> $source_claude"
}

print_next_steps() {
    step "Next steps"
    cat <<EOF
    1. Reload your shell (or:  source "$(detect_shell_rc)")
    2. Optional: install Wallaby.js + run \`wallaby update-mcp\` if you want runtime-test introspection
    3. Smoke test:
           opencode
           /plan add a TODO list to my homepage

    Adjust env-var values for your provider in $(detect_shell_rc)
    Re-run anytime: $REPO_DIR/install.sh
    Uninstall:     $REPO_DIR/install.sh --uninstall
EOF
}

# ------------------------------ uninstall ------------------------------------

run_uninstall() {
    step "Uninstall"
    info "this will:"
    info "  - remove the marker-fenced env block from your shell rc"
    info "  - remove $TARGET_OPENCODE if it symlinks to this repo"
    info "  - remove $TARGET_CLAUDE if it symlinks to this repo"
    info "the cloned repo at $REPO_DIR is left intact."
    if ! ask "proceed?" N; then
        info "aborted"
        exit 0
    fi

    local rc
    rc="$(detect_shell_rc)"
    [ -n "$rc" ] && remove_env_block "$rc" || warn "no known shell rc detected, skipping env block"

    if [ -L "$TARGET_OPENCODE" ] && [ "$(readlink "$TARGET_OPENCODE")" = "$REPO_DIR" ]; then
        rm "$TARGET_OPENCODE"
        ok "removed symlink $TARGET_OPENCODE"
    else
        info "$TARGET_OPENCODE is not a symlink to this repo, leaving it alone"
    fi

    if [ -L "$TARGET_CLAUDE" ] && [ "$(readlink "$TARGET_CLAUDE")" = "$REPO_DIR/.claude" ]; then
        rm "$TARGET_CLAUDE"
        ok "removed symlink $TARGET_CLAUDE"
    else
        info "$TARGET_CLAUDE is not a symlink to this repo, leaving it alone"
    fi

    step "Done. Backups (if any) are at *.bak.YYYYMMDD-HHMMSS — restore manually if you want them back."
}

# ------------------------------ main -----------------------------------------

while [ $# -gt 0 ]; do
    case "$1" in
        --yes|-y)     ASSUME_YES=1 ;;
        --no-claude)  SKIP_CLAUDE=1 ;;
        --uninstall)  DO_UNINSTALL=1 ;;
        -h|--help)    print_help; exit 0 ;;
        *) err "unknown flag: $1"; print_help; exit 1 ;;
    esac
    shift
done

if [ "$DO_UNINSTALL" = "1" ]; then
    run_uninstall
    exit 0
fi

step "settings-opencode installer"
info "repo:    $REPO_DIR"
info "target:  $TARGET_OPENCODE"
info "claude:  $([ "$SKIP_CLAUDE" = "1" ] && echo "skipped" || echo "$TARGET_CLAUDE")"
info "mode:    $([ "$ASSUME_YES" = "1" ] && echo "non-interactive" || echo "interactive")"

check_prereqs
install_repo_link
install_deps
install_env_vars
install_claude_mirror
print_next_steps
