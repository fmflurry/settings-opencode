#!/bin/bash -p
# Usage: worktree-rm.sh <path> [--confirmed]
# Exit: 0 removed, checkouts intact | 1 STOP/refused | 2 usage | 3 dry run | 4 removal failed or unrecoverable damage
set -euo pipefail
# shellcheck source=scripts/agent-harness/lib.sh
. "${BASH_SOURCE[0]%/*}/lib.sh"

usage() { echo "usage: agent-harness.sh worktree-rm <path> [--confirmed]" >&2; exit 2; }

p="" confirmed=0
for a in "$@"; do
  case "$a" in
    --confirmed) confirmed=1 ;;
    -*) usage ;;
    *) [ -z "$p" ] || usage; p="$a" ;;
  esac
done
[ -n "$p" ] || usage
if autonomy_on; then echo "worktree-rm: worktree removal is forbidden in autonomous mode" >&2; exit 1; fi

# shellcheck source=scripts/agent-harness/worktree-core.sh
. "$HARNESS_DIR/worktree-core.sh"
wt_remove "$p" "$confirmed" rm
