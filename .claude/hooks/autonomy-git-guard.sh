#!/usr/bin/env bash
# PreToolUse (Bash): in every mode, deny worktree removal (orca/git/rm) except via agent-harness worktree-rm or teardown-merged-worktree, and shell-function or env injection into agent-harness commands; while autonomous, also deny merges, pushes to a base branch (forced or not) and shell edits of protected paths. Fails open on empty input or missing jq.
# A quote-aware scan denies git and rm words it cannot parse (substitution, ANSI-C quoting, brace expansion), and, while autonomous, feeds gh to the same scan so a quoted assignment cannot hide gh pr merge. The legacy tokenizer still strips quotes so a quoted ref cannot hide.
input="$(cat)"
set -f
command -v jq >/dev/null 2>&1 || exit 0
cmd="$(jq -r '.tool_input.command // empty' <<<"$input" 2>/dev/null)"
[ -n "$cmd" ] || exit 0
cwd="$(jq -r '.cwd // empty' <<<"$input" 2>/dev/null)"
cwd="${cwd:-$PWD}"

ROOT="$(git -C "${CLAUDE_PROJECT_DIR:-$PWD}" worktree list --porcelain 2>/dev/null | sed -n '1s/^worktree //p')"
[ -n "$ROOT" ] || ROOT="${CLAUDE_PROJECT_DIR:-$PWD}"
STATE_DIR="$ROOT/.claude/state"
[ "${AGENT_HARNESS_TEST:-}" = 1 ] && STATE_DIR="${AGENT_STATE_DIR:-${TLTB_STATE_DIR:-$STATE_DIR}}"
AUTO=0
[ -f "$STATE_DIR/autonomy.on" ] && AUTO=1

CONFIG_FILE="$ROOT/.claude/agent-harness.json"
cfg() { [ -f "$CONFIG_FILE" ] || return 0; jq -r "$1" "$CONFIG_FILE" 2>/dev/null || true; }

base_cfg="$(cfg '.base // empty')"
if [ -n "$base_cfg" ]; then BASE_A="$base_cfg"; BASE_B="$base_cfg"; else BASE_A=main; BASE_B=master; fi
ALIAS_RE=$'(^|\n)[Aa][Ll][Ii][Aa][Ss]\\.'
is_base() { [ "$1" = "$BASE_A" ] || [ "$1" = "$BASE_B" ]; }

DEFAULT_ALTS='\.github/|\.claude/|\.opencode/|tools/agent-harness/|tools/ci/|opencode\.jsonc$|AGENTS\.md$|CLAUDE\.md$'
alts="$(cfg '(.protectedPaths // []) | map(ltrimstr("^")) | join("|")')"
alts="${alts:-$DEFAULT_ALTS}"
ALTS_DEFAULT=0
[ "$alts" = "$DEFAULT_ALTS" ] && ALTS_DEFAULT=1
AUTONOMY_FLAG='\.claude/state/autonomy\.on'
TOKEN_RE="(^|/)(${alts})|${AUTONOMY_FLAG}"
LOOSE_RE="$(sed -E 's/\$(\||$)/\1/g' <<<"$alts")|${AUTONOMY_FLAG}"

emit() {
  jq -n --arg d "$1" --arg r "$2" '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:$d,permissionDecisionReason:$r}}'
  exit 0
}
deny() { emit deny "Blocked by git-guard: merge via agent-harness ship-merge, push feature branches normally, do not edit harness files from the shell."; }
deny_worktree() { emit deny "Blocked by git-guard: remove worktrees only via \`agent-harness worktree-rm <path> --confirmed\`."; }
deny_harness_env() { emit deny "Blocked by git-guard: run agent-harness as one plain command; no env overrides, exported functions or shell startup files."; }
deny_harness_cmd() { emit deny "Blocked by git-guard: agent-harness ship-init and teardown-merged-worktree take exactly their documented arguments as one plain command."; }
deny_alias() { emit deny "Blocked by git-guard: git aliases can smuggle worktree removal; do not define or pass alias.* settings."; }
deny_branch_delete() { emit deny "Blocked by git-guard: branch deletion only via agent-harness cleanup <pr> after merge."; }
deny_config() { emit deny "Blocked by git-guard: git config injection (-c, --config-env, GIT_CONFIG_*) is not allowed."; }
deny_unparsed() { emit deny "Blocked by git-guard: cannot parse this command safely (substitution, expansion, or ANSI-C quoting)."; }
is_protected_token() {
  local t="${1//[<>]/}"
  t="${t#of=}"
  [[ "$t" =~ $TOKEN_RE ]]
}
any_protected() {
  local t
  [ "$ALTS_DEFAULT" = 1 ] && [[ "$*" != *[./]* ]] && return 1
  for t in "$@"; do is_protected_token "$t" && return 0; done
  return 1
}

