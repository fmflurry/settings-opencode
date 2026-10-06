#!/usr/bin/env bash
#
# install-cursor.sh — build the Cursor plugin and install it locally
#
# Builds plugins/fmflurry-harness/ from the repo and installs it into
# ~/.cursor/plugins/local/fmflurry-harness, then reload Cursor.
#
# Flags:
#   --yes, -y          Non-interactive
#   --link             Symlink the plugin instead of copying it
#   --migrate-legacy   Remove files the previous installer copied into ~/.cursor
#   --uninstall        Remove the installed plugin
#   --no-backup        Skip the backup made by --migrate-legacy
#   --help, -h
#
set -euo pipefail

REPO_DIR="$( cd "$( dirname "${BASH_SOURCE[0]:-$0}" )" && pwd )"
CURSOR_DIR="$HOME/.cursor"
PLUGIN_NAME="fmflurry-harness"
PLUGIN_SRC="$REPO_DIR/plugins/fmflurry-harness"
PLUGIN_DST="$CURSOR_DIR/plugins/local/$PLUGIN_NAME"
BACKUP_ROOT="$CURSOR_DIR/_pre_install_backups"

ASSUME_YES=0
DO_UNINSTALL=0
DO_MIGRATE=0
DO_LINK=0
NO_BACKUP=0

if [ -t 1 ]; then
    BOLD=$'\033[1m'; RED=$'\033[31m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; BLUE=$'\033[34m'
    RESET=$'\033[0m'
else
    BOLD=""; RED=""; GREEN=""; YELLOW=""; BLUE=""; RESET=""
fi

step() { printf "\n%s==>%s %s%s%s\n" "${BOLD}${BLUE}" "$RESET" "$BOLD" "$*" "$RESET"; }
info() { printf "    %s\n" "$*"; }
ok()   { printf "    %sOK%s   %s\n" "$GREEN" "$RESET" "$*"; }
warn() { printf "    %sWARN%s %s\n" "$YELLOW" "$RESET" "$*"; }
err()  { printf "    %sERR%s  %s\n" "$RED" "$RESET" "$*" >&2; }

ask() {
    local prompt="$1" default="${2:-Y}" hint reply
    if [ "$ASSUME_YES" = "1" ]; then
        [ "$default" = "Y" ] && return 0 || return 1
    fi
    if [ "$default" = "Y" ]; then hint="[Y/n]"; else hint="[y/N]"; fi
    while :; do
        printf "    %s?%s %s %s " "$BOLD" "$RESET" "$prompt" "$hint"
        read -r reply || reply=""
        reply="${reply:-$default}"
        case "$reply" in
            Y|y|Yes|yes) return 0 ;;
            N|n|No|no)   return 1 ;;
            *) printf "    please answer y or n\n" ;;
        esac
    done
}

print_help() {
    cat <<EOF
${BOLD}install-cursor.sh${RESET} — build and install the Cursor plugin

Usage: ./install-cursor.sh [flags]

Flags:
  --yes, -y          Non-interactive (accept all defaults)
  --link             Symlink the plugin instead of copying it
  --migrate-legacy   Remove files the previous installer copied into ~/.cursor
  --uninstall        Remove $PLUGIN_DST
  --no-backup        Skip the backup made by --migrate-legacy
  --help, -h         Show this help

Builds $PLUGIN_SRC and installs it to $PLUGIN_DST.
EOF
}

while [ $# -gt 0 ]; do
    case "$1" in
        --yes|-y)         ASSUME_YES=1 ;;
        --link)           DO_LINK=1 ;;
        --migrate-legacy) DO_MIGRATE=1 ;;
        --uninstall)      DO_UNINSTALL=1 ;;
        --no-backup)      NO_BACKUP=1 ;;
        --help|-h)        print_help; exit 0 ;;
        *) err "unknown flag: $1"; print_help; exit 2 ;;
    esac
    shift
done

require_node() {
    command -v node >/dev/null 2>&1 || { err "node is required"; exit 1; }
}

build_plugin() {
    step "Build plugin"
    node "$REPO_DIR/scripts/build-cursor-plugin.mjs"
    [ -f "$PLUGIN_SRC/.cursor-plugin/plugin.json" ] || { err "build produced no plugin at $PLUGIN_SRC"; exit 1; }
    ok "built $PLUGIN_SRC"
}

install_plugin() {
    step "Install plugin -> $PLUGIN_DST"
    mkdir -p "$(dirname "$PLUGIN_DST")"
    rm -rf "$PLUGIN_DST"
    if [ "$DO_LINK" = "1" ]; then
        ln -s "$PLUGIN_SRC" "$PLUGIN_DST"
        ok "linked"
    else
        cp -R "$PLUGIN_SRC" "$PLUGIN_DST"
        ok "copied"
    fi
}

