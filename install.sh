#!/usr/bin/env bash
#
# settings-opencode installer
#
# Default: interactive, prompts each step.
# Flags:
#   --yes, -y       Non-interactive, accept all defaults
#   --no-claude     Skip ~/.claude mirror install
#   --uninstall     Remove env-var block and installed copies (does not delete the repo)
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
WSL_MODE=0
WSL_WIN_HOME=""

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
  --uninstall     Remove the env-var block and copies created by this script
                  (does not delete the cloned repo or your data)
  --help, -h      Show this message

What it does (interactive by default):
  1. Verifies prerequisites (git, bun or npm).
  2. Copies this repo into ~/.config/opencode (or uses it in place).
  3. Installs JS deps with bun (if available) or npm.
  4. Adds OPENCODE_MODEL_* and OPENCODE_REASONING_* defaults to your shell rc,
     fenced with markers so re-runs and uninstalls are idempotent.
  5. Optionally copies the .claude/ mirror into ~/.claude.
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

# Copy src/ contents into dst/ as a real copy (not a symlink).
# Used for both the local install and the WSL -> Windows install (where symlinks
# across /mnt/c don't work). Excludes node_modules (reinstalled in the target),
# .git, and transient artifacts. Additive — does NOT use --delete, so runtime
# state created in the target (auth.json, sessions, memory/, projects/) survives
# re-runs. Files removed from the repo are therefore not pruned from the target.
copy_tree() {
    local src="$1" dst="$2"
    if ! command -v rsync >/dev/null 2>&1; then
        err "rsync is required to copy files into the install target"
        err "  macOS: rsync ships by default"
        err "  Debian/Ubuntu: sudo apt install -y rsync"
        exit 1
    fi
    mkdir -p "$dst"
    rsync -a \
        --exclude='node_modules' \
        --exclude='.git' \
        --exclude='*.log' \
        --exclude='.DS_Store' \
        "$src/" "$dst/"
}

# ------------------------------ env-var block --------------------------------

