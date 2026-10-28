#!/usr/bin/env bash
# PreToolUse (Bash): in every mode, deny worktree removal (orca/git/rm) except via agent-harness worktree-rm or teardown-merged-worktree, and shell-function or env injection into agent-harness commands; while autonomous, also deny merges, pushes to a base branch (forced or not) and shell edits of protected paths. Fails open on empty input or missing jq.
# A quote-aware scan denies git and rm words it cannot parse (substitution, ANSI-C quoting, brace expansion), and, while autonomous, feeds gh to the same scan so a quoted assignment cannot hide gh pr merge. The legacy tokenizer still strips quotes so a quoted ref cannot hide.
input="$(cat)"
set -f
export LC_ALL=C
command -v jq >/dev/null 2>&1 || exit 0
WIN=0
GREP_CI=
case "${OSTYPE:-}" in msys* | cygwin* | win32*) WIN=1; GREP_CI=-i ;; esac
# Opt-in timing for diagnosis; it only writes to stderr and is read from the hook's own environment.
GG_PROF=""
gg_mark() {
  [ -n "$GG_PROF" ] || return 0
  local n="${EPOCHREALTIME//[.,]/}"
  printf 'guard-profile: %-12s +%7d us  (total %d us)\n' "$1" $((n - GG_TL)) $((n - GG_T0)) >&2
  GG_TL=$n
}
gg_end() { gg_mark end; printf 'guard-profile: git lookups %d\n' "$GG_GIT" >&2; }
if [ "${AGENT_HARNESS_GUARD_PROFILE:-}" = 1 ] && [ -n "${EPOCHREALTIME:-}" ]; then
  GG_PROF=1; GG_T0="${EPOCHREALTIME//[.,]/}"; GG_TL=$GG_T0; GG_GIT=0
  trap gg_end EXIT
fi
# A native jq.exe under MSYS2 or Cygwin writes CRLF unless told to stay binary.
jqr() { if [ "$WIN" = 1 ]; then jq -rb "$@"; else jq -r "$@"; fi; }
# Windows spellings (C:\a\b, C:/a/b, //?/C:/a, /cygdrive/c/a) become the /c/a/b form that bash and cd -P
# report; NTFS ignores case, so every path comparison is made on lowercase text there.
if [ "$WIN" = 1 ]; then
  if [ "${BASH_VERSINFO[0]:-3}" -ge 4 ]; then
    eval 'lc() { LCV="${1,,}"; }'
  else
    lc() {
      local u=ABCDEFGHIJKLMNOPQRSTUVWXYZ l=abcdefghijklmnopqrstuvwxyz i
      LCV="$1"
      for ((i = 0; i < 26; i++)); do LCV="${LCV//${u:i:1}/${l:i:1}}"; done
    }
  fi
fi
winconv() {
  local d lc=abcdefghijklmnopqrstuvwxyz uc=ABCDEFGHIJKLMNOPQRSTUVWXYZ idx
  WP="${1//\\//}"
  case "$WP" in //\?/* | //./*) WP="${WP#//?/}" ;; esac
  if [[ "$WP" =~ ^/cygdrive/([A-Za-z])(/.*)?$ ]] || [[ "$WP" =~ ^([A-Za-z]):(/.*)?$ ]]; then
    d="${BASH_REMATCH[1]}"; idx="${uc%%"$d"*}"
    [ "${#idx}" -lt 26 ] && d="${lc:${#idx}:1}"
    WP="/$d${BASH_REMATCH[2]}"
  fi
}
if [ "$WIN" = 1 ]; then fields="$(jq -jb '(.cwd // ""), "\u0001", (.tool_input.command // "")' <<<"$input" 2>/dev/null)"
else fields="$(jq -j '(.cwd // ""), "\u0001", (.tool_input.command // "")' <<<"$input" 2>/dev/null)"; fi
cwd="${fields%%$'\001'*}"
cmd="${fields:$((${#cwd} + 1))}"
[ -n "$cmd" ] || exit 0
# One scan. A command with none of these cannot name git, gh, a delete, a redirect,
# an expansion, or a protected-path write, so the quote walker never starts.
# The right-hand side stays unquoted: bash 3.2 treats a quoted =~ operand as a literal.
GG_FAST_RE='git|gh|rm|mv|cp|ln|tee|sed|dd|perl|python|node|ruby|rsync|find|trash|truncate|touch|install|sponge|direnv|orca|ship-init|ship-merge|worktree|teardown|agent-harness|cleanup|xargs|pushd|popd|<|>|\$|\{|`|\\'
# Git Bash's =~ walks a multi-megabyte subject even when the only hit is a
# backslash inside quotes, and lowercasing that subject copies it. A 200K-line
# quoted echo then misses the 1500ms budget before the quote walker starts.
# One awk pass allows that command; any guarded token or expansion falls through.
GG_HUGE='
BEGIN {
  RS = "\034"
  word = "git|gh|rm|mv|cp|ln|tee|sed|dd|perl|python|node|ruby|rsync|find|trash|truncate|touch|install|sponge|direnv|orca|ship-init|ship-merge|worktree|teardown|agent-harness|cleanup|xargs|pushd|popd"
  prot = "\\.claude/|\\.github/|\\.opencode/|goal\\.json|autonomy\\.on|opencode\\.jsonc|AGENTS\\.md|CLAUDE\\.md|agents\\.md|claude\\.md|\\.envrc|tools/agent-harness/|tools/ci/|rmtree|rm_rf|rmSync|remove_tree|rmdir"
}
function outside_bad(t) {
  return t ~ word || t ~ prot || index(t, "<") || index(t, ">") || index(t, "$") || index(t, "{") || index(t, "`") || index(t, "\\")
}
function eat_sq(   end, inner) {
  end = index(s, "\047")
  inner = (end == 0) ? s : substr(s, 1, end - 1)
  if (inner ~ word || inner ~ prot) exit 1
  if (end == 0) { s = ""; return }
  s = substr(s, end + 1)
}
function eat_dq(   a, b, c, d, p, ch, n, pre) {
  while (s != "") {
    a = index(s, "\\"); b = index(s, "$"); c = index(s, "`"); d = index(s, "\"")
    p = 0
    if (a) p = a
    if (b && (p == 0 || b < p)) p = b
    if (c && (p == 0 || c < p)) p = c
    if (d && (p == 0 || d < p)) p = d
    if (p == 0) {
      if (s ~ word || s ~ prot) exit 1
      s = ""
      return
    }
    if (p > 1) {
      pre = substr(s, 1, p - 1)
      if (pre ~ word || pre ~ prot) exit 1
    }
    ch = substr(s, p, 1)
    if (ch == "\"") { s = substr(s, p + 1); return }
    if (ch != "\\") exit 1
    n = substr(s, p + 1, 1)
    if (n == "" || n == "$" || n == "`" || n == "\\" || n == "\"" || n == "\n") exit 1
    s = substr(s, p + 1)
  }
}
{
  s = $0
  if (win == 1) s = tolower(s)
  sub(/\n$/, "", s)
  while (s != "") {
    sq = index(s, "\047")
    dq = index(s, "\"")
    if (sq == 0 && dq == 0) {
      if (outside_bad(s)) exit 1
      break
    }
    if (sq && (dq == 0 || sq < dq)) {
      if (sq > 1 && outside_bad(substr(s, 1, sq - 1))) exit 1
      s = substr(s, sq + 1)
      eat_sq()
    } else {
      if (dq > 1 && outside_bad(substr(s, 1, dq - 1))) exit 1
      s = substr(s, dq + 1)
      eat_dq()
    }
  }
}
'
if [ "${#cmd}" -gt 262144 ] && [[ "$cmd" != *$'\034'* ]]; then
  if LC_ALL=C awk -v win="$WIN" "$GG_HUGE" <<<"$cmd"; then exit 0; fi
else
  probe="$cmd"
  # Git Bash on bash 3.2 has no ${var,,}. lc is the hook's own lowercase, defined for WIN.
  if [ "$WIN" = 1 ]; then lc "$cmd"; probe="$LCV"; fi
  if [[ ! "$probe" =~ $GG_FAST_RE ]]; then exit 0; fi
  unset probe
fi
cwd="${cwd:-$PWD}"
if [ "$WIN" = 1 ]; then winconv "$cwd"; cwd="$WP"; fi
gg_mark input

