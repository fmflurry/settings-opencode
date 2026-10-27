#!/usr/bin/env bash
# PreToolUse (Bash): block a gh or az pull-request body that has no ## Visual report section.
# Check mode: pr-visual-report.sh --check [--body-file path]
# Hook mode reads the PreToolUse JSON on stdin. Allow prints nothing. Deny prints hook JSON.
# A docs typo or a version bump only may pass with a checked Skip line and a reason.
set -f

say() { REASON="$1"; printf '%s\n' "$1" >&2; }

visual_ok() {
  local body="$1" section skip_line reason
  body="${body//$'\r'/}"
  section="$(printf '%s\n' "$body" | awk '
    /^## Visual report[[:space:]]*$/ { found=1; next }
    found && /^##[^#]/ { exit }
    found { print }
  ')"
  if ! printf '%s\n' "$body" | grep -Eq '^## Visual report[[:space:]]*$'; then
    say "pr-visual-report: PR body is missing a ## Visual report section"
    return 1
  fi
  if printf '%s\n' "$section" | grep -Eq '^[[:space:]]*[-*] \[[xX]\][[:space:]]+Report([^[:alnum:]]|$)' \
    && printf '%s\n' "$section" | grep -Eq 'docs/pr-reports/[A-Za-z0-9._-]+\.html' \
    && printf '%s\n' "$section" | grep -Eq '!\[[^]]*\]\(|<img[[:space:]]'; then
    return 0
  fi
  skip_line="$(printf '%s\n' "$section" | grep -E '^[[:space:]]*[-*] \[[xX]\][[:space:]]+Skip([^[:alnum:]]|$)' | head -n 1 || true)"
  if [ -n "$skip_line" ]; then
    reason="${skip_line#*Reason:}"
    if [ "$reason" = "$skip_line" ]; then
      say "pr-visual-report: skip needs a reason after Reason:"
      return 1
    fi
    reason="${reason#"${reason%%[![:space:]]*}"}"
    reason="${reason%"${reason##*[![:space:]]}"}"
    if [ "${#reason}" -lt 8 ]; then
      say "pr-visual-report: skip reason must say why this PR is a docs typo or a version bump"
      return 1
    fi
    say "pr-visual-report: skip recorded; only a docs typo or a version bump may skip"
    return 0
  fi
  say "pr-visual-report: ## Visual report needs a checked Report line, a docs/pr-reports/<slug>.html link, and an embedded PNG, or a checked Skip line with a reason"
  return 1
}

section_between() {
  local heading="$1"
  printf '%s\n' "$2" | awk -v heading="$heading" '
    $0 ~ ("^" heading "[[:space:]]*$") { found=1; next }
    found && /^##[^#]/ { exit }
    found { print }
  '
}

metrics_warn() {
  local body="$1" section visual skip_line missing="" label wall_line active_line
  body="${body//$'\r'/}"
  section="$(section_between "## Metrics" "$body")"
  visual="$(section_between "## Visual report" "$body")"
  if [ -z "$section" ]; then
    skip_line="$(printf '%s\n' "$visual" | grep -E '^[[:space:]]*[-*] \[[xX]\][[:space:]]+Skip([^[:alnum:]]|$)' | head -n 1 || true)"
    if [ -n "$skip_line" ]; then
      return 0
    fi
    if printf '%s\n' "$visual" | grep -Eq '\|[[:space:]]*Wall[[:space:]]*\|'; then
      section="$visual"
    fi
  fi
  if [ -z "$section" ]; then
    say "pr-report-check: warning: metrics missing"
    return 0
  fi
  for label in Wall Active Sessions Tokens; do
    printf '%s\n' "$section" | grep -Eq "\\|[[:space:]]*${label}[[:space:]]*\\|" || missing="${missing}${label} "
  done
  if [ -n "$missing" ]; then
    say "pr-report-check: warning: metrics partial (missing ${missing% })"
    return 0
  fi
  wall_line="$(printf '%s\n' "$section" | grep -Ei '^[[:space:]]*\|[[:space:]]*Wall[[:space:]]*\|' | head -n 1 || true)"
  active_line="$(printf '%s\n' "$section" | grep -Ei '^[[:space:]]*\|[[:space:]]*Active[[:space:]]*\|' | head -n 1 || true)"
  if printf '%s\n' "$section" | grep -Eq 'Status:[[:space:]]*partial' \
    || printf '%s\n' "$wall_line" | grep -Eiq '[[:space:]]n/a[[:space:]]*\|' \
    || printf '%s\n' "$active_line" | grep -Eiq '[[:space:]]n/a[[:space:]]*\|'; then
    say "pr-report-check: warning: metrics partial"
  fi
  return 0
}

read_body_file() {
  local f="$1" dir="$2" path
  case "$f" in
    ''|'-'|*'..'*) say "pr-visual-report: body file must be a literal path inside the work tree"; return 1 ;;
  esac
  case "$f" in
    /*) path="$f" ;;
    *) path="$dir/$f" ;;
  esac
  [ -f "$path" ] || { say "pr-visual-report: cannot read body file $f"; return 1; }
  BODY="$(cat -- "$path")" || { say "pr-visual-report: cannot read body file $f"; return 1; }
}

# Sets TOKENS. Returns 1 when the command has a substitution the hook will not expand.
tokenize() {
  local s="$1"
  local i=0 n=${#s} c state=none cur="" nxt
  TOKENS=()
  while [ "$i" -lt "$n" ]; do
    c="${s:i:1}"
    case "$state" in
      none|raw)
        case "$c" in
          [[:space:]])
            if [ "$state" = raw ]; then TOKENS+=("$cur"); cur=""; state=none; fi
            ;;
          '|'|'&'|';')
            if [ "$state" = raw ]; then TOKENS+=("$cur"); cur=""; state=none; fi
            nxt="${s:i+1:1}"
            if [ "$c" = "|" ] && [ "$nxt" = "|" ]; then TOKENS+=("||"); i=$((i + 1))
            elif [ "$c" = "&" ] && [ "$nxt" = "&" ]; then TOKENS+=("&&"); i=$((i + 1))
            else TOKENS+=("$c"); fi
            ;;
          '('|')'|'\\'|'$'|'`') return 1 ;;
          "'") state=single ;;
          '"') state=double ;;
          '#')
            if [ "$state" = none ]; then break; fi
            cur+="$c"; state=raw
            ;;
          *) cur+="$c"; state=raw ;;
        esac
        ;;
      single)
        if [ "$c" = "'" ]; then state=raw; else cur+="$c"; fi
        ;;
      double)
        if [ "$c" = "\\" ]; then
          nxt="${s:i+1:1}"
          case "$nxt" in
            '$'|'`'|'"'|'\\') return 1 ;;
            *) cur+="$nxt"; i=$((i + 1)) ;;
          esac
        elif [ "$c" = '$' ] || [ "$c" = '`' ]; then
          return 1
        elif [ "$c" = '"' ]; then
          state=raw
        else
          cur+="$c"
        fi
        ;;
    esac
    i=$((i + 1))
  done
  if [ "$state" = single ] || [ "$state" = double ]; then return 1; fi
  if [ "$state" = raw ]; then TOKENS+=("$cur"); fi
  return 0
}

is_sep() {
  case "$1" in
    '&&'|'||'|'|'|';'|'&') return 0 ;;
    *) return 1 ;;
  esac
}

# Last matching flag wins. mode is required or optional.
take_body_flags() {
  local mode="$1" i=0 a
  shift
  KIND=""
  PAYLOAD=""
  while [ "$i" -lt "$#" ]; do
    a="${*:$((i + 1)):1}"
    case "$a" in
      --body-file|-F|--description-file)
        i=$((i + 1))
        a="${*:$((i + 1)):1}"
        [ -n "$a" ] || { say "pr-visual-report: body file flag needs a path"; return 1; }
        KIND=file
        PAYLOAD="$a"
        ;;
      --body-file=*|--description-file=*)
        KIND=file
        PAYLOAD="${a#*=}"
        ;;
      --body|-b|--description)
        i=$((i + 1))
        a="${*:$((i + 1)):1}"
        [ -n "$a" ] || { say "pr-visual-report: body flag needs a value"; return 1; }
        KIND=text
        PAYLOAD="$a"
        ;;
      --body=*|--description=*)
        KIND=text
        PAYLOAD="${a#*=}"
        ;;
    esac
    i=$((i + 1))
  done
  if [ -z "$KIND" ]; then
    [ "$mode" = optional ] && return 0
    say "pr-visual-report: pass the PR body with --body-file or a single quoted --body (or --description)"
    return 1
  fi
  if [ "$KIND" = file ]; then
    read_body_file "$PAYLOAD" "$HOOK_CWD" || return 1
  else
    BODY="$PAYLOAD"
  fi
  visual_ok "$BODY" || return 1
  metrics_warn "$BODY"
}

skip_flags() {
  local j="$1" t
  while [ "$j" -lt "${#TOKENS[@]}" ]; do
    t="${TOKENS[$j]}"
    is_sep "$t" && break
    case "$t" in
      --repo|--hostname|--jq|--output|--query|--subscription|-R|-o)
        j=$((j + 2)); continue ;;
      --repo=*|--hostname=*|--jq=*|--output=*|--query=*|--subscription=*)
        j=$((j + 1)); continue ;;
      -*) j=$((j + 1)); continue ;;
      *) break ;;
    esac
  done
  SKIP_AT="$j"
}

args_until_sep() {
  local j="$1"
  ARGS=()
  while [ "$j" -lt "${#TOKENS[@]}" ]; do
    is_sep "${TOKENS[$j]}" && break
    ARGS+=("${TOKENS[$j]}")
    j=$((j + 1))
  done
}

inspect() {
  local i=0 n=${#TOKENS[@]} cmdpos=1 t base
  while [ "$i" -lt "$n" ]; do
    t="${TOKENS[$i]}"
    if is_sep "$t"; then cmdpos=1; i=$((i + 1)); continue; fi
    if [ "$cmdpos" -eq 1 ]; then
      if [[ "$t" =~ ^[A-Za-z_][A-Za-z0-9_]*= ]]; then i=$((i + 1)); continue; fi
      base="${t##*/}"
      if [ "$base" = "command" ] || [ "$base" = "env" ] || [ "$base" = "time" ]; then
        i=$((i + 1)); continue
      fi
      if [ "$base" = "gh" ]; then
        skip_flags $((i + 1))
        if [ "${TOKENS[$SKIP_AT]:-}" = "pr" ]; then
          case "${TOKENS[$((SKIP_AT + 1))]:-}" in
            create|new)
              args_until_sep $((SKIP_AT + 2))
              take_body_flags required ${ARGS[@]+"${ARGS[@]}"} || return 1
              ;;
            edit)
              args_until_sep $((SKIP_AT + 2))
              take_body_flags optional ${ARGS[@]+"${ARGS[@]}"} || return 1
              ;;
          esac
        fi
      elif [ "$base" = "az" ]; then
        skip_flags $((i + 1))
        if [ "${TOKENS[$SKIP_AT]:-}" = "repos" ] && [ "${TOKENS[$((SKIP_AT + 1))]:-}" = "pr" ]; then
          case "${TOKENS[$((SKIP_AT + 2))]:-}" in
            create)
              args_until_sep $((SKIP_AT + 3))
              take_body_flags required ${ARGS[@]+"${ARGS[@]}"} || return 1
              ;;
            update)
              args_until_sep $((SKIP_AT + 3))
              take_body_flags optional ${ARGS[@]+"${ARGS[@]}"} || return 1
              ;;
          esac
        fi
      fi
      cmdpos=0
    fi
    i=$((i + 1))
  done
  return 0
}