env_block_content() {
    cat <<'EOF'
# Added by settings-opencode installer. Edit values to match your provider.
# To remove this block, run: ~/.config/opencode/install.sh --uninstall
# Defaults target the myMistral provider configured in opencode.jsonc.
export OPENCODE_MODEL_CONDUCTOR="myMistral/mistral-medium-2604"
export OPENCODE_MODEL_SUBAGENT_PLANNER="myMistral/mistral-large-latest"
export OPENCODE_MODEL_SUBAGENT_WORKER="myMistral/mistral-medium-latest"
export OPENCODE_MODEL_SUBAGENT_MINI="myMistral/mistral-small-latest"
export OPENCODE_REASONING_CONDUCTOR="high"
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

is_wsl() {
    grep -qiE "(microsoft|wsl)" /proc/version 2>/dev/null
}

detect_wsl_windows_user() {
    local u=""
    if command -v cmd.exe >/dev/null 2>&1; then
        u="$(cmd.exe /c 'echo %USERNAME%' 2>/dev/null | tr -d '\r\n' || true)"
    fi
    if [ -z "$u" ] && command -v wslvar >/dev/null 2>&1; then
        u="$(wslvar USERNAME 2>/dev/null | tr -d '\r\n' || true)"
    fi
    if [ -z "$u" ] && command -v powershell.exe >/dev/null 2>&1; then
        u="$(powershell.exe -NoProfile -Command '[Environment]::UserName' 2>/dev/null | tr -d '\r\n' || true)"
    fi
    printf "%s" "$u"
}

configure_wsl_targets() {
    is_wsl || return 0
    info "WSL detected — opencode config lives on the Windows side"
    local winuser
    winuser="$(detect_wsl_windows_user)"
    if [ -z "$winuser" ] || [ ! -d "/mnt/c/Users/$winuser" ]; then
        warn "could not auto-detect your Windows username under /mnt/c/Users"
        if [ "$ASSUME_YES" = "1" ]; then
            err "non-interactive run cannot prompt — aborting. Pass --windows-user=<name> or run interactively."
            exit 1
        fi
        printf "    ${BOLD}?${RESET} Enter your Windows username (folder under /mnt/c/Users): "
        read -r winuser || winuser=""
        winuser="$(printf "%s" "$winuser" | tr -d '\r\n')"
        if [ -z "$winuser" ] || [ ! -d "/mnt/c/Users/$winuser" ]; then
            err "invalid Windows user — /mnt/c/Users/$winuser does not exist"
            exit 1
        fi
    fi
    WSL_WIN_HOME="/mnt/c/Users/$winuser"
    TARGET_OPENCODE="$WSL_WIN_HOME/.config/opencode"
    TARGET_CLAUDE="$WSL_WIN_HOME/.claude"
    WSL_MODE=1
    ok "Windows home: $WSL_WIN_HOME"
    ok "opencode target: $TARGET_OPENCODE"
    ok "claude target:   $TARGET_CLAUDE"
}

check_prereqs() {
    step "Checking prerequisites"

    local missing=0
    if ! command -v git >/dev/null 2>&1; then
        err "git not found"; missing=1
    else
        ok "git $(git --version | awk '{print $3}')"
    fi

    local pm=""
    if [ "$WSL_MODE" = "1" ]; then
        info "WSL mode — bun/npm not required on Linux side (Windows handles deps)"
        if ! command -v rsync >/dev/null 2>&1; then
            err "rsync not found — required for WSL -> Windows copy"
            err "  sudo apt install -y rsync"
            missing=1
        else
            ok "rsync $(rsync --version | head -1 | awk '{print $3}')"
        fi
    else
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
    fi
    PKG_MANAGER="$pm"

    [ "$missing" = "0" ] || { err "missing required tools"; exit 1; }
}

check_environment() {
    step "Checking environment"

    # 1. Detect Windows Node leaking into WSL (only matters for Linux-side install).
    if is_wsl && [ "$WSL_MODE" != "1" ]; then
        local node_path node_platform
        node_path="$(command -v node 2>/dev/null || true)"
        if [ -n "$node_path" ]; then
            case "$node_path" in
                /mnt/c/*|/mnt/[a-z]/*)
                    err "node resolves to a Windows path: $node_path"
                    err "Windows Node cannot build native modules (better-sqlite3) from a WSL path."
                    err "Install Linux Node inside WSL:"
                    err "  sudo apt update && sudo apt install -y build-essential python3 curl"
                    err "  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash"
                    err "  source ~/.bashrc && nvm install --lts && nvm use --lts"
                    err "Then re-run this installer."
                    exit 1
                    ;;
            esac
            node_platform="$("$node_path" -p "process.platform" 2>/dev/null || true)"
            if [ -n "$node_platform" ] && [ "$node_platform" != "linux" ]; then
                err "node platform is '$node_platform', expected 'linux' inside WSL"
                err "You are running a non-Linux Node binary. Install Linux Node via nvm."
                exit 1
            fi
            ok "Linux Node at $node_path"
        fi
    fi

    # 2. Repo dir writable by current user.
    if [ ! -w "$REPO_DIR" ]; then
        err "$REPO_DIR is not writable by user '$USER'"
        err "Fix ownership:  sudo chown -R \"$USER:$USER\" \"$REPO_DIR\""
        exit 1
    fi

    # 3. Stale node_modules owned by another user (classic 'sudo npm install' aftermath).
    if [ -d "$REPO_DIR/node_modules" ]; then
        local nm_owner
        nm_owner="$(stat -c '%U' "$REPO_DIR/node_modules" 2>/dev/null || stat -f '%Su' "$REPO_DIR/node_modules" 2>/dev/null || echo "")"
        if [ -n "$nm_owner" ] && [ "$nm_owner" != "$USER" ]; then
            err "$REPO_DIR/node_modules is owned by '$nm_owner', not '$USER'"
            err "Likely a previous 'sudo npm install' or a failed Windows-Node attempt."
            err "Clean it up:"
            err "  sudo rm -rf \"$REPO_DIR/node_modules\" \"$REPO_DIR/package-lock.json\""
            err "  sudo chown -R \"$USER:$USER\" \"$REPO_DIR\""
            err "Then re-run this installer (without sudo)."
            exit 1
        fi
        if [ ! -w "$REPO_DIR/node_modules" ]; then
            err "$REPO_DIR/node_modules exists but is not writable by '$USER'"
            err "Clean it up:"
            err "  sudo rm -rf \"$REPO_DIR/node_modules\" \"$REPO_DIR/package-lock.json\""
            err "Then re-run this installer (without sudo)."
            exit 1
        fi
    fi

    # 4. Refuse to run the installer itself as root.
    if [ "${EUID:-$(id -u)}" = "0" ]; then
        err "Do not run install.sh as root/sudo."
        err "It will create root-owned node_modules that you can't modify later."
        err "Run as your normal user."
        exit 1
    fi

    ok "environment looks sane"
}

install_repo_link() {
    if [ "$WSL_MODE" = "1" ]; then
        step "Copying repo into $TARGET_OPENCODE (WSL -> Windows)"
        if [ -e "$TARGET_OPENCODE" ] && [ ! -L "$TARGET_OPENCODE" ]; then
            info "$TARGET_OPENCODE exists"
            if ask "back it up and replace with a fresh copy of $REPO_DIR?" Y; then
                backup_path "$TARGET_OPENCODE"
            else
                warn "skipping copy — Windows opencode will keep using whatever is already there"
                return 0
            fi
        elif [ -L "$TARGET_OPENCODE" ]; then
            info "$TARGET_OPENCODE is a symlink — removing (Windows can't follow WSL symlinks)"
            rm "$TARGET_OPENCODE"
        fi
        copy_tree "$REPO_DIR" "$TARGET_OPENCODE"
        ok "copied $REPO_DIR -> $TARGET_OPENCODE (node_modules excluded)"
        return 0
    fi

    step "Copying repo into $TARGET_OPENCODE"

    if [ "$REPO_DIR" = "$TARGET_OPENCODE" ]; then
        ok "repo already lives at $TARGET_OPENCODE"
        return 0
    fi

    if [ -L "$TARGET_OPENCODE" ]; then
        info "$TARGET_OPENCODE is a legacy symlink — removing before copying"
        rm "$TARGET_OPENCODE"
    elif [ -e "$TARGET_OPENCODE" ]; then
        info "$TARGET_OPENCODE exists"
        if ask "back it up and replace with a fresh copy of $REPO_DIR?" Y; then
            backup_path "$TARGET_OPENCODE"
        else
            warn "skipping copy step — you'll need to point OpenCode at this repo manually"
            return 0
        fi
    fi

    copy_tree "$REPO_DIR" "$TARGET_OPENCODE"
    ok "copied $REPO_DIR -> $TARGET_OPENCODE (node_modules excluded)"
}

install_deps() {
    if [ "$WSL_MODE" = "1" ]; then
        step "Skipping Linux-side npm install (WSL mode)"
        warn "Windows opencode needs node_modules built with Windows Node.js."
        warn "Linux Node would produce binaries Windows cannot load (better-sqlite3, etc.)."
        info "From PowerShell or cmd.exe on Windows, run:"
        info "  cd \"%USERPROFILE%\\.config\\opencode\""
        info "  npm install        (or: bun install)"
        return 0
    fi

    # Install into the live copy so node_modules lands where OpenCode reads from.
    # Falls back to the repo if the copy step was skipped.
    local opencode_dir="$REPO_DIR"
    [ -d "$TARGET_OPENCODE" ] && opencode_dir="$TARGET_OPENCODE"

    step "Installing JS dependencies ($PKG_MANAGER) in $opencode_dir"
    cd "$opencode_dir"
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

    if [ "$WSL_MODE" = "1" ]; then
        info "WSL mode — copying instead of symlinking"
        if [ -e "$TARGET_CLAUDE" ] && [ ! -L "$TARGET_CLAUDE" ]; then
            if ask "back up existing $TARGET_CLAUDE and replace with fresh copy?" Y; then
                backup_path "$TARGET_CLAUDE"
            else
                warn "skipping"
                return 0
            fi
        elif [ -L "$TARGET_CLAUDE" ]; then
            rm "$TARGET_CLAUDE"
        fi
        copy_tree "$source_claude" "$TARGET_CLAUDE"
        ok "copied $source_claude -> $TARGET_CLAUDE"
        return 0
    fi

    if [ -L "$TARGET_CLAUDE" ]; then
        info "$TARGET_CLAUDE is a legacy symlink — removing before copying"
        rm "$TARGET_CLAUDE"
    elif [ -e "$TARGET_CLAUDE" ]; then
        info "$TARGET_CLAUDE exists"
        if ask "back it up before copying? (runtime state like memory/ and projects/ is preserved on re-runs, not on this replace)" Y; then
            backup_path "$TARGET_CLAUDE"
        else
            info "merging fresh copy into existing $TARGET_CLAUDE (existing files preserved)"
        fi
    fi

    copy_tree "$source_claude" "$TARGET_CLAUDE"
    ok "copied $source_claude -> $TARGET_CLAUDE"
}

print_next_steps() {
    step "Next steps"
    if [ "$WSL_MODE" = "1" ]; then
        cat <<EOF
    WSL -> Windows install. Finish setup from a Windows shell (PowerShell or cmd.exe):

        cd "%USERPROFILE%\\.config\\opencode"
        npm install        (or: bun install)

    Then in WSL:
    1. Reload your shell (or:  source "$(detect_shell_rc)")
    2. Re-run this script to push fresh changes from the repo to the Windows target.

    Adjust env-var values for your provider in $(detect_shell_rc)
    Re-run anytime: $REPO_DIR/install.sh
    Uninstall:     $REPO_DIR/install.sh --uninstall
EOF
        return 0
    fi
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
    configure_wsl_targets

    step "Uninstall"
    info "this will:"
    info "  - remove the marker-fenced env block from your shell rc"
    info "  - remove the copied directory at $TARGET_OPENCODE (after confirm)"
    info "  - remove the copied directory at $TARGET_CLAUDE (after confirm)"
    info "the cloned repo at $REPO_DIR is left intact."
    if ! ask "proceed?" N; then
        info "aborted"
        exit 0
    fi

    local rc
    rc="$(detect_shell_rc)"
    [ -n "$rc" ] && remove_env_block "$rc" || warn "no known shell rc detected, skipping env block"

    if [ "$WSL_MODE" = "1" ]; then
        if [ -d "$TARGET_OPENCODE" ] && [ ! -L "$TARGET_OPENCODE" ]; then
            if ask "delete copied directory $TARGET_OPENCODE ?" N; then
                rm -rf "$TARGET_OPENCODE"
                ok "removed $TARGET_OPENCODE"
            else
                info "left $TARGET_OPENCODE in place"
            fi
        else
            info "$TARGET_OPENCODE not found or not a directory, skipping"
        fi
        if [ -d "$TARGET_CLAUDE" ] && [ ! -L "$TARGET_CLAUDE" ]; then
            if ask "delete copied directory $TARGET_CLAUDE ?" N; then
                rm -rf "$TARGET_CLAUDE"
                ok "removed $TARGET_CLAUDE"
            else
                info "left $TARGET_CLAUDE in place"
            fi
        else
            info "$TARGET_CLAUDE not found or not a directory, skipping"
        fi
    else
        if [ -L "$TARGET_OPENCODE" ] && [ "$(readlink "$TARGET_OPENCODE")" = "$REPO_DIR" ]; then
            rm "$TARGET_OPENCODE"
            ok "removed legacy symlink $TARGET_OPENCODE"
        elif [ -d "$TARGET_OPENCODE" ] && [ "$TARGET_OPENCODE" != "$REPO_DIR" ]; then
            if ask "delete copied directory $TARGET_OPENCODE ?" N; then
                rm -rf "$TARGET_OPENCODE"
                ok "removed $TARGET_OPENCODE"
            else
                info "left $TARGET_OPENCODE in place"
            fi
        else
            info "$TARGET_OPENCODE is not managed by this installer, leaving it alone"
        fi
        if [ -L "$TARGET_CLAUDE" ] && [ "$(readlink "$TARGET_CLAUDE")" = "$REPO_DIR/.claude" ]; then
            rm "$TARGET_CLAUDE"
            ok "removed legacy symlink $TARGET_CLAUDE"
        elif [ -d "$TARGET_CLAUDE" ]; then
            if ask "delete copied directory $TARGET_CLAUDE ? (this includes any runtime state stored there)" N; then
                rm -rf "$TARGET_CLAUDE"
                ok "removed $TARGET_CLAUDE"
            else
                info "left $TARGET_CLAUDE in place"
            fi
        else
            info "$TARGET_CLAUDE is not managed by this installer, leaving it alone"
        fi
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
info "mode:    $([ "$ASSUME_YES" = "1" ] && echo "non-interactive" || echo "interactive")"

configure_wsl_targets
check_prereqs
check_environment

info "target:  $TARGET_OPENCODE"
info "claude:  $([ "$SKIP_CLAUDE" = "1" ] && echo "skipped" || echo "$TARGET_CLAUDE")"

install_repo_link
install_deps
install_env_vars
install_claude_mirror
print_next_steps
