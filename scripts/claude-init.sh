#!/usr/bin/env bash
#
# claude-init — copy the canonical CLAUDE.md starter into cwd.
#
# Source of truth: <repo-root>/CLAUDE.md (this script lives in <repo-root>/scripts/).
# Target:          <cwd>/CLAUDE.md
#
# Flags:
#   -f, --force    Overwrite existing CLAUDE.md without prompting
#   -s, --symlink  Symlink instead of copy (edits propagate from repo)
#   -p, --print    Print the source path and exit
#   -h, --help     Show usage
#
set -euo pipefail

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
REPO_ROOT="$( cd "$SCRIPT_DIR/.." && pwd )"
SOURCE="$REPO_ROOT/CLAUDE.md"
TARGET="$PWD/CLAUDE.md"

FORCE=0
SYMLINK=0

if [ -t 1 ]; then
    BOLD=$'\033[1m'; RED=$'\033[31m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; RESET=$'\033[0m'
else
    BOLD=""; RED=""; GREEN=""; YELLOW=""; RESET=""
fi

print_help() {
    cat <<EOF
${BOLD}claude-init${RESET} — drop the CLAUDE.md starter into the current project.

Usage: claude-init [flags]

Flags:
  -f, --force    Overwrite an existing CLAUDE.md without asking
  -s, --symlink  Symlink to the repo's CLAUDE.md (edits in the repo propagate)
  -p, --print    Print the source path and exit
  -h, --help     Show this message

Source: $SOURCE
EOF
}

while [ $# -gt 0 ]; do
    case "$1" in
        -f|--force)   FORCE=1 ;;
        -s|--symlink) SYMLINK=1 ;;
        -p|--print)   printf "%s\n" "$SOURCE"; exit 0 ;;
        -h|--help)    print_help; exit 0 ;;
        *) printf "${RED}unknown flag:${RESET} %s\n" "$1" >&2; print_help; exit 1 ;;
    esac
    shift
done

if [ ! -f "$SOURCE" ]; then
    printf "${RED}error:${RESET} source not found at %s\n" "$SOURCE" >&2
    exit 1
fi

if [ -e "$TARGET" ] || [ -L "$TARGET" ]; then
    if [ "$FORCE" = "0" ]; then
        printf "${YELLOW}exists:${RESET} %s\n" "$TARGET"
        printf "    rerun with ${BOLD}--force${RESET} to overwrite (existing file will be backed up)\n"
        exit 1
    fi
    backup="${TARGET}.bak.$(date +%Y%m%d-%H%M%S)"
    mv "$TARGET" "$backup"
    printf "    backed up existing -> %s\n" "$backup"
fi

if [ "$SYMLINK" = "1" ]; then
    ln -s "$SOURCE" "$TARGET"
    printf "${GREEN}linked${RESET}  %s -> %s\n" "$TARGET" "$SOURCE"
else
    cp "$SOURCE" "$TARGET"
    printf "${GREEN}copied${RESET}  %s -> %s\n" "$SOURCE" "$TARGET"
fi