# The same directory is resolved by the quote-aware scan and again by the legacy loop; the result is
# kept in a variable named after the hex-encoded path so the second lookup costs no fork.
rh_name() {
  local p="$1" i c
  RH_N=RHC_
  for ((i = 0; i < ${#p}; i++)); do printf -v c '%x_' "'${p:i:1}"; RH_N+="$c"; done
}

# Sets RH_CUR to the branch a push would update. Returns 1 when a location override
# (--git-dir, --work-tree, GIT_DIR, GIT_WORK_TREE) does not resolve. The last result is reused
# when the location repeats, so a run of identical pushes costs one git call.
# Callers must deny in the parent shell.
RH_LK=""; RH_LV=""; RH_LS=0; RH_HAVE=0
resolve_head() {
  local gdir="$1" cur="" key st=0
  printf -v key '%q ' "$gdir" "${GIT_DIR_VAL:-}" "${GIT_WT_VAL:-}" "$SAW_LOC" ${GIT_LOC+"${GIT_LOC[@]}"}
  if [ "$RH_HAVE" = 1 ] && [ "$RH_LK" = "$key" ]; then RH_CUR="$RH_LV"; return "$RH_LS"; fi
  if [ "$SAW_LOC" = 1 ] || [ -n "${GIT_DIR_VAL:-}" ] || [ -n "${GIT_WT_VAL:-}" ]; then
    local -a ea=()
    [ -n "${GIT_DIR_VAL:-}" ] && ea+=(GIT_DIR="$GIT_DIR_VAL")
    [ -n "${GIT_WT_VAL:-}" ] && ea+=(GIT_WORK_TREE="$GIT_WT_VAL")
    if [ "${#ea[@]}" -gt 0 ]; then
      cur="$(cd "$cwd" 2>/dev/null && env "${ea[@]}" git ${GIT_LOC+"${GIT_LOC[@]}"} rev-parse --abbrev-ref HEAD 2>/dev/null)" || true
    else
      cur="$(cd "$cwd" 2>/dev/null && git ${GIT_LOC+"${GIT_LOC[@]}"} rev-parse --abbrev-ref HEAD 2>/dev/null)" || true
    fi
    [ -n "$cur" ] || st=1
  else
    if [ -d "$gdir" ]; then
      if [ "${#gdir}" -lt 256 ]; then
        rh_name "$gdir"
        if [ -n "${!RH_N+x}" ]; then cur="${!RH_N}"
        else
          cur="$(git -C "$gdir" rev-parse --abbrev-ref HEAD 2>/dev/null)" || true
          printf -v "$RH_N" '%s' "$cur"
        fi
      else
        cur="$(git -C "$gdir" rev-parse --abbrev-ref HEAD 2>/dev/null)" || true
      fi
    fi
  fi
  RH_CUR="$cur"; RH_LK="$key"; RH_LV="$cur"; RH_LS="$st"; RH_HAVE=1
  return "$st"
}

check_push() {
  local gdir="$1" a ref; shift
  local pos=()
  if [[ "$*" != *'$'* && " $* " != *" -"* ]]; then
    pos=("$@")
  else
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
  fi
  local pj=" ${pos[*]} "
  if [[ "$pj" == *[:+]* || "$pj" == *refs/heads/* || "$pj" == *" $BASE_A "* || "$pj" == *" $BASE_B "* ]]; then
    for a in "${pos[@]}"; do
      [[ "${a#+}" == :* ]] && deny_branch_delete
      ref="${a##*:}"
      ref="${ref#+}"
      ref="${ref#refs/heads/}"
      is_base "$ref" && deny
    done
  fi
  if [ "${#pos[@]}" -le 1 ] || { [ "${#pos[@]}" -eq 2 ] && [ "${pos[1]}" = HEAD ]; }; then
    if [ "$CD_BASE" = "?" ] && [ "$SAW_LOC" != 1 ] && [ -z "$GIT_DIR_VAL" ]; then deny; fi
    resolve_head "$gdir" || deny
    is_base "$RH_CUR" && deny
  fi
}

worktree_destroy_in() {
  case " $* " in *" worktree "*) ;; *) return 1 ;; esac
  local t=("$@") k x git_seen=0
  for ((k = 0; k < ${#t[@]} - 1; k++)); do
    [ "${t[k]##*/}" = git ] && git_seen=1
    [ "$git_seen" = 1 ] && [ "${t[k]}" = worktree ] || continue
    case "${t[k + 1]}" in
      remove | move) return 0 ;;
      *'$'* | *'`'* | *'{'*'}'*) return 0 ;;
      prune)
        for x in "${t[@]:k+2}"; do [[ "$x" =~ ^(-n|-nv|-vn|--dry-run)$ ]] && return 1; done
        return 0 ;;
    esac
  done
  return 1
}

check_git() {
  local gdir="$cwd" n=$# a kv sub="" j=2
  cd_sync
  [ -n "$CD_BASE" ] && [ "$CD_BASE" != "?" ] && gdir="$CD_BASE"
  local args=("$@")
  GIT_LOC=(); SAW_LOC=0
  while [ "$j" -le "$n" ]; do
    a="${args[$((j - 1))]}"
    case "$a" in
      -C)
        kv="${args[$j]:-}"
        [[ "$kv" == *'$'* || "$kv" == *'`'* ]] && [ "$AUTO" = 1 ] && deny_unparsed
        case "$kv" in /*) gdir="$kv" ;; *) gdir="$gdir/$kv" ;; esac
        GIT_LOC+=(-C "$kv"); j=$((j + 2)) ;;
      --git-dir | --work-tree)
        kv="${args[$j]:-}"
        [[ "$kv" == *'$'* || "$kv" == *'`'* ]] && deny_unparsed
        GIT_LOC+=("$a" "$kv"); SAW_LOC=1; j=$((j + 2)) ;;
      --git-dir=* | --work-tree=*)
        [[ "$a" == *'$'* || "$a" == *'`'* ]] && deny_unparsed
        GIT_LOC+=("$a"); SAW_LOC=1; j=$((j + 1)) ;;
      --namespace | --exec-path | --super-prefix) j=$((j + 2)) ;;
      --namespace=* | --exec-path=* | --super-prefix=*) j=$((j + 1)) ;;
      --config-env | --config-env=*) deny_config ;;
      -c)
        kv="${args[$j]:-}"
        [[ "$kv" =~ $ALIAS_RE ]] && deny_alias
        [ "$AUTO" = 1 ] && deny_config
        j=$((j + 2)) ;;
      -*) j=$((j + 1)) ;;
      *) sub="$a"; j=$((j + 1)); break ;;
    esac
  done
  case "$sub" in
    *'$'* | *'`'* | *'{'*'}'*) deny_unparsed ;;
  esac
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

gh_has() {
  local re="$1" l
  if [[ "$line" != *$'\n'* ]]; then [[ "$line" =~ $re ]]; return; fi
  while IFS= read -r l; do [[ "$l" =~ $re ]] && return 0; done <<<"$line"
  return 1
}

check_gh() {
  local line="$*" t method=0
  gh_has ' pr( .*)? merge( |$)' && deny
  gh_has ' api( |$)' || return 0
  gh_has 'pulls/[0-9]+/merge|mergePullRequest|repos/[^ ]*/merges|query=@' && deny
  gh_has 'deleteRef' && deny_branch_delete
  gh_has ' graphql( .*)? --input( |=|$)' && deny
  gh_has '(-[Xx]|--[Mm][Ee][Tt][Hh][Oo][Dd])[ =]*([Pp][Uu][Tt]|[Pp][Aa][Tt][Cc][Hh]|[Dd][Ee][Ll][Ee][Tt][Ee])' && method=1
  [ "$method" = 1 ] || return 0
  local del=0
  gh_has '(-[Xx]|--[Mm][Ee][Tt][Hh][Oo][Dd])[ =]*[Dd][Ee][Ll][Ee][Tt][Ee]' && del=1
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

ensure_loose() {
  [ -n "$LOOSE_HIT" ] && return 0
  if grep -Eq -- "$LOOSE_RE" <<<"$cmd"; then LOOSE_HIT=1; else LOOSE_HIT=0; fi
}

ensure_pyrm() {
  [ -n "$PYRM_HIT" ] && return 0
  PYRM_HIT=0
  [[ "$cmd" =~ rmtree|rm_rf|rmSync|remove_tree|rmdir ]] && [[ "$cmd" =~ /orca/workspaces/|worktree ]] && PYRM_HIT=1
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
  ensure_loose
  [ "$LOOSE_HIT" = 1 ]
}

LOOSE_HIT=""
PYRM_HIT=""
CD_BASE=""; CD_PEND=(); CD_VER=0
SR_PEND=(); SR_VER=0

# cd and pushd only queue their target: the base matters when a path is resolved, and an absolute
# target discards the queue, so a run of cd lines costs no path resolution.
cd_sync() {
  local t
  [ "${#CD_PEND[@]}" -gt 0 ] || return 0
  for t in "${CD_PEND[@]}"; do norm_path "$t" "${CD_BASE:-$cwd}"; CD_BASE="$NP"; CD_BASE="${CD_BASE:-/}"; done
  CD_PEND=()
}

sr_cd_set() {
  if [[ "$1" != /* ]]; then SR_PEND+=("$1"); SR_VER=$((SR_VER + 1))
  elif [ -n "$SR_CD" ] || [ "${#SR_PEND[@]}" != 1 ] || [ "${SR_PEND[0]}" != "$1" ]; then SR_CD=""; SR_PEND=("$1"); SR_VER=$((SR_VER + 1))
  fi
}

screen_cd() {
  local tgt="$2"
  [ "$SR_CD" = "?" ] && return 0
  case "$1" in
    k) SR_CD="?"; SR_PEND=(); SR_VER=$((SR_VER + 1)); return 0 ;;
    h)
      if [[ "$HOME" == -* ]]; then SR_CD="?"; SR_PEND=(); SR_VER=$((SR_VER + 1)); return 0; fi
      [ -n "${HOME_LIT+x}" ] || home_lit
      tgt="$HOME_LIT" ;;
    P) printf -v tgt '%b' "$tgt" ;;
  esac
  sr_cd_set "$tgt"
}

sr_sync() {
  local t
  [ "${#SR_PEND[@]}" -gt 0 ] || return 0
  for t in "${SR_PEND[@]}"; do norm_path "$t" "${SR_CD:-$cwd}"; SR_CD="$NP"; SR_CD="${SR_CD:-/}"; done
  SR_PEND=()
}

WTS=()
WTS_LOADED=0

phys_dir() {
  local save="$PWD"
  d=""
  if cd -P "$1" 2>/dev/null; then d="$PWD"; cd "$save" 2>/dev/null; fi
}

norm_path() {
  local p="${1/#\~/$HOME}" out=() seg d
  case "$p" in /*) ;; *) p="${2:-$cwd}/$p" ;; esac
  if [[ "$p" == *//* || "$p" == */./* || "$p" == */../* || "$p" == */. || "$p" == */.. ]]; then
    local IFS=/
    for seg in $p; do
      case "$seg" in
        '' | .) ;;
        ..) [ "${#out[@]}" -gt 0 ] && out=("${out[@]:0:$((${#out[@]} - 1))}") ;;
        *) out+=("$seg") ;;
      esac
    done
    p="/${out[*]}"
  else
    p="${p%/}"
    p="${p:-/}"
  fi
  if [ -d "$p" ]; then
    phys_dir "$p"
    [ -n "$d" ] && p="$d"
  elif [ -d "${p%/*}" ]; then
    phys_dir "${p%/*}"
    [ -n "$d" ] && p="${d%/}/${p##*/}"
  fi
  NP="${p%/}"
  NP="${NP%"${NP##*[!$'\n']}"}"
}

