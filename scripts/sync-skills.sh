#!/usr/bin/env bash
#
# sync-skills.sh — sync the canonical skill union into one or more destination dirs.
#
# Usage:
#   sync-skills.sh <dest_dir_1> [<dest_dir_2> ...]
#
# Builds the canonical skill union from:
#   $REPO_DIR/skills        (primary — root wins on name conflict)
#   $REPO_DIR/.claude/skills (secondary)
#
# Runtime/plugin dirs excluded from the union:
#   skills/skill-creator/   (plugin-regenerated, not a committed skill)
#
# Behaviour:
#   - Additive overlay: new skill dirs are created, existing files are updated.
#   - NO --delete: destination runtime state is never pruned.
#   - Idempotent: safe to run repeatedly.
#   - Prints a summary at the end.
#
set -euo pipefail

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]:-$0}" )" && pwd )"
REPO_DIR="$( cd "$SCRIPT_DIR/.." && pwd )"

# ------------------------------ presentation ---------------------------------

if [ -t 1 ]; then
    BOLD=$'\033[1m'
    GREEN=$'\033[32m'; YELLOW=$'\033[33m'; BLUE=$'\033[34m'
    RESET=$'\033[0m'
else
    BOLD=""; GREEN=""; YELLOW=""; BLUE=""; RESET=""
fi

step() { printf "\n${BOLD}${BLUE}==>${RESET} ${BOLD}%s${RESET}\n" "$*"; }
info() { printf "    %s\n" "$*"; }
ok()   { printf "    ${GREEN}OK${RESET}   %s\n" "$*"; }
warn() { printf "    ${YELLOW}WARN${RESET} %s\n" "$*"; }

# ------------------------------ copy helper ----------------------------------

# copy_skill_source <src_dir> <dst_dir>
# Copies the contents of src_dir (a skills root) into dst_dir (another skills
# root), skipping the gitignored runtime dirs.  Uses rsync when available and
# full-featured; falls back to a tar-pipe (handles macOS openrsync nested-dir
# bugs, same strategy as install-cursor.sh).
#
# Canonical impl shared by install.sh and install-cursor.sh.

_USE_RSYNC=1
_rsync_checked=0

_check_rsync() {
    [ "$_rsync_checked" = "1" ] && return 0
    _rsync_checked=1
    if ! command -v rsync >/dev/null 2>&1; then
        _USE_RSYNC=0
        warn "rsync not found — using tar-pipe fallback"
        return 0
    fi
    local rv
    rv="$(rsync --version 2>&1 | head -1)"
    if printf "%s" "$rv" | grep -qi openrsync; then
        _USE_RSYNC=0
        warn "openrsync detected — using tar-pipe fallback (avoids nested-dir bug)"
    fi
}

copy_skill_source() {
    local src="$1" dst="$2"
    [ -d "$src" ] || return 0

    _check_rsync

    mkdir -p "$dst"

    if [ "$_USE_RSYNC" = "1" ]; then
        rsync -a \
            --exclude='skill-creator' \
            --exclude='.DS_Store' \
            --exclude='node_modules' \
            --exclude='.git' \
            "$src/" "$dst/"
    else
        ( cd "$src" && tar -h -cf - \
            --exclude='./skill-creator' \
            --exclude='.DS_Store' \
            --exclude='node_modules' \
            --exclude='.git' \
            . ) | ( cd "$dst" && tar xf - )
    fi
}

# ------------------------------ main -----------------------------------------

if [ $# -lt 1 ]; then
    printf "Usage: %s <dest_dir_1> [<dest_dir_2> ...]\n" "$(basename "${BASH_SOURCE[0]:-$0}")" >&2
    exit 1
fi

ROOT_SKILLS="$REPO_DIR/skills"
CLAUDE_SKILLS="$REPO_DIR/.claude/skills"

step "Syncing canonical skill union"
info "repo:          $REPO_DIR"
info "source 1:      $ROOT_SKILLS (primary — wins on conflict)"
info "source 2:      $CLAUDE_SKILLS (secondary)"
info "destinations:  $*"
info "excluded:      skill-creator/"

SYNCED_COUNT=0
for DEST in "$@"; do
    step "Syncing to $DEST"

    # Pass 1: secondary source (lower priority — will be overwritten by pass 2)
    if [ -d "$CLAUDE_SKILLS" ]; then
        copy_skill_source "$CLAUDE_SKILLS" "$DEST"
        ok "layered .claude/skills -> $DEST"
    else
        warn ".claude/skills not found at $CLAUDE_SKILLS — skipping"
    fi

    # Pass 2: primary source (root wins on name conflicts)
    if [ -d "$ROOT_SKILLS" ]; then
        copy_skill_source "$ROOT_SKILLS" "$DEST"
        ok "layered skills/ -> $DEST (root wins)"
    else
        warn "root skills/ not found at $ROOT_SKILLS — skipping"
    fi

    local_count=0
    local_count="$(find "$DEST" -mindepth 1 -maxdepth 1 -type d | wc -l | tr -d ' ')"
    ok "$local_count skill dirs in $DEST"
    SYNCED_COUNT=$((SYNCED_COUNT + 1))
done

step "Done"
info "synced to $SYNCED_COUNT destination(s)"
