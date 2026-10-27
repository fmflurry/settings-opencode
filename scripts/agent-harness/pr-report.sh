#!/bin/bash -p
# pr-report.sh <html> [--slug slug]: copy a show-me HTML report into docs/pr-reports/ and render the PNG next to it.
set -euo pipefail
usage="usage: pr-report.sh <html> [--slug slug] [--metrics path]"
html=""
slug=""
metrics=""
while [ $# -gt 0 ]; do
  case "$1" in
    --slug)
      [ -n "${2:-}" ] || { printf '%s\n' "$usage" >&2; exit 2; }
      slug="$2"; shift 2 ;;
    --slug=*) slug="${1#--slug=}"; shift ;;
    --metrics)
      [ -n "${2:-}" ] || { printf '%s\n' "$usage" >&2; exit 2; }
      metrics="$2"; shift 2 ;;
    --metrics=*) metrics="${1#--metrics=}"; shift ;;
    -*) printf '%s\n' "$usage" >&2; exit 2 ;;
    *)
      [ -z "$html" ] || { printf '%s\n' "$usage" >&2; exit 2; }
      html="$1"; shift ;;
  esac
done
[ -n "$html" ] || { printf '%s\n' "$usage" >&2; exit 2; }
[ -f "$html" ] || { printf '%s\n' "pr-report: $html not found" >&2; exit 1; }
src_html="$html"

if ! grep -q '@media' "$html"; then
  printf '%s\n' "pr-report: HTML needs an @media breakpoint" >&2
  exit 1
fi
if grep -E -q '(src|href)[[:space:]]*=[[:space:]]*["'\''][[:space:]]*(https?:)?//|url\([[:space:]]*["'\'']?(https?:)?//|@import[[:space:]]+["'\''](https?:)?//' "$html"; then
  printf '%s\n' "pr-report: HTML must render offline (no external src, href, or import)" >&2
  exit 1
fi

root="$(git rev-parse --show-toplevel 2>/dev/null)" || { printf '%s\n' "pr-report: not inside a git repository" >&2; exit 1; }
if [ -z "$slug" ]; then
  branch="$(git -C "$root" symbolic-ref --short HEAD 2>/dev/null || true)"
  [ -n "$branch" ] || { printf '%s\n' "pr-report: detached HEAD; pass --slug" >&2; exit 1; }
  slug="${branch//\//-}"
fi
[[ "$slug" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]] || { printf '%s\n' "pr-report: bad slug '$slug'" >&2; exit 1; }

dest="$root/docs/pr-reports"
mkdir -p "$dest"
out_html="$dest/$slug.html"
out_png="$dest/$slug.png"
out_metrics="$dest/$slug.metrics.json"
if [ -L "$out_html" ] || [ -L "$out_png" ] || [ -L "$out_metrics" ] || [ -L "$dest" ]; then
  printf '%s\n' "pr-report: refuse to write through a symlink" >&2
  exit 1
fi