load_wts() {
  [ "$WTS_LOADED" = 1 ] && return 0
  WTS_LOADED=1
  local l
  while IFS= read -r l; do norm_path "${l#worktree }" /; WTS+=("$NP"); done < <(git -C "$cwd" worktree list --porcelain 2>/dev/null | grep '^worktree ')
}

unknown_base_relative() { cd_sync; [ "$CD_BASE" = "?" ] && [[ "$1" != /* && "$1" != \~* ]]; }

is_worktree_path() {
  unknown_base_relative "$1" && return 0
  local a wt
  norm_path "$1" "${CD_BASE:-$cwd}"; a="$NP"
  [[ "$a/" =~ /orca/workspaces/[^/]+(/[^/]+)?/$ ]] && return 0
  [[ "$a" == */orca || "$a" == */orca/workspaces ]] && return 0
  load_wts
  for wt in "${WTS[@]}"; do
    { [ "$wt" = "$a" ] || [[ "$wt" == "$a"/* ]]; } && return 0
  done
  return 1
}

is_brace_pattern() { [[ "$1" == *'{'*,* || "$1" == *'{'*..* ]]; }

glob_hits_worktree() {
  unknown_base_relative "$1" && return 0
  local g="$1" pre="${1%%[\*\?\[\{]*}" d wt
  case "$pre" in */*) d="${pre%/*}"; [ -n "$d" ] || d=/ ;; *) d=. ;; esac
  norm_path "$d" "${CD_BASE:-$cwd}"; d="$NP"
  load_wts
  for wt in "${WTS[@]}"; do
    [[ "$wt" == "$d"/* ]] && return 0
    [ "$wt" = "$d" ] && { [[ "${g##*/}" =~ ^\.?\*$ ]] || is_brace_pattern "$g"; } && return 0
  done
  [[ "$d/" =~ /orca/workspaces(/[^/]+)?/$ ]]
}

is_git_dir_path() {
  local p="${1%/}" a wt
  case "$p" in
    .git | .git/* | */.git | */.git/*) ;;
    *) return 1 ;;
  esac
  unknown_base_relative "$p" && return 0
  norm_path "$p" "${CD_BASE:-$cwd}"; a="$NP"
  load_wts
  for wt in "${WTS[@]}"; do
    [ "$a" = "$wt/.git" ] || [[ "$a" == "$wt/.git/"* ]] && return 0
  done
  return 1
}

check_rm_worktree() {
  case "$*" in *.git* | *[rR]*) ;; *) return 0 ;; esac
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
  for a in "${args[@]}"; do is_git_dir_path "$a" && deny_worktree; done
  [ "$rec" = 1 ] || return 0
  [ "$XARGS" = 1 ] && deny_worktree
  for a in "${args[@]}"; do
    [[ "$a" == *'$'* ]] && deny_worktree
    if [[ "$a" == *[\*\?\[]* ]] || is_brace_pattern "$a"; then glob_hits_worktree "$a" && deny_worktree; continue; fi
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
  for a in "${nf[@]}"; do is_worktree_path "$a" && deny_worktree; is_git_dir_path "$a" && deny_worktree; done
  return 0
}

check_find_worktree() {
  local a re=' -(delete|exec|execdir|ok|okdir) '
  [[ " $* " =~ $re ]] || return 0
  for a in "$@"; do
    case "$a" in -* | '(' | '!') break ;; esac
    is_worktree_path "$a" && deny_worktree
    is_git_dir_path "$a" && deny_worktree
  done
  return 0
}

is_prefix_keyword() {
  case "$1" in if | then | elif | else | do | while | until | '!' | '{' | '(' | builtin | eval) return 0 ;; esac
  return 1
}

prefix_value_flags() {
  PVF=""
  case "$1" in
    sudo) PVF="-u -g -h -p -C -D -R -T -U --user --group --host --prompt --chdir" ;;
    env) PVF="-u -C -S --unset --chdir --split-string" ;;
    xargs) PVF="-n -I -L -P -s -d -E -a --max-args --max-procs --max-lines --delimiter --arg-file --replace --eof --max-chars" ;;
    nice) PVF="-n --adjustment" ;;
    timeout) PVF="-s -k --signal --kill-after" ;;
    exec) PVF="-a" ;;
    time) PVF="-f -o" ;;
  esac
}

HARNESS_ENV_RE='(^|[^A-Za-z0-9_])(AGENT_HARNESS_TEST|AGENT_HARNESS_DIR|AGENT_HARNESS_WORKTREE_RM_[A-Z]*|GH_BIN|ORCA_BIN|AGENT_STATE_DIR|TLTB_STATE_DIR|CLAUDE_PROJECT_DIR|BASH_ENV|PATH|HOME|SHELLOPTS|BASHOPTS|PS4|ENV|DYLD_[A-Z_]*|LD_[A-Z_]*)\+?=|--(rcfile|init-file)'
HARNESS_SOURCE_RE='(^|[;&|({`]|\$\(|(^|[^[:alnum:]_])(then|do|else)[[:space:]])[[:space:]]*(\.|source)[[:space:]]+[^[:space:]]'
HARNESS_FUNC_RE='(^|[^A-Za-z0-9_])(export[[:space:]]+-[A-Za-z]*f|(declare|typeset)[[:space:]]+-[A-Za-z]*[xf]|set[[:space:]]+-[A-Za-z]*a|set[[:space:]]+-o[[:space:]]+allexport)|BASH_FUNC_|allexport'

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

# check_harness_cmd <name> <pr|init> <has_assign> <c0> args...: returns 1 when the command is not <name>; denies bad shapes
# and any launcher other than the plain `agent-harness` wrapper (direct bash/sh script forms are denied).
check_harness_cmd() {
  local name="$1" shape="$2" has_assign="$3" c0="$4" a script=""; shift 4
  case "$c0" in
    bash | sh | zsh | dash)
      while [[ "${1:-}" == -* ]]; do shift; done
      script="${1:-}"
      case "${script##*/}" in
        "$name.sh") deny_harness_cmd ;;
        agent-harness.sh) [ "${2:-}" = "$name" ] || return 1; deny_harness_cmd ;;
        *) return 1 ;;
      esac ;;
    agent-harness)
      [ "${1:-}" = "$name" ] || return 1
      case "$RAW0" in agent-harness | "$HOME/.local/bin/agent-harness" | \~/.local/bin/agent-harness) ;; *) deny_harness_cmd ;; esac
      shift ;;
    agent-harness.sh)
      [ "${1:-}" = "$name" ] || return 1
      deny_harness_cmd ;;
    "$name.sh") deny_harness_cmd ;;
    *) return 1 ;;
  esac
  [ "$has_assign" = 0 ] || deny_harness_cmd
  case "$shape" in
    pr) { [ "$#" -eq 1 ] && [[ "$1" =~ ^[0-9]+$ ]]; } || deny_harness_cmd ;;
    init)
      if [ "${1:-}" = --adopt ]; then
        { [ "$#" -ge 2 ] && [[ "$2" =~ ^[0-9]+$ ]]; } || deny_harness_cmd
        shift 2
      else
        { [ "$#" -ge 3 ] && [[ "$1" =~ ^(feat|fix|refactor|docs|test|chore|perf|ci)$ ]] \
          && [[ "$2" =~ ^[a-z0-9]+$ ]] && [[ "$3" =~ ^[a-z0-9]+(-[a-z0-9]+)*$ ]]; } || deny_harness_cmd
        shift 3
      fi
      if [ "$#" -gt 0 ]; then
        { [ "$1" = --goal ] && [ "$#" -ge 2 ]; } || deny_harness_cmd
        shift
        for a in "$@"; do [[ "$a" == *'$'* ]] && deny_harness_cmd; done
      fi ;;
  esac
  return 0
}