looks_like_pr() {
  local skeleton
  skeleton="$(printf '%s\n' "$1" | sed -e "s/'[^']*'//g" -e 's/"[^"]*"//g')"
  printf '%s\n' "$skeleton" | grep -Eq '(^|[^[:alnum:]_./-])(gh[[:space:]]+pr[[:space:]]+(create|edit|new)|az[[:space:]]+repos[[:space:]]+pr[[:space:]]+(create|update))([^[:alnum:]_]|$)'
}

emit_deny() {
  local r="${1:-${REASON:-pr-visual-report: PR body failed the Visual report check}}"
  local kpi="${BASH_SOURCE[0]%/*}/kpi-emit.sh"
  [ -f "$kpi" ] && "$kpi" guard_block "guard=pr-visual-report" >/dev/null 2>&1 || true
  [ -n "${REASON:-}" ] || printf '%s\n' "$r" >&2
  if command -v jq >/dev/null 2>&1; then
    jq -n --arg r "$r" '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"deny",permissionDecisionReason:$r}}'
  fi
  exit 0
}

if [ "${1:-}" = "--check" ]; then
  shift
  HOOK_CWD="${PWD}"
  case "${1:-}" in
    --body-file)
      [ -n "${2:-}" ] || { say "usage: pr-visual-report.sh --check [--body-file path]"; exit 2; }
      read_body_file "$2" "$HOOK_CWD" || exit 1
      ;;
    --body-file=*)
      read_body_file "${1#--body-file=}" "$HOOK_CWD" || exit 1
      ;;
    '')
      BODY="$(cat)"
      ;;
    *)
      say "usage: pr-visual-report.sh --check [--body-file path]"
      exit 2
      ;;
  esac
  if visual_ok "$BODY"; then
    metrics_warn "$BODY"
    exit 0
  fi
  exit 1
fi

input="$(cat 2>/dev/null || true)"
command -v jq >/dev/null 2>&1 || exit 0
cmd="$(printf '%s' "$input" | jq -r '.tool_input.command // empty' 2>/dev/null || true)"
[ -n "$cmd" ] || exit 0
HOOK_CWD="$(printf '%s' "$input" | jq -r '.cwd // empty' 2>/dev/null || true)"
[ -n "$HOOK_CWD" ] || HOOK_CWD="${PWD}"

if ! tokenize "$cmd"; then
  if looks_like_pr "$cmd"; then
    emit_deny "pr-visual-report: cannot read the PR body (substitution or expansion). Pass --body-file or a single quoted --body."
  fi
  exit 0
fi
if ! inspect; then
  emit_deny "${REASON:-pr-visual-report: PR body failed the Visual report check}"
fi
exit 0
