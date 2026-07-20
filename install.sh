#!/usr/bin/env bash
#
# settings-opencode installer
#
# Default: interactive, prompts each step.
# Flags:
#   --yes, -y       Non-interactive, accept all defaults
#   --opencode      Allowlist: install opencode only (unless combined with --claude)
#   --claude        Allowlist: install claude only (unless combined with --opencode)
#   --no-opencode   Force-skip opencode (wins over allowlist)
#   --no-claude     Force-skip claude (wins over allowlist)
#   --uninstall     Remove env-var block and installed copies (does not delete the repo)
#   --local         Project-scoped install into the current working directory
#                   (./.opencode, ./.claude). Does not touch shell rc files.
#   --help, -h      Show usage
#
set -euo pipefail

# Capture invocation directory before any cd happens.
INVOKE_DIR="$PWD"

# ------------------------------ constants ------------------------------------

MARKER_START="# >>> settings-opencode >>>"
MARKER_END="# <<< settings-opencode <<<"
TARGET_OPENCODE="$HOME/.config/opencode"
TARGET_CLAUDE="$HOME/.claude"
REPO_DIR="$( cd "$( dirname "${BASH_SOURCE[0]:-$0}" )" && pwd )"

ASSUME_YES=0
SKIP_CLAUDE=0
SKIP_OPENCODE=0
DO_UNINSTALL=0
LOCAL_MODE=0
WSL_MODE=0
WSL_WIN_HOME=""
WSL_OPENCODE_WIN_PATH=""
OPENCODE_TARGET_READY=0
CLAUDE_TARGET_READY=0

# Positive-flag allowlist trackers (0 = not explicitly requested)
FLAG_OPENCODE=0
FLAG_CLAUDE=0
FLAG_LOCAL=0

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

read_reply() {
    local __var="$1" __reply
    if [ -r /dev/tty ]; then
        read -r __reply </dev/tty || __reply=""
    else
        err "cannot prompt without a controlling TTY; pass --yes for non-interactive defaults"
        exit 1
    fi
    printf -v "$__var" "%s" "$__reply"
}

confirm_existing_local_opencode() {
    [ "$LOCAL_MODE" = "1" ] || return 0
    [ -d "$TARGET_OPENCODE" ] || return 0

    if [ "$ASSUME_YES" = "1" ]; then
        warn "$TARGET_OPENCODE exists; --yes does not merge into an existing local .opencode without target-specific confirmation"
        return 1
    fi

    local reply
    printf "    ${BOLD}?${RESET} Merge settings-opencode files into existing local target $TARGET_OPENCODE? Type yes to continue [y/N] "
    read_reply reply
    case "$reply" in
        Y|y|Yes|yes) return 0 ;;
        *) return 1 ;;
    esac
}

confirm_existing_local_claude() {
    [ "$LOCAL_MODE" = "1" ] || return 0
    [ -d "$TARGET_CLAUDE" ] || return 0

    if [ "$ASSUME_YES" = "1" ]; then
        warn "$TARGET_CLAUDE exists; --yes does not merge into an existing local .claude without target-specific confirmation"
        return 1
    fi

    local reply
    printf "    ${BOLD}?${RESET} Merge settings-opencode files into existing local target $TARGET_CLAUDE? Type yes to continue [y/N] "
    read_reply reply
    case "$reply" in
        Y|y|Yes|yes) return 0 ;;
        *) return 1 ;;
    esac
}

handle_nested_opencode_claude() {
    local nested_claude="$TARGET_OPENCODE/.claude"
    [ -e "$nested_claude" ] || [ -L "$nested_claude" ] || return 0

    if [ "$REPO_DIR" = "$TARGET_OPENCODE" ]; then
        err "repo already lives at the OpenCode target and contains nested .claude: $nested_claude"
        err "refusing to continue; move or remove that .claude directory explicitly, then re-run the installer"
        exit 1
    fi

    if [ "$ASSUME_YES" = "1" ]; then
        err "unexpected nested .claude inside OpenCode target: $nested_claude"
        err "--yes cannot remove it without target-specific confirmation; remove it manually or re-run interactively and confirm deletion"
        exit 1
    fi

    if ask "delete unexpected nested .claude inside the OpenCode target at $nested_claude ?" N; then
        if ! rm -rf "$nested_claude"; then
            err "failed to remove nested .claude inside OpenCode target: $nested_claude"
            err "refusing to continue until it is removed"
            exit 1
        fi
        if [ -e "$nested_claude" ] || [ -L "$nested_claude" ]; then
            err "failed to remove nested .claude inside OpenCode target: $nested_claude"
            err "refusing to continue until it is removed"
            exit 1
        fi
        ok "removed $nested_claude"
    else
        err "left unexpected nested .claude in place: $nested_claude"
        err "refusing to continue; remove it manually or re-run and confirm deletion"
        exit 1
    fi
}

# Ask yes/no with default. $1 = prompt, $2 = default (Y or N)
ask() {
    local prompt="$1" default="${2:-Y}" hint reply
    if [ "$ASSUME_YES" = "1" ]; then
        [ "$default" = "Y" ] && return 0 || return 1
    fi
    if [ "$default" = "Y" ]; then hint="[Y/n]"; else hint="[y/N]"; fi
    while :; do
        printf "    ${BOLD}?${RESET} %s %s " "$prompt" "$hint"
        read_reply reply
        reply="${reply:-$default}"
        case "$reply" in
            Y|y|Yes|yes) return 0 ;;
            N|n|No|no)   return 1 ;;
            *) printf "    please answer y or n\n" ;;
        esac
    done
}

ask_harness_choice() {
    local reply
    while :; do
        printf "    ${BOLD}?${RESET} Choose harness to install: ClaudeCode, OpenCode, or both [both] "
        read_reply reply
        reply="${reply:-both}"
        case "$reply" in
            1|ClaudeCode|Claude\ Code|claudecode|claude-code|claude)
                SKIP_CLAUDE=0
                SKIP_OPENCODE=1
                return 0
                ;;
            2|OpenCode|opencode|open-code)
                SKIP_CLAUDE=1
                SKIP_OPENCODE=0
                return 0
                ;;
            3|both|Both|BOTH)
                SKIP_CLAUDE=0
                SKIP_OPENCODE=0
                return 0
                ;;
            *) printf "    please answer ClaudeCode, OpenCode, or both\n" ;;
        esac
    done
}