# Modes: join drops backslash-newline outside single quotes; scan prints, per kept segment, a header
# ("1" when a field holds %b escapes, "r" when it repeats the previous segment) and six lines of
# US-separated entries (raw, exp, brace, lit, litbase, litval), each ending in a sentinel entry, with
# "\" LF US escaped as \\ \n \0037; a leading cd or pushd becomes a "c" header plus a kind line and a
# target line; seg keeps only legacy-tokenizer segments that can reach a check
# (scan drops the same no-op segments); lit unquotes stdin. Every mode ends with a sentinel the caller checks.
# Input is walked in bounded chunks because BSD awk's substr is O(length).
# After "$" the next quote closes the quote state at once, so "$'" never opens ANSI-C quoting here.
GG_AWK='
function apush(id, s,   k) {
  k = ++sp[id]; st[id, k] = s; sz[id, k] = length(s)
  while (k > 1 && sz[id, k - 1] <= sz[id, k]) {
    st[id, k - 1] = st[id, k - 1] st[id, k]; sz[id, k - 1] += sz[id, k]; k--
  }
  sp[id] = k
}
function aget(id,   k, acc) {
  k = sp[id]; acc = ""
  while (k >= 1) { acc = st[id, k] acc; k-- }
  sp[id] = 0
  return acc
}
function esc(s,   n, p, ch, m, i, c, ob) {
  if (index(s, BS) == 0 && index(s, "\n") == 0 && index(s, US) == 0) return s
  n = length(s); p = 1
  while (p <= n) {
    ch = substr(s, p, CH); m = length(ch); ob = ""
    for (i = 1; i <= m; i++) {
      c = substr(ch, i, 1)
      if (c == BS) ob = ob BS BS
      else if (c == "\n") ob = ob BS "n"
      else if (c == US) ob = ob BS "0037"
      else ob = ob c
    }
    apush("E", ob); p += m
  }
  return aget("E")
}
function stripnl(s) {
  if (substr(s, length(s), 1) == "\n") sub(/\n+$/, "", s)
  return s
}
function lit(s,   n, p, ch, m, lim, i, c, qq, o, ob) {
  if (index(s, BS) == 0 && index(s, SQ) == 0 && index(s, DQ) == 0) return s
  n = length(s); p = 1; qq = 0
  while (p <= n) {
    ch = substr(s, p, CH + 1); m = length(ch); lim = (m > CH) ? CH : m
    if ((qq == 1 && index(ch, SQ) == 0) || (qq == 2 && index(ch, DQ) == 0 && index(ch, BS) == 0)) {
      apush("L", substr(ch, 1, lim)); p += lim; continue
    }
    ob = ""; i = 1
    while (i <= lim) {
      c = substr(ch, i, 1); i++
      if (qq == 1) { if (c == SQ) qq = 0; else ob = ob c; continue }
      if (qq == 2) {
        if (c == BS && i <= m) { ob = ob substr(ch, i, 1); i++; continue }
        if (c == DQ) qq = 0; else ob = ob c
        continue
      }
      if (c == SQ) { qq = 1; continue }
      if (c == DQ) { qq = 2; continue }
      if (c == BS && i <= m) { ob = ob substr(ch, i, 1); i++; continue }
      ob = ob c
    }
    apush("L", ob); p += i - 1
  }
  return aget("L")
}
function fw(   i, j, r, br, n, lw, lb, lv, ps, lws, lbs, e1, e2, e3, e4, fastw) {
  if (lbuf != "") { apush("W", lbuf); lbuf = "" }
  apush("W", wb); wb = ""; W = aget("W")
  if (W != "" || ex) {
    br = 0
    fastw = (!ex && length(W) <= 256 && W !~ SPECIAL)
    if (fastw) {
      lws = W; lbs = W
    } else {
      if (!ex && index(W, SQ) == 0 && index(W, DQ) == 0) {
        i = index(W, "{")
        if (i) {
          r = substr(W, i + 1)
          j = index(r, ",")
          if (j && index(substr(r, j + 1), "}")) br = 1
          else { j = index(r, ".."); if (j && index(substr(r, j + 2), "}")) br = 1 }
        }
      }
      lw = lit(W)
      n = split(W, ps, "/")
      lb = (n > 1) ? lit(ps[n]) : lw
      i = index(W, "=")
      lv = i ? lit(substr(W, i + 1)) : lw
      lws = stripnl(lw); lbs = stripnl(lb)
    }
    if (lbs == "export") xs = 1
    if (nw == 0) {
      md = 0
      if (!ex && !br && W !~ ASG) {
        gp = 0
        if (lbs == "git") { md = xs ? 0 : 2; gp = !xs }
        else if (lbs == "rm") md = 3
        else if (lbs == "gh") md = 4
        else if (lbs == "cd" || lbs == "pushd") md = 5
        else if (!(lbs in SK)) md = 1
      }
    } else if (md == 2) {
      if (!ex && !br && substr(W, 1, 1) != "-" && lws != "worktree" && lws != "push") md = 1
      else md = 0
    } else if (md == 3 && ex) md = 0
    else if (md == 4 && (index(lws, "merge") || index(lws, "api"))) md = 0
    if (md != 1) {
      nk++
      if (fastw) { e1 = W; e2 = W; e3 = W; e4 = W }
      else {
        e1 = esc(W); e2 = esc(lws); e3 = esc(lbs); e4 = esc(stripnl(lv))
        if (index(e1, BS) || index(e2, BS) || index(e3, BS) || index(e4, BS)) bs = 1
      }
      aw[nk] = e1; al[nk] = e2; ab2[nk] = e3; av[nk] = e4; ae[nk] = ex; abr[nk] = br
    }
    nw++
  }
  W = ""; ex = 0
}
function emitarr(a, n,   i) {
  for (i = 1; i <= n; i++) print a[i] US
  print "E\n"
}
function fsg(   i, txt, hdr) {
  fw()
  if (md == 5 && nk > 0) {
    if (nk == 1) print "c\nh\n\n"
    else if (ae[2] != 0 || abr[2] != 0 || substr(aw[2], 1, 1) == "-") print "c\nk\n\n"
    else print "c\n" (index(al[2], BS) ? "P" : "p") "\n" al[2] "\n"
  } else if (md == 0 && nk > 0 && !(gp && screen_push_inert())) {
    txt = ""
    if (nk <= 16) for (i = 1; i <= nk; i++) txt = txt aw[i] US ae[i] US abr[i] US al[i] US ab2[i] US av[i] RSEP
    if (txt != "" && txt == prevtxt) print "r\n"
    else {
      hdr = bs ? "1" : "0"; print hdr "\n"
      emitarr(aw, nk); emitarr(ae, nk); emitarr(abr, nk); emitarr(al, nk); emitarr(ab2, nk); emitarr(av, nk)
      prevtxt = txt
    }
  }
  nk = 0; bs = 0; nw = 0; md = 0; gp = 0
}
function pushargs_ok(a, from, n,   i, t, np, pos) {
  if (!pushfast) return 0
  np = 0
  for (i = from; i <= n; i++) {
    t = a[i]
    if (index(t, "$") || substr(t, 1, 1) == "-") return 0
    pos[++np] = t
  }
  if (np < 2 || (np == 2 && pos[2] == "HEAD")) return 0
  for (i = 1; i <= np; i++) {
    t = pos[i]
    if (index(t, ":") || index(t, "+") || index(t, "refs/heads/") || t == basea || t == baseb) return 0
  }
  return 1
}
function screen_push_inert(   i) {
  for (i = 1; i <= nk; i++) if (ae[i] != 0 || abr[i] != 0) return 0
  i = 2
  while (i <= nk && aw[i] == "-C") i += 2
  if (i > nk || substr(aw[i], 1, 1) == "-" || al[i] != "push") return 0
  return pushargs_ok(al, i + 1, nk)
}
function segkeep(s,   t, k, b, i, a, n, ps) {
  sub(/^[ \t\r\f\v({]+/, "", s)
  if (s == "") return 0
  if (index(s, ">")) return 1
  match(s, /^[^ \t]+/); t = substr(s, 1, RLENGTH)
  sub(/[)}]+$/, "", t)
  if (t == "" || t ~ ASG) return 1
  n = split(t, ps, "/"); b = ps[n]
  if (b == "gh") return (index(s, "merge") || index(s, "api")) ? 1 : 0
  if (b in LK) return 1
  if (b in PY || b ~ /^python[0-9]/) return !pyinert
  if (b != "git") return 0
  k = split(s, a, " ")
  for (i = 1; i <= k; i++) { sub(/[)}]+$/, "", a[i]); if (a[i] == "worktree") return 1 }
  if (k < 2) return 0
  t = a[2]
  if (t == "-C") {
    i = 2
    while (i <= k && a[i] == "-C") {
      if (i + 1 > k || index(a[i + 1], "$") || index(a[i + 1], "`")) return 1
      i += 2
    }
    if (i <= k && a[i] == "push") return pushargs_ok(a, i + 1, k) ? 0 : 1
    return 1
  }
  if (substr(t, 1, 1) == "-" || index(t, "$") || index(t, "`") || index(t, "{") || (t in GD)) return 1
  return 0
}
function scanrec(rec, more,   L, n, p, ch, m, lim, i, c) {
  L = more ? rec "\n" : rec
  if ((q == 1 && index(L, SQ) == 0) || (q == 2 && L !~ /["\\$`]/)) {
    lbuf = lbuf L
    if (length(lbuf) > 4096) { apush("W", lbuf); lbuf = "" }
    return
  }
  if (lbuf != "") { apush("W", lbuf); lbuf = "" }
  n = length(L); p = 1
  while (p <= n) {
    ch = substr(L, p, CH + 1); m = length(ch); lim = (m > CH) ? CH : m
    i = 1
    while (i <= lim) {
      c = substr(ch, i, 1); i++
      if (q == 0) {
        if (c == " " || c == "\t" || c == "\r") { fw(); continue }
        if (c == "\n" || c == ";" || c == "&" || c == "|") { fsg(); continue }
        if (c == BS) { wb = wb c; if (i <= m) { wb = wb substr(ch, i, 1); i++ }; continue }
        if (c == SQ) { q = 1; wb = wb c; continue }
        if (c == DQ) { q = 2; wb = wb c; continue }
        if (c == "$") { ex = 1; if (substr(ch, i, 1) == SQ) q = 3; wb = wb c; continue }
        if (c == "`") ex = 1
        wb = wb c; continue
      }
      if (q == 1) { wb = wb c; if (c == SQ) q = 0; continue }
      if (q == 3) {
        ex = 1
        if (c == BS && i <= m) { wb = wb c substr(ch, i, 1); i++; continue }
        wb = wb c; if (c == SQ) q = 0
        continue
      }
      if (c == "$" || c == "`") ex = 1
      if (c == BS && i <= m) { wb = wb c substr(ch, i, 1); i++; continue }
      wb = wb c; if (c == DQ) q = 0
    }
    apush("W", wb); wb = ""; p += i - 1
  }
}
function joinrec(rec, more,   L, n, p, ch, m, lim, i, c, del) {
  L = more ? rec "\n" : rec
  if (q == 1) { if (index(L, SQ) == 0) { print L; return } }
  else if (q == 2) { if (L !~ /["\\]/) { print L; return } }
  else if (q == 0 && index(L, BS) == 0 && index(L, SQ) == 0 && index(L, DQ) == 0) { print L; return }
  n = length(L); p = 1; del = 0
  while (p <= n) {
    ch = substr(L, p, CH + 1); m = length(ch); lim = (m > CH) ? CH : m
    i = 1
    while (i <= lim) {
      c = substr(ch, i, 1); i++
      if (q == 1) { if (c == SQ) q = 0; continue }
      if (q == 3) {
        if (c == BS && i <= m) { i++; continue }
        if (c == SQ) q = 0
        continue
      }
      if (c == BS) {
        if (i <= m) { if (substr(ch, i, 1) == "\n") del = 1; i++ }
        continue
      }
      if (q == 2) { if (c == DQ) q = 0; continue }
      if (c == SQ) q = 1
      else if (c == DQ) q = 2
      else if (c == "$" && substr(ch, i, 1) == SQ) q = 3
    }
    p += i - 1
  }
  print del ? substr(L, 1, n - 2) : L
}
BEGIN {
  n = split("if then elif else do while until ! { ( builtin eval env sudo command exec nice nohup xargs timeout time bash sh zsh dash export cd pushd rm gh", ps, " ")
  for (i = 1; i <= n; i++) SK[ps[i]] = 1
  n = split("if then elif else do while until ! { ( builtin eval env sudo command exec nice nohup xargs timeout time bash sh zsh dash agent-harness agent-harness.sh worktree-rm.sh teardown-merged-worktree.sh ship-init.sh ship-merge.sh cleanup.sh orca rm mv trash rsync find cd pushd gh tee cp ln install truncate touch sed dd", ps, " ")
  for (i = 1; i <= n; i++) LK[ps[i]] = 1
  n = split("push reset branch update-ref send-pack commit checkout restore config worktree", ps, " ")
  for (i = 1; i <= n; i++) GD[ps[i]] = 1
  n = split("python perl node ruby", ps, " ")
  for (i = 1; i <= n; i++) PY[ps[i]] = 1
  ASG = "^[A-Za-z_][A-Za-z0-9_]*="
  SPECIAL = "[\\\\\047\"\n\037/={]"
  CH = 512; SQ = "\047"; US = "\037"; RSEP = "\036"; DQ = "\""; BS = "\\"; q = 0; ex = 0; nk = 0; lbuf = ""; bs = 0; prevtxt = ""; ORS = "" }
mode == "seg" { if (segkeep($0)) print $0 "\n"; next }
mode == "lit" { acc = (NR > 1) ? acc "\n" $0 : $0; next }
{ if (hv) { if (mode == "join") joinrec(prev, 1); else scanrec(prev, 1) }; prev = $0; hv = 1 }
END {
  if (mode == "lit") { print stripnl(lit(acc)) "\n" US "LEND\n"; exit }
  if (hv) { if (mode == "join") joinrec(prev, 0); else scanrec(prev, 0) }
  if (mode == "join") print "\n" US "JEND"
  if (mode == "scan") { fsg(); print "e\n" }
  if (mode == "seg") print US "SEND\n"
}
'

home_lit() {
  case "$HOME" in
    *[\'\"\\]*) HOME_LIT="$(printf '%s' "$HOME" | LC_ALL=C awk -v mode=lit "$GG_AWK")" || deny_unparsed
       [[ "$HOME_LIT" == *$'\n\037LEND' ]] || deny_unparsed
       HOME_LIT="${HOME_LIT%$'\n\037LEND'}" ;;
    *) HOME_LIT="$HOME" ;;
  esac
}

note_assign_idx() {
  local idx="$1" persist="${2:-}" w name val
  w="${words[$idx]}"
  name="${w%%=*}"
  case "$name" in
    GIT_DIR | GIT_WORK_TREE | GIT_CONFIG | GIT_CONFIG_* | GIT_NAMESPACE) ;;
    *) return 0 ;;
  esac
  if [ "${exp_f[$idx]}" = 1 ] || [ "${brace_f[$idx]}" = 1 ]; then GIT_ENV_U=1; return 0; fi
  val="${litv_f[$idx]}"
  case "$name" in
    GIT_DIR) GIT_DIR_VAL="$val"; [ "$persist" = 1 ] && P_GIT_DIR="$val" ;;
    GIT_WORK_TREE) GIT_WT_VAL="$val"; [ "$persist" = 1 ] && P_GIT_WT="$val" ;;
    *) GIT_CFG_RISK=1; [ "$persist" = 1 ] && P_GIT_CFG=1 ;;
  esac
}

