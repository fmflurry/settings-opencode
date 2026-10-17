#!/bin/bash -p
# shellcheck disable=SC2016
# report.sh <slug|branch> <html> [<out.png>]: render a temp copy of an HTML report to PNG with headless Chrome and record it on the goal.
# Output stays inside the registered worktree; default <worktree>/docs/agent-reports/<yyyy-mm-dd>-<slug>.png. AGENT_HARNESS_CHROME overrides the Chrome binary in test mode from a repo checkout only.
# Exit: 0 rendered | 1 failed | 2 usage or no Chrome
set -euo pipefail
# shellcheck source=scripts/agent-harness/lib.sh
. "${BASH_SOURCE[0]%/*}/lib.sh"
usage="usage: report.sh <slug> <html> [<out.png>]"
[ $# -ge 2 ] && [ $# -le 3 ] || { echo "$usage" >&2; exit 2; }
slug="$(reg_slug "$1")" html="$2" out="${3:-}"
[[ "$slug" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]] || { echo "report: bad slug '$1'" >&2; exit 2; }
[ -f "$html" ] || { echo "report: $html not found" >&2; exit 1; }

find_chrome() {
  local c
  if [ "$HARNESS_INSTALLED" = 0 ] && [ "${AGENT_HARNESS_TEST:-}" = 1 ] && [ -n "${AGENT_HARNESS_CHROME:-}" ]; then
    [ -x "$AGENT_HARNESS_CHROME" ] && { printf '%s' "$AGENT_HARNESS_CHROME"; return 0; }
    return 1
  fi
  for c in google-chrome google-chrome-stable chromium chromium-browser chrome; do
    type -P "$c" && return 0
  done
  for c in "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" "/Applications/Chromium.app/Contents/MacOS/Chromium"; do
    [ -x "$c" ] && { printf '%s' "$c"; return 0; }
  done
  return 1
}
chrome="$(find_chrome)" || { echo "report: no Chrome found (install Google Chrome or Chromium, or set AGENT_HARNESS_CHROME)" >&2; exit 2; }

M="$(main_checkout)" || { echo "report: not inside a git repository" >&2; exit 1; }
wt="$(reg_get "$slug" '.path // empty' || true)"
[ -n "$wt" ] || { echo "report: no registered goal '$slug' to place the report in" >&2; exit 1; }
if [ -L "$wt" ] || [ "$(cd "$wt" 2>/dev/null && pwd -P)" != "$wt" ] || [ "$wt" = "$(realp "$M")" ] \
  || ! git -C "$M" worktree list --porcelain | sed -n 's/^worktree //p' | grep -qxF "$wt"; then
  echo "report: registered path $wt is not a linked worktree of this repository" >&2; exit 1
fi
[ -n "$out" ] || out="$wt/docs/agent-reports/$(date +%Y-%m-%d)-$slug.png"
case "$out" in /*) ;; *) out="$PWD/$out" ;; esac
case "/$out/" in */../*) echo "report: $out must not contain .." >&2; exit 1 ;; esac
case "$out" in "$wt"/*.png) ;; *) echo "report: output must be a .png inside $wt" >&2; exit 1 ;; esac
rel="${out#"$wt"/}" dir="$wt"
IFS=/ read -ra parts <<<"${rel%/*}"
if [ "$rel" != "${rel%/*}" ]; then
  for part in "${parts[@]}"; do
    dir="$dir/$part"
    [ ! -L "$dir" ] || { echo "report: $dir is a symlink" >&2; exit 1; }
  done
fi
mkdir -p "$(dirname "$out")"
[ "$(cd "$(dirname "$out")" && pwd -P)/$(basename "$out")" = "$out" ] || { echo "report: output resolves outside $wt" >&2; exit 1; }
CSP="default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:"
profile="$(mktemp -d)"
trap 'rm -rf "$profile"' EXIT
printf '%s\n' "<meta http-equiv=\"Content-Security-Policy\" content=\"$CSP\">" | cat - "$html" >"$profile/report.html"
"$chrome" --headless=new --disable-gpu --no-first-run --disable-features=FileSystemAccessAPI --user-data-dir="$profile/profile" --screenshot="$out" --window-size=1200,1600 "file://$profile/report.html" >/dev/null 2>&1 || true
[ -s "$out" ] || { echo "report: Chrome produced no screenshot at $out" >&2; exit 1; }
reg_update "$slug" --arg r "$out" '.report = $r' || true
echo "$out"