ask_install_scope() {
    local reply
    while :; do
        printf "    ${BOLD}?${RESET} Choose install scope: global or local current directory [global] "
        read_reply reply
        reply="${reply:-global}"
        case "$reply" in
            1|global|Global|GLOBAL)
                LOCAL_MODE=0
                return 0
                ;;
            2|local|Local|LOCAL|cwd|CWD)
                LOCAL_MODE=1
                return 0
                ;;
            *) printf "    please answer global or local\n" ;;
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
  --opencode      Install opencode config into ~/.config/opencode (allowlist flag)
  --claude        Install claude config into ~/.claude (allowlist flag)
  --no-opencode   Force-skip opencode (wins over any allowlist)
  --no-claude     Force-skip claude (wins over any allowlist)
  --uninstall     Remove the env-var block and copies created by this script
                  (does not delete the cloned repo or your data)
  --local         Project-scoped install into the current working directory.
                  Copies repo into ./.opencode and ./.claude.
                  Does not touch global shell rc files. Combine with --yes,
                  --no-claude, --no-opencode, and --uninstall as normal. Do
                  NOT run this from inside the settings-opencode repo itself.
  --help, -h      Show this message

Target paths (global mode):
  opencode → ~/.config/opencode
  claude   → ~/.claude

Target paths (--local mode):
  opencode → ./.opencode
  claude   → ./.claude

Allowlist semantics:
  By default: opencode ON, claude ON.
  If ANY positive flag (--opencode / --claude) is present, only those
  targets are candidates — the others default to OFF.
  Opt-out flags (--no-*) force their target OFF and win over the allowlist.
  If both targets end up OFF → error "nothing to install".

What it does (interactive by default):
  1. Verifies prerequisites (git, bun or npm).
  2. Merges this repo into ~/.config/opencode (or uses it in place).
  3. Installs JS deps with bun (if available) or npm.
  4. Adds OPENCODE_MODEL_* and OPENCODE_REASONING_* defaults to your shell rc,
     fenced with markers so re-runs and uninstalls are idempotent.
  5. Optionally merges the .claude/ mirror into ~/.claude.
  6. Prints next steps for MCP servers and a smoke test.

  With --local, steps 2-3 and 5 target ./.opencode and ./.claude in the cwd.
  Step 4 (shell rc) is skipped; the env block is printed to stdout instead.

  With --no-opencode, steps 2-4 are skipped entirely; only step 5 runs.
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

# Copy src/ contents into dst/ as a real copy (not a symlink).
# Used for both the local install and the WSL -> Windows install (where symlinks
# across /mnt/c don't work). Excludes node_modules (reinstalled in the target),
# .git, the ClaudeCode mirror, and transient artifacts. Also excludes assets,
# vibe, and removed OCX files so they are never installed even if reintroduced accidentally.
# Additive — does NOT use --delete, so runtime state created in the target
# (auth.json, sessions, memory/, projects/) survives re-runs. Files removed
# from the repo are therefore not pruned from the target.
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
        --exclude='.claude' \
        --exclude='*.log' \
        --exclude='.DS_Store' \
        --exclude='*.bak' \
        --exclude='*.bak.*' \
        --exclude='.serena' \
        --exclude='assets' \
        --exclude='ocx.jsonc' \
        --exclude='profiles/default/ocx.jsonc' \
        --exclude='.vibe' \
        --exclude='vibe' \
        --exclude='install.sh' \
        --exclude='install-cursor.sh' \
        --exclude='bootstrap.sh' \
        --exclude='bootstrap.ps1' \
        --exclude='*.test.*' \
        --exclude='*.spec.*' \
        --exclude='__tests__' \
        --exclude='__mocks__' \
        "$src/" "$dst/"
}

ensure_opencode_runtime_dirs() {
    mkdir -p "$TARGET_OPENCODE/data/opencode"
}

# Copy src/ into dst/ but protect personal config files from being overwritten
# on reinstall. Repo-managed content (skills/, agents/, rules/, etc.) is still
# updated normally. Personal files (settings.json, settings.local.json,
# policy-limits.json, *.local.json) are seeded on first install only.
copy_tree_with_seed() {
    local src="$1" dst="$2"
    if ! command -v rsync >/dev/null 2>&1; then
        err "rsync is required to copy files into the install target"
        err "  macOS: rsync ships by default"
        err "  Debian/Ubuntu: sudo apt install -y rsync"
        exit 1
    fi
    mkdir -p "$dst"

    # Pass 1: update all repo-managed content, excluding personal config files.
    rsync -a \
        --exclude='node_modules' \
        --exclude='.git' \
        --exclude='*.log' \
        --exclude='.DS_Store' \
        --exclude='*.bak' \
        --exclude='*.bak.*' \
        --exclude='.serena' \
        --exclude='install.sh' \
        --exclude='install-cursor.sh' \
        --exclude='bootstrap.sh' \
        --exclude='bootstrap.ps1' \
        --exclude='settings.json' \
        --exclude='settings.local.json' \
        --exclude='policy-limits.json' \
        --exclude='*.local.json' \
        --exclude='*.test.*' \
        --exclude='*.spec.*' \
        --exclude='__tests__' \
        --exclude='__mocks__' \
        "$src/" "$dst/"

    # Pass 2: seed personal config files on first install only (--ignore-existing
    # means they are never overwritten on reinstall, preserving user edits).
    rsync -a --ignore-existing \
        --include='settings.json' \
        --include='settings.local.json' \
        --include='policy-limits.json' \
        --include='*.local.json' \
        --exclude='*' \
        "$src/" "$dst/"
}

# Claude Code stores conversation and runtime data alongside configuration. Never
# mirror that tree wholesale: only canonical, repository-owned assets are copied.
CLAUDE_MANAGED_ALLOWLIST=("CLAUDE.md" "RTK.md" "agents" "hooks" "rules" "skills" "policy-limits.json")

