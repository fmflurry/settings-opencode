#!/bin/bash -p
# memory-lint.sh [--body FILE|-] [ROOT]: run the memory-lint hook on the project's docs/memory.
set -euo pipefail
here="$(CDPATH= cd -P -- "${BASH_SOURCE[0]%/*}" && builtin pwd -P)"
hook=""
for c in \
  "$here/../../.claude/hooks/memory-lint.sh" \
  "$here/hooks/memory-lint.sh" \
  "${HOME:-}/.claude/hooks/memory-lint.sh"
do
  [ -f "$c" ] || continue
  hook="$c"
  break
done
[ -n "$hook" ] || { printf '%s\n' "memory-lint: memory-lint.sh not found" >&2; exit 1; }
builtin exec /bin/bash "$hook" "$@"
