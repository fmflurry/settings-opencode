#!/usr/bin/env bash
# PreToolUse (Bash): in every mode, deny worktree removal (orca/git/rm) except via agent-harness worktree-rm; while autonomous, also deny merges, pushes to a base branch (forced or not) and shell edits of protected paths. Fails open.
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
AUTO=0
[ -f "$STATE_DIR/autonomy.on" ] && AUTO=1

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
deny_worktree() { emit deny "Blocked by git-guard: remove worktrees only via \`agent-harness worktree-rm <path> --confirmed\`."; }
deny_alias() { emit deny "Blocked by git-guard: git aliases can smuggle worktree removal; do not define or pass alias.* settings."; }
deny_branch_delete() { emit deny "Blocked by git-guard: branch deletion only via agent-harness cleanup <pr> after merge."; }
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
      --delete | --prune) deny_branch_delete ;;
      --*) ;;
      -*d*) deny_branch_delete ;;
      -*) ;;
      *) pos+=("$a") ;;
    esac
  done
  for a in "${pos[@]}"; do
    [[ "${a#+}" == :* ]] && deny_branch_delete
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

worktree_destroy_in() {
  local t=("$@") k x git_seen=0
  for ((k = 0; k < ${#t[@]} - 1; k++)); do
    [ "${t[k]##*/}" = git ] && git_seen=1
    [ "$git_seen" = 1 ] && [ "${t[k]}" = worktree ] || continue
    case "${t[k + 1]}" in
      remove | move) return 0 ;;
      prune)
        for x in "${t[@]:k+2}"; do [[ "$x" =~ ^(-n|-nv|-vn|--dry-run)$ ]] && return 1; done
        return 0 ;;
    esac
  done
  return 1
}

check_git() {
  local gdir="$cwd" n=$# a kv sub="" j=2
  local args=("$@")
  while [ "$j" -le "$n" ]; do
    a="${args[$((j - 1))]}"
    case "$a" in
      -C) kv="${args[$j]:-}"; case "$kv" in /*) gdir="$kv" ;; *) gdir="$gdir/$kv" ;; esac; j=$((j + 2)) ;;
      --git-dir | --work-tree | --namespace | --exec-path | --super-prefix | --config-env) j=$((j + 2)) ;;
      -c)
        kv="${args[$j]:-}"
        grep -Eqi '^alias\.' <<<"$kv" && deny_alias
        [ "$AUTO" = 1 ] && grep -Eqi '^alias\.|^core\.(hookspath|pager|sshcommand)' <<<"$kv" && deny
        j=$((j + 2)) ;;
      -*) j=$((j + 1)) ;;
      *) sub="$a"; j=$((j + 1)); break ;;
    esac
  done
  local rest=("${args[@]:$((j - 1))}")
  case "$sub" in
    commit | tag | stash | log | notes) ;;
    *) worktree_destroy_in "${args[@]}" && deny_worktree ;;
  esac
  if [ "$sub" = config ]; then
    for a in "${rest[@]}"; do case "$a" in --get | --get-all | --get-regexp | --list | -l) return 0 ;; esac; done
    for a in "${rest[@]}"; do [[ "$a" == alias.* ]] && deny_alias; done
  fi
  [ "$AUTO" = 1 ] || return 0
  case "$sub" in
    push) check_push "$gdir" "${rest[@]}" ;;
    reset) for a in "${rest[@]}"; do [ "$a" = --hard ] && deny; done ;;
    branch)
      for a in "${rest[@]}"; do
        case "$a" in
          --delete) deny_branch_delete ;;
          --*) ;;
          -*[dD]*) deny_branch_delete ;;
        esac
      done ;;
    update-ref) for a in "${rest[@]}"; do [[ "$a" =~ ^(-d|--delete|--stdin)$ ]] && deny_branch_delete; done ;;
    send-pack) deny_branch_delete ;;
    commit) for a in "${rest[@]}"; do [ "$a" = --no-verify ] && deny; done ;;
    checkout | restore) any_protected "${rest[@]}" && deny ;;
  esac
}

check_gh() {
  local line="$*" t method=0
  grep -Eq ' pr( .*)? merge( |$)' <<<"$line" && deny
  grep -Eq ' api( |$)' <<<"$line" || return 0
  grep -Eq 'pulls/[0-9]+/merge|mergePullRequest|repos/[^ ]*/merges|query=@' <<<"$line" && deny
  grep -Eq 'deleteRef' <<<"$line" && deny_branch_delete
  grep -Eq ' graphql( .*)? --input( |=|$)' <<<"$line" && deny
  grep -Eqi '(-X|--method)[ =]*(PUT|PATCH|DELETE)' <<<"$line" && method=1
  [ "$method" = 1 ] || return 0
  local del=0
  grep -Eqi '(-X|--method)[ =]*DELETE' <<<"$line" && del=1
  for t in "$@"; do
    [ "$del" = 1 ] && [[ "$t" == *%2[Ff]* || "$t" == *'$'* ]] && deny_branch_delete
    [[ "$t" =~ refs/heads/(.+)$ ]] || continue
    [ "$del" = 1 ] && deny_branch_delete
    is_base "${BASH_REMATCH[1]}" && deny
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

CD_BASE=""
WTS=()
WTS_LOADED=0

norm_path() {
  local p="${1/#\~/$HOME}" out=() seg d
  case "$p" in /*) ;; *) p="${2:-$cwd}/$p" ;; esac
  local IFS=/
  set -f
  for seg in $p; do
    case "$seg" in
      '' | .) ;;
      ..) [ "${#out[@]}" -gt 0 ] && out=("${out[@]:0:$((${#out[@]} - 1))}") ;;
      *) out+=("$seg") ;;
    esac
  done
  set +f
  p="/${out[*]}"
  if [ -d "$p" ]; then
    d="$(cd -P "$p" 2>/dev/null && pwd)"
    [ -n "$d" ] && p="$d"
  elif [ -d "${p%/*}" ]; then
    d="$(cd -P "${p%/*}" 2>/dev/null && pwd)"
    [ -n "$d" ] && p="${d%/}/${p##*/}"
  fi
  printf '%s' "${p%/}"
}