copy_claude_allowlist() {
    local src="$1" dst="$2" managed
    if ! command -v rsync >/dev/null 2>&1; then
        err "rsync is required to copy managed Claude Code assets"
        exit 1
    fi
    mkdir -p "$dst"
    for managed in "${CLAUDE_MANAGED_ALLOWLIST[@]}"; do
        [ -e "$src/$managed" ] || continue
        mkdir -p "$dst/$(dirname "$managed")"
        rsync -a \
            --exclude='projects' \
            --exclude='sessions' \
            --exclude='history' \
            --exclude='backups' \
            --exclude='debug' \
            --exclude='statsig' \
            --exclude='todos' \
            --exclude='file-history' \
            --exclude='session-env' \
            --exclude='shell-snapshots' \
            --exclude='homunculus' \
            --exclude='cache' \
            --exclude='data' \
            --exclude='*.log' \
            --exclude='*.bak' \
            --exclude='*.test.*' \
            --exclude='*.spec.*' \
            --exclude='__tests__' \
            --exclude='__mocks__' \
            "$src/$managed" "$dst/$(dirname "$managed")/"
    done
    # Fresh and Claude-only installs need the canonical baseline before the
    # runtime merger adds its one managed hook. Existing user settings are
    # deliberately never replaced.
    if [ -f "$src/settings.json" ] && [ ! -e "$dst/settings.json" ] && [ ! -L "$dst/settings.json" ]; then
        cp "$src/settings.json" "$dst/settings.json"
        chmod 600 "$dst/settings.json"
    fi
}

localize_claude_settings_hooks() {
    local settings_file="$1" tmp grep_status

    if grep -qF '"~/.claude/' "$settings_file"; then
        :
    else
        grep_status=$?
        [ "$grep_status" -eq 1 ] && return 0
        return "$grep_status"
    fi

    info "rewriting hook paths for --local mode"
    tmp="$(mktemp "${settings_file}.XXXXXX")"
    cp -p "$settings_file" "$tmp"
    sed 's|"~/.claude/|"./.claude/|g' "$settings_file" > "$tmp"
    mv "$tmp" "$settings_file"
    ok "hook paths localized in $settings_file"
}

# Sync the canonical skill union (root skills/ ∪ .claude/skills/, root wins)
# into each installed target's skills/ directory.  Delegates to scripts/sync-skills.sh.
sync_skills() {
    local sync_script="$REPO_DIR/scripts/sync-skills.sh"
    if [ ! -x "$sync_script" ]; then
        warn "scripts/sync-skills.sh not found or not executable — skipping skill sync"
        return 0
    fi

    step "Syncing canonical skill union"
    local dests=()
    [ "$SKIP_OPENCODE" != "1" ] && [ "$OPENCODE_TARGET_READY" = "1" ] && dests+=("$TARGET_OPENCODE/skills")
    [ "$SKIP_CLAUDE" != "1" ] && [ "$CLAUDE_TARGET_READY" = "1" ] && dests+=("$TARGET_CLAUDE/skills")

    if [ "${#dests[@]}" -gt 0 ]; then
        "$sync_script" "${dests[@]}"
    else
        info "no install targets active — skill sync skipped"
    fi
}

sync_learning_runtime() {
    if [ "$OPENCODE_TARGET_READY" != "1" ] && [ "$CLAUDE_TARGET_READY" != "1" ]; then
        err "proposal-learning runtime sync failed: no selected harness target is ready"
        return 1
    fi
    if ! command -v node >/dev/null 2>&1; then
        err "proposal-learning runtime sync failed: node is unavailable"
        return 1
    fi
    if node --experimental-strip-types "$REPO_DIR/plugins/learning/installer-cli.ts" \
        --source-root "$REPO_DIR" \
        --opencode-root "$TARGET_OPENCODE" \
        --claude-root "$TARGET_CLAUDE" \
        $([ "$OPENCODE_TARGET_READY" = "1" ] && printf '%s' '--opencode') \
        $([ "$CLAUDE_TARGET_READY" = "1" ] && printf '%s' '--claude'); then
        ok "synchronized proposal-learning runtime"
    else
        err "proposal-learning runtime sync failed; existing harness settings were left unchanged"
        return 1
    fi
}

