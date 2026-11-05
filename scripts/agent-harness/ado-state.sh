#!/bin/bash -p
if ! command -v node >/dev/null 2>&1; then
  echo 'ado-state: node is unavailable; work item unchanged' >&2
  exit 0
fi
node "${BASH_SOURCE[0]%/*}/ado-state.mjs" "$@" || { echo 'ado-state: work item unchanged' >&2; exit 0; }