ROOT="$(git -C "${CLAUDE_PROJECT_DIR:-$PWD}" worktree list --porcelain 2>/dev/null | sed -n '1s/^worktree //p')"
[ -n "$ROOT" ] || ROOT="${CLAUDE_PROJECT_DIR:-$PWD}"
STATE_DIR="$ROOT/.claude/state"
[ "${AGENT_HARNESS_TEST:-}" = 1 ] && STATE_DIR="${AGENT_STATE_DIR:-${TLTB_STATE_DIR:-$STATE_DIR}}"
AUTO=0
[ -f "$STATE_DIR/autonomy.on" ] && AUTO=1

CONFIG_FILE="$ROOT/.claude/agent-harness.json"
cfg() { [ -f "$CONFIG_FILE" ] || return 0; jqr "$1" "$CONFIG_FILE" 2>/dev/null || true; }

base_cfg="$(cfg '.base // empty')"
if [ -n "$base_cfg" ]; then BASE_A="$base_cfg"; BASE_B="$base_cfg"; else BASE_A=main; BASE_B=master; fi
ALIAS_RE=$'(^|\n)[Aa][Ll][Ii][Aa][Ss]\\.'
is_base() { [ "$1" = "$BASE_A" ] || [ "$1" = "$BASE_B" ]; }

DEFAULT_ALTS='\.github/|\.claude/|\.opencode/|tools/agent-harness/|tools/ci/|opencode\.jsonc$|AGENTS\.md$|CLAUDE\.md$|\.envrc$'
alts="$(cfg '(.protectedPaths // []) | map(ltrimstr("^")) | join("|")')"
alts="${alts:-$DEFAULT_ALTS}"
ALTS_DEFAULT=0
[ "$alts" = "$DEFAULT_ALTS" ] && ALTS_DEFAULT=1
AUTONOMY_FLAG='\.claude/state/(autonomy\.on|goal\.json)'
TOKEN_RE="(^|/)(${alts})|${AUTONOMY_FLAG}"
if [ "$WIN" = 1 ]; then lc "$TOKEN_RE"; TOKEN_RE="$LCV"; fi
LOOSE_RE="$(sed -E 's/\$(\||$)/\1/g' <<<"$alts")|${AUTONOMY_FLAG}"

