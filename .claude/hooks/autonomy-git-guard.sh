#!/usr/bin/env bash
# PreToolUse (Bash): while autonomous, deny merges, pushes to a base branch (forced or not) and shell edits of protected paths. Fails open.
# Quotes are stripped before tokenising so a quoted argument cannot hide a refspec; the cost is over-denying odd quoting.
input="$(cat)"
command -v jq >/dev/null 2>&1 || exit 0
cmd="$(jq -r '.tool_input.command // empty' <<<"$input" 2>/dev/null)"
[ -n "$cmd" ] || exit 0
cwd="$(jq -r '.cwd // empty' <<<"$input" 2>/dev/null)"
cwd="${cwd:-$PWD}"

ROOT="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
STATE_DIR="$ROOT/.claude/state"
[ "${AGENT_HARNESS_TEST:-}" = 1 ] && STATE_DIR="${AGENT_STATE_DIR:-${TLTB_STATE_DIR:-$STATE_DIR}}"
[ -f "$STATE_DIR/autonomy.on" ] || exit 0

CONFIG_FILE="$ROOT/.claude/agent-harness.json"
cfg() { [ -f "$CONFIG_FILE" ] || return 0; jq -r "$1" "$CONFIG_FILE" 2>/dev/null || true; }

base_cfg="$(cfg '.base // empty')"
if [ -n "$base_cfg" ]; then BASES=("$base_cfg"); else BASES=(main master); fi
is_base() { local b; for b in "${BASES[@]}"; do [ "$1" = "$b" ] && return 0; done; return 1; }

DEFAULT_ALTS='\.github/|\.claude/|\.opencode/|tools/agent-harness/|tools/ci/|opencode\.jsonc$|AGENTS\.md$|CLAUDE\.md$'
alts="$(cfg '(.protectedPaths // []) | map(ltrimstr("^")) | join("|")')"
alts="${alts:-$DEFAULT_ALTS}"
AUTONOMY_FLAG='\.claude/state/autonomy\.on'
TOKEN_RE="(^|/)(${alts})|${AUTONOMY_FLAG}"
LOOSE_RE="$(sed -E 's/\$(\||$)/\1/g' <<<"$alts")|${AUTONOMY_FLAG}"

emit() {
  jq -n --arg d "$1" --arg r "$2" '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:$d,permissionDecisionReason:$r}}'
  exit 0
}
deny() { emit deny "Blocked by git-guard: merge via agent-harness ship-merge, push feature branches normally, do not edit harness files from the shell."; }
is_protected_token() {
  local t="${1//[<>]/}"
  t="${t#of=}"
  [[ "$t" =~ $TOKEN_RE ]]
}
any_protected() { local t; for t in "$@"; do is_protected_token "$t" && return 0; done; return 1; }

check_push() {
  local gdir="$1" a ref cur; shift
  local pos=()
  for a in "$@"; do
    case "$a" in
      *'$'*) deny ;;
      --mirror | --all | --no-verify) deny ;;
      --* | -*) ;;
      *) pos+=("$a") ;;
    esac
  done
  for a in "${pos[@]}"; do
    ref="${a##*:}"
    ref="${ref#+}"
    ref="${ref#refs/heads/}"
    is_base "$ref" && deny
  done
  if [ "${#pos[@]}" -le 1 ] || { [ "${#pos[@]}" -eq 2 ] && [ "${pos[1]}" = HEAD ]; }; then
    cur="$(git -C "$gdir" rev-parse --abbrev-ref HEAD 2>/dev/null)"
    is_base "$cur" && deny
  fi
}

check_git() {
  local gdir="$cwd" n=$# a kv sub="" j=2
  local args=("$@")
  while [ "$j" -le "$n" ]; do
    a="${args[$((j - 1))]}"
    case "$a" in
      -C) kv="${args[$j]:-}"; case "$kv" in /*) gdir="$kv" ;; *) gdir="$gdir/$kv" ;; esac; j=$((j + 2)) ;;
      -c)
        kv="${args[$j]:-}"
        grep -Eqi '^alias\.[^=]*=!|^core\.(hookspath|pager|sshcommand)' <<<"$kv" && deny
        j=$((j + 2)) ;;
      -*) j=$((j + 1)) ;;
      *) sub="$a"; j=$((j + 1)); break ;;
    esac
  done
  local rest=("${args[@]:$((j - 1))}")
  case "$sub" in
    push) check_push "$gdir" "${rest[@]}" ;;
    reset) for a in "${rest[@]}"; do [ "$a" = --hard ] && deny; done ;;
    branch) for a in "${rest[@]}"; do [[ "$a" =~ ^-[A-Za-z]*D ]] && deny; done ;;
    commit) for a in "${rest[@]}"; do [ "$a" = --no-verify ] && deny; done ;;
    checkout | restore) any_protected "${rest[@]}" && deny ;;
  esac
}

check_gh() {
  local line="$*" t method=0
  grep -Eq ' pr( .*)? merge( |$)' <<<"$line" && deny
  grep -Eq ' api( |$)' <<<"$line" || return 0
  grep -Eq 'pulls/[0-9]+/merge|mergePullRequest|repos/[^ ]*/merges|query=@' <<<"$line" && deny
  grep -Eqi '(-X|--method)[ =]*(PUT|PATCH|DELETE)' <<<"$line" && method=1
  [ "$method" = 1 ] || return 0
  for t in "$@"; do
    [[ "$t" =~ refs/heads/(.+)$ ]] && is_base "${BASH_REMATCH[1]}" && deny
  done
}

