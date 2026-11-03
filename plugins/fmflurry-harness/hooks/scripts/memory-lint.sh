#!/usr/bin/env bash
# memory-lint.sh [--body FILE|-] [ROOT]: lint docs/memory in the project at ROOT (default: the git root of $PWD).
# Fails on a doc without owner or reviewed frontmatter, a reviewed date older than 90 days, or a dead ref
# (path or path#symbol). With --body, the PR body must also say "mémoire : màj" or "mémoire : aucun changement".
# Exit 0 when clean, when FMFLURRY_MEMORY=off, or when the project has no docs/memory. Exit 1 on a finding.
set -u
MAX_AGE_DAYS=90
MAX_AGENTS_LINES=80

body_file=""
if [ "${1:-}" = "--body" ]; then
  [ $# -ge 2 ] || { echo "usage: memory-lint.sh [--body FILE|-] [ROOT]" >&2; exit 2; }
  body_file="$2"
  shift 2
fi

mode="$(printf '%s' "${FMFLURRY_MEMORY-}" | tr '[:upper:]' '[:lower:]' | tr -d '[:space:]')"
[ "$mode" != off ] || exit 0

start="${1:-$PWD}"
root="$(git -C "$start" rev-parse --show-toplevel 2>/dev/null)" || root="$start"
[ -d "$root/docs/memory" ] || exit 0

failures=0
fail() { failures=$((failures + 1)); printf 'memory-lint: %s\n' "$1" >&2; }

days_from_civil() {
  local y=$((10#$1)) m=$((10#$2)) d=$((10#$3)) era yoe doy doe
  [ "$m" -le 2 ] && y=$((y - 1))
  era=$((y / 400))
  yoe=$((y - era * 400))
  if [ "$m" -gt 2 ]; then doy=$(((153 * (m - 3) + 2) / 5 + d - 1)); else doy=$(((153 * (m + 9) + 2) / 5 + d - 1)); fi
  doe=$((yoe * 365 + yoe / 4 - yoe / 100 + doy))
  echo $((era * 146097 + doe - 719468))
}

today="$(date -u +%Y-%m-%d)"
[ "${AGENT_HARNESS_TEST:-}" != 1 ] || today="${MEMORY_LINT_TODAY:-$today}"
today_days="$(days_from_civil "${today:0:4}" "${today:5:2}" "${today:8:2}")"

trim() {
  local s="$1"
  s="${s#"${s%%[![:space:]]*}"}"
  s="${s%"${s##*[![:space:]]}"}"
  s="${s#[\"\']}"
  s="${s%[\"\']}"
  printf '%s' "$s"
}

ref_alive() {
  local ref="$1" path symbol
  path="${ref%%#*}"
  symbol=""
  [ "$path" = "$ref" ] || symbol="${ref#*#}"
  case "/$path/" in */../* | //*) return 1 ;; esac
  [ -e "$root/$path" ] || return 1
  [ -n "$symbol" ] || return 0
  [ -f "$root/$path" ] && grep -Fqw -- "$symbol" "$root/$path"
}

lint_doc() {
  local file="$1" rel="${1#"$root"/}" front line key value owner="" reviewed="" in_refs=0 refs=() r
  if [ "$(head -n 1 "$file" | tr -d '\r')" != "---" ]; then
    fail "$rel: missing frontmatter (owner, reviewed, refs)"
    return
  fi
  front="$(awk 'NR == 1 { next } /^---[[:space:]]*$/ { exit } { print }' "$file" | tr -d '\r')"
  while IFS= read -r line; do
    if [ "$in_refs" = 1 ] && [[ "$line" =~ ^[[:space:]]+-[[:space:]]*(.*)$ ]]; then
      refs+=("$(trim "${BASH_REMATCH[1]}")")
      continue
    fi
    in_refs=0
    [[ "$line" =~ ^([A-Za-z_]+):(.*)$ ]] || continue
    key="${BASH_REMATCH[1]}"
    value="$(trim "${BASH_REMATCH[2]}")"
    case "$key" in
      owner) owner="$value" ;;
      reviewed) reviewed="$value" ;;
      refs)
        if [[ "$value" =~ ^\[(.*)\]$ ]]; then
          value="${BASH_REMATCH[1]}"
          while [ -n "$value" ]; do
            r="${value%%,*}"
            [ -z "$(trim "$r")" ] || refs+=("$(trim "$r")")
            [ "$r" != "$value" ] || break
            value="${value#*,}"
          done
        elif [ -z "$value" ]; then
          in_refs=1
        fi
        ;;
    esac
  done <<<"$front"

  [ -n "$owner" ] || fail "$rel: missing owner"
  if [ -z "$reviewed" ]; then
    fail "$rel: missing reviewed"
  elif [[ ! "$reviewed" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]]; then
    fail "$rel: reviewed '$reviewed' is not a YYYY-MM-DD date"
  elif [ $((today_days - $(days_from_civil "${reviewed:0:4}" "${reviewed:5:2}" "${reviewed:8:2}"))) -gt "$MAX_AGE_DAYS" ]; then
    fail "$rel: reviewed $reviewed is older than $MAX_AGE_DAYS days"
  fi
  for r in ${refs[@]+"${refs[@]}"}; do
    ref_alive "$r" || fail "$rel: dead ref $r"
  done
}

while IFS= read -r doc; do
  [ -n "$doc" ] || continue
  lint_doc "$doc"
done < <(find "$root/docs/memory" -type f -name '*.md' | LC_ALL=C sort)

if [ -f "$root/AGENTS.md" ] && [ "$(wc -l <"$root/AGENTS.md")" -gt "$MAX_AGENTS_LINES" ]; then
  printf 'memory-lint: warning: AGENTS.md has more than %s lines; move detail to docs/memory\n' "$MAX_AGENTS_LINES" >&2
fi

if [ -n "$body_file" ]; then
  if [ "$body_file" = - ]; then body="$(cat)"; else body="$(cat -- "$body_file" 2>/dev/null)" || body=""; fi
  printf '%s\n' "$body" | grep -Eq '[Mm]émoire[[:space:]]*:[[:space:]]*(màj|aucun changement)' \
    || fail "PR body must state 'mémoire : màj' or 'mémoire : aucun changement'"
fi

[ "$failures" -eq 0 ]