install_learning_maintenance() {
    [ "$OPENCODE_TARGET_READY" = "1" ] || [ "$CLAUDE_TARGET_READY" = "1" ] || return 0
    if ! command -v node >/dev/null 2>&1; then
        err "proposal-learning maintenance cannot be registered: node is unavailable"
        return 1
    fi

    local runtime_root="$TARGET_CLAUDE/hooks/learning"
    [ "$OPENCODE_TARGET_READY" = "1" ] && runtime_root="$TARGET_OPENCODE/plugins/learning"
    local node_path
    node_path="$(command -v node)"
    local state_home="${XDG_STATE_HOME:-}"
    case "$runtime_root:$node_path" in
        *$'\n'*|*$'\r'*|*$'\t'*|*' '*|*'..'*|*'//'*|:* )
            err "proposal-learning maintenance rejected an unsafe runtime, executable, or state path"
            return 1
            ;;
    esac
    case "$runtime_root:$node_path" in
        /*:/*) ;;
        *)
            err "proposal-learning maintenance requires absolute runtime and executable paths"
            return 1
            ;;
    esac
    if [ -n "$state_home" ]; then
        case "$state_home" in
            /*) ;;
            *)
                err "proposal-learning maintenance requires an absolute XDG state path when XDG_STATE_HOME is set"
                return 1
                ;;
        esac
    fi

    plist_escape() {
        printf '%s' "$1" | sed 's/&/\&amp;/g; s/</\&lt;/g; s/>/\&gt;/g; s/"/\&quot;/g; s/'"'"'/\&apos;/g'
    }

    case "$(uname -s)" in
    Darwin)
    if ! command -v launchctl >/dev/null 2>&1; then
        err "proposal-learning maintenance cannot be registered: launchctl is unavailable"
        return 1
    fi
    local launch_agents="$HOME/Library/LaunchAgents"
    local label="com.settings-opencode.proposal-learning-maintenance"
    local plist="$launch_agents/$label.plist"
    local temporary state_environment_xml=""
    if [ -n "$state_home" ]; then
        state_environment_xml="<key>EnvironmentVariables</key><dict><key>XDG_STATE_HOME</key><string>$(plist_escape "$state_home")</string></dict>"
    fi
    mkdir -p "$launch_agents"
    temporary="$(mktemp "$launch_agents/.${label}.XXXXXX")"
    cat > "$temporary" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$label</string>
  <key>ProgramArguments</key><array><string>$(plist_escape "$node_path")</string><string>--experimental-strip-types</string><string>$(plist_escape "$runtime_root/state-cli.ts")</string><string>purge</string></array>
  $state_environment_xml
  <key>RunAtLoad</key><true/>
  <key>StartInterval</key><integer>86400</integer>
</dict></plist>
EOF
    chmod 600 "$temporary"
    mv "$temporary" "$plist"
    launchctl bootout "gui/$(id -u)/$label" >/dev/null 2>&1 || true
    if launchctl bootstrap "gui/$(id -u)" "$plist"; then
        ok "registered daily proposal-learning maintenance"
    else
        rm -f "$plist"
        err "proposal-learning maintenance registration failed"
        return 1
    fi
    ;;
    Linux)
    local systemd_dir="$HOME/.config/systemd/user"
    local service="$systemd_dir/settings-opencode-proposal-learning-purge.service"
    local timer="$systemd_dir/settings-opencode-proposal-learning-purge.timer"
    if command -v systemctl >/dev/null 2>&1; then
        mkdir -p "$systemd_dir"
        validate_linux_maintenance_path() {
            if [[ "$1" =~ [\;\&\|\`\$\<\>] ]] || [[ "$1" == *$'\n'* || "$1" == *$'\r'* || "$1" == *$'\t'* || "$1" == *' '* || "$1" == *'..'* || "$1" == *//* ]]; then
                err "proposal-learning maintenance rejected shell metacharacters or unsafe path"
                return 1
            fi
        }
        validate_linux_maintenance_path "$runtime_root" || return 1
        validate_linux_maintenance_path "$node_path" || return 1
        [ -z "$state_home" ] || validate_linux_maintenance_path "$state_home" || return 1
        local state_environment=""
        [ -z "$state_home" ] || state_environment="Environment=XDG_STATE_HOME=$state_home"
        cat > "$service" <<EOF
[Service]
Type=oneshot
$state_environment
ExecStart=$node_path --experimental-strip-types $runtime_root/state-cli.ts purge
EOF
        cat > "$timer" <<EOF
[Unit]
Description=Daily proposal-learning purge
[Timer]
OnCalendar=daily
Persistent=true
[Install]
WantedBy=timers.target
EOF
        if systemctl --user daemon-reload && systemctl --user enable --now "$(basename "$timer")"; then
            ok "registered daily proposal-learning maintenance"
            return 0
        fi
        rm -f "$service" "$timer"
    fi
    err "proposal-learning maintenance requires a working systemd user timer"
    return 1
    ;;
    MINGW*|MSYS*|CYGWIN*)
    if command -v schtasks.exe >/dev/null 2>&1 && schtasks.exe /Create /F /SC DAILY /TN "settings-opencode-proposal-learning-purge" /TR "\"$node_path\" --experimental-strip-types \"$runtime_root/state-cli.ts\" purge" >/dev/null; then
        ok "registered daily proposal-learning maintenance"
        return 0
    fi
    err "proposal-learning maintenance requires schtasks.exe"
    return 1
    ;;
    *)
    err "proposal-learning maintenance is unsupported on this platform"
    return 1
    ;;
    esac
}

# ------------------------------ env-var block --------------------------------

# Resolve the launcher path the installer actually deployed to $TARGET_OPENCODE.
# Uniform across all install modes (global, --local, WSL) — no special-casing.
opencode_launcher_path() { printf '%s\n' "$TARGET_OPENCODE/bin/opencode-pick"; }

# $1 = absolute path to the deployed opencode-pick launcher.
env_block_content() {
    local launcher_path="${1:?env_block_content: launcher_path argument required}"
    cat <<'EOF'
# Added by settings-opencode installer. Edit values to match your provider.
# To remove this block, run: settings-sync --uninstall
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
    printf 'export SETTINGS_OPENCODE_REPO="%s"\n' "$REPO_DIR"
    printf 'alias ocp="%s"\n' "$launcher_path"
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
        env_block_content "$(opencode_launcher_path)"
        printf "%s\n" "$MARKER_END"
    } >> "$rc"
    ok "wrote env block to $rc"

    reconcile_legacy_ocp_alias "$rc"
}

# Warn about (and, only on explicit interactive confirmation, comment out)
# any `alias ocp=` line living outside the managed marker block in $1 — it
# would otherwise shadow the alias we just wrote. Never deletes anything.
reconcile_legacy_ocp_alias() {
    local rc="$1"
    local hits
    hits="$(mktemp)"

    awk -v s="$MARKER_START" -v e="$MARKER_END" '
        $0 == s { in_block = 1 }
        $0 == e { in_block = 0; next }
        !in_block && $0 ~ /^[[:space:]]*alias[[:space:]]+ocp=/ { print NR }
    ' "$rc" > "$hits"

    if [ ! -s "$hits" ]; then
        rm -f "$hits"
        return 0
    fi

    warn "found legacy 'alias ocp=' line(s) outside the managed block in $rc (line $(paste -sd, "$hits")) — may shadow the alias just written"
    rm -f "$hits"

    if [ "$ASSUME_YES" != "1" ] && [ -t 0 ]; then
        if ask "comment out the legacy 'alias ocp=' line(s) in $rc?" N; then
            local tmp
            tmp="$(mktemp)"
            awk -v s="$MARKER_START" -v e="$MARKER_END" '
                $0 == s { in_block = 1 }
                $0 == e { in_block = 0 }
                !in_block && $0 ~ /^[[:space:]]*alias[[:space:]]+ocp=/ { print "# " $0; next }
                { print }
            ' "$rc" > "$tmp"
            mv "$tmp" "$rc"
            ok "commented out legacy alias ocp= line(s) in $rc"
        fi
    else
        info "non-interactive: leaving legacy alias ocp= line(s) in $rc untouched (warn only)"
    fi
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
    # Local mode keeps cwd-scoped targets; WSL re-targeting must not override them.
    [ "$LOCAL_MODE" = "1" ] && return 0
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
        read_reply winuser
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

check_node_version() {
    local version major minor
    if ! command -v node >/dev/null 2>&1; then
        err "Node minimum required version is 22.6 before installer writes, synchronizes, or registers anything"
        exit 1
    fi
    version="$(node -p 'process.versions.node' 2>/dev/null || true)"
    major="${version%%.*}"
    minor="${version#*.}"
    minor="${minor%%.*}"
    if ! [[ "$major" =~ ^[0-9]+$ && "$minor" =~ ^[0-9]+$ ]] || [ "$major" -lt 22 ] || { [ "$major" -eq 22 ] && [ "$minor" -lt 6 ]; }; then
        err "Node minimum required version is 22.6 before installer writes, synchronizes, or registers anything (found ${version:-unavailable})"
        exit 1
    fi
    ok "Node $version"
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
    OPENCODE_TARGET_READY=0

    if [ "$WSL_MODE" = "1" ]; then
        step "Copying repo into $TARGET_OPENCODE (WSL -> Windows)"
        if [ -L "$TARGET_OPENCODE" ]; then
            if [ "$(readlink "$TARGET_OPENCODE")" = "$REPO_DIR" ]; then
                if [ -e "$TARGET_OPENCODE/.claude" ] || [ -L "$TARGET_OPENCODE/.claude" ]; then
                    err "OpenCode target is a symlink to the repo and exposes nested .claude: $TARGET_OPENCODE/.claude"
                    err "refusing to mark OpenCode ready; replace the symlink or remove that .claude explicitly, then re-run the installer"
                    exit 1
                fi
                ok "$TARGET_OPENCODE already points at $REPO_DIR"
                OPENCODE_TARGET_READY=1
                return 0
            fi
            warn "$TARGET_OPENCODE is a symlink; leaving it untouched and skipping OpenCode copy"
            return 0
        elif [ -d "$TARGET_OPENCODE" ]; then
            info "$TARGET_OPENCODE exists; merging repo files into it"
        elif [ -e "$TARGET_OPENCODE" ]; then
            warn "$TARGET_OPENCODE exists and is not a directory; leaving it untouched and skipping OpenCode copy"
            return 0
        fi
        handle_nested_opencode_claude
        copy_tree "$REPO_DIR" "$TARGET_OPENCODE"
        ensure_opencode_runtime_dirs
        [ -f "$TARGET_OPENCODE/bin/opencode-pick" ] && chmod +x "$TARGET_OPENCODE/bin/opencode-pick"
        [ -f "$TARGET_OPENCODE/bin/proposal-learning" ] && chmod +x "$TARGET_OPENCODE/bin/proposal-learning"
        ok "copied $REPO_DIR -> $TARGET_OPENCODE (node_modules excluded)"
        OPENCODE_TARGET_READY=1
        return 0
    fi

    step "Copying repo into $TARGET_OPENCODE"

    if [ "$REPO_DIR" = "$TARGET_OPENCODE" ]; then
        handle_nested_opencode_claude
        ok "repo already lives at $TARGET_OPENCODE"
        OPENCODE_TARGET_READY=1
        return 0
    fi

    if [ -L "$TARGET_OPENCODE" ]; then
        if [ "$(readlink "$TARGET_OPENCODE")" = "$REPO_DIR" ]; then
            if [ -e "$TARGET_OPENCODE/.claude" ] || [ -L "$TARGET_OPENCODE/.claude" ]; then
                err "OpenCode target is a symlink to the repo and exposes nested .claude: $TARGET_OPENCODE/.claude"
                err "refusing to mark OpenCode ready; replace the symlink or remove that .claude explicitly, then re-run the installer"
                exit 1
            fi
            ok "$TARGET_OPENCODE already points at $REPO_DIR"
            OPENCODE_TARGET_READY=1
            return 0
        fi
        if [ -e "$TARGET_OPENCODE/.claude" ]; then
            warn "OpenCode target exposes nested .claude through symlink: $TARGET_OPENCODE/.claude"
        fi
        warn "$TARGET_OPENCODE is a symlink; leaving it untouched and skipping OpenCode copy"
        return 0
    elif [ -d "$TARGET_OPENCODE" ]; then
        handle_nested_opencode_claude
        if ! confirm_existing_local_opencode; then
            info "$TARGET_OPENCODE exists; leaving it unchanged"
            return 0
        fi
        info "$TARGET_OPENCODE exists; merging repo files into it"
    elif [ -e "$TARGET_OPENCODE" ]; then
        warn "$TARGET_OPENCODE exists and is not a directory; leaving it untouched and skipping OpenCode copy"
        return 0
    fi

    copy_tree "$REPO_DIR" "$TARGET_OPENCODE"
    ensure_opencode_runtime_dirs
    [ -f "$TARGET_OPENCODE/bin/opencode-pick" ] && chmod +x "$TARGET_OPENCODE/bin/opencode-pick"
    [ -f "$TARGET_OPENCODE/bin/proposal-learning" ] && chmod +x "$TARGET_OPENCODE/bin/proposal-learning"
    ok "copied $REPO_DIR -> $TARGET_OPENCODE (node_modules excluded)"
    OPENCODE_TARGET_READY=1
}

install_deps() {
    if [ "$WSL_MODE" = "1" ]; then
        step "Installing JS dependencies on the Windows side (via WSL interop)"
        warn "node_modules must be built with Windows Node.js — Linux Node would"
        warn "produce binaries Windows cannot load (better-sqlite3, etc.)."

        local win_path
        win_path="$(wslpath -w "$TARGET_OPENCODE" 2>/dev/null || true)"
        if [ -z "$win_path" ]; then
            warn "couldn't resolve the Windows path for $TARGET_OPENCODE — skipping"
            info "once you know the path, run 'npm install' there with Windows Node."
            return 0
        fi
        WSL_OPENCODE_WIN_PATH="$win_path"

        if ! command -v cmd.exe >/dev/null 2>&1; then
            warn "Windows interop (cmd.exe) not reachable from this WSL distro."
            info "Run this from a Windows shell instead:"
            info "  cd \"$win_path\" && npm install"
            return 0
        fi

        info "target (Windows path): $win_path"
        # Windows npm is invoked through interop, so this runs from THIS WSL
        # terminal — no need to open PowerShell — yet still builds native
        # modules with Windows Node.
        if ask "run 'npm install' on the Windows side now, from this terminal?" Y; then
            if cmd.exe /c "cd /d \"$win_path\" && npm install"; then
                ok "deps installed (Windows Node)"
            else
                warn "Windows npm install failed — is Node.js installed on Windows?"
                info "install Node.js for Windows, then re-run from this WSL terminal:"
                info "  cmd.exe /c 'cd /d \"$win_path\" && npm install'"
            fi
        else
            info "skipped. Run later from this same WSL terminal:"
            info "  cmd.exe /c 'cd /d \"$win_path\" && npm install'   (or swap npm for bun)"
        fi
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

# Warn about a legacy standalone opencode-pick binary. The managed 'ocp' alias
# is now written as an absolute path, so PATH shadowing no longer breaks it —
# but a stray script left over from an old install may still confuse `command
# -v opencode-pick` or direct invocations. Never deletes anything.
warn_legacy_opencode_pick_binary() {
    local target="$1" legacy candidate

    legacy="$HOME/.local/bin/opencode-pick"
    if [ -e "$legacy" ] && [ "$legacy" != "$target" ]; then
        warn "legacy launcher found at $legacy (differs from $target)"
        info "the managed 'ocp' alias is an absolute path now, so this won't shadow it; remove or repoint it manually if unused:"
        info "  rm \"$legacy\"   # or: ln -sf \"$target\" \"$legacy\""
    fi

    candidate="$(command -v opencode-pick 2>/dev/null || true)"
    if [ -n "$candidate" ] && [ "$candidate" != "$target" ] && [ "$candidate" != "$legacy" ]; then
        warn "an 'opencode-pick' binary on PATH ($candidate) differs from the installed launcher ($target)"
        info "the managed 'ocp' alias already points at the absolute path above, so PATH shadowing is neutralized for 'ocp'; repoint or remove the stray binary manually if unused:"
        info "  rm \"$candidate\"   # or: ln -sf \"$target\" \"$candidate\""
    fi
}

install_env_vars() {
    step "Configuring shell environment variables"

    local launcher
    launcher="$(opencode_launcher_path)"
    if [ ! -x "$launcher" ]; then
        warn "launcher missing or not executable: $launcher — the 'ocp' alias will be written but won't work until this exists"
    fi
    local profile_file
    profile_file="$(dirname "$launcher")/opencode-models.zsh"
    if [ ! -f "$profile_file" ]; then
        warn "opencode-models.zsh not found next to the launcher: $profile_file — opencode-pick profile resolution will fail"
    fi
    warn_legacy_opencode_pick_binary "$launcher"

    local rc
    rc="$(detect_shell_rc)"
    if [ -z "$rc" ]; then
        warn "couldn't detect a known shell rc for SHELL=${SHELL:-unset}"
        info "add the following to your shell profile manually:"
        printf "\n"
        env_block_content "$launcher" | sed 's/^/        /'
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
        env_block_content "$launcher" | sed 's/^/        /'
        printf "\n"
    fi
}

# Symlink scripts/settings-sync.sh into ~/.local/bin so `settings-sync` works
# from any directory, independent of harness choice. Idempotent (ln -sf).
install_global_command() {
    [ "$LOCAL_MODE" = "1" ] && return 0

    step "Installing global settings-sync command"

    local source_script="$REPO_DIR/scripts/settings-sync.sh"
    if [ ! -x "$source_script" ]; then
        warn "scripts/settings-sync.sh not found or not executable — skipping global command"
        return 0
    fi

    local bin_dir="$HOME/.local/bin"
    local target="$bin_dir/settings-sync"
    mkdir -p "$bin_dir"
    ln -sf "$source_script" "$target"
    ok "linked $target -> $source_script"

    case ":$PATH:" in
        *":$bin_dir:"*) ;;
        *) warn "$bin_dir is not on PATH — add it to your shell rc to use 'settings-sync' directly" ;;
    esac
}

# Warn about (and, only on explicit interactive confirmation, replace) a real
# directory at the legacy clone location that differs from the canonical
# repo. Never touches an existing symlink and never runs under --yes.
reconcile_legacy_clone() {
    local legacy="$HOME/.local/share/settings-opencode"

    [ -e "$legacy" ] || return 0
    [ -L "$legacy" ] && return 0
    [ -d "$legacy" ] || return 0
    [ "$legacy" = "$REPO_DIR" ] && return 0

    warn "legacy settings-opencode clone found at $legacy (a real directory, not a symlink to $REPO_DIR)"

    if ask "replace $legacy with a symlink to $REPO_DIR?" N; then
        rm -rf "$legacy"
        ln -s "$REPO_DIR" "$legacy"
        ok "replaced $legacy with a symlink to $REPO_DIR"
    else
        info "left legacy clone at $legacy untouched"
    fi
}

install_claude_mirror() {
    CLAUDE_TARGET_READY=0

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
    # Seed settings.json on fresh installs; the fixed runtime merger preserves
    # unrelated entries and replaces only its managed hook.
    if [ ! -d "$source_claude" ]; then
        warn ".claude/ not found in repo, skipping"
        return 0
    fi

    if [ "$WSL_MODE" = "1" ]; then
        info "WSL mode — copying instead of symlinking"
        if [ -L "$TARGET_CLAUDE" ]; then
            if [ "$(readlink "$TARGET_CLAUDE")" = "$source_claude" ]; then
                ok "$TARGET_CLAUDE already points at $source_claude"
                return 0
            fi
            warn "$TARGET_CLAUDE is a symlink; leaving it untouched and skipping Claude copy"
            return 0
        elif [ -d "$TARGET_CLAUDE" ]; then
            info "$TARGET_CLAUDE exists; merging Claude mirror into it"
        elif [ -e "$TARGET_CLAUDE" ]; then
            warn "$TARGET_CLAUDE exists and is not a directory; leaving it untouched and skipping Claude copy"
            return 0
        fi
        copy_claude_allowlist "$source_claude" "$TARGET_CLAUDE"
        ok "copied managed Claude assets without private runtime data"
        CLAUDE_TARGET_READY=1
        if [ "$LOCAL_MODE" = "1" ] && [ -f "$TARGET_CLAUDE/settings.json" ]; then
            localize_claude_settings_hooks "$TARGET_CLAUDE/settings.json"
        fi
        return 0
    fi

    if [ -L "$TARGET_CLAUDE" ]; then
        if [ "$(readlink "$TARGET_CLAUDE")" = "$source_claude" ]; then
            ok "$TARGET_CLAUDE already points at $source_claude"
            return 0
        fi
        warn "$TARGET_CLAUDE is a symlink; leaving it untouched and skipping Claude copy"
        return 0
    elif [ -d "$TARGET_CLAUDE" ]; then
        if ! confirm_existing_local_claude; then
            info "$TARGET_CLAUDE exists; leaving it unchanged"
            return 0
        fi
        info "$TARGET_CLAUDE exists; merging Claude mirror into it (personal config files never overwritten)"
    elif [ -e "$TARGET_CLAUDE" ]; then
        warn "$TARGET_CLAUDE exists and is not a directory; leaving it untouched and skipping Claude copy"
        return 0
    fi

    copy_claude_allowlist "$source_claude" "$TARGET_CLAUDE"
    ok "copied managed Claude assets without private runtime data"
    CLAUDE_TARGET_READY=1
    if [ "$LOCAL_MODE" = "1" ] && [ -f "$TARGET_CLAUDE/settings.json" ]; then
        localize_claude_settings_hooks "$TARGET_CLAUDE/settings.json"
    fi
}

print_next_steps() {
    step "Next steps"
    if [ "$LOCAL_MODE" = "1" ]; then
        cat <<EOF
    Project-scoped (--local) install — applies only when working in:
      $INVOKE_DIR

    Installed:
      $([ "$SKIP_OPENCODE" = "1" ] && echo "$INVOKE_DIR/.opencode   (skipped via --no-opencode)" || { [ "$OPENCODE_TARGET_READY" = "1" ] && echo "$INVOKE_DIR/.opencode   (opencode config + deps)" || echo "$INVOKE_DIR/.opencode   (left unchanged)"; })
$([ "$SKIP_CLAUDE" = "1" ] && echo "      ./.claude              (skipped via --no-claude)" || { [ "$CLAUDE_TARGET_READY" = "1" ] && echo "      $INVOKE_DIR/.claude    (Claude Code mirror)" || echo "      $INVOKE_DIR/.claude    (left unchanged)"; })

    No shell reload needed — no global rc was modified.
    To set model env-vars for this project only, add the block printed above
    to a per-project .envrc (direnv) or source it manually.

    Re-run anytime from $INVOKE_DIR: $REPO_DIR/install.sh --local
    Uninstall local copy:           $REPO_DIR/install.sh --local --uninstall
EOF
        return 0
    fi
    if [ "$WSL_MODE" = "1" ]; then
        local dep_hint="Dependencies were installed on the Windows side from this terminal."
        if [ "$OPENCODE_TARGET_READY" != "1" ]; then
            dep_hint="OpenCode target was left unchanged; dependencies were not installed."
        elif [ -n "${WSL_OPENCODE_WIN_PATH:-}" ]; then
            dep_hint="If you skipped the dependency step, run it from THIS WSL terminal:
        cmd.exe /c 'cd /d \"$WSL_OPENCODE_WIN_PATH\" && npm install'"
        fi
        cat <<EOF
    WSL -> Windows install.
    $dep_hint

    1. Reload your shell (or:  source "$(detect_shell_rc)")
    2. Re-run this script to push fresh changes from the repo to the Windows target.

    Adjust env-var values for your provider in $(detect_shell_rc)
    Re-run anytime: $REPO_DIR/install.sh
    Uninstall:     $REPO_DIR/install.sh --uninstall
EOF
        return 0
    fi
    cat <<EOF
    $([ "$OPENCODE_TARGET_READY" = "1" ] && echo "1. Reload your shell (or:  source \"$(detect_shell_rc)\")" || echo "1. OpenCode target was left unchanged; no shell env was written")
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
    if [ "$LOCAL_MODE" = "1" ]; then
        info "this will (local mode):"
        info "  - remove $TARGET_OPENCODE (after confirm)"
        info "  - remove $TARGET_CLAUDE (after confirm)"
        info "  - shell rc is NOT modified (local mode never touched it)"
    else
        info "this will:"
        info "  - remove the marker-fenced env block from your shell rc"
        info "  - remove the copied directory at $TARGET_OPENCODE (after confirm)"
        info "  - remove the copied directory at $TARGET_CLAUDE (after confirm)"
    fi
    info "the cloned repo at $REPO_DIR is left intact."
    if ! ask "proceed?" N; then
        info "aborted"
        exit 0
    fi

    if [ "$LOCAL_MODE" = "1" ]; then
        if [ "$SKIP_OPENCODE" != "1" ]; then
            if [ -d "$TARGET_OPENCODE" ]; then
                if ask "delete local directory $TARGET_OPENCODE ?" N; then
                    rm -rf "$TARGET_OPENCODE"
                    ok "removed $TARGET_OPENCODE"
                else
                    info "left $TARGET_OPENCODE in place"
                fi
            else
                info "$TARGET_OPENCODE not found, skipping"
            fi
        else
            info "OpenCode target skipped (--no-opencode)"
        fi
        if [ "$SKIP_CLAUDE" != "1" ]; then
            if [ -d "$TARGET_CLAUDE" ]; then
                if ask "delete local directory $TARGET_CLAUDE ?" N; then
                    rm -rf "$TARGET_CLAUDE"
                    ok "removed $TARGET_CLAUDE"
                else
                    info "left $TARGET_CLAUDE in place"
                fi
            else
                info "$TARGET_CLAUDE not found, skipping"
            fi
        else
            info "Claude target skipped (--no-claude)"
        fi
        step "Done. Local copies removed."
        return 0
    fi

    # The env block (repo-path export, model/reasoning defaults, settings-sync
    # command) is harness-independent — remove it regardless of --no-opencode.
    local rc
    rc="$(detect_shell_rc)"
    [ -n "$rc" ] && remove_env_block "$rc" || warn "no known shell rc detected, skipping env block"

    local settings_sync_link="$HOME/.local/bin/settings-sync"
    if [ -e "$settings_sync_link" ] || [ -L "$settings_sync_link" ]; then
        if [ -L "$settings_sync_link" ] && [ "$(readlink "$settings_sync_link")" = "$REPO_DIR/scripts/settings-sync.sh" ]; then
            rm "$settings_sync_link"
            ok "removed $settings_sync_link"
        else
            warn "$settings_sync_link exists but is not our symlink; leaving it in place"
        fi
    fi

    if [ "$WSL_MODE" = "1" ]; then
        if [ "$SKIP_OPENCODE" != "1" ]; then
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
        else
            info "OpenCode target skipped (--no-opencode)"
        fi
        if [ "$SKIP_CLAUDE" != "1" ]; then
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
            info "Claude target skipped (--no-claude)"
        fi
    else
        if [ "$SKIP_OPENCODE" != "1" ]; then
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
        else
            info "OpenCode target skipped (--no-opencode)"
        fi
        if [ "$SKIP_CLAUDE" != "1" ]; then
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
        else
            info "Claude target skipped (--no-claude)"
        fi
    fi

    step "Done."
}

# ------------------------------ main -----------------------------------------

while [ $# -gt 0 ]; do
    case "$1" in
        --yes|-y)        ASSUME_YES=1 ;;
        --no-claude)     SKIP_CLAUDE=1 ;;
        --no-opencode)   SKIP_OPENCODE=1 ;;
        --opencode)      FLAG_OPENCODE=1 ;;
        --claude)        FLAG_CLAUDE=1 ;;
        --uninstall)     DO_UNINSTALL=1 ;;
        --local)         LOCAL_MODE=1; FLAG_LOCAL=1 ;;
        -h|--help)       print_help; exit 0 ;;
        *) err "unknown flag: $1"; print_help; exit 1 ;;
    esac
    shift
done

# Allowlist resolution: if ANY positive flag is present, only listed targets
# are candidates; unlisted targets default to OFF (skipped). Opt-outs are
# applied afterward and always win (override the allowlist).
if [ "$FLAG_OPENCODE" = "1" ] || [ "$FLAG_CLAUDE" = "1" ]; then
    # Allowlist mode: start with everything skipped, then enable what was listed.
    [ "$FLAG_OPENCODE" != "1" ] && SKIP_OPENCODE=1
    [ "$FLAG_CLAUDE"   != "1" ] && SKIP_CLAUDE=1
fi

# Opt-out flags win over allowlist (applied last).
# SKIP_CLAUDE and SKIP_OPENCODE are already set by --no-* flags earlier.

# Empty-set guard must run before any interactive scope prompt.
if [ "$SKIP_OPENCODE" = "1" ] && [ "$SKIP_CLAUDE" = "1" ]; then
    err "nothing to install (both targets disabled)"
    exit 1
fi

if [ "$ASSUME_YES" != "1" ] && [ ! -t 0 ]; then
    err "non-interactive stdin cannot answer prompts; run from a terminal or pass --yes"
    exit 1
fi

if [ "$ASSUME_YES" != "1" ] && [ "$DO_UNINSTALL" != "1" ]; then
    if [ "$FLAG_OPENCODE" != "1" ] && [ "$FLAG_CLAUDE" != "1" ] && [ "$SKIP_OPENCODE" != "1" ] && [ "$SKIP_CLAUDE" != "1" ]; then
        ask_harness_choice
    fi
    if [ "$FLAG_LOCAL" != "1" ]; then
        ask_install_scope
    fi
fi

# Apply local-mode target overrides before any other logic runs.
if [ "$LOCAL_MODE" = "1" ]; then
    if [ "$INVOKE_DIR" = "$REPO_DIR" ]; then
        err "--local copies the repo into ./.opencode; run it from your project directory, not from the settings-opencode repo"
        exit 1
    fi
    TARGET_OPENCODE="$INVOKE_DIR/.opencode"
    TARGET_CLAUDE="$INVOKE_DIR/.claude"
fi

if [ "$DO_UNINSTALL" = "1" ]; then
    run_uninstall
    exit 0
fi

step "settings-opencode installer"
info "repo:    $REPO_DIR"
info "mode:    $([ "$ASSUME_YES" = "1" ] && echo "non-interactive" || echo "interactive")$([ "$LOCAL_MODE" = "1" ] && echo " --local (project-scoped)" || true)"

configure_wsl_targets
check_prereqs
check_node_version
check_environment

info "target:  $([ "$SKIP_OPENCODE" = "1" ] && echo "skipped" || echo "$TARGET_OPENCODE")"
info "claude:  $([ "$SKIP_CLAUDE" = "1" ] && echo "skipped" || echo "$TARGET_CLAUDE")"

if [ "$SKIP_OPENCODE" != "1" ]; then
    install_repo_link
    if [ "$OPENCODE_TARGET_READY" = "1" ]; then
        install_deps
        if [ "$LOCAL_MODE" = "1" ]; then
            step "Shell environment variables — skipped (--local does not modify global rc)"
            info "To use per-project env vars, add the following to a .envrc or source it manually:"
            printf "\n"
            env_block_content "$(opencode_launcher_path)" | sed 's/^/        /'
            printf "\n"
        fi
    else
        warn "OpenCode target was not modified; skipping dependencies and OpenCode skill sync"
    fi
fi
install_claude_mirror

# The repo-path export, model/reasoning defaults, and the global settings-sync
# command are harness-independent — install them in global mode regardless of
# --no-opencode/--no-claude. Never touches global rc in --local mode.
if [ "$LOCAL_MODE" != "1" ]; then
    install_env_vars
    install_global_command
    reconcile_legacy_clone
fi

sync_skills
if [ "$SKIP_OPENCODE" != "1" ] && [ "$OPENCODE_TARGET_READY" != "1" ]; then
    err "OpenCode target runtime is absent; refusing a successful install"
    exit 1
fi
if [ "$SKIP_CLAUDE" != "1" ] && [ "$CLAUDE_TARGET_READY" != "1" ]; then
    err "Claude target hook is absent; refusing a successful install"
    exit 1
fi
sync_learning_runtime || exit 1
install_learning_maintenance || { err "learning activation remains unavailable because automatic purge registration failed"; exit 1; }
print_next_steps