uninstall_plugin() {
    step "Uninstall $PLUGIN_DST"
    if [ ! -e "$PLUGIN_DST" ] && [ ! -L "$PLUGIN_DST" ]; then
        info "nothing to remove"
        return 0
    fi
    ask "Remove $PLUGIN_DST?" Y || { info "aborted"; return 0; }
    rm -rf "$PLUGIN_DST"
    ok "removed"
}

backup_legacy() {
    [ "$NO_BACKUP" = "1" ] && { info "backup skipped (--no-backup)"; return 0; }
    local dest item
    dest="$BACKUP_ROOT/$(date +%Y%m%d-%H%M%S)"
    mkdir -p "$dest"
    for item in skills agents commands rules hooks.json mcp.json _primary_agents; do
        [ -e "$CURSOR_DIR/$item" ] && cp -pR "$CURSOR_DIR/$item" "$dest/$item"
    done
    ok "backup at $dest"
}

migrate_legacy() {
    step "Migrate legacy ~/.cursor install"
    ask "Remove files from the old installer that the plugin now provides?" Y || { info "aborted"; return 0; }
    backup_legacy
    CURSOR_DIR="$CURSOR_DIR" PLUGIN_SRC="$PLUGIN_SRC" node <<'NODE'
const fs = require('fs');
const path = require('path');
const { CURSOR_DIR, PLUGIN_SRC } = process.env;

const list = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir) : []);
const strip = (name) => name.replace(/\.(md|mdc)$/, '');
const remove = (p) => {
    fs.rmSync(p, { recursive: true, force: true });
    console.log(`    removed ${p}`);
};

for (const kind of ['skills', 'agents', 'commands']) {
    const owned = new Set(list(path.join(PLUGIN_SRC, kind)).map(strip));
    for (const entry of list(path.join(CURSOR_DIR, kind))) {
        if (owned.has(strip(entry))) remove(path.join(CURSOR_DIR, kind, entry));
    }
}

// Legacy rules were named <label>__<slug>.mdc / always__<slug>.mdc; primary agents kept plugin names.
const ownedRules = new Set(list(path.join(PLUGIN_SRC, 'rules')).map(strip));
const legacyRule = /^(claude-global__|repo-claude__|always__)/;
for (const entry of list(path.join(CURSOR_DIR, 'rules'))) {
    if (ownedRules.has(strip(entry)) || legacyRule.test(entry)) remove(path.join(CURSOR_DIR, 'rules', entry));
}

const stage = path.join(CURSOR_DIR, '_primary_agents');
if (fs.existsSync(stage)) remove(stage);

const pluginMcp = path.join(PLUGIN_SRC, 'mcp.json');
const userMcp = path.join(CURSOR_DIR, 'mcp.json');
if (fs.existsSync(pluginMcp) && fs.existsSync(userMcp)) {
    const ours = Object.keys(JSON.parse(fs.readFileSync(pluginMcp, 'utf8')).mcpServers || {});
    const user = JSON.parse(fs.readFileSync(userMcp, 'utf8'));
    const kept = Object.fromEntries(
        Object.entries(user.mcpServers || {}).filter(([key]) => !ours.includes(key)),
    );
    fs.writeFileSync(userMcp, JSON.stringify({ ...user, mcpServers: kept }, null, 2) + '\n');
    console.log(`    mcp.json: removed ${ours.filter((k) => k in (user.mcpServers || {})).join(', ') || 'nothing'}`);
}

const hooksFile = path.join(CURSOR_DIR, 'hooks.json');
if (fs.existsSync(hooksFile)) {
    const commands = [];
    const collect = (node) => {
        if (Array.isArray(node)) node.forEach(collect);
        else if (node && typeof node === 'object') {
            for (const [k, v] of Object.entries(node)) {
                if (k === 'command' && typeof v === 'string') commands.push(v);
                else collect(v);
            }
        }
    };
    collect(JSON.parse(fs.readFileSync(hooksFile, 'utf8')));
    if (commands.every((c) => c.includes('.claude/hooks'))) remove(hooksFile);
    else console.log('    WARN hooks.json has commands not from the old installer; kept');
}
NODE
    ok "legacy migration done"
}

require_node

if [ "$DO_UNINSTALL" = "1" ]; then
    uninstall_plugin
    exit 0
fi

build_plugin
[ "$DO_MIGRATE" = "1" ] && migrate_legacy
install_plugin

step "Next steps"
info "Reload Cursor (Developer: Reload Window)"
info "Uninstall: $REPO_DIR/install-cursor.sh --uninstall"