load_wts() {
  [ "$WTS_LOADED" = 1 ] && return 0
  WTS_LOADED=1
  local l
  while IFS= read -r l; do WTS+=("$(norm_path "${l#worktree }" /)"); done < <(git -C "$cwd" worktree list --porcelain 2>/dev/null | grep '^worktree ')
}

unknown_base_relative() { [ "$CD_BASE" = "?" ] && [[ "$1" != /* && "$1" != \~* ]]; }

is_worktree_path() {
  unknown_base_relative "$1" && return 0
  local a wt
  a="$(norm_path "$1" "${CD_BASE:-$cwd}")"
  [[ "$a/" =~ /orca/workspaces/[^/]+(/[^/]+)?/$ ]] && return 0
  [[ "$a" == */orca || "$a" == */orca/workspaces ]] && return 0
  load_wts
  for wt in "${WTS[@]}"; do
    { [ "$wt" = "$a" ] || [[ "$wt" == "$a"/* ]]; } && return 0
  done
  return 1
}

glob_hits_worktree() {
  unknown_base_relative "$1" && return 0
  local g="$1" pre="${1%%[\*\?\[]*}" d wt
  case "$pre" in */*) d="${pre%/*}"; [ -n "$d" ] || d=/ ;; *) d=. ;; esac
  d="$(norm_path "$d" "${CD_BASE:-$cwd}")"
  load_wts
  for wt in "${WTS[@]}"; do
    [[ "$wt" == "$d"/* ]] && return 0
    [ "$wt" = "$d" ] && [[ "${g##*/}" =~ ^\.?\*$ ]] && return 0
  done
  [[ "$d/" =~ /orca/workspaces(/[^/]+)?/$ ]]
}

check_rm_worktree() {
  local a rec=0 args=()
  for a in "$@"; do
    case "$a" in
      --recursive) rec=1 ;;
      --*) ;;
      -*[rR]*) rec=1 ;;
      -*) ;;
      *) args+=("$a") ;;
    esac
  done
  [ "$rec" = 1 ] || return 0
  [ "$XARGS" = 1 ] && deny_worktree
  for a in "${args[@]}"; do
    [[ "$a" == *'$'* ]] && deny_worktree
    if [[ "$a" == *[\*\?\[]* ]]; then glob_hits_worktree "$a" && deny_worktree; continue; fi
    is_worktree_path "$a" && deny_worktree
  done
  return 0
}

check_destroyers() {
  local c="$1" a nf=() del=0; shift
  for a in "$@"; do
    case "$a" in
      --delete*) del=1 ;;
      -*) ;;
      *) nf+=("$a") ;;
    esac
  done
  case "$c" in
    rsync) [ "$del" = 1 ] || return 0 ;;
    mv) [ "${#nf[@]}" -gt 0 ] && nf=("${nf[@]:0:$((${#nf[@]} - 1))}") ;;
  esac
  for a in "${nf[@]}"; do is_worktree_path "$a" && deny_worktree; done
  return 0
}

