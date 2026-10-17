#!/bin/bash -p
# Usage: agent-harness.sh autonomy|goal|notify|ship-init|ship-merge|cleanup|teardown-merged-worktree|worktree-rm|report [args...]
for _fn in $(builtin compgen -A function); do builtin unset -f "$_fn"; done
builtin unset _fn
builtin set -euo pipefail
dir="$(builtin cd -P "${BASH_SOURCE[0]%/*}" && builtin pwd -P)"
[ ! -f "$dir/.installed" ] || PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
case "${1:-}" in
  autonomy | goal | notify | ship-init | ship-merge | cleanup | teardown-merged-worktree | worktree-rm | report)
    sub="$1"; shift
    builtin exec /bin/bash -p "$dir/$sub.sh" "$@" ;;
  *) echo "usage: agent-harness.sh autonomy|goal|notify|ship-init|ship-merge|cleanup|teardown-merged-worktree|worktree-rm|report [args...]" >&2; exit 2 ;;
esac
