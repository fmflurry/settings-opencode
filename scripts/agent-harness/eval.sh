#!/bin/bash -p
# eval: run the local task suite under Conductor and Monolith. Checker mode calls no model.
set -euo pipefail
dir="$(builtin cd -P "${BASH_SOURCE[0]%/*}" && builtin pwd -P)"
node="$(type -P node || true)"
[ -n "$node" ] || { echo "eval: node is required" >&2; exit 1; }
builtin exec "$node" "$dir/eval-run.mjs" "$@"