check_find_worktree() {
  local a re=' -(delete|exec|execdir|ok|okdir) '
  [[ " $* " =~ $re ]] || return 0
  for a in "$@"; do
    case "$a" in -* | '(' | '!') break ;; esac
    is_worktree_path "$a" && deny_worktree
  done
  return 0
}

is_prefix_keyword() {
  case "$1" in if | then | elif | else | do | while | until | '!' | '{' | '(' | builtin | eval) return 0 ;; esac
  return 1
}

prefix_value_flags() {
  case "$1" in
    sudo) echo "-u -g -h -p -C -D -R -T -U --user --group --host --prompt --chdir" ;;
    env) echo "-u -C -S --unset --chdir --split-string" ;;
    xargs) echo "-n -I -L -P -s -d -E -a --max-args --max-procs --max-lines --delimiter --arg-file --replace --eof --max-chars" ;;
    nice) echo "-n --adjustment" ;;
    timeout) echo "-s -k --signal --kill-after" ;;
    exec) echo "-a" ;;
    time) echo "-f -o" ;;
  esac
}

ASKED=0
ASKED_WT=0
check_worktree_rm() {
  local has_assign="$1" c0="$2"; shift 2
  local rest=()
  case "$c0" in
    bash | sh | zsh | dash) while [[ "${1:-}" == -* ]]; do shift; done; [[ "${1:-}" =~ worktree-rm\.sh$ ]] || return 1; shift; rest=("$@") ;;
    agent-harness | agent-harness.sh) [ "${1:-}" = worktree-rm ] || return 1; shift; rest=("$@") ;;
    worktree-rm.sh) rest=("$@") ;;
    *) return 1 ;;
  esac
  [ "$has_assign" = 0 ] || deny_worktree
  local a paths=0 confirmed=0
  for a in "${rest[@]}"; do
    case "$a" in
      --confirmed) [ "$confirmed" = 0 ] || deny_worktree; confirmed=1; ASKED_WT=1 ;;
      -*) deny_worktree ;;
      *) paths=$((paths + 1)) ;;
    esac
  done
  [ "$paths" = 1 ] || deny_worktree
  return 0
}

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
  local i=1 seen_confirmed=0 seen_method=0 seen_keep=0
  while [ "$i" -lt "${#rest[@]}" ]; do
    case "${rest[$i]}" in
      --confirmed) [ "$seen_confirmed" = 0 ] || deny; seen_confirmed=1; ASKED=1 ;;
      --keep-branch) [ "$seen_keep" = 0 ] || deny; seen_keep=1 ;;
      --method) [ "$seen_method" = 0 ] || deny; seen_method=1; i=$((i + 1))
        [[ "${rest[$i]:-}" =~ ^(squash|rebase|merge)$ ]] || deny ;;
      --method=*) [ "$seen_method" = 0 ] || deny; seen_method=1
        [[ "${rest[$i]#--method=}" =~ ^(squash|rebase|merge)$ ]] || deny ;;
      *) deny ;;
    esac
    i=$((i + 1))
  done
  return 0
}

check_cleanup() {
  local has_assign="$1" c0="$2"; shift 2
  local rest=()
  case "$c0" in
    bash | sh | zsh | dash)
      [[ "${1:-}" =~ cleanup\.sh$ ]] || return 1
      [[ "$1" == */scripts/agent-harness/cleanup.sh ]] || deny
      shift; rest=("$@") ;;
    agent-harness | agent-harness.sh) [ "${1:-}" = cleanup ] || return 1; shift; rest=("$@") ;;
    cleanup.sh) [[ "$RAW0" == */scripts/agent-harness/cleanup.sh ]] || deny; rest=("$@") ;;
    *) return 1 ;;
  esac
  [ "$has_assign" = 0 ] || deny
  [[ "${rest[0]:-}" =~ ^[0-9]+$ ]] || deny
  [ "${#rest[@]}" -le 2 ] || deny
  [ "${#rest[@]}" -lt 2 ] || [ "${rest[1]}" = --keep-branch ] || deny
  return 0
}

if [[ "$cmd" == *worktree-rm* ]] && grep -Eq '(^|[^[:alnum:]_])(export|declare +-x|set +-a)( |$)' <<<"$cmd"; then deny_worktree; fi
[[ "$cmd" == *--confirmed* && "$cmd" == *worktree-rm* ]] && ASKED_WT=1

