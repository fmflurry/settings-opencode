#!/usr/bin/env bash
# memory-lint.sh [--body FILE|-] [ROOT]: lint docs/memory in the project at ROOT (default: the git root of $PWD).
# Fails on a doc without owner or reviewed frontmatter, a reviewed date older than 90 days, or a dead ref
# (path or path#symbol). ADRs under decisions/ are immutable, so they skip the age and ref checks.
# With --body, the PR body must also say "mémoire : màj" or "mémoire : aucun changement".
# Exit 0 when clean, when FMFLURRY_MEMORY=off, or when the project has no docs/memory. Exit 1 on a finding.
set -u
MAX_AGE_DAYS=90
MAX_AGENTS_LINES=80
MAX_MESSAGE_CHARS=200

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
real_root="$(cd -P -- "$root" && pwd -P)" || exit 0

failures=0
fail() {
  local msg="memory-lint: $1"
  failures=$((failures + 1))
  printf '%s\n' "${msg:0:$MAX_MESSAGE_CHARS}" >&2
}

days_from_civil() {
  local y=$((10#$1)) m=$((10#$2)) d=$((10#$3)) era yoe doy doe
  [ "$m" -le 2 ] && y=$((y - 1))
  era=$((y / 400))
  yoe=$((y - era * 400))
  if [ "$m" -gt 2 ]; then doy=$(((153 * (m - 3) + 2) / 5 + d - 1)); else doy=$(((153 * (m + 9) + 2) / 5 + d - 1)); fi
  doe=$((yoe * 365 + yoe / 4 - yoe / 100 + doy))
  echo $((era * 146097 + doe - 719468))
}

valid_date() {
  [[ "$1" =~ ^[0-9]{4}-([0-9]{2})-([0-9]{2})$ ]] || return 1
  local m=$((10#${BASH_REMATCH[1]})) d=$((10#${BASH_REMATCH[2]}))
  [ "$m" -ge 1 ] && [ "$m" -le 12 ] && [ "$d" -ge 1 ] && [ "$d" -le 31 ]
}

today="$(date -u +%Y-%m-%d)"
[ "${AGENT_HARNESS_TEST:-}" != 1 ] || today="${MEMORY_LINT_TODAY:-$today}"
today_days="$(days_from_civil "${today:0:4}" "${today:5:2}" "${today:8:2}")"

trim() {
  local s="$1"
  [[ "$s" =~ ^(.*[^[:space:]])[[:space:]]+#.*$ ]] && s="${BASH_REMATCH[1]}"
  [[ "$s" =~ ^[[:space:]]*#.*$ ]] && s=""
  s="${s#"${s%%[![:space:]]*}"}"
  s="${s%"${s##*[![:space:]]}"}"
  s="${s#[\"\']}"
  s="${s%[\"\']}"
  printf '%s' "$s"
}

# A committed symlink must not let a ref probe files outside the project.
inside_root() {
  local target="$1" dir
  dir="$(cd -P -- "$(dirname -- "$target")" 2>/dev/null && pwd -P)" || return 1
  case "$dir/" in "$real_root"/*) ;; *) return 1 ;; esac
  [ ! -L "$target" ] || return 1
}

ref_alive() {
  local ref="$1" path symbol
  path="${ref%%#*}"
  symbol=""
  [ "$path" = "$ref" ] || symbol="${ref#*#}"
  [ -n "$path" ] || return 1
  case "/$path/" in */../* | //*) return 1 ;; esac
  [ -e "$root/$path" ] || return 1
  inside_root "$root/$path" || return 1
  [ -n "$symbol" ] || return 0
  [ -f "$root/$path" ] && grep -Fqw -- "$symbol" "$root/$path"
}

lint_doc() {
  local file="$1" rel="${1#"$root"/}" front line key value owner="" reviewed="" in_refs=0 refs=() r age
  if [ "$(head -n 1 "$file" | tr -d '\r' | LC_ALL=C sed $'s/^\xEF\xBB\xBF//')" != "---" ]; then
    fail "$rel: missing frontmatter (owner, reviewed, refs)"
    return
  fi
  if ! awk 'NR > 1 && /^---[[:space:]]*\r?$/ { found = 1; exit } END { exit !found }' "$file"; then
    fail "$rel: unterminated frontmatter (no closing ---)"
    return
  fi
  front="$(awk 'NR == 1 { next } /^---[[:space:]]*\r?$/ { exit } { print }' "$file" | tr -d '\r')"
  while IFS= read -r line; do
    if [ "$in_refs" = 1 ] && [[ "$line" =~ ^[[:space:]]*-[[:space:]]*(.*)$ ]]; then
      r="$(trim "${BASH_REMATCH[1]}")"
      [ -z "$r" ] || refs+=("$r")
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
    return
  fi
  if ! valid_date "$reviewed"; then
    fail "$rel: reviewed '$reviewed' is not a YYYY-MM-DD date"
    return
  fi
  case "$rel" in docs/memory/decisions/*) return ;; esac
  age=$((today_days - $(days_from_civil "${reviewed:0:4}" "${reviewed:5:2}" "${reviewed:8:2}")))
  if [ "$age" -gt "$MAX_AGE_DAYS" ]; then
    fail "$rel: reviewed $reviewed is older than $MAX_AGE_DAYS days"
  elif [ "$age" -lt -1 ]; then
    fail "$rel: reviewed $reviewed is in the future"
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
