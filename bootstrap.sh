#!/usr/bin/env bash
#
# settings-opencode bootstrap — one-line installer for macOS, Linux, and WSL.
#
# Usage (install or update — same command):
#   curl -fsSL https://raw.githubusercontent.com/fmflurry/settings-opencode/master/bootstrap.sh | bash
#
# Pass flags through to install.sh after `-s --`, e.g.:
#   curl -fsSL .../bootstrap.sh | bash -s -- --no-claude
#   curl -fsSL .../bootstrap.sh | bash -s -- --uninstall
#   curl -fsSL .../bootstrap.sh | bash -s -- --local
#   curl -fsSL .../bootstrap.sh | bash -s -- --no-opencode
#   curl -fsSL .../bootstrap.sh | bash -s -- --opencode --yes
#
# It clones (or fast-forwards) the repo into a local source dir, then hands off
# to install.sh, which copies the config into ~/.config/opencode and ~/.claude.
# Re-running this exact command pulls the latest and re-applies it — that is the
# update path. Set SETTINGS_OPENCODE_SRC to override the source clone location.
#
set -euo pipefail

REPO_URL="https://github.com/fmflurry/settings-opencode.git"
BRANCH="${SETTINGS_OPENCODE_BRANCH:-master}"
SRC_DIR="${SETTINGS_OPENCODE_SRC:-${XDG_DATA_HOME:-$HOME/.local/share}/settings-opencode}"

if [ -t 1 ]; then
    BOLD=$'\033[1m'; BLUE=$'\033[34m'; RED=$'\033[31m'; RESET=$'\033[0m'
else
    BOLD=""; BLUE=""; RED=""; RESET=""
fi
step() { printf "\n${BOLD}${BLUE}==>${RESET} ${BOLD}%s${RESET}\n" "$*"; }
die()  { printf "${RED}error:${RESET} %s\n" "$*" >&2; exit 1; }

command -v git >/dev/null 2>&1 || die "git is required. Install it first:
  macOS:         xcode-select --install   (or: brew install git)
  Debian/Ubuntu: sudo apt install -y git
  Fedora:        sudo dnf install -y git"

step "Fetching settings-opencode into $SRC_DIR"
if [ -d "$SRC_DIR/.git" ]; then
    git -C "$SRC_DIR" fetch --depth 1 origin "$BRANCH"
    git -C "$SRC_DIR" checkout -q "$BRANCH" 2>/dev/null || git -C "$SRC_DIR" checkout -qB "$BRANCH" "origin/$BRANCH"
    git -C "$SRC_DIR" reset --hard "origin/$BRANCH"
else
    [ -e "$SRC_DIR" ] && die "$SRC_DIR exists but is not a git checkout. Remove it or set SETTINGS_OPENCODE_SRC to a different path."
    mkdir -p "$(dirname "$SRC_DIR")"
    git clone --depth 1 --branch "$BRANCH" "$REPO_URL" "$SRC_DIR"
fi

[ -f "$SRC_DIR/install.sh" ] || die "install.sh not found in $SRC_DIR after fetch"

# Forward any user-supplied flags to install.sh. install.sh reads prompts from
# the controlling terminal when stdin is a pipe, so curl | bash stays interactive.
args=( ${@+"$@"} )

step "Running installer"
if [ -r /dev/tty ]; then
    exec bash "$SRC_DIR/install.sh" ${args[@]+"${args[@]}"} </dev/tty
fi
exec bash "$SRC_DIR/install.sh" ${args[@]+"${args[@]}"}