segments="$(tr -d "'\"" <<<"$cmd" | sed -E 's/\$\(/;/g; s/`/;/g; s/\\(.)/\1/g' | tr ';&|' '\n\n\n')"
while IFS= read -r seg; do
  seg="$(sed -E 's/^[[:space:]({]+//' <<<"$seg")"
  [ -n "$seg" ] || continue
  read -ra toks <<<"$seg"
  [ "${#toks[@]}" -gt 0 ] || continue
  [ "$AUTO" = 1 ] && check_redirects "${toks[@]}"

  i=0 has_assign=0 XARGS=0 pref=0
  while [ "$i" -lt "${#toks[@]}" ]; do
    t="${toks[$i]}"; b="${t##*/}"
    if [[ "$t" =~ ^[A-Za-z_][A-Za-z0-9_]*= ]]; then has_assign=1; i=$((i + 1))
    elif is_prefix_keyword "$b"; then i=$((i + 1))
    elif [[ "$b" =~ ^(env|sudo|command|exec|nice|nohup|xargs|timeout|time)$ ]]; then
      pref=1
      [ "$b" = xargs ] && XARGS=1
      i=$((i + 1))
      vf="$(prefix_value_flags "$b")"
      while [[ "${toks[$i]:-}" == -* ]]; do
        o="${toks[$i]}"; i=$((i + 1))
        [ "$o" = -- ] && break
        [[ " $vf " == *" $o "* ]] && i=$((i + 1))
      done
      [ "$b" = timeout ] && i=$((i + 1))
    elif [[ "$b" =~ ^(bash|sh|zsh|dash)$ ]]; then
      j=$((i + 1)) found=0
      while [[ "${toks[$j]:-}" == -* && "${toks[$j]}" != -- ]]; do
        [[ "${toks[$j]}" =~ ^-[A-Za-z]*c[A-Za-z]*$ ]] && { found=1; break; }
        [[ "${toks[$j]}" =~ ^-[oO]$ ]] && j=$((j + 1))
        j=$((j + 1))
      done
      [ "$found" = 1 ] || break
      pref=1
      i=$((j + 1))
    else break
    fi
  done
  ct=("${toks[@]:$i}")
  [ "${#ct[@]}" -gt 0 ] || continue
  RAW0="${ct[0]}"
  c0="${ct[0]##*/}"
  ct[0]="$c0"

  if [ "$pref" = 1 ] && [ "$c0" != git ] && worktree_destroy_in "${ct[@]}"; then deny_worktree; fi
  if check_worktree_rm "$has_assign" "$c0" "${ct[@]:1}"; then continue; fi
  case "$c0" in
    orca)
      for ((k = 1; k < ${#ct[@]} - 1; k++)); do
        [ "${ct[k]}" = worktree ] && [[ "${ct[k + 1]}" =~ ^(rm|remove|delete)$ ]] && deny_worktree
      done ;;
    rm) check_rm_worktree "${ct[@]:1}" ;;
    mv | trash | rsync) check_destroyers "$c0" "${ct[@]:1}" ;;
    find) check_find_worktree "${ct[@]:1}" ;;
    xargs) ;;
    python | python[0-9]* | perl | node | ruby)
      grep -Eq 'rmtree|rm_rf|rmSync|remove_tree|rmdir' <<<"$cmd" && grep -Eq '/orca/workspaces/|worktree' <<<"$cmd" && deny_worktree ;;
    cd | pushd)
      tgt="${ct[1]:-$HOME}"
      if [ "$CD_BASE" = "?" ] || [[ "$tgt" == *'$'* || "$tgt" == -* ]]; then CD_BASE="?"
      else CD_BASE="$(norm_path "$tgt" "${CD_BASE:-$cwd}")"; CD_BASE="${CD_BASE:-/}"
      fi ;;
  esac
  [ "$AUTO" = 1 ] || { [ "$c0" = git ] && check_git "${ct[@]}"; continue; }

  if check_ship_merge "$has_assign" "$c0" "${ct[@]:1}"; then continue; fi
  if check_cleanup "$has_assign" "$c0" "${ct[@]:1}"; then continue; fi

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

[ "$ASKED_WT" = 1 ] && emit ask "worktree-rm --confirmed removes a worktree: confirm the human named this removal."
[ "$ASKED" = 1 ] && emit ask "ship-merge --confirmed merges with autonomy rails relaxed and deletes the merged branch: confirm with the user."
exit 0
