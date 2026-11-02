#!/bin/bash -p
# pr-report-links.sh [--slug slug] [--ref rev]: print the ## Visual report section with absolute GitHub URLs pinned to a commit.
set -euo pipefail
usage="usage: pr-report-links.sh [--slug slug] [--ref rev]"
slug=""
ref="HEAD"
while [ $# -gt 0 ]; do
  case "$1" in
    --slug) [ -n "${2:-}" ] || { printf '%s\n' "$usage" >&2; exit 2; }; slug="$2"; shift 2 ;;
    --slug=*) slug="${1#--slug=}"; shift ;;
    --ref) [ -n "${2:-}" ] || { printf '%s\n' "$usage" >&2; exit 2; }; ref="$2"; shift 2 ;;
    --ref=*) ref="${1#--ref=}"; shift ;;
    *) printf '%s\n' "$usage" >&2; exit 2 ;;
  esac
done

here="$(CDPATH= cd -P -- "${BASH_SOURCE[0]%/*}" && builtin pwd -P)"
root="$(git rev-parse --show-toplevel 2>/dev/null)" || { printf '%s\n' "pr-report-links: not inside a git repository" >&2; exit 1; }
if [ -z "$slug" ]; then
  branch="$(git -C "$root" symbolic-ref --short HEAD 2>/dev/null || true)"
  [ -n "$branch" ] || { printf '%s\n' "pr-report-links: detached HEAD; pass --slug" >&2; exit 1; }
  slug="${branch//\//-}"
fi
[[ "$slug" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]] || { printf '%s\n' "pr-report-links: bad slug '$slug'" >&2; exit 1; }

sha="$(git -C "$root" rev-parse --verify --quiet "$ref^{commit}" 2>/dev/null)" || { printf '%s\n' "pr-report-links: '$ref' is not a commit" >&2; exit 1; }
html="docs/pr-reports/$slug.html"
png="docs/pr-reports/$slug.png"
for f in "$html" "$png"; do
  git -C "$root" cat-file -e "$sha:$f" 2>/dev/null \
    || { printf '%s\n' "pr-report-links: $f is not in commit ${sha:0:12}; commit the report files first" >&2; exit 1; }
done

url="$(git -C "$root" remote get-url origin 2>/dev/null || true)"
[ -n "$url" ] || { printf '%s\n' "pr-report-links: no origin remote" >&2; exit 1; }
case "$url" in
  https://*|http://*) rest="${url#*://}"; rest="${rest#*@}"; host="${rest%%/*}"; path="${rest#*/}" ;;
  ssh://*) rest="${url#ssh://}"; rest="${rest#*@}"; host="${rest%%/*}"; host="${host%%:*}"; path="${rest#*/}" ;;
  *@*:*) rest="${url#*@}"; host="${rest%%:*}"; path="${rest#*:}" ;;
  *) printf '%s\n' "pr-report-links: cannot read a host from origin" >&2; exit 1 ;;
esac
path="${path%/}"
path="${path%.git}"
case "$host" in
  *dev.azure.com*|*visualstudio.com*) printf '%s\n' "pr-report-links: origin is Azure DevOps; keep relative docs/pr-reports links there" >&2; exit 1 ;;
esac
# An SSH alias such as github-work is not a web host; PR_REPORT_HOST names the real one.
if [ -n "${PR_REPORT_HOST:-}" ]; then
  host="$PR_REPORT_HOST"
elif [[ "$host" != *.* ]]; then
  printf '%s\n' "pr-report-links: origin host '$host' looks like an SSH alias; set PR_REPORT_HOST (for example github.com)" >&2
  exit 1
fi
[[ "$host" =~ ^[A-Za-z0-9.-]+$ ]] && [[ "$path" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] \
  || { printf '%s\n' "pr-report-links: cannot read owner/repo from origin" >&2; exit 1; }

if [ -z "$(git -C "$root" branch -r --contains "$sha" 2>/dev/null)" ]; then
  printf '%s\n' "pr-report-links: warning: ${sha:0:12} is not on a remote branch yet; the links return 404 until you push" >&2
fi

base="https://$host/$path/blob/$sha"
printf '## Visual report\n\n- [x] Report: HTML and PNG committed, PNG embedded, HTML linked.\n\n![Visual report](%s/%s?raw=true)\n\n[HTML report](%s/%s)\n' "$base" "$png" "$base" "$html"

art="${PR_REPORT_ARTIFACT_DIR:-/opt/cursor/artifacts}"
if [ -f "$art/pr-reports/$slug.png" ]; then
  printf '<img alt="Visual report" src="%s" />\n' "$art/pr-reports/$slug.png"
fi

metrics="$root/docs/pr-reports/$slug.metrics.json"
node="$(type -P node || true)"
if [ -s "$metrics" ] && [ -n "$node" ]; then
  md="$("$node" "$here/kpi-feature.mjs" --markdown --metrics "$metrics" 2>/dev/null || true)"
  [ -z "$md" ] || printf '\n%s\n' "$md"
fi