here="$(CDPATH= cd -P -- "${BASH_SOURCE[0]%/*}" && builtin pwd -P)"
node="$(type -P node || true)"
if [ -z "$metrics" ] && [ -f "$out_metrics" ]; then
  metrics="$out_metrics"
fi
if [ -z "$metrics" ]; then
  sib="${src_html%.html}.metrics.json"
  [ "$sib" != "$src_html" ] && [ -f "$sib" ] && metrics="$sib"
fi
render="$src_html"
panel_tmp=""
if [ -n "$metrics" ]; then
  if [ -z "$node" ]; then
    printf '%s\n' "pr-report: warning: node is required to add the metrics panel" >&2
  elif [ ! -f "$metrics" ]; then
    printf '%s\n' "pr-report: warning: metrics file not found" >&2
  else
    panel_tmp="$(mktemp)"
    if "$node" "$here/kpi-feature.mjs" --inject "$src_html" --metrics "$metrics" --out "$panel_tmp" --metrics-out "$out_metrics"; then
      render="$panel_tmp"
    else
      printf '%s\n' "pr-report: warning: metrics ignored" >&2
      rm -f -- "$panel_tmp"
      panel_tmp=""
    fi
  fi
fi
cp -- "$render" "$out_html"
[ -z "$panel_tmp" ] || rm -f -- "$panel_tmp"
shot=""
if [ "${AGENT_HARNESS_TEST:-}" = 1 ] && [ -n "${PR_REPORT_SCREENSHOT:-}" ]; then
  shot="$PR_REPORT_SCREENSHOT"
else
  for c in \
    "$here/../../skills/show-me/scripts/screenshot.sh" \
    "$here/../../.claude/skills/show-me/scripts/screenshot.sh" \
    "${HOME:-}/.claude/skills/show-me/scripts/screenshot.sh" \
    "${HOME:-}/.config/opencode/skills/show-me/scripts/screenshot.sh" \
    "${CURSOR_PLUGIN_ROOT:-}/skills/show-me/scripts/screenshot.sh"
  do
    [ -f "$c" ] || continue
    shot="$c"
    break
  done
fi
if [ -n "$shot" ]; then
  /bin/bash "$shot" "$out_html" "$dest" >&2 || true
fi
rm -f -- "$dest/$slug-390.png"

if [ ! -s "$out_png" ]; then
  chrome=""
  if [ "${AGENT_HARNESS_TEST:-}" = 1 ] && [ -n "${AGENT_HARNESS_CHROME:-}" ] && [ -x "${AGENT_HARNESS_CHROME}" ]; then
    chrome="$AGENT_HARNESS_CHROME"
  else
    for c in google-chrome google-chrome-stable chromium chromium-browser chrome; do
      chrome="$(command -v "$c" 2>/dev/null || true)"
      [ -n "$chrome" ] && break
    done
  fi
  if [ -n "$chrome" ]; then
    profile="$(mktemp -d)"
    "$chrome" --headless=new --disable-gpu --no-first-run --user-data-dir="$profile" \
      --screenshot="$out_png" --window-size=1280,1600 "file://$out_html" >/dev/null 2>&1 || true
    rm -rf "$profile"
  fi
fi
[ -s "$out_png" ] || { printf '%s\n' "pr-report: no PNG at $out_png (screenshot failed)" >&2; exit 1; }

art=""
if [ -n "${PR_REPORT_ARTIFACT_DIR:-}" ]; then
  art="$PR_REPORT_ARTIFACT_DIR"
elif [ -d /opt/cursor/artifacts ] && [ -w /opt/cursor/artifacts ]; then
  art="/opt/cursor/artifacts"
fi
art_html=""
art_png=""
if [ -n "$art" ]; then
  mkdir -p "$art/pr-reports"
  art_html="$art/pr-reports/$slug.html"
  art_png="$art/pr-reports/$slug.png"
  cp -- "$out_html" "$art_html"
  cp -- "$out_png" "$art_png"
fi

rel_html="docs/pr-reports/$slug.html"
rel_png="docs/pr-reports/$slug.png"
rel_metrics="docs/pr-reports/$slug.metrics.json"
printf '%s\n' "html=$rel_html" "png=$rel_png"
[ -s "$out_metrics" ] && printf '%s\n' "metrics=$rel_metrics"
[ -z "$art_html" ] || printf '%s\n' "artifact_html=$art_html" "artifact_png=$art_png"
if [ -n "$art" ] && [ -s "$out_metrics" ]; then
  cp -- "$out_metrics" "$art/pr-reports/$slug.metrics.json"
fi
printf '\n## Visual report\n\n- [x] Report: HTML and PNG committed, PNG embedded, HTML linked.\n\n![Visual report](%s)\n\n[HTML report](%s)\n' "$rel_png" "$rel_html"
if [ -n "$art_png" ]; then
  printf '<img alt="Visual report" src="%s" />\n' "$art_png"
fi
if [ -s "$out_metrics" ] && [ -n "$node" ]; then
  md="$("$node" "$here/kpi-feature.mjs" --markdown --metrics "$out_metrics" 2>/dev/null || true)"
  [ -z "$md" ] || printf '\n%s\n' "$md"
fi
