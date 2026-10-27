#!/bin/bash -p
# kpi report: Conductor vs Monolith. kpi feature: one repo+branch, and its PR once known.
set -euo pipefail
dir="$(builtin cd -P "${BASH_SOURCE[0]%/*}" && builtin pwd -P)"
node="$(type -P node || true)"
[ -n "$node" ] || { echo "kpi: node is required" >&2; exit 1; }
cmd="${1:-report}"
case "$cmd" in
  report)
    [ $# -eq 0 ] || shift
    builtin exec "$node" "$dir/kpi-report.mjs" "$@" ;;
  feature)
    shift
    builtin exec "$node" "$dir/kpi-feature.mjs" "$@" ;;
  *)
    echo "usage: agent-harness kpi report [--since 30d] [--by variant] [--json|--html] [--no-live]" >&2
    echo "       agent-harness kpi feature [--branch X | --pr N] [--json|--html] [--log path]" >&2
    exit 2 ;;
esac
