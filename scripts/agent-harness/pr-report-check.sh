#!/bin/bash -p
# pr-report-check.sh [--body-file path]: exit 0 when the PR body has a valid ## Visual report section.
set -euo pipefail
here="$(CDPATH= cd -P -- "${BASH_SOURCE[0]%/*}" && builtin pwd -P)"
hook=""
for c in \
  "$here/../../.claude/hooks/pr-visual-report.sh" \
  "$here/../../hooks/pr-visual-report.sh" \
  "${HOME:-}/.claude/hooks/pr-visual-report.sh"
do
  [ -f "$c" ] || continue
  hook="$c"
  break
done
[ -n "$hook" ] || { printf '%s\n' "pr-report-check: pr-visual-report.sh not found" >&2; exit 1; }
builtin exec /bin/bash "$hook" --check "$@"