screen_git() {
  local i="$1" w gdir="$cwd" sub="" sub_u=0 opt_u=0 opt val
  local -a lit=()
  sr_sync
  [ -n "$SR_CD" ] && [ "$SR_CD" != "?" ] && gdir="$SR_CD"
  GIT_LOC=(); SAW_LOC=0
  while [ "$i" -lt "${#words[@]}" ]; do
    w="${words[$i]}"
    if [ "${exp_f[$i]}" = 1 ] || [ "${brace_f[$i]}" = 1 ]; then sub_u=1; break; fi
    case "$w" in
      -C | --git-dir | --work-tree | --namespace | --exec-path | --super-prefix | -c | --config-env)
        opt="$w"; i=$((i + 1))
        [ "$i" -ge "${#words[@]}" ] && break
        if [ "${exp_f[$i]}" = 1 ] || [ "${brace_f[$i]}" = 1 ]; then opt_u=1; i=$((i + 1)); continue; fi
        val="${lit_f[$i]}"
        case "$opt" in
          -C)
            case "$val" in /*) gdir="$val" ;; *) gdir="$gdir/$val" ;; esac
            GIT_LOC+=(-C "$val") ;;
          --git-dir | --work-tree) GIT_LOC+=("$opt" "$val"); SAW_LOC=1 ;;
          --config-env) deny_config ;;
          -c)
            [[ "$val" =~ $ALIAS_RE ]] && deny_alias
            [ "$AUTO" = 1 ] && deny_config ;;
        esac
        i=$((i + 1)); continue ;;
      --git-dir=* | --work-tree=*)
        if [ "${exp_f[$i]}" = 1 ] || [ "${brace_f[$i]}" = 1 ]; then opt_u=1; else GIT_LOC+=("${lit_f[$i]}"); SAW_LOC=1; fi
        i=$((i + 1)); continue ;;
      --config-env=*) deny_config ;;
      --namespace=* | --exec-path=* | --super-prefix=* | -*) i=$((i + 1)); continue ;;
      *) sub="${lit_f[$i]}"; i=$((i + 1)); break ;;
    esac
  done
  [ "$sub_u" = 1 ] && deny_unparsed
  if [ "$opt_u" = 1 ] && { [ "$AUTO" = 1 ] || [ "$sub" = worktree ]; }; then deny_unparsed; fi
  if [ "$GIT_ENV_U" = 1 ] && { [ "$AUTO" = 1 ] || [ "$sub" = worktree ]; }; then deny_unparsed; fi
  [ "$AUTO" = 1 ] && [ "$GIT_CFG_RISK" = 1 ] && deny_config
  case "$sub" in
    worktree)
      [[ "${exp_f[*]:$i:$((${#words[@]} - i))}${brace_f[*]:$i:$((${#words[@]} - i))}" == *1* ]] && deny_unparsed ;;
    push)
      [ "$AUTO" = 1 ] || return 0
      [[ "${exp_f[*]:$i:$((${#words[@]} - i))}${brace_f[*]:$i:$((${#words[@]} - i))}" == *1* ]] && deny_unparsed
      lit=("${lit_f[@]:$i:$((${#words[@]} - i))}")
      local saved_cd="${CD_BASE:-}"
      [ -n "$SR_CD" ] && CD_BASE="$SR_CD"
      check_push "$gdir" ${lit+"${lit[@]}"}
      CD_BASE="$saved_cd" ;;
  esac
}

screen_rm() {
  local i="$1"
  while [ "$i" -lt "${#words[@]}" ]; do
    [ "${exp_f[$i]}" = 1 ] && deny_unparsed
    i=$((i + 1))
  done
}

# The legacy tokenizer deletes quotes before it splits, so FOO='a b' gh
# becomes the command b. check_gh has to see the quote-aware words.
screen_gh() {
  [ "$AUTO" = 1 ] || return 0
  local i="$1"
  local -a lit=(gh)
  while [ "$i" -lt "${#words[@]}" ]; do
    lit+=("${lit_f[$i]}")
    i=$((i + 1))
  done
  check_gh "${lit[@]}"
}

screen_segment() {
  local i=0 w b u wb vf o j found
  GIT_DIR_VAL="${P_GIT_DIR:-}"
  GIT_WT_VAL="${P_GIT_WT:-}"
  GIT_CFG_RISK="${P_GIT_CFG:-0}"
  GIT_ENV_U=0
  while [ "$i" -lt "${#words[@]}" ]; do
    w="${words[$i]}"; u=0
    [ "${exp_f[$i]}" = 1 ] || [ "${brace_f[$i]}" = 1 ] && u=1
    b="${w##*/}"
    if [ "$u" = 0 ]; then
      b="${litb_f[$i]}"
      case "$w" in
        *=*) ;;
        *) case "$b" in
             if|then|elif|else|do|while|until|'!'|'{'|'('|builtin|eval|env|sudo|command|exec|nice|nohup|xargs|timeout|time|bash|sh|zsh|dash | export | cd | pushd) ;;
             *) break ;;
           esac ;;
      esac
    fi
    if [ "$u" = 0 ] && [[ "$w" =~ ^[A-Za-z_][A-Za-z0-9_]*= ]]; then note_assign_idx "$i"; i=$((i + 1)); continue; fi
    if [ "$u" = 0 ] && is_prefix_keyword "$b"; then i=$((i + 1)); continue; fi
    if [ "$u" = 0 ] && [[ "$b" =~ ^(env|sudo|command|exec|nice|nohup|xargs|timeout|time)$ ]]; then
      wb="$b"; i=$((i + 1))
      prefix_value_flags "$wb"; vf="$PVF"
      while [ "$i" -lt "${#words[@]}" ] && [[ "${words[$i]}" == -* ]]; do
        o="${words[$i]}"; i=$((i + 1))
        [ "$o" = -- ] && break
        [[ " $vf " == *" $o "* ]] && i=$((i + 1))
      done
      if [ "$wb" = env ]; then
        while [ "$i" -lt "${#words[@]}" ] && [[ "${words[$i]}" =~ ^[A-Za-z_][A-Za-z0-9_]*= ]]; do
          note_assign_idx "$i"; i=$((i + 1))
        done
      fi
      [ "$wb" = timeout ] && i=$((i + 1))
      continue
    fi
    if [ "$u" = 0 ] && [[ "$b" =~ ^(bash|sh|zsh|dash)$ ]]; then
      j=$((i + 1)); found=0
      while [ "$j" -lt "${#words[@]}" ] && [[ "${words[$j]}" == -* && "${words[$j]}" != -- ]]; do
        [[ "${words[$j]}" =~ ^-[A-Za-z]*c[A-Za-z]*$ ]] && { found=1; break; }
        [[ "${words[$j]}" =~ ^-[oO]$ ]] && j=$((j + 1))
        j=$((j + 1))
      done
      if [ "$found" = 1 ]; then
        j=$((j + 1))
        if [ "$j" -lt "${#words[@]}" ] && { [ "${exp_f[$j]}" = 1 ] || [ "${brace_f[$j]}" = 1 ]; }; then deny_unparsed; fi
      fi
      return 0
    fi
    if [ "$u" = 0 ] && [ "$b" = export ]; then
      i=$((i + 1))
      while [ "$i" -lt "${#words[@]}" ]; do
        [[ "${words[$i]}" == -* ]] && { i=$((i + 1)); continue; }
        [[ "${words[$i]}" == *=* ]] && { note_assign_idx "$i" 1; i=$((i + 1)); continue; }
        break
      done
      return 0
    fi
    if [ "$u" = 0 ] && { [ "$b" = cd ] || [ "$b" = pushd ]; }; then
      local tgt="${words[$((i + 1))]:-$HOME}" tu=0
      if [ $((i + 1)) -lt "${#words[@]}" ] && { [ "${exp_f[$((i + 1))]}" = 1 ] || [ "${brace_f[$((i + 1))]}" = 1 ]; }; then tu=1; fi
      if [ "$SR_CD" = "?" ]; then :
      elif [ "$tu" = 1 ] || [[ "$tgt" == -* ]]; then SR_CD="?"; SR_PEND=(); SR_VER=$((SR_VER + 1))
      else
        if [ $((i + 1)) -lt "${#words[@]}" ]; then tgt="${lit_f[$((i + 1))]}"; else [ -n "${HOME_LIT+x}" ] || home_lit; tgt="$HOME_LIT"; fi
        sr_cd_set "$tgt"
      fi
      return 0
    fi
    break
  done
  [ "$i" -lt "${#words[@]}" ] || return 0
  if [ "${exp_f[$i]}" = 1 ] || [ "${brace_f[$i]}" = 1 ]; then deny_unparsed; fi
  b="${litb_f[$i]}"
  i=$((i + 1))
  case "$b" in
    git) screen_git "$i" ;;
    rm) screen_rm "$i" ;;
    gh) screen_gh "$i" ;;
  esac
}

