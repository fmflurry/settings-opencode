#!/usr/bin/env bash
# Usage: agent-harness.sh autonomy|goal|notify|ship-merge|cleanup [args...]
set -euo pipefail
dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
case "${1:-}" in
  autonomy | goal | notify | ship-merge | cleanup)
    sub="$1"; shift
    exec bash "$dir/$sub.sh" "$@" ;;
  *) echo "usage: agent-harness.sh autonomy|goal|notify|ship-merge|cleanup [args...]" >&2; exit 2 ;;
esac