check_redirects() {
  local t pending=0
  for t in "$@"; do
    if [ "$pending" = 1 ]; then is_protected_token "$t" && deny; pending=0; continue; fi
    if [[ "$t" =~ ^[0-9\&]*\>\>?$ ]]; then pending=1
    elif [[ "$t" =~ ^[0-9\&]*\>\>?(.+)$ ]]; then is_protected_token "${BASH_REMATCH[1]}" && deny
    fi
  done
}

interpreter_inline_hits_protected() {
  local a inline=0 script=0 stdin=0
  [ "$#" -eq 0 ] && stdin=1
  for a in "$@"; do
    case "$a" in
      - | '<'*) stdin=1 ;;
      --eval | --eval=* | --print | --print=* | -[ceEp] | -[!-]*[ceEp]*) inline=1 ;;
      *.py | *.js | *.mjs | *.cjs | *.rb | *.pl) script=1 ;;
    esac
  done
  [ "$inline" = 0 ] && [ "$script" = 1 ] && [ "$stdin" = 0 ] && return 1
  [ "$inline" = 1 ] || [ "$stdin" = 1 ] || return 1
  grep -Eq -- "$LOOSE_RE" <<<"$cmd"
}

ASKED=0
check_ship_merge() {
  local has_assign="$1" c0="$2"; shift 2
  local rest=()
  case "$c0" in
    bash | sh | zsh | dash) [[ "${1:-}" =~ ship-merge\.sh$ ]] || return 1; shift; rest=("$@") ;;
    agent-harness | agent-harness.sh) [ "${1:-}" = ship-merge ] || return 1; shift; rest=("$@") ;;
    ship-merge.sh) rest=("$@") ;;
    *) return 1 ;;
  esac
  [ "$has_assign" = 0 ] || deny
  [[ "${rest[0]:-}" =~ ^[0-9]+$ ]] || deny
  case "${#rest[@]}" in
    1) ;;
    2) [ "${rest[1]}" = --confirmed ] || deny; ASKED=1 ;;
    *) deny ;;
  esac
  return 0
}

segments="$(tr -d "'\"" <<<"$cmd" | sed -E 's/\$\(/;/g; s/`/;/g; s/\\(.)/\1/g' | tr ';&|' '\n\n\n')"
while IFS= read -r seg; do
  seg="$(sed -E 's/^[[:space:]({]+//' <<<"$seg")"
  [ -n "$seg" ] || continue
  read -ra toks <<<"$seg"
  [ "${#toks[@]}" -gt 0 ] || continue
  check_redirects "${toks[@]}"

  i=0 has_assign=0
  while [ "$i" -lt "${#toks[@]}" ]; do
    t="${toks[$i]}"; b="${t##*/}"
    if [[ "$t" =~ ^[A-Za-z_][A-Za-z0-9_]*= ]]; then has_assign=1; i=$((i + 1))
    elif [[ "$b" =~ ^(env|sudo|command|exec|time|nohup|builtin|eval)$ ]]; then i=$((i + 1))
    elif [[ "$b" =~ ^(xargs|nice|timeout)$ ]]; then
      i=$((i + 1))
      while [[ "${toks[$i]:-}" == -* ]]; do
        if [[ "${toks[$i]}" =~ ^-[nILPsk]$ ]]; then i=$((i + 2)); else i=$((i + 1)); fi
      done
      [ "$b" = timeout ] && i=$((i + 1))
    elif [[ "$b" =~ ^(bash|sh|zsh|dash)$ ]] && [[ "${toks[$((i + 1))]:-}" =~ ^-[a-z]*c$ ]]; then i=$((i + 2))
    else break
    fi
  done
  ct=("${toks[@]:$i}")
  [ "${#ct[@]}" -gt 0 ] || continue
  c0="${ct[0]##*/}"
  ct[0]="$c0"

  if check_ship_merge "$has_assign" "$c0" "${ct[@]:1}"; then continue; fi

  case "$c0" in
    git) check_git "${ct[@]}" ;;
    gh) check_gh "${ct[@]}" ;;
    tee | mv | cp | rm | ln | install | truncate | touch | rsync) any_protected "${ct[@]:1}" && deny ;;
    sed)
      for a in "${ct[@]:1}"; do
        if [[ "$a" =~ ^-[A-Za-z]*i || "$a" = --in-place* ]]; then any_protected "${ct[@]:1}" && deny; break; fi
      done ;;
    dd) any_protected "${ct[@]:1}" && deny ;;
    python | python[0-9]* | perl | node | ruby) interpreter_inline_hits_protected "${ct[@]:1}" && deny ;;
  esac
done <<<"$segments"

[ "$ASKED" = 1 ] && emit ask "ship-merge --confirmed merges with autonomy rails relaxed: confirm with the user."
exit 0