command -v awk >/dev/null 2>&1 || deny_unparsed
cmd="$(LC_ALL=C awk -v mode=join "$GG_AWK" <<<"$cmd")" || deny_unparsed
[[ "$cmd" == *$'\n\037JEND' ]] || deny_unparsed
cmd="${cmd%$'\n\037JEND'}"
[ -n "$cmd" ] || deny_unparsed
words=(); exp_f=(); brace_f=(); lit_f=(); litb_f=(); litv_f=()
P_GIT_DIR=""; P_GIT_WT=""; P_GIT_CFG=0
SR_CD=""
pushfast=1
case "$BASE_A$BASE_B" in *\\* | *\"* | *\'* | *$'\n'*) pushfast=0 ;; esac
scan_out="$(LC_ALL=C awk -v mode=scan -v pushfast="$pushfast" -v basea="$BASE_A" -v baseb="$BASE_B" "$GG_AWK" <<<"$cmd")" || deny_unparsed
scan_ended=0
SK_CD=-1 SK_DIR="" SK_WT="" SK_CFG=""
while IFS= read -r rec_h; do
  case "$rec_h" in
    e) scan_ended=1; continue ;;
    c)
      IFS= read -r c_kind; IFS= read -r c_val
      screen_cd "$c_kind" "$c_val"
      continue ;;
    r)
      if [ "$SR_VER" = "$SK_CD" ] && [ "$P_GIT_DIR" = "$SK_DIR" ] && [ "$P_GIT_WT" = "$SK_WT" ] && [ "$P_GIT_CFG" = "$SK_CFG" ]; then continue; fi ;;
    *)
      IFS=$'\037' read -ra words; IFS=$'\037' read -ra exp_f; IFS=$'\037' read -ra brace_f
      IFS=$'\037' read -ra lit_f; IFS=$'\037' read -ra litb_f; IFS=$'\037' read -ra litv_f
      [ "${#words[@]}" -gt 0 ] && unset "words[$((${#words[@]} - 1))]"
      if [ "$rec_h" = 1 ]; then
        for ((rec_k = 0; rec_k < ${#words[@]}; rec_k++)); do
          printf -v "words[$rec_k]" '%b' "${words[rec_k]}"; printf -v "lit_f[$rec_k]" '%b' "${lit_f[rec_k]}"
          printf -v "litb_f[$rec_k]" '%b' "${litb_f[rec_k]}"; printf -v "litv_f[$rec_k]" '%b' "${litv_f[rec_k]}"
        done
      fi ;;
  esac
  SK_CD="$SR_VER" SK_DIR="$P_GIT_DIR" SK_WT="$P_GIT_WT" SK_CFG="$P_GIT_CFG"
  screen_segment
done <<<"$scan_out"
[ "$scan_ended" = 1 ] || deny_unparsed

if [[ "$cmd" == *agent-harness* ]] && { [ "$AUTO" = 1 ] || [[ "$cmd" =~ worktree-rm|teardown-merged-worktree|ship-init ]]; }; then
  unquoted="$(tr -d "'\"" <<<"$cmd")"
  grep -Eq "$HARNESS_ENV_RE" <<<"$unquoted" && deny_harness_env
  grep -Eq "$HARNESS_FUNC_RE" <<<"$unquoted" && deny_harness_env
  grep -Eq "$HARNESS_SOURCE_RE" <<<"$unquoted" && deny_harness_env
fi
if [[ "$cmd" == *worktree-rm* ]] && grep -Eq '(^|[^[:alnum:]_])(export|declare +-x|set +-a)( |$)' <<<"$cmd"; then deny_worktree; fi
[[ "$cmd" == *--confirmed* && "$cmd" == *worktree-rm* ]] && ASKED_WT=1

segments="$(tr -d "'\"" <<<"$cmd" | sed -E 's/\$\(/;/g; s/`/;/g; s/\\(.)/\1/g' | tr ';&|' '\n\n\n')"
pyinert=0
if [[ "$segments" != *python* && "$segments" != *perl* && "$segments" != *node* && "$segments" != *ruby* ]]; then
  pyinert=1
else
  ensure_pyrm
  [ "$AUTO" = 1 ] && ensure_loose
  [ "$PYRM_HIT" = 0 ] && { [ "$AUTO" = 0 ] || [ "$LOOSE_HIT" = 0 ]; } && pyinert=1
fi
segments="$(LC_ALL=C awk -v mode=seg -v pyinert="$pyinert" -v pushfast="$pushfast" -v basea="$BASE_A" -v baseb="$BASE_B" "$GG_AWK" <<<"$segments")" || deny_unparsed
[[ "$segments" == $'\037SEND' || "$segments" == *$'\n\037SEND' ]] || deny_unparsed
segments="${segments%$'\037SEND'}"
PSEG=""; PIN=""
while IFS= read -r seg; do
  if [ "$seg" = "$PSEG" ] && [ "$CD_VER" = "$PIN" ]; then continue; fi
  PSEG="$seg"; PIN="$CD_VER"
  seg="${seg#"${seg%%[![:space:]({]*}"}"
  [ -n "$seg" ] || continue
  toks=($seg)
  [ "${#toks[@]}" -gt 0 ] || continue
  if [[ "$seg" == *[\)\}]* ]]; then
    for ((i = 0; i < ${#toks[@]}; i++)); do
      while [[ "${toks[i]}" == *[\)\}] ]]; do toks[i]="${toks[i]%?}"; done
    done
  fi
  [ "$AUTO" = 1 ] && [[ "$seg" == *'>'* ]] && check_redirects "${toks[@]}"

  i=0 has_assign=0 XARGS=0 pref=0
  GIT_DIR_VAL="" GIT_WT_VAL="" GIT_CFG_RISK=0 GIT_ENV_U=0 SAW_LOC=0
  GIT_LOC=()
  while [ "$i" -lt "${#toks[@]}" ]; do
    t="${toks[$i]}"; b="${t##*/}"
    case "$t" in
      *=*) ;;
      *) case "$b" in
           if|then|elif|else|do|while|until|'!'|'{'|'('|builtin|eval|env|sudo|command|exec|nice|nohup|xargs|timeout|time|bash|sh|zsh|dash) ;;
           *) break ;;
         esac ;;
    esac
    if [[ "$t" =~ ^([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]]; then
      has_assign=1
      case "${BASH_REMATCH[1]}" in
        GIT_DIR) GIT_DIR_VAL="${BASH_REMATCH[2]}"; [[ "$GIT_DIR_VAL" == *'$'* ]] && GIT_ENV_U=1 ;;
        GIT_WORK_TREE) GIT_WT_VAL="${BASH_REMATCH[2]}"; [[ "$GIT_WT_VAL" == *'$'* ]] && GIT_ENV_U=1 ;;
        GIT_CONFIG | GIT_CONFIG_* | GIT_NAMESPACE) GIT_CFG_RISK=1 ;;
      esac
      i=$((i + 1))
    elif is_prefix_keyword "$b"; then i=$((i + 1))
    elif [[ "$b" =~ ^(env|sudo|command|exec|nice|nohup|xargs|timeout|time)$ ]]; then
      pref=1
      [ "$b" = xargs ] && XARGS=1
      i=$((i + 1))
      prefix_value_flags "$b"; vf="$PVF"
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
  case "$c0" in
    bash | sh | zsh | dash | agent-harness | agent-harness.sh | worktree-rm.sh | teardown-merged-worktree.sh | ship-init.sh | ship-merge.sh | cleanup.sh) HC=1 ;;
    *) HC=0 ;;
  esac
  if [ "$HC" = 1 ] && check_worktree_rm "$has_assign" "$c0" "${ct[@]:1}"; then continue; fi
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
      ensure_pyrm
      [ "$PYRM_HIT" = 1 ] && deny_worktree ;;
    cd | pushd)
      tgt="${ct[1]:-$HOME}"
      if [ "$CD_BASE" = "?" ]; then :
      elif [[ "$tgt" == *'$'* || "$tgt" == -* ]]; then CD_BASE="?"; CD_PEND=(); CD_VER=$((CD_VER + 1))
      elif [[ "$tgt" != /* ]]; then CD_PEND+=("$tgt"); CD_VER=$((CD_VER + 1))
      elif [ -n "$CD_BASE" ] || [ "${#CD_PEND[@]}" != 1 ] || [ "${CD_PEND[0]}" != "$tgt" ]; then CD_BASE=""; CD_PEND=("$tgt"); CD_VER=$((CD_VER + 1))
      fi
      continue ;;
  esac
  if [ "$HC" = 1 ] && check_harness_cmd teardown-merged-worktree pr "$has_assign" "$c0" "${ct[@]:1}"; then continue; fi
  if [ "$HC" = 1 ] && check_harness_cmd ship-init init "$has_assign" "$c0" "${ct[@]:1}"; then continue; fi
  [ "$AUTO" = 1 ] || { [ "$c0" = git ] && check_git "${ct[@]}"; continue; }

  if [ "$HC" = 1 ] && check_ship_merge "$has_assign" "$c0" "${ct[@]:1}"; then continue; fi
  if [ "$HC" = 1 ] && check_cleanup "$has_assign" "$c0" "${ct[@]:1}"; then continue; fi

  case "$c0" in
    git)
      [ "$AUTO" = 1 ] && [ "${GIT_CFG_RISK:-0}" = 1 ] && deny_config
      [ "$AUTO" = 1 ] && [ "${GIT_ENV_U:-0}" = 1 ] && deny_unparsed
      check_git "${ct[@]}" ;;
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