emit() {
  if [ "$1" = deny ]; then
    _kpi="${BASH_SOURCE[0]%/*}/kpi-emit.sh"
    [ -f "$_kpi" ] && "$_kpi" guard_block guard=git >/dev/null 2>&1 || true
  fi
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
deny_review() { emit deny "Blocked by git-guard: $1"; }
# Read-only git does not publish or rewrite. A variable -C on one of these is not a guarded operation.
git_ro() {
  case "$1" in
    status | diff | log | ls-remote | merge-base) return 0 ;;
  esac
  return 1
}
# Redirections are not ref names. 2>&1 used to be split into the word 2> and then used as the review key.
redir_word() {
  REDIR_NEED=0
  case "$1" in
    [0-9]*[\<\>]* | [\>\<]* | '&>'* | '&>>'*) ;;
    *) return 1 ;;
  esac
  case "$1" in
    [0-9]*'>>' | [0-9]*'<<' | [0-9]*'<>' | [0-9]*'>' | [0-9]*'<' | [0-9]*'>&' | [0-9]*'<&' | '&>' | '&>>' | '<<<' | '<<-')
      REDIR_NEED=1 ;;
    [0-9]*'>&'[0-9-]* | [0-9]*'<&'[0-9-]*) ;;
    [0-9]*'>>'?*) ;;
    [0-9]*'<<'?*) ;;
    [0-9]*'<>'?*) ;;
    [0-9]*'>'?*) ;;
    [0-9]*'<'?*) ;;
    '&>'?*) ;;
    '&>>'?*) ;;
    *) REDIR_NEED=1 ;;
  esac
  return 0
}
strip_redir_args() {
  local a need=0
  GG_ARGS=()
  for a in "$@"; do
    if [ "$need" = 1 ]; then need=0; continue; fi
    if redir_word "$a"; then
      [ "$REDIR_NEED" = 1 ] && need=1
      continue
    fi
    GG_ARGS+=("$a")
  done
}
# sh -c 'cd dir && git push' is one quoted script. Re-queue the script's commands so the push is still checked.
queue_shell_script() {
  [ "$shell_c" = 1 ] || return 1
  local script="${ct[*]}" line more
  local -a add=() pre=() post=()
  [[ "$script" == *[\;\&\|]* ]] || return 1
  more="$(LC_ALL=C awk -v mode=lex "$GG_AWK" <<<"$script")" || return 1
  [[ "$more" == *$'\n\037LEXEND' ]] || return 1
  more="${more%$'\n\037LEXEND'}"
  more="${more%%$'\037NCMD '*}"
  while IFS= read -r line; do
    [ -n "${line//[[:space:]]/}" ] && add+=("$line")
  done <<<"$more"
  [ "${#add[@]}" -gt 1 ] || return 1
  pre=("${GGL[@]:0:$LI}")
  post=("${GGL[@]:$LI}")
  GGL=("${pre[@]}" "${add[@]}" "${post[@]}")
  nlines=${#GGL[@]}
  return 0
}
is_protected_token() {
  local t="${1//[<>]/}"
  if [ "$WIN" = 1 ]; then t="${t//\\//}"; lc "$t"; t="$LCV"; fi
  t="${t#of=}"
  case "${t##*/}" in
    [Gg][Oo][Aa][Ll].[Jj][Ss][Oo][Nn] | [Aa][Uu][Tt][Oo][Nn][Oo][Mm][Yy].[Oo][Nn])
      cd_sync
      [ "${CD_BASE:-}" = "?" ] && return 0
      norm_path "$t" "${CD_BASE:-$cwd}"
      [[ "$NP" == */.claude/state/* ]] && return 0 ;;
  esac
  [[ "$t" =~ $TOKEN_RE ]]
}
any_protected() {
  local t
  [ "$ALTS_DEFAULT" = 1 ] && [[ "$*" != *[./]* ]] && return 1
  for t in "$@"; do is_protected_token "$t" && return 0; done
  return 1
}

# The same directory is resolved by the quote-aware scan and again by the legacy loop; the result is
# kept in a variable named after the path. Only paths of plain ASCII characters are cached, so two
# different paths can never share a name in any locale.
rh_name() {
  local p="$1"
  [[ "$p" != *[!abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789/._-]* ]] || return 1
  p="${p//_/_u}"; p="${p//\//_s}"; p="${p//./_d}"; p="${p//-/_h}"
  RH_N="RHC_$p"
}

# Directories of one repository share a HEAD, so the cache is keyed by the nearest ancestor holding a .git
# entry, found on the physical path the way git walks up. An unusual layout gets no key and no cache.
rh_key() {
  local d
  [ -z "${GIT_CEILING_DIRECTORIES:-}" ] || return 1
  phys_dir "$1"
  [ -n "$d" ] || return 1
  while [ ! -e "$d/.git" ]; do
    { [ "$d" != / ] && [ -n "$d" ]; } || return 1
    d="${d%/*}"; [ -n "$d" ] || d=/
  done
  rh_name "$d"
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
      [ -n "$GG_PROF" ] && GG_GIT=$((GG_GIT + 1))
      cur="$(cd "$cwd" 2>/dev/null && env "${ea[@]}" git ${GIT_LOC+"${GIT_LOC[@]}"} rev-parse --abbrev-ref HEAD 2>/dev/null)" || true
    else
      [ -n "$GG_PROF" ] && GG_GIT=$((GG_GIT + 1))
      cur="$(cd "$cwd" 2>/dev/null && git ${GIT_LOC+"${GIT_LOC[@]}"} rev-parse --abbrev-ref HEAD 2>/dev/null)" || true
    fi
    [ -n "$cur" ] || st=1
  else
    if [ -d "$gdir" ]; then
      if rh_key "$gdir"; then
        if [ -n "${!RH_N+x}" ]; then cur="${!RH_N}"
        else
          [ -n "$GG_PROF" ] && GG_GIT=$((GG_GIT + 1))
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

GATE_DIR="" GATE_BASE=""
gate_git() {
  if [ "$SAW_LOC" = 1 ] || [ -n "${GIT_DIR_VAL:-}" ] || [ -n "${GIT_WT_VAL:-}" ]; then
    (
      cd "$cwd" 2>/dev/null || exit 1
      [ -z "${GIT_DIR_VAL:-}" ] || export GIT_DIR="$GIT_DIR_VAL"
      [ -z "${GIT_WT_VAL:-}" ] || export GIT_WORK_TREE="$GIT_WT_VAL"
      git ${GIT_LOC+"${GIT_LOC[@]}"} "$@"
    )
  else
    git -C "$GATE_DIR" "$@"
  fi
}

# Gated while autonomy is on and the goal is active; an unreadable goal.json fails closed.
# Sets GATE_BASE from goal.json.
gate_on() {
  local goal="$STATE_DIR/goal.json" st=""
  [ "$AUTO" = 1 ] && [ -f "$goal" ] || return 1
  { read -r st; read -r GATE_BASE; } < <(jqr '(.status // ""), (.base // "")' "$goal" 2>/dev/null)
  [ "$st" = active ] || [ -z "$st" ]
}

# The recipe is repeated in scripts/agent-harness/goal.sh (hooks must not source lib.sh): keep both identical.
# Sets GKEY to the hash of the byte-exact diff a push would publish, ignoring the harness's own report artifacts.
# Flags override diff.* config so a repo setting cannot change or empty the diff.
gate_key() {
  local rev="$1" b mb="" k=""
  for b in "$GATE_BASE" "$(gate_git symbolic-ref -q --short refs/remotes/origin/HEAD 2>/dev/null | sed 's#^origin/##')" "$BASE_A" "$BASE_B"; do
    [ -n "$b" ] || continue
    mb="$(gate_git merge-base "origin/$b" "$rev" 2>/dev/null)" && [ -n "$mb" ] && break
    mb=""
  done
  [ -n "$mb" ] || return 1
  k="$(set -o pipefail; gate_git -c core.quotepath=true diff --no-ext-diff --no-textconv --binary --full-index --no-color --no-renames --no-relative -O/dev/null --src-prefix=a/ --dst-prefix=b/ --diff-algorithm=myers -U3 --inter-hunk-context=0 --submodule=short --ignore-submodules=none "$mb" "$rev" -- ':/' ':(top,exclude)docs/agent-reports' 2>/dev/null | gate_git hash-object --stdin 2>/dev/null)" || return 1
  case "$k" in e69de29bb2d1d6434b8b29ae775ad8c2e48c5391 | 473a0f4c3be8a93681a267e3b1e9a7dcda1185436fe141f7749120a303721813) k=empty ;; esac
  [ -n "$k" ] || return 1
  GKEY="$k"
}

# $1 = directory the command runs in ("?" when unknown); the rest = pushed source revs ("HEAD" when none).
review_gate() {
  local goal="$STATE_DIR/goal.json" src ok
  GATE_DIR="$1"; shift
  [ "$#" -gt 0 ] || set -- HEAD
  for src in "$@"; do
    if [ "$GATE_DIR" = "?" ] || ! gate_key "$src"; then
      deny_review "cannot compute review key for '$src' (unknown directory, or no origin/<base> to diff against). Run from the goal worktree after \`git fetch origin\`, then push again."
    fi
    ok="$(jqr --arg k "$GKEY" '((.reviews // {})[$k] // {}) | ((.code.verdict == "pass") and (.security.verdict == "pass"))' "$goal" 2>/dev/null)"
    [ "$ok" = true ] || deny_review "review the diff before pushing: no passing code and security review is recorded for it (key $GKEY). Run the local reviewers, record each verdict with \`agent-harness goal review code|security pass|fail\`, fix findings, then push again."
  done
}

# Sets PCFG to the push-relevant config lines of the repository at GATE_DIR with one git call, cached per
# repository like resolve_head. A bare push reads it for the mirror check; the gate reads it too.
PCFG_RE='^(remote\..*\.(mirror|push)|push\.default)$'
push_cfg() {
  local v="" have=0 out=""
  PCFG=""
  if [ "$SAW_LOC" != 1 ] && [ -z "${GIT_DIR_VAL:-}" ] && [ -z "${GIT_WT_VAL:-}" ] && [ -d "$GATE_DIR" ] && rh_key "$GATE_DIR"; then
    v="RHP${RH_N#RHC}"
    if [ -n "${!v+x}" ]; then PCFG="${!v}"; return 0; fi
    have=1
  fi
  [ -n "$GG_PROF" ] && GG_GIT=$((GG_GIT + 1))
  out="$(gate_git config --get-regexp "$PCFG_RE" 2>/dev/null)" || true
  [ "$have" = 0 ] || printf -v "$v" '%s' "$out"
  PCFG="$out"
}

# True unless every remote.<name>.mirror is clearly false: git also reads non-zero integers and a valueless key as true.
mirror_on() {
  local line v re='^remote\..*\.mirror( (.*))?$' zero='^[+-]?0+[kKmMgG]?$' hexzero='^[+-]?0[xX]0*[kKmMgG]?$'
  while IFS= read -r line; do
    [[ "$line" =~ $re ]] || continue
    [ -n "${BASH_REMATCH[1]}" ] || return 0
    v="${BASH_REMATCH[2]}"
    case "$v" in
      [Ff][Aa][Ll][Ss][Ee] | [Nn][Oo] | [Oo][Ff][Ff] | '') ;;
      *) [[ "$v" =~ $zero || "$v" =~ $hexzero ]] || return 0 ;;
    esac
  done <<<"$PCFG"
  return 1
}

redirected_push() {
  local line re='^remote\..*\.push( |$)' def='^push\.default (.*)$'
  while IFS= read -r line; do
    [[ "$line" =~ $re ]] && return 0
    if [[ "$line" =~ $def ]]; then
      case "${BASH_REMATCH[1]}" in [Mm][Aa][Tt][Cc][Hh][Ii][Nn][Gg]) return 0 ;; esac
    fi
  done <<<"$PCFG"
  return 1
}

# Pushes of backup/* refs are the safety net before a rewrite and are never gated.
push_gate() {
  local gd="$1" a src dst; shift
  local -a srcs=()
  gate_on || return 0
  GATE_DIR="$gd"
  if [ "$#" -eq 0 ]; then
    push_cfg
    if redirected_push; then
      deny_review "a push without an explicit refspec follows remote.<name>.push or push.default=matching, which can publish a branch other than the reviewed one: name the branch."
    fi
  fi
  for a in "$@"; do
    a="${a#+}"
    dst="${a##*:}"; dst="${dst#refs/heads/}"
    case "$dst" in backup/*) [[ "$dst" == *..* ]] || continue ;; esac
    src="${a%%:*}"
    [ -z "$src" ] || srcs+=("$src")
  done
  [ "$#" -eq 0 ] || [ "${#srcs[@]}" -gt 0 ] || return 0
  review_gate "$gd" ${srcs+"${srcs[@]}"}
}

check_push() {
  local gdir="$1" a ref; shift
  strip_redir_args "$@"
  set -- ${GG_ARGS+"${GG_ARGS[@]}"}
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
  local skip=1
  for a in "$@"; do [[ "$a" == --repo || "$a" == --repo=* ]] && skip=0; done
  if [ "$((${#pos[@]} - skip))" -le 0 ] && [ "$gdir" != "?" ]; then
    GATE_DIR="$gdir"
    push_cfg
    mirror_on && deny_review "a bare push follows remote.<name>.mirror, which is a hidden --mirror (or a value that is not clearly false): name the branch."
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
  local gd="$gdir"
  [ "$CD_BASE" = "?" ] && [ "$SAW_LOC" != 1 ] && [ -z "$GIT_DIR_VAL" ] && gd="?"
  push_gate "$gd" ${pos[@]+"${pos[@]:$skip}"}
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
  local gdir="$cwd" n=$# a kv sub="" j=2 c_exp=0
  cd_sync
  [ -n "$CD_BASE" ] && [ "$CD_BASE" != "?" ] && gdir="$CD_BASE"
  local args=("$@")
  GIT_LOC=(); SAW_LOC=0
  while [ "$j" -le "$n" ]; do
    a="${args[$((j - 1))]}"
    case "$a" in
      -C)
        kv="${args[$j]:-}"
        if [[ "$kv" == *'$'* || "$kv" == *'`'* ]]; then c_exp=1
        else
          case "$kv" in /*) gdir="$kv" ;; *) gdir="$gdir/$kv" ;; esac
          GIT_LOC+=(-C "$kv")
        fi
        j=$((j + 2)) ;;
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
  if [ "$c_exp" = 1 ] && [ "$AUTO" = 1 ] && ! git_ro "$sub"; then deny_unparsed; fi
  local rest=("${args[@]:$((j - 1))}")
  case "$sub" in
    commit | tag | stash | log | notes) ;;
    *) worktree_destroy_in "${args[@]}" && deny_worktree ;;
  esac
  if [ "$sub" = config ]; then
    for a in "${rest[@]}"; do case "$a" in --get | --get-all | --get-regexp | --list | -l) return 0 ;; esac; done
    for a in "${rest[@]}"; do [[ "$a" == alias.* ]] && deny_alias; done
    for a in "${rest[@]}"; do
      a="$(printf '%s' "$a" | tr '[:upper:]' '[:lower:]')"
      [ "$AUTO" = 1 ] && [[ "$a" == remote.*.mirror ]] && deny_review "remote.<name>.mirror makes a bare push a hidden --mirror, which is forbidden: do not set it."
      [[ "$a" == remote.*.push || "$a" == remote.*.mirror || "$a" == push.default ]] && gate_on && deny_review "while a goal is active, remote.<name>.push, remote.<name>.mirror and push.default decide what a bare push publishes: do not set them."
    done
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
    remote) for a in "${rest[@]}"; do [[ "$a" == --mirror || "$a" == --mirror=* ]] && deny_review "git remote add --mirror creates a hidden --mirror push, which is forbidden."; done ;;
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
  if gh_has ' pr( .*)? (create|new)( |$)' && gate_on; then
    gh_has ' (--head|-H)' && deny_review "gh pr create --head/-H can publish a branch other than the reviewed one: run it from the goal worktree without them."
    local gd="$cwd"
    cd_sync
    [ -n "${CD_BASE:-}" ] && gd="$CD_BASE"
    GIT_LOC=(); SAW_LOC=0
    review_gate "$gd"
  fi
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
  if grep -Eq $GREP_CI -- "$LOOSE_RE" <<<"$cmd"; then LOOSE_HIT=1; else LOOSE_HIT=0; fi
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
legacy_cd() {
  local tgt="${1:-$HOME}"
  if [ "$CD_BASE" = "?" ]; then :
  elif [[ "$tgt" == *'$'* || "$tgt" == -* ]]; then CD_BASE="?"; CD_PEND=(); CD_VER=$((CD_VER + 1))
  elif [[ "$tgt" != /* ]]; then CD_PEND+=("$tgt"); CD_VER=$((CD_VER + 1))
  elif [ -n "$CD_BASE" ] || [ "${#CD_PEND[@]}" != 1 ] || [ "${CD_PEND[0]}" != "$tgt" ]; then CD_BASE=""; CD_PEND=("$tgt"); CD_VER=$((CD_VER + 1))
  fi
}

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
  local p="${1/#\~/$HOME}" base="${2:-$cwd}" out=() seg d
  if [ "$WIN" = 1 ]; then winconv "$p"; p="$WP"; winconv "$base"; base="$WP"; fi
  case "$p" in /*) ;; *) p="$base/$p" ;; esac
  if [[ "$p" == *//* || "$p" == */./* || "$p" == */../* || "$p" == */. || "$p" == */.. ]]; then
    local IFS=/
    for seg in $p; do
      case "$seg" in
        '' | .) ;;
        ..) [ "${#out[@]}" -gt 0 ] && unset "out[$((${#out[@]} - 1))]" ;;
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
  if [ "$WIN" = 1 ]; then lc "$NP"; NP="$LCV"; fi
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
      [0-9]'>' | '>') [ "$i" -eq $((${#rest[@]} - 1)) ] || deny ;; # the segment splitter cuts N>&M at the ampersand
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
# "\" LF US escaped as \\ \n \0037. A leading cd, pushd or popd becomes a "c" record: header line "c",
# a kind line (h = HOME, k = unknown directory, p/P = literal target, P holding %b escapes) and a
# value line prefixed "x". Consecutive literal cd records collapse: an absolute target discards the
# literal records before it. seg keeps only legacy-tokenizer segments that can reach a check (scan
# drops the same no-op segments); a cd there is a "\034"-prefixed digest, python-class segments are
# tagged "\036". both runs scan and seg in one pass over a command without a backslash. lit unquotes
# stdin. Every mode ends with a sentinel the caller checks. Input is read line by line and walked in
# bounded chunks because BSD awk substr is O(length); in both mode, lines inside a quote that cannot
# change scan state or reach a check are skipped without further work.
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
function stripexe(s) {
  if (length(s) > 4 && tolower(substr(s, length(s) - 3)) == ".exe") return substr(s, 1, length(s) - 4)
  return s
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
function fw(   i, j, r, br, n, m2, piece, qs, lw, lb, lv, ps, lws, lbs, e1, e2, e3, e4, fastw) {
  if (nw > 0 && md == 1) { sp["W"] = 0; wb = ""; lbuf = ""; ex = 0; nw++; return }
  if (lbuf != "") { apush("W", lbuf); lbuf = "" }
  apush("W", wb); wb = ""; W = aget("W")
  if (W != "" || ex) {
    br = 0
    fastw = (!ex && length(W) <= 256 && W !~ SPECIAL)
    if (fastw) {
      lws = W; lbs = win ? stripexe(tolower(W)) : W
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
      piece = ps[n]
      if (win) { m2 = split(piece, qs, BS); if (m2 > 1) { piece = qs[m2]; n += m2 - 1 } }
      lb = (n > 1) ? lit(piece) : lw
      i = index(W, "=")
      lv = i ? lit(substr(W, i + 1)) : lw
      lws = stripnl(lw); lbs = stripnl(lb)
      if (win) lbs = stripexe(tolower(lbs))
    }
    if (lbs == "export") xs = 1
    if (nw == 0) {
      md = 0
      if (!ex && !br && W !~ ASG) {
        gp = 0
        if (lbs == "git") { md = xs ? 0 : 2; gp = !xs }
        else if (lbs == "rm") md = 3
        else if (lbs == "gh") md = 4
        else if (lbs == "cd") md = 5
        else if (lbs == "pushd") { md = 5; pd = 1 }
        else if (lbs == "popd") { md = 5; pop = 1 }
        else if (!(lbs in SK)) md = 1
      }
    } else if (md == 2) {
      if (!ex && !br && substr(W, 1, 1) != "-" && lws != "worktree" && lws != "push") md = 1
      else md = 0
    } else if (md == 3 && ex) md = 0
    else if (md == 4 && (index(lws, "merge") || index(lws, "api") || index(lws, "create") || index(lws, "new"))) md = 0
    if (md != 1) {
      nk++
      if (fastw) { e1 = W; e2 = W; e3 = lbs; e4 = W }
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
function cdflush(   i) {
  for (i = 1; i <= ncb; i++) print cb[i]
  ncb = 0
}
function cdsafe(t) { return t != "" && index(t, "$") == 0 && substr(t, 1, 1) != "-" }
function fsg(   i, txt, hdr) {
  fw()
  if (md == 5 && nk > 0) {
    if (pop) txt = "c\nk\nx\n"
    else if (nk == 1) txt = pd ? "c\nk\nx\n" : "c\nh\nx\n"
    else if (ae[2] != 0 || abr[2] != 0 || substr(aw[2], 1, 1) == "-" || (pd && (substr(aw[2], 1, 1) == "+" || aw[2] ~ /^[0-9]*[<>]/))) txt = "c\nk\nx\n"
    else txt = "c\n" (index(al[2], BS) ? "P" : "p") "\nx" al[2] "\n"
    if (substr(txt, 1, 3) == "c\np") {
      if (substr(al[2], 1, 1) == "/") ncb = 0
      cb[++ncb] = txt
    } else {
      cdflush()
      if (!((txt == prevc) && (txt ~ /^c\nk/ || substr(al[2], 1, 1) == "/"))) print txt
    }
    prevc = txt
  } else if (md == 0 && nk > 0 && !(gp && screen_push_inert())) {
    cdflush()
    txt = ""
    if (nk <= 16) for (i = 1; i <= nk; i++) txt = txt aw[i] US ae[i] US abr[i] US al[i] US ab2[i] US av[i] RSEP
    prevc = ""
    if (txt != "" && txt == prevtxt) print "r\n"
    else {
      hdr = bs ? "1" : "0"; print hdr "\n"
      emitarr(aw, nk); emitarr(ae, nk); emitarr(abr, nk); emitarr(al, nk); emitarr(ab2, nk); emitarr(av, nk)
      prevtxt = txt
    }
  }
  nk = 0; bs = 0; nw = 0; md = 0; gp = 0; pop = 0; pd = 0
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
function segemit(line,   r, pfx) {
  r = segkeep(line)
  if (r == 2) {
    if (substr(cdtgt, 1, 1) == "/" && cdsafe(cdtgt))
      while (ns > 0 && substr(sg[ns], 1, 1) == "\034" && cdsafe(substr(sg[ns], 2))) ns--
    if (!(ns > 0 && sg[ns] == "\034" cdtgt && substr(cdtgt, 1, 1) == "/")) sg[++ns] = "\034" cdtgt
  }
  else if (r) {
    pfx = (substr(line, 1, 1) == "\034" || substr(line, 1, 1) == "\035" || substr(line, 1, 1) == "\036" || substr(line, 1, 1) == US) ? "\035" : ""
    if (r == 3) pfx = "\036" pfx
    sg[++ns] = pfx line
  }
}
function plainq(s,   w, c) {
  if (s ~ PLAINX) return 0
  if (!match(s, /^[A-Za-z0-9_]+/)) return 0
  c = substr(s, RLENGTH + 1, 1)
  if (c != "" && c != " " && c != "\t") return 0
  w = substr(s, 1, RLENGTH)
  if (win) w = tolower(w)
  return !(w in ALLB) && w !~ /^python/
}
function xadd(s) {
  if (s == "") return
  apush("X", s)
  xl = substr(s, length(s), 1)
}
function note_cmd(s) {
  gsub(/^[ \t\r\f\v({]+/, "", s)
  if (s != "") ncmd++
}
function lexflush(   s) {
  s = aget("X"); xl = ""
  if (s == "") return
  note_cmd(s)
  if (lexprint) print s "\n"
  else segemit(s)
}
function lexplain(s,   n, i, parts) {
  if (index(s, ">") || index(s, "&")) {
    gsub(/>&/, ">\003", s)
    gsub(/&>/, "\003>", s)
  }
  gsub(/\$\(/, "\n", s)
  gsub(/`/, "\n", s)
  gsub(/[;&|]/, "\n", s)
  gsub(/\003/, "\\&", s)
  n = split(s, parts, "\n")
  for (i = 1; i <= n; i++) {
    if (parts[i] == "") continue
    note_cmd(parts[i])
    if (lexprint) print parts[i] "\n"
    else segemit(parts[i])
  }
}
function lexfeed(s,   n, p, ch, m, lim, i, c, nxt, rest, k) {
  if (lq == 1 && index(s, SQ) == 0) { xadd(s); xadd(" "); return }
  if (lq == 2 && index(s, DQ) == 0 && index(s, BS) == 0 && index(s, "$") == 0 && index(s, "`") == 0) { xadd(s); xadd(" "); return }
  if (lq == 0 && index(s, SQ) == 0 && index(s, DQ) == 0 && index(s, BS) == 0 && index(s, "`") == 0) {
    if (s ~ /^[A-Za-z0-9_]+$/) {
      if (!lexprint) { n = win ? tolower(s) : s; if (!(n in ALLB) && n !~ /^python/) { note_cmd(s); return } }
    }
    if (s !~ SEGSPECIAL) {
      note_cmd(s)
      if (lexprint) { if (s != "") print s "\n" }
      else segemit(s)
      return
    }
    lexplain(s); return
  }
  n = length(s); p = 1
  while (p <= n) {
    ch = substr(s, p, CH + 1); m = length(ch); lim = (m > CH) ? CH : m
    i = 1
    while (i <= lim) {
      c = substr(ch, i, 1)
      if (lq == 1) {
        rest = substr(ch, i, lim - i + 1)
        k = index(rest, SQ)
        if (k == 0) { xadd(rest); i = lim + 1; continue }
        if (k > 1) xadd(substr(rest, 1, k - 1))
        lq = 0; i += k; continue
      }
      if (lq == 2) {
        if (c == BS && i < m) {
          nxt = substr(ch, i + 1, 1); i += 2
          if (nxt == "$" || nxt == DQ || nxt == BS || nxt == "`") xadd(nxt)
          else { xadd(c); xadd(nxt) }
          continue
        }
        if (c == DQ) { lq = 0; i++; continue }
        if (c == "`") { lexflush(); i++; continue }
        if (c == "$" && i < m && substr(ch, i + 1, 1) == "(") { lexflush(); i += 2; continue }
        xadd(c); i++; continue
      }
      if (c == SQ) { lq = 1; i++; continue }
      if (c == DQ) { lq = 2; i++; continue }
      if (c == BS && i < m) {
        nxt = substr(ch, i + 1, 1); i += 2
        if (nxt == ";" || nxt == "&" || nxt == "|" || nxt == "\n") lexflush()
        else xadd(nxt)
        continue
      }
      if (c == "$" && i < m && substr(ch, i + 1, 1) == "(") { lexflush(); i += 2; continue }
      if (c == "`") { lexflush(); i++; continue }
      if (c == ";" || c == "|" || c == "\n") { lexflush(); i++; continue }
      if (c == "&") {
        nxt = (i < m) ? substr(ch, i + 1, 1) : ""
        if (nxt == ">" || xl == ">") xadd(c)
        else lexflush()
        i++; continue
      }
      xadd(c); i++
    }
    p += i - 1
  }
  if (lq == 0) lexflush()
  else xadd(" ")
}
function body_subs(line,   n, i, c, depth, qq, start) {
  if (index(line, "$") == 0 && index(line, "`") == 0) return
  n = length(line); i = 1; qq = 0
  while (i <= n) {
    c = substr(line, i, 1)
    if (qq == 1) { if (c == SQ) qq = 0; i++; continue }
    if (qq == 2) {
      if (c == BS) { i += 2; continue }
      if (c == DQ) qq = 0
      i++; continue
    }
    if (c == SQ) { qq = 1; i++; continue }
    if (c == DQ) { qq = 2; i++; continue }
    if (c == "`") {
      start = i; i++
      while (i <= n && substr(line, i, 1) != "`") i++
      print substr(line, start, i - start + 1) "\n"
      if (i <= n) i++
      continue
    }
    if (c == "$" && substr(line, i + 1, 1) == "(") {
      start = i; depth = 1; i += 2
      while (i <= n && depth > 0) {
        c = substr(line, i, 1); i++
        if (c == "(") depth++
        else if (c == ")") depth--
      }
      print substr(line, start, i - start) "\n"
      continue
    }
    i++
  }
}
function body_queue(line, i,   n, c, strip, quoted, delim) {
  n = length(line); strip = 0; quoted = 0; delim = ""
  if (substr(line, i, 1) == "-") { strip = 1; i++ }
  while (i <= n && (substr(line, i, 1) == " " || substr(line, i, 1) == "\t")) i++
  while (i <= n) {
    c = substr(line, i, 1)
    if (c == " " || c == "\t" || c == ";" || c == "&" || c == "|" || c == "<" || c == ">" || c == "(" || c == ")") break
    if (c == SQ || c == DQ) { quoted = 1; i++; continue }
    if (c == BS) {
      quoted = 1
      if (i < n) { delim = delim substr(line, i + 1, 1); i += 2; continue }
      i++; continue
    }
    delim = delim c; i++
  }
  if (delim != "") {
    hd_n++; hd_d[hd_n] = delim; hd_q[hd_n] = quoted; hd_t[hd_n] = strip
  }
  return i
}
function body_close(line,   s) {
  s = line
  if (hd_t[hd_i]) sub(/^\t+/, "", s)
  if (s != hd_d[hd_i]) return 0
  hd_i++
  if (hd_i > hd_n) { hd_n = 0; hd_i = 1 }
  return 1
}
function bodyrec(line,   n, i, c) {
  if (hd_i <= hd_n) {
    if (body_close(line)) return
    if (!hd_q[hd_i]) body_subs(line)
    return
  }
  n = length(line); i = 1
  while (i <= n) {
    c = substr(line, i, 1)
    if (bq == 1) { if (c == SQ) bq = 0; i++; continue }
    if (bq == 3) {
      if (c == BS) { i += 2; continue }
      if (c == SQ) bq = 0
      i++; continue
    }
    if (bq == 2) {
      if (c == BS) { i += 2; continue }
      if (c == DQ) bq = 0
      i++; continue
    }
    if (c == SQ) { bq = 1; i++; continue }
    if (c == DQ) { bq = 2; i++; continue }
    if (c == "$" && substr(line, i + 1, 1) == SQ) { bq = 3; i += 2; continue }
    if (c == BS) { i += 2; continue }
    if (c == "<" && substr(line, i + 1, 1) == "<") {
      if (substr(line, i + 2, 1) == "<") { i += 3; continue }
      i = body_queue(line, i + 2)
      continue
    }
    i++
  }
  print line "\n"
}
function maybe_prot(t) {
  if (win) t = tolower(t)
  return index(t, ".github/") || index(t, ".claude/") || index(t, ".opencode/") || index(t, "tools/agent-harness/") \
    || index(t, "tools/ci/") || index(tolower(t), "goal.json") || index(tolower(t), "autonomy.on") || index(t, "opencode.jsonc") || index(t, "agents.md") || index(t, "claude.md") \
    || index(t, "AGENTS.md") || index(t, "CLAUDE.md") || index(t, ".envrc")
}
function segkeep(s,   t, k, b, i, a, n, ps) {
  sub(/^[ \t\r\f\v({]+/, "", s)
  if (s == "") return 0
  if (s ~ /^[A-Za-z0-9_]+$/) {
    t = win ? tolower(s) : s
    if (!(t in ALLB) && t !~ /^python/) return 0
  }
  if (index(s, ">")) {
    if (!altsdef) return 1
    k = split(s, a, " ")
    for (i = 1; i <= k; i++) if (maybe_prot(a[i])) return 1
  }
  match(s, /^[^ \t]+/); t = substr(s, 1, RLENGTH)
  sub(/[)}]+$/, "", t)
  if (t == "" || t ~ ASG) return 1
  n = split(t, ps, "/"); b = ps[n]
  if (win) b = stripexe(tolower(b))
  if (b == "popd") { cdtgt = "-"; return 2 }
  if (b == "cd" || b == "pushd") {
    k = split(s, a, " ")
    if (k > 2) return 1
    if (k == 2) { sub(/[)}]+$/, "", a[2]); cdtgt = a[2]; if (b == "pushd" && (substr(a[2], 1, 1) == "+" || a[2] ~ /^[0-9]*[<>]/)) cdtgt = "-" }
    else cdtgt = (b == "pushd") ? "-" : ""
    return 2
  }
  if (b == "rm") {
    if (!altsdef || index(s, ".git")) return 1
    k = split(s, a, " ")
    for (i = 2; i <= k; i++) if (index(a[i], "r") || index(a[i], "R") || index(a[i], ".") || index(a[i], "/")) return 1
    return 0
  }
  if (b == "gh") return (index(s, "merge") || index(s, "api") || index(s, "create") || index(s, "new")) ? 1 : 0
  if (b in LK) return 1
  if (b in PY || b ~ /^python[0-9]/) return pytag ? 3 : !pyinert
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
    if (nw > 0 && md == 1) return
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
        if (c == "\n" || c == ";" || c == "|") { fsg(); continue }
        if (c == "&") {
          if (substr(ch, i, 1) == ">" || substr(wb, length(wb), 1) == ">") { wb = wb c; continue }
          fsg(); continue
        }
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
  n = split("if then elif else do while until ! { ( builtin eval env sudo command exec nice nohup xargs timeout time bash sh zsh dash agent-harness agent-harness.sh worktree-rm.sh teardown-merged-worktree.sh ship-init.sh ship-merge.sh cleanup.sh orca rm mv trash rsync find cd pushd gh direnv tee cp ln install truncate touch sed dd sponge", ps, " ")
  for (i = 1; i <= n; i++) LK[ps[i]] = 1
  n = split("push reset branch update-ref send-pack commit checkout restore config worktree remote", ps, " ")
  for (i = 1; i <= n; i++) GD[ps[i]] = 1
  n = split("python perl node ruby", ps, " ")
  for (i = 1; i <= n; i++) PY[ps[i]] = 1
  ASG = "^[A-Za-z_][A-Za-z0-9_]*="
  SEGSPECIAL = "[\047\"`;&|$]"
  PLAINX = "[\047\"`;&|$>\\\\]"
  isseg = (mode == "seg"); islit = (mode == "lit"); isboth = (mode == "both"); islex = (mode == "lex"); isbody = (mode == "body")
  lexprint = islex
  for (k in LK) ALLB[k] = 1
  for (k in PY) ALLB[k] = 1
  ALLB["git"] = 1; ALLB["gh"] = 1; ALLB["rm"] = 1; ALLB["cd"] = 1; ALLB["pushd"] = 1; ALLB["popd"] = 1
  SPECIAL = "[\\\\\047\"\n\037/={]"
  CH = 512; SQ = "\047"; US = "\037"; RSEP = "\036"; DQ = "\""; BS = "\\"; q = 0; ex = 0; nk = 0; ns = 0; lbuf = ""; prevc = ""; bs = 0; prevtxt = ""; ncb = 0; ORS = ""
  lq = 0; xl = ""; bq = 0; hd_n = 0; hd_i = 1; ncmd = 0 }
isbody { bodyrec($0); next }
islex { lexfeed($0); next }
isseg { segemit($0); next }
islit { acc = (NR > 1) ? acc "\n" $0 : $0; next }
{
  if (isboth) {
    if (hv) { scanrec(prev, 1); hv = 0 }
    if ((q == 1 || q == 2) && nw > 0 && md == 1 && $0 !~ PLAINX && plainq($0)) next
    lexfeed($0)
  }
  if (hv) { if (mode == "join") joinrec(prev, 1); else scanrec(prev, 1) }
  prev = $0; hv = 1
}
END {
  if (isbody) { print US "BODYEND"; exit }
  if (islex) { lexflush(); print US "NCMD " ncmd "\n" US "LEXEND\n"; exit }
  if (mode == "lit") { print stripnl(lit(acc)) "\n" US "LEND\n"; exit }
  if (hv) { if (mode == "join") joinrec(prev, 0); else scanrec(prev, 0) }
  if (mode == "join") print "\n" US "JEND"
  if (mode == "scan") { fsg(); cdflush(); print US "SCANEND\n" }
  if (mode == "both") { fsg(); cdflush(); print US "SCANEND\n" }
  if (mode == "both" && lq != 0) lexflush()
  if (mode == "both" || mode == "seg") {
    for (i = 1; i <= ns; i++) print sg[i] "\n"
    if (mode == "both") print US "NCMD " ncmd "\n"
    print US "SEND\n"
  }
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
  local i="$1" w gdir="$cwd" sub="" sub_u=0 opt_u=0 c_exp=0 opt val
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
        if [ "${exp_f[$i]}" = 1 ] || [ "${brace_f[$i]}" = 1 ]; then
          if [ "$opt" = -C ]; then c_exp=1; else opt_u=1; fi
          i=$((i + 1)); continue
        fi
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
  if [ "$c_exp" = 1 ] && { [ "$sub" = worktree ] || { [ "$AUTO" = 1 ] && ! git_ro "$sub"; }; }; then deny_unparsed; fi
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
  local saved_cd="${CD_BASE:-}"
  sr_sync
  [ -n "$SR_CD" ] && CD_BASE="$SR_CD"
  check_gh "${lit[@]}"
  CD_BASE="$saved_cd"
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
    if [[ "$w" =~ ^[A-Za-z_][A-Za-z0-9_]*= ]]; then note_assign_idx "$i"; i=$((i + 1)); continue; fi
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
      elif [ "$tu" = 1 ] || [[ "$tgt" == -* ]] || { [ "$b" = pushd ] && { [ $((i + 1)) -ge "${#words[@]}" ] || [[ "$tgt" == +* || "$tgt" =~ ^[0-9]*[\<\>] ]]; }; }; then SR_CD="?"; SR_PEND=(); SR_VER=$((SR_VER + 1))
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

# awk output reaches bash as one string split in memory: a read loop costs a syscall per line, which is
# slow under MSYS2, and a pipe is read one byte at a time.
gg_lines() { local IFS=$'\n'; set -f; GGL=($1); LI=0; }

command -v awk >/dev/null 2>&1 || deny_unparsed
# A heredoc body is data, not a command. Quoted bodies are literal. Unquoted bodies still run $(...) and backticks.
if [[ "$cmd" == *'<<'* ]]; then
  cmd="$(LC_ALL=C awk -v mode=body "$GG_AWK" <<<"$cmd")" || deny_unparsed
  [[ "$cmd" == *$'\n\037BODYEND' ]] || deny_unparsed
  cmd="${cmd%$'\n\037BODYEND'}"
fi
# A quoted span longer than qmax is data. Short quotes stay byte for byte.
# $(...), backticks, and backslash escapes stay so a hidden push is still checked.
# One index scan per plain run; the char walker never sees the body.
if [[ "$cmd" == *\"* || "$cmd" == *\'* ]]; then
  GG_SQUASH='
function note_needles(s) {
  if (index(s, ".claude/") || index(s, ".github/") || index(s, ".opencode/") || index(s, "goal.json") || index(s, "autonomy.on") || index(s, "opencode.jsonc") || index(s, "AGENTS.md") || index(s, "CLAUDE.md") || index(s, "agents.md") || index(s, "claude.md") || index(s, ".envrc") || index(s, "tools/agent-harness/") || index(s, "tools/ci/")) qprot = 1
  if ((index(s, "rmtree") || index(s, "rm_rf") || index(s, "rmSync") || index(s, "remove_tree") || index(s, "rmdir")) && (index(s, "worktree") || index(s, "/orca/workspaces/"))) qpy = 1
}
function quote_marker(   m) {
  m = ""
  if (qprot) m = ".claude/state/goal.json"
  if (qpy) {
    if (m != "") m = m " "
    m = m "rmtree /orca/workspaces/worktree"
  }
  if (m == "") m = "x"
  return m
}
function become_big() {
  if (qbig) return
  qbig = 1
  if (held_raw && held != "") printf "%s", held
  held = ""; held_raw = 0; need_mark = 1
}
function note_plain(s,   n) {
  n = length(s)
  if (n == 0) return
  if (index(s, ".") || index(s, "/") || index(s, "r") || index(s, "w")) note_needles(s)
  if (qbig) { need_mark = 1; return }
  if (qlen + n > qmax) { become_big(); return }
  held = held s; qlen += n
}
function keep_raw(s,   n) {
  n = length(s)
  if (n == 0) return
  if (qbig) { printf "%s", s; return }
  if (qlen + n > qmax) {
    if (held != "") printf "%s", held
    held = ""; held_raw = 0; qbig = 1; qlen = qmax + 1
    printf "%s", s
    return
  }
  held = held s; held_raw = 1; qlen += n
}
function emit_close(ch) {
  if (!qbig) printf "%s", held
  else if (need_mark || qprot || qpy) printf "%s", quote_marker()
  printf "%s", ch
  q = 0; qlen = 0; qbig = 0; qprot = 0; qpy = 0; held = ""; held_raw = 0; need_mark = 0
}
function eat_sq(   k) {
  k = index(rest, SQ)
  if (k == 0) { note_plain(rest); rest = ""; return }
  if (k > 1) note_plain(substr(rest, 1, k - 1))
  emit_close(SQ)
  rest = substr(rest, k + 1)
}
function dq_special(s,   a, b, c, d, m) {
  m = 0
  a = index(s, "\\"); if (a && (m == 0 || a < m)) m = a
  b = index(s, "$"); if (b && (m == 0 || b < m)) m = b
  c = index(s, "`"); if (c && (m == 0 || c < m)) m = c
  d = index(s, DQ); if (d && (m == 0 || d < m)) m = d
  return m
}
function eat_dq(   k, c, j, depth, n, inner) {
  while (rest != "") {
    k = dq_special(rest)
    if (k == 0) { note_plain(rest); rest = ""; return }
    if (k > 1) note_plain(substr(rest, 1, k - 1))
    c = substr(rest, k, 1)
    if (c == DQ) { emit_close(DQ); rest = substr(rest, k + 1); return }
    if (c == "\\") {
      if (k >= length(rest)) { keep_raw("\\"); rest = ""; return }
      keep_raw(substr(rest, k, 2))
      rest = substr(rest, k + 2)
      continue
    }
    if (c == "`") {
      inner = substr(rest, k + 1)
      j = index(inner, "`")
      if (j == 0) { keep_raw(substr(rest, k)); rest = ""; return }
      keep_raw(substr(rest, k, j + 1))
      rest = substr(rest, k + j + 1)
      continue
    }
    if (substr(rest, k + 1, 1) == "(") {
      depth = 1; n = length(rest); j = k + 2
      while (j <= n && depth > 0) {
        c = substr(rest, j, 1)
        if (c == "(") depth++
        else if (c == ")") depth--
        j++
      }
      keep_raw(substr(rest, k, j - k))
      rest = substr(rest, j)
      continue
    }
    keep_raw("$")
    rest = substr(rest, k + 1)
  }
}
BEGIN { SQ = "\047"; DQ = "\""; q = 0; if (!qmax) qmax = 4096 }
{
  rest = $0
  cont = 1
  while (cont) {
    cont = 0
    if (q == 1 || q == 2) {
      if (q == 1) eat_sq(); else eat_dq()
      if (q != 0) { note_plain("\n"); break }
      if (rest == "") { printf "\n"; break }
      cont = 1
      continue
    }
    is = index(rest, SQ); id = index(rest, DQ)
    if (is == 0 && id == 0) { printf "%s\n", rest; break }
    if (id == 0 || (is && is < id)) { k = is; q = 1 }
    else { k = id; q = 2 }
    printf "%s", substr(rest, 1, k)
    rest = substr(rest, k + 1)
    cont = 1
  }
}
END {
  if (q != 0) {
    if (!qbig) printf "%s", held
    else if (need_mark || qprot || qpy) printf "%s", quote_marker()
  }
  printf "\037SQUASHEND\n"
}
'
  squashed="$(LC_ALL=C awk -v qmax=4096 "$GG_SQUASH" <<<"$cmd")" || deny_unparsed
  squashed="${squashed%$'\n'}"
  [[ "$squashed" == *$'\037SQUASHEND' ]] || deny_unparsed
  cmd="${squashed%$'\037SQUASHEND'}"
  cmd="${cmd%$'\n'}"
fi
if [[ "$cmd" == *\\* ]]; then
  cmd="$(LC_ALL=C awk -v mode=join "$GG_AWK" <<<"$cmd")" || deny_unparsed
  [[ "$cmd" == *$'\n\037JEND' ]] || deny_unparsed
  cmd="${cmd%$'\n\037JEND'}"
  [ -n "$cmd" ] || deny_unparsed
fi
words=(); exp_f=(); brace_f=(); lit_f=(); litb_f=(); litv_f=()
P_GIT_DIR=""; P_GIT_WT=""; P_GIT_CFG=0
SR_CD=""
pushfast=1
case "$BASE_A$BASE_B" in *\\* | *\"* | *\'* | *$'\n'*) pushfast=0 ;; esac
gate_on && pushfast=0
merged=0
if [[ "$cmd" != *\\* ]]; then
  # One awk pass yields the quote-aware scan and the legacy segments. Splits stay outside quotes,
  # and >& / &> stay one token so a redirection is not a ref.
  merged=1
  both_out="$(LC_ALL=C awk -v mode=both -v pytag=1 -v win="$WIN" -v altsdef="$ALTS_DEFAULT" -v pushfast="$pushfast" -v basea="$BASE_A" -v baseb="$BASE_B" "$GG_AWK" <<<"$cmd")" || deny_unparsed
  gg_lines "$both_out"
else
  scan_out="$(LC_ALL=C awk -v mode=scan -v win="$WIN" -v pushfast="$pushfast" -v basea="$BASE_A" -v baseb="$BASE_B" "$GG_AWK" <<<"$cmd")" || deny_unparsed
  gg_lines "$scan_out"
fi
gg_mark awk
scan_ended=0
nlines=${#GGL[@]}
SK_CD=-1 SK_DIR="" SK_WT="" SK_CFG=""
while [ "$LI" -lt "$nlines" ]; do
  rec_h="${GGL[LI]}"; LI=$((LI + 1))
  case "$rec_h" in
    $'\037SCANEND') scan_ended=1; break ;;
    c)
      c_kind="${GGL[LI]}"; c_val="${GGL[LI + 1]#x}"; LI=$((LI + 2))
      screen_cd "$c_kind" "$c_val"
      continue ;;
    r)
      if [ "$SR_VER" = "$SK_CD" ] && [ "$P_GIT_DIR" = "$SK_DIR" ] && [ "$P_GIT_WT" = "$SK_WT" ] && [ "$P_GIT_CFG" = "$SK_CFG" ]; then continue; fi ;;
    *)
      IFS=$'\037'
      words=(${GGL[LI]}); exp_f=(${GGL[LI + 1]}); brace_f=(${GGL[LI + 2]})
      lit_f=(${GGL[LI + 3]}); litb_f=(${GGL[LI + 4]}); litv_f=(${GGL[LI + 5]})
      IFS=$' \t\n'
      LI=$((LI + 6))
      [ "${#words[@]}" -gt 0 ] && unset "words[$((${#words[@]} - 1))]"
      if [ "$rec_h" = 1 ]; then
        for ((rec_k = 0; rec_k < ${#words[@]}; rec_k++)); do
          printf -v rec_t '%b' "${words[rec_k]}"; words[rec_k]=$rec_t
          printf -v rec_t '%b' "${lit_f[rec_k]}"; lit_f[rec_k]=$rec_t
          printf -v rec_t '%b' "${litb_f[rec_k]}"; litb_f[rec_k]=$rec_t
          printf -v rec_t '%b' "${litv_f[rec_k]}"; litv_f[rec_k]=$rec_t
        done
      fi ;;
  esac
  SK_CD="$SR_VER" SK_DIR="$P_GIT_DIR" SK_WT="$P_GIT_WT" SK_CFG="$P_GIT_CFG"
  screen_segment
done
[ "$scan_ended" = 1 ] || deny_unparsed
gg_mark scan_loop

if [[ "$cmd" == *agent-harness* ]] && { [ "$AUTO" = 1 ] || [[ "$cmd" =~ worktree-rm|teardown-merged-worktree|ship-init ]]; }; then
  unquoted="$(tr -d "'\"" <<<"$cmd")"
  grep -Eq "$HARNESS_ENV_RE" <<<"$unquoted" && deny_harness_env
  grep -Eq "$HARNESS_FUNC_RE" <<<"$unquoted" && deny_harness_env
  grep -Eq "$HARNESS_SOURCE_RE" <<<"$unquoted" && deny_harness_env
fi
if [[ "$cmd" == *worktree-rm* ]] && grep -Eq '(^|[^[:alnum:]_])(export|declare +-x|set +-a)( |$)' <<<"$cmd"; then deny_worktree; fi
[[ "$cmd" == *--confirmed* && "$cmd" == *worktree-rm* ]] && ASKED_WT=1

ncmd_all=0
if [ "$merged" = 0 ]; then
legacy_cmd="$cmd"
# Inside quotes a backslash in a Windows path is literal, so the legacy tokenizer reads it as a separator.
[ "$WIN" = 1 ] && legacy_cmd="$(sed -E 's#\\([^"\\ $`'"'"'])#/\1#g' <<<"$cmd")"
segments="$(LC_ALL=C awk -v mode=lex "$GG_AWK" <<<"$legacy_cmd")" || deny_unparsed
[[ "$segments" == *$'\n\037LEXEND' ]] || deny_unparsed
segments="${segments%$'\n\037LEXEND'}"
ncmd_all=0
if [[ "$segments" == *$'\037NCMD '* ]]; then
  ncmd_all="${segments##*$'\037NCMD '}"
  ncmd_all="${ncmd_all%%$'\n'*}"
  segments="${segments%%$'\037NCMD '*}"
fi
pyinert=0
if [[ "$segments" != *python* && "$segments" != *perl* && "$segments" != *node* && "$segments" != *ruby* ]]; then
  pyinert=1
else
  ensure_pyrm
  [ "$AUTO" = 1 ] && ensure_loose
  [ "$PYRM_HIT" = 0 ] && { [ "$AUTO" = 0 ] || [ "$LOOSE_HIT" = 0 ]; } && pyinert=1
fi
segments="$(LC_ALL=C awk -v mode=seg -v win="$WIN" -v altsdef="$ALTS_DEFAULT" -v pyinert="$pyinert" -v pushfast="$pushfast" -v basea="$BASE_A" -v baseb="$BASE_B" "$GG_AWK" <<<"$segments")" || deny_unparsed
gg_lines "$segments"
fi
PSEG=""; PIN=""; PYI=""
seg_ended=0
segs=0
life=0
nlines=${#GGL[@]}
while [ "$LI" -lt "$nlines" ]; do
  seg="${GGL[LI]}"; LI=$((LI + 1))
  case "$seg" in
    $'\037SEND') seg_ended=1; break ;;
    $'\037NCMD '*) ncmd_all="${seg#*$'\037NCMD '}"; continue ;;
    $'\036'*)
      if [ -z "$PYI" ]; then
        ensure_pyrm
        [ "$AUTO" = 1 ] && ensure_loose
        PYI=0
        [ "$PYRM_HIT" = 0 ] && { [ "$AUTO" = 0 ] || [ "$LOOSE_HIT" = 0 ]; } && PYI=1
      fi
      [ "$PYI" = 1 ] && continue
      seg="${seg#?}"
      case "$seg" in $'\034'* | $'\035'*) seg="${seg#?}" ;; esac ;;
    $'\034'*) legacy_cd "${seg#?}"; continue ;;
    $'\035'*) seg="${seg#?}" ;;
  esac
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
  strip_redir_args "${toks[@]}"
  toks=()
  [ "${#GG_ARGS[@]}" -gt 0 ] && toks=("${GG_ARGS[@]}")
  [ "${#toks[@]}" -gt 0 ] || continue

  i=0 has_assign=0 XARGS=0 pref=0 shell_c=0
  GIT_DIR_VAL="" GIT_WT_VAL="" GIT_CFG_RISK=0 GIT_ENV_U=0 SAW_LOC=0
  GIT_LOC=()
  while [ "$i" -lt "${#toks[@]}" ]; do
    t="${toks[$i]}"; b="${t##*/}"
    if [ "$WIN" = 1 ]; then lc "$b"; b="${LCV%.exe}"; fi
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
      shell_c=1
      i=$((j + 1))
    else break
    fi
  done
  ct=("${toks[@]:$i}")
  [ "${#ct[@]}" -gt 0 ] || continue
  if queue_shell_script; then continue; fi
  RAW0="${ct[0]}"
  c0="${ct[0]##*/}"
  if [ "$WIN" = 1 ]; then lc "$c0"; c0="${LCV%.exe}"; fi
  ct[0]="$c0"
  segs=$((segs + 1))
  case "$c0" in
    agent-harness | agent-harness.sh)
      case "${ct[1]:-}" in ship-init | teardown-merged-worktree) life=1 ;; esac ;;
    ship-init.sh | teardown-merged-worktree.sh) life=1 ;;
  esac

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
    cd) legacy_cd "${ct[1]:-}"; continue ;;
    pushd)
      case "${ct[1]:-}" in "" | +* | [0-9]\>* | \>* | \<*) legacy_cd "-" ;; *) legacy_cd "${ct[1]}" ;; esac
      continue ;;
    popd) legacy_cd "-"; continue ;;
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
    direnv)
      for a in "${ct[@]:1}"; do
        case "$a" in allow | permit | grant | edit) deny_review "direnv allow and edit approve .envrc, which then runs code inside the harness: a human must approve it." ;; esac
      done ;;
    tee | sponge | mv | cp | rm | ln | install | truncate | touch | rsync) any_protected "${ct[@]:1}" && deny ;;
    sed)
      for a in "${ct[@]:1}"; do
        if [[ "$a" =~ ^-[A-Za-z]*i || "$a" = --in-place* ]]; then any_protected "${ct[@]:1}" && deny; break; fi
      done ;;
    dd) any_protected "${ct[@]:1}" && deny ;;
    python | python[0-9]* | perl | node | ruby) interpreter_inline_hits_protected "${ct[@]:1}" && deny ;;
  esac
done
[ "$life" = 1 ] && { [ "$segs" -gt 1 ] || [ "${ncmd_all:-0}" -gt 1 ]; } && deny_harness_cmd
[ "$seg_ended" = 1 ] || deny_unparsed
gg_mark legacy_loop

[ "$ASKED_WT" = 1 ] && emit ask "worktree-rm --confirmed removes a worktree: confirm the human named this removal."
[ "$ASKED" = 1 ] && emit ask "ship-merge --confirmed merges with autonomy rails relaxed and deletes the merged branch: confirm with the user."
exit 0
