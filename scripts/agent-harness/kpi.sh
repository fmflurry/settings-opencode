#!/bin/bash -p
# kpi report: read the local JSONL log and compare Conductor with Monolith.
set -euo pipefail
dir="$(builtin cd -P "${BASH_SOURCE[0]%/*}" && builtin pwd -P)"
node="$(type -P node || true)"
[ -n "$node" ] || { echo "kpi: node is required" >&2; exit 1; }
cmd="${1:-report}"
case "$cmd" in
  report)
    [ $# -eq 0 ] || shift
    builtin exec "$node" "$dir/kpi-report.mjs" "$@" ;;
  *)
    echo "usage: agent-harness kpi report [--since 30d] [--by variant] [--json|--html] [--no-live]" >&2
    exit 2 ;;
esac
