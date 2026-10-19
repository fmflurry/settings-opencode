#!/usr/bin/env bash
# shellcheck disable=SC2016
set -uo pipefail
# A native jq.exe ends lines with CRLF, which would break every string comparison below.
case "${OSTYPE:-}" in msys* | cygwin* | win32*) jq() { command jq "$@" | tr -d '\r'; } ;; esac
# Only the jq calls that build hook input skip MSYS path conversion; native git needs it for /tmp paths.
jqn() { MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='*' jq "$@"; }
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
FX="$TMP/fx"; mkdir -p "$FX" "$TMP/state" "$TMP/proj/.claude"
pass=0; failn=0
ok() { pass=$((pass + 1)); }
bad() { failn=$((failn + 1)); echo "FAIL: $*"; }
check() { local name="$1"; shift; if "$@"; then ok; else bad "$name"; fi; }

cat >"$TMP/gh" <<'STUB'
#!/usr/bin/env bash
echo "$*" >>"$FX/gh.log"
case "$*" in
  *defaultBranchRef*)
    b="$(cat "$FX/default_branch" 2>/dev/null || echo master)"
    case "$*" in
      *" -q "* | *--jq*) echo "$b" ;;
      *) jq -n --arg b "$b" '{defaultBranchRef:{name:$b}}' ;;
    esac ;;
  "pr view"*) cat "$FX/view.json" ;;
  "pr merge"*)
    [ -e "$FX/merge.noop" ] || { jq '.state="MERGED"' "$FX/view.json" >"$FX/t" && mv "$FX/t" "$FX/view.json"; }
    exit "$(cat "$FX/merge.rc" 2>/dev/null || echo 0)" ;;
  "pr ready"*) ;;
  "pr list"*)
    [ -e "$FX/list.fail" ] && exit 1
    base=""; head=""; expr=""; set -- $*
    while [ $# -gt 0 ]; do case "$1" in --base) base="$2";; --head) head="$2";; -q|--jq) expr="$2";; esac; shift; done
    list="$(jq -c --arg b "$base" --arg h "$head" 'map(select(($b==""or .baseRefName==$b) and ($h==""or .headRefName==$h)))' "$FX/open_prs.json" 2>/dev/null || echo '[]')"
    if [ -n "$expr" ]; then echo "$list" | jq -r "$expr"; else echo "$list"; fi ;;
  "api repos/o/r/branches/"*)
    [ -e "$FX/branch.gone" ] && { echo "gh: Not Found (HTTP 404)" >&2; exit 1; }
    [ -e "$FX/branch.err" ] && { echo "gh: Bad Gateway (HTTP 502)" >&2; exit 1; }
    body="$(cat "$FX/branch.json" 2>/dev/null || jq -c '{protected:false,commit:{sha:.headRefOid}}' "$FX/view.json")"
    expr=""; set -- $*
    while [ $# -gt 0 ]; do case "$1" in -q|--jq) expr="$2";; esac; shift; done
    if [ -n "$expr" ]; then echo "$body" | jq -r "$expr"; else echo "$body"; fi ;;
  "repo view"*) echo "o/r" ;;
  "api repos/o/r --jq"*) cat "$FX/merge_settings.txt" 2>/dev/null || echo "true true true" ;;
  *check-runs*) jq -c '.[]' "$FX/checks.json" ;;
  *statuses*) jq -c '.[]' "$FX/statuses.json" ;;
  *compare*) cat "$FX/behind.txt" ;;
  "api graphql"*) cat "$FX/threads.json" ;;
  *) ;;
esac
STUB
cat >"$TMP/orca" <<'STUB'
#!/usr/bin/env bash
echo "$*" >>"$FX/orca.log"
STUB
chmod +x "$TMP/gh" "$TMP/orca"

H="$HERE/scripts/agent-harness"; HOOKS="$HERE/.claude/hooks"
CFG="$TMP/proj/.claude/agent-harness.json"
export FX GH_BIN="$TMP/gh" ORCA_BIN="$TMP/orca" AGENT_STATE_DIR="$TMP/state" CLAUDE_PROJECT_DIR="$TMP/proj" AGENT_HARNESS_DIR="$H" AGENT_HARNESS_TEST=1
unset ORCA_WORKTREE_ID GITHUB_ACTIONS TLTB_STATE_DIR
reset() { rm -f "$FX"/*.log "$FX"/merge.* "$FX"/merge_settings.txt "$FX"/open_prs.json "$FX"/branch.json "$FX"/branch.gone "$FX"/branch.err "$FX"/list.fail "$FX"/default_branch "$TMP/state"/* "$CFG"; }
flag_on() { : >"$TMP/state/autonomy.on"; }
cfg_ci() { echo '{"base":"master","requiredChecks":["gate","export"],"reviewStatus":"tltb-review","reviewStatusCreator":"github-actions[bot]"}' >"$CFG"; }

git init -q --bare "$TMP/origin.git"
git clone -q "$TMP/origin.git" "$TMP/work" 2>/dev/null
( cd "$TMP/work" && git config user.email t@t && git config user.name t && git checkout -q -b master \
  && echo a >a && git add a && git commit -qm A && git push -q origin master \
  && git checkout -q -b feat && echo b >b && git add b && git commit -qm B ) >/dev/null 2>&1
HEAD_SHA="$(git -C "$TMP/work" rev-parse HEAD)"

green_fixtures() {
  jq -n --arg h "$HEAD_SHA" '{state:"OPEN",baseRefName:"master",isDraft:false,headRefOid:$h,headRefName:"feat",isCrossRepository:false,files:[{path:"client/a.gd"},{path:"docs/notes.md"}]}' >"$FX/view.json"
  echo '[{"name":"gate","status":"completed","conclusion":"success","app":{"slug":"github-actions"}},{"name":"export","status":"completed","conclusion":"success","app":{"slug":"github-actions"}},{"name":"lint","status":"completed","conclusion":"skipped","app":{"slug":"github-actions"}}]' >"$FX/checks.json"
  echo '[{"id":2,"context":"tltb-review","state":"success","creator":{"login":"github-actions[bot]"}},{"id":1,"context":"tltb-review","state":"failure","creator":{"login":"github-actions[bot]"}}]' >"$FX/statuses.json"
  echo '{"data":{"repository":{"pullRequest":{"reviewThreads":{"pageInfo":{"hasNextPage":false},"nodes":[{"isResolved":true}]}}}}}' >"$FX/threads.json"
  echo 0 >"$FX/behind.txt"
}
mutate() { jq "$1" "$FX/$2" >"$FX/t" && mv "$FX/t" "$FX/$2"; }

ONLY="${RUN_ONLY:-}"
GUARD_BASH="${GUARD_BASH:-bash}"
EMPTY_JSON='{}'
fresh_work() {
  ( cd "$TMP/work" && git worktree prune && git checkout -q -f master && git reset -q --hard origin/master \
    && git branch -q --set-upstream-to=origin/master master \
    && { git branch -q -D feat || true; } \
    && for b in $(git for-each-ref --format='%(refname:short)' refs/heads/backup); do git branch -q -D "$b"; done \
    && git checkout -q -b feat && echo "b$RANDOM" >b && git add b && git commit -qm B ) >/dev/null 2>&1
  HEAD_SHA="$(git -C "$TMP/work" rev-parse HEAD)"
}

if [ "$ONLY" != guard ]; then
# ---- dispatcher
DISP="$H/agent-harness.sh"
DREPO="$TMP/disp"; git init -q "$DREPO"
disp() { ( cd "$DREPO" && env -u AGENT_STATE_DIR -u CLAUDE_PROJECT_DIR bash "$DISP" "$@" ); }
check "dispatcher: autonomy status prints off in fresh repo" test "$(disp autonomy status 2>&1)" = "autonomy: off"
out="$(disp bogus 2>&1)"; rc=$?
check "dispatcher: unknown subcommand exits non-zero" test $rc -ne 0
check "dispatcher: unknown subcommand prints usage" grep -qi 'usage' <<<"$out"
disp >/dev/null 2>&1; check "dispatcher: no args exits non-zero" test $? -ne 0
disp goal set "via dispatcher" >/dev/null 2>&1
check "dispatcher: goal forwards to goal.sh" grep -q 'via dispatcher' "$DREPO/.claude/state/goal.json"
out="$(disp ship-merge 5 2>&1)"; rc=$?
check "dispatcher: ship-merge forwards (refuses with flag off)" test $rc -ne 0
check "dispatcher: ship-merge output comes from ship-merge.sh" grep -q 'ship-merge refused' <<<"$out"
reset
ORCA_WORKTREE_ID='repo::/p' disp notify "done" "merged" 7 >/dev/null 2>&1
check "dispatcher: notify forwards to notify.sh" grep -q -- 'done: merged' "$FX/orca.log"

# ---- state dir resolution
reset
SDR="$TMP/sdrepo"; git init -q "$SDR"; mkdir -p "$SDR/sub/dir"
( cd "$SDR/sub/dir" && env -u AGENT_STATE_DIR -u CLAUDE_PROJECT_DIR bash "$H/goal.sh" set g1 )
check "state dir: git toplevel when no CLAUDE_PROJECT_DIR" test -f "$SDR/.claude/state/goal.json"
NOGIT="$TMP/nogit"; mkdir -p "$NOGIT"
( cd "$NOGIT" && env -u AGENT_STATE_DIR -u CLAUDE_PROJECT_DIR GIT_CEILING_DIRECTORIES="$TMP" bash "$H/goal.sh" set g2 )
check "state dir: cwd when not in git and no CLAUDE_PROJECT_DIR" test -f "$NOGIT/.claude/state/goal.json"
( cd "$SDR" && env -u AGENT_STATE_DIR CLAUDE_PROJECT_DIR="$TMP/proj" bash "$H/goal.sh" set g3 )
check "state dir: CLAUDE_PROJECT_DIR beats git toplevel" test -f "$TMP/proj/.claude/state/goal.json"
rm -rf "$TMP/proj/.claude/state"
( env -u AGENT_STATE_DIR TLTB_STATE_DIR="$TMP/legacy" bash "$H/goal.sh" set g4 )
check "state dir: TLTB_STATE_DIR honoured as fallback" test -f "$TMP/legacy/goal.json"
( AGENT_STATE_DIR="$TMP/primary" TLTB_STATE_DIR="$TMP/legacy2" bash "$H/goal.sh" set g5 )
check "state dir: AGENT_STATE_DIR wins over TLTB_STATE_DIR" test -f "$TMP/primary/goal.json"
check "state dir: legacy dir untouched when AGENT_STATE_DIR set" test ! -e "$TMP/legacy2/goal.json"
( AGENT_STATE_DIR="$TMP/ctxdir" bash "$H/autonomy.sh" on ) >/dev/null
out="$(AGENT_STATE_DIR="$TMP/ctxdir" bash "$HOOKS/autonomy-context.sh" </dev/null)"
check "state dir: hooks honour AGENT_STATE_DIR" grep -q 'AUTONOMOUS MODE ON' <<<"$out"
out="$(env -u AGENT_STATE_DIR TLTB_STATE_DIR="$TMP/ctxdir" bash "$HOOKS/autonomy-context.sh" </dev/null)"
check "state dir: hooks honour TLTB_STATE_DIR fallback" grep -q 'AUTONOMOUS MODE ON' <<<"$out"

# ---- env overrides are honoured only under AGENT_HARNESS_TEST=1
SDR2="$TMP/sdrepo2"; git init -q "$SDR2"
( cd "$SDR2" && env -u CLAUDE_PROJECT_DIR -u AGENT_HARNESS_TEST AGENT_STATE_DIR="$TMP/ign1" bash "$H/goal.sh" set gx )
check "env gate: AGENT_STATE_DIR ignored without AGENT_HARNESS_TEST" test ! -e "$TMP/ign1/goal.json"
check "env gate: falls back to project state dir" test -f "$SDR2/.claude/state/goal.json"
rm -rf "$SDR2/.claude/state"
( cd "$SDR2" && env -u CLAUDE_PROJECT_DIR -u AGENT_STATE_DIR -u AGENT_HARNESS_TEST TLTB_STATE_DIR="$TMP/ign2" bash "$H/goal.sh" set gy )
check "env gate: TLTB_STATE_DIR ignored without AGENT_HARNESS_TEST" test ! -e "$TMP/ign2/goal.json"
out="$(cd "$NOGIT" && env -u AGENT_HARNESS_TEST CLAUDE_PROJECT_DIR="$NOGIT" AGENT_STATE_DIR="$TMP/ctxdir" bash "$HOOKS/autonomy-context.sh" </dev/null)"
check "env gate: hooks ignore AGENT_STATE_DIR without AGENT_HARNESS_TEST" test -z "$out"
reset; green_fixtures; flag_on; cfg_ci
( cd "$TMP/work" && env -u AGENT_HARNESS_TEST bash "$H/ship-merge.sh" 5 ) >/dev/null 2>&1; rc=$?
check "env gate: ship-merge ignores GH_BIN without AGENT_HARNESS_TEST (refuses)" test $rc -ne 0
check "env gate: stub gh never called without AGENT_HARNESS_TEST" test ! -e "$FX/gh.log"

# ---- autonomy on: git exclude
excl() { local n; n="$(grep -Fxc '.claude/state/' "$1/.git/info/exclude" 2>/dev/null || true)"; echo "${n:-0}"; }
auto_in() { ( cd "$1" && env -u AGENT_STATE_DIR -u TLTB_STATE_DIR CLAUDE_PROJECT_DIR="$1" bash "$H/autonomy.sh" "${@:2}" ); }
EX="$TMP/ex"; git init -q "$EX"
auto_in "$EX" on >/dev/null
check "autonomy on: creates flag under project state" test -f "$EX/.claude/state/autonomy.on"
check "autonomy on: adds .claude/state/ to .git/info/exclude" test "$(excl "$EX")" = 1
auto_in "$EX" on >/dev/null
check "autonomy on: exclude entry is idempotent" test "$(excl "$EX")" = 1
EX2="$TMP/ex2"; git init -q "$EX2"; echo '.claude/state/' >"$EX2/.gitignore"
auto_in "$EX2" on >/dev/null
check "autonomy on: leaves exclude alone when already ignored" test "$(excl "$EX2")" = 0
PLAIN="$TMP/plain"; mkdir -p "$PLAIN"
( cd "$PLAIN" && env -u AGENT_STATE_DIR GIT_CEILING_DIRECTORIES="$TMP" CLAUDE_PROJECT_DIR="$PLAIN" bash "$H/autonomy.sh" on ) >/dev/null 2>&1
check "autonomy on: works outside a git repo" test -f "$PLAIN/.claude/state/autonomy.on"
auto_in "$EX" off >/dev/null
check "autonomy off removes flag" test ! -e "$EX/.claude/state/autonomy.on"

# ---- hooks are no-ops without a flag file
NOOP="$TMP/noop"; git init -q "$NOOP"
noop() {
  reset
  local out rc
  out="$(cd "$NOOP" && echo "$3" | env -u AGENT_STATE_DIR -u TLTB_STATE_DIR -u ORCA_WORKTREE_ID CLAUDE_PROJECT_DIR="$NOOP" bash "$HOOKS/$2" 2>/dev/null)"; rc=$?
  check "no-op without flag: $1 exits 0" test $rc -eq 0
  check "no-op without flag: $1 silent" test -z "$out"
  check "no-op without flag: $1 no notification" test ! -e "$FX/orca.log"
}
noop autonomy-context autonomy-context.sh '{}'
noop ask-guard autonomy-ask-guard.sh '{"tool_input":{"questions":[{"question":"Which?"}]}}'
noop git-guard autonomy-git-guard.sh '{"tool_input":{"command":"gh pr merge 1"}}'
noop stop-gate ship-stop-gate.sh '{"stop_hook_active":false}'
noop orca-notify orca-notify.sh '{"notification_type":"permission_prompt","message":"m"}'

# ---- ask-guard
reset
flag_on
out="$(echo '{"tool_input":{"questions":[{"question":"Which?"}]}}' | bash "$HOOKS/autonomy-ask-guard.sh")"
check "ask-guard denies when on" test "$(jq -r .hookSpecificOutput.permissionDecision <<<"$out")" = deny
rm -f "$TMP/state/autonomy.on"
out="$(echo '{"tool_input":{"questions":[{"question":"Which?"}]}}' | ORCA_WORKTREE_ID=repo::/p bash "$HOOKS/autonomy-ask-guard.sh")"
check "ask-guard silent when off" test -z "$out"
check "ask-guard notifies when off" grep -q -- 'question: Which?' "$FX/orca.log"

# ---- orca-notify hook
reset
echo '{"notification_type":"idle_prompt","message":"waiting on you"}' | ORCA_WORKTREE_ID=repo::/p bash "$HOOKS/orca-notify.sh"
check "orca-notify forwards idle_prompt as waiting" grep -q -- 'waiting: waiting on you' "$FX/orca.log"
reset
echo '{"notification_type":"permission_prompt","message":"needs approval"}' | ORCA_WORKTREE_ID=repo::/p bash "$HOOKS/orca-notify.sh"
check "orca-notify forwards permission_prompt as waiting" grep -q -- 'waiting: needs approval' "$FX/orca.log"
reset
echo '{"notification_type":"auth_success","message":"x"}' | ORCA_WORKTREE_ID=repo::/p bash "$HOOKS/orca-notify.sh"
check "orca-notify ignores other notification types" test ! -e "$FX/orca.log"

# ---- notify
reset
bash "$H/notify.sh" "done" "merged" 7
check "notify silent without ORCA_*" test ! -e "$FX/orca.log"
ORCA_WORKTREE_ID='repo::/p' bash "$H/notify.sh" "done" "merged" 7
check "notify targets id:" grep -q -- '--worktree id:repo::/p --unread --comment done: merged --workspace-status completed --pr 7' "$FX/orca.log"
ORCA_WORKTREE_ID='repo::/p' bash "$H/notify.sh" failure "boom"
check "notify failure is in-review" grep -q -- 'failure: boom --workspace-status in-review' "$FX/orca.log"

reset
GITHUB_ACTIONS=true GITHUB_STEP_SUMMARY="$TMP/summary.md" bash "$H/notify.sh" failure "boom"
check "notify writes step summary in Actions" grep -q '^\*\*failure\*\*: boom' "$TMP/summary.md"

# ---- autonomy-context
reset
out="$(bash "$HOOKS/autonomy-context.sh" </dev/null)"
check "autonomy-context silent when off" test -z "$out"
flag_on; bash "$H/goal.sh" set "ctx goal"
out="$(bash "$HOOKS/autonomy-context.sh" </dev/null)"
check "autonomy-context prints block when on" grep -q 'AUTONOMOUS MODE ON' <<<"$out"
check "autonomy-context prints goal" grep -q 'Goal: ctx goal' <<<"$out"

# ---- goal.sh
reset
bash "$H/goal.sh" set "ship it" "crit a" "crit b"
check "goal criteria array" test "$(jq '.criteria | length' "$TMP/state/goal.json")" = 2
check "goal default fix cap is 3" test "$(jq -r .max_fix_iterations "$TMP/state/goal.json")" = 3
jq '.max_fix_iterations = 2' "$TMP/state/goal.json" >"$TMP/g" && mv "$TMP/g" "$TMP/state/goal.json"
bash "$H/goal.sh" bump; check "bump within max" test $? -eq 0
ORCA_WORKTREE_ID='repo::/p' bash "$H/goal.sh" bump; rc=$?
check "bump past max exits 3" test $rc -eq 3
check "bump past max escalates" test "$(jq -r .status "$TMP/state/goal.json")" = escalated
check "bump past max notifies" grep -q 'failure:' "$FX/orca.log"
check "bump past max records reason" test "$(jq -r .reason "$TMP/state/goal.json")" = "fix iterations exhausted (2)"
reset
bash "$H/goal.sh" bump; check "bump with no goal file exits 0" test $? -eq 0
bash "$H/goal.sh" set g2
bash "$H/goal.sh" escalate "needs a human"; rc=$?
check "escalate exits 0" test $rc -eq 0
check "escalate sets status and reason" test "$(jq -r '.status + "|" + .reason' "$TMP/state/goal.json")" = "escalated|needs a human"

# ---- stop-gate
stop() { echo '{"stop_hook_active":false}' | bash "$HOOKS/ship-stop-gate.sh"; }
reset; green_fixtures
bash "$H/goal.sh" set g; bash "$H/goal.sh" pr 5
out="$(stop)"
check "stop-gate no-op when flag off" test -z "$out"
flag_on
mutate '.state="MERGED"' view.json
out="$(stop)"
check "stop-gate allows on MERGED" test -z "$out"
check "stop-gate marks done" test "$(jq -r .status "$TMP/state/goal.json")" = "done"

reset; green_fixtures; flag_on
bash "$H/goal.sh" set g; bash "$H/goal.sh" pr 5
out="$(stop)"
check "stop-gate blocks when PR not merged" test "$(jq -r .decision <<<"$out")" = block
check "stop-gate reason names ship-merge" grep -Eq 'ship-merge(\.sh)? 5' <<<"$out"

reset; green_fixtures; flag_on
bash "$H/goal.sh" set g; bash "$H/goal.sh" pr 5; bash "$H/goal.sh" sha "$HEAD_SHA"
for _ in 1 2 3 4; do out="$(stop)"; done
check "stop-gate still blocks at 4 no-progress" test "$(jq -r .decision <<<"$out")" = block
out="$(stop)"
check "stop-gate escalates after 5 no-progress" test -z "$out"
check "stop-gate escalated status" test "$(jq -r .status "$TMP/state/goal.json")" = escalated
check "stop-gate records reason" grep -q 'no progress after 5 stop blocks: PR #5 is not merged' "$TMP/state/goal.json"

reset; green_fixtures; flag_on
bash "$H/goal.sh" set g; bash "$H/goal.sh" pr 5
jq '.total_blocks = 29 | .stop_blocks = 0' "$TMP/state/goal.json" >"$TMP/g" && mv "$TMP/g" "$TMP/state/goal.json"
out="$(stop)"
check "stop-gate total cap escalates despite head change" test -z "$out"
check "stop-gate total cap reason" grep -q 'total stop blocks reached 30' "$TMP/state/goal.json"

reset; green_fixtures; flag_on
bash "$H/goal.sh" set g; bash "$H/goal.sh" pr 5; bash "$H/goal.sh" sha "$HEAD_SHA"
jq '.stop_blocks = 3' "$TMP/state/goal.json" >"$TMP/g" && mv "$TMP/g" "$TMP/state/goal.json"
mutate '.headRefOid="newhead"' view.json; stop >/dev/null
check "stop-gate keeps stop_blocks across head change" test "$(jq -r .stop_blocks "$TMP/state/goal.json")" = 3


# ---- ship-merge (configured: base master, required gate+export, tltb-review by the bot)
merge() { ( cd "$TMP/work" && bash "$H/ship-merge.sh" "$@" ) >"$FX/out" 2>&1; }
refuses() {
  local name="$1"; shift
  merge "$@"; local rc=$?
  check "ship-merge refuses: $name" test $rc -ne 0
  check "ship-merge no merge call: $name" bash -c '! grep -q "pr merge" "$1" 2>/dev/null' _ "$FX/gh.log"
}
fresh() { reset; fresh_work; green_fixtures; flag_on; cfg_ci; }

fresh; mutate 'map(select(.name != "gate"))' checks.json; refuses "required gate missing" 5
fresh; echo '[]' >"$FX/checks.json"; refuses "no checks" 5
fresh; mutate '(.[] | select(.name=="gate") | .conclusion) = "failure"' checks.json; refuses "gate failing" 5
fresh; mutate '(.[] | select(.name=="gate") | .status) = "in_progress"' checks.json; refuses "gate pending" 5
fresh; mutate '(.[] | select(.name=="export") | .conclusion) = "failure"' checks.json; refuses "export failing" 5
fresh; mutate '. + [{"name":"other","status":"queued","conclusion":null,"app":{"slug":"x"}}]' checks.json; refuses "other check pending" 5
fresh; mutate '. + [{"name":"other","status":"completed","conclusion":"failure","app":{"slug":"x"}}]' checks.json; refuses "other check failing" 5
fresh; mutate 'map(select(.context != "tltb-review"))' statuses.json; refuses "review status missing" 5
fresh; mutate '.[0].creator.login="fmflurry"' statuses.json; refuses "review status forged by human" 5
fresh; mutate '.[0].state="failure"' statuses.json; refuses "review status failing" 5
fresh; mutate '.[0].state="pending"' statuses.json; refuses "review status pending" 5
fresh; mutate '.data.repository.pullRequest.reviewThreads.nodes=[{"isResolved":false}]' threads.json; refuses "unresolved thread" 5
fresh; mutate '.data.repository.pullRequest.reviewThreads.pageInfo.hasNextPage=true' threads.json; refuses "thread pagination" 5
fresh; echo 3 >"$FX/behind.txt"; refuses "behind base" 5
fresh; mutate '.isDraft=true' view.json; refuses "draft" 5
fresh; rm -f "$TMP/state/autonomy.on"; refuses "flag off w/o --confirmed" 5
fresh; mutate '.baseRefName="develop"' view.json; refuses "PR base differs from configured base" 5
fresh; touch "$FX/merge.noop"; echo 1 >"$FX/merge.rc"; merge 5; rc=$?
check "ship-merge refuses when merge fails and PR stays open" test $rc -ne 0

fresh; bash "$H/goal.sh" set g; bash "$H/goal.sh" pr 5
merge 5; rc=$?
check "ship-merge succeeds when green" test $rc -eq 0
check "ship-merge exact flags" grep -qx "pr merge 5 --squash --match-head-commit $HEAD_SHA" "$FX/gh.log"
check "ship-merge never deletes via gh" bash -c '! grep -q -- "--delete-branch" "$1"' _ "$FX/gh.log"
check "ship-merge cleanup deletes remote branch via API" grep -q 'api -X DELETE repos/o/r/git/refs/heads/feat' "$FX/gh.log"
check "ship-merge marks goal done" test "$(jq -r .status "$TMP/state/goal.json")" = "done"
fresh; ORCA_WORKTREE_ID='repo::/p' merge 5
check "ship-merge notifies done with PR number" grep -q -- 'done: PR #5 merged' "$FX/orca.log"
fresh; mutate '.isDraft=true' view.json; ORCA_WORKTREE_ID='repo::/p' merge 5
check "ship-merge refusal sends no done notification" bash -c '! grep -q "done:" "$1" 2>/dev/null' _ "$FX/orca.log"
fresh; rm -f "$TMP/state/autonomy.on"; merge 5 --confirmed; rc=$?
check "ship-merge --confirmed works with flag off" test $rc -eq 0
fresh; echo 1 >"$FX/merge.rc"; merge 5; rc=$?
check "ship-merge succeeds when merge exits non-zero but PR is MERGED" test $rc -eq 0

# ---- ship-merge: merge method
fresh; bash "$H/goal.sh" set g; bash "$H/goal.sh" pr 5
echo "false true false" >"$FX/merge_settings.txt"; merge 5; rc=$?
check "merge method: auto picks rebase when squash is disallowed" test $rc -eq 0
check "merge method: auto passes --rebase" grep -qx "pr merge 5 --rebase --match-head-commit $HEAD_SHA" "$FX/gh.log"
fresh; echo "false false true" >"$FX/merge_settings.txt"; merge 5 --method merge; rc=$?
check "merge method: explicit merge allowed" test $rc -eq 0
check "merge method: explicit passes --merge" grep -qx "pr merge 5 --merge --match-head-commit $HEAD_SHA" "$FX/gh.log"
fresh; echo "false true false" >"$FX/merge_settings.txt"; refuses "method squash not allowed" 5 --method squash
check "merge method: refusal names allowed methods" grep -q 'allowed: rebase' "$FX/out"
fresh; refuses "unknown method" 5 --method fast-forward
fresh; refuses "method without value" 5 --method
fresh; echo "false true false" >"$FX/merge_settings.txt"; merge --method=rebase 5; rc=$?
check "merge method: --method=value and arg order" test $rc -eq 0
fresh; jq '.mergeMethod="merge"' "$CFG" >"$CFG.t" && mv "$CFG.t" "$CFG"; merge 5; rc=$?
check "merge method: config mergeMethod used" test $rc -eq 0
check "merge method: config passes --merge" grep -q "pr merge 5 --merge " "$FX/gh.log"
fresh; jq '.mergeMethod="merge"' "$CFG" >"$CFG.t" && mv "$CFG.t" "$CFG"; merge 5 --method squash; rc=$?
check "merge method: flag overrides config" grep -q "pr merge 5 --squash " "$FX/gh.log"
fresh; jq '.mergeMethod="octopus"' "$CFG" >"$CFG.t" && mv "$CFG.t" "$CFG"; refuses "invalid config mergeMethod" 5

# ---- ship-merge: no config (base = repo default branch, all checks green, review rail skipped)
nocfg() { reset; fresh_work; green_fixtures; flag_on; }
nocfg; echo '[]' >"$FX/statuses.json"; merge 5; rc=$?
check "no config: merges with all checks green and no review status" test $rc -eq 0
check "no config: asks GitHub for the default branch" grep -q 'defaultBranchRef' "$FX/gh.log"
nocfg; mutate '.[0].state="failure"' statuses.json; merge 5; rc=$?
check "no config: failing review status is ignored" test $rc -eq 0
nocfg; echo trunk >"$FX/default_branch"; refuses "no config: PR base differs from default branch" 5
nocfg; echo trunk >"$FX/default_branch"; mutate '.baseRefName="trunk"' view.json; merge 5; rc=$?
check "no config: merges into a non-master default branch" test $rc -eq 0
check "no config: compares against default branch" grep -q 'compare/trunk\.\.\.' "$FX/gh.log"
nocfg; mutate '(.[] | select(.name=="gate") | .conclusion) = "failure"' checks.json; refuses "no config: any failing check" 5
nocfg; mutate '. + [{"name":"other","status":"queued","conclusion":null,"app":{"slug":"x"}}]' checks.json; refuses "no config: any pending check" 5
nocfg; mutate '.state="CLOSED"' view.json; refuses "no config: PR not open" 5

# ---- ship-merge: custom config
main_fixtures() {
  green_fixtures
  mutate '.baseRefName="main"' view.json
  echo '[{"name":"build","status":"completed","conclusion":"success","app":{"slug":"github-actions"}}]' >"$FX/checks.json"
  echo '[{"id":1,"context":"ci-review","state":"success","creator":{"login":"github-actions[bot]"}}]' >"$FX/statuses.json"
}
cfg_main() { echo '{"base":"main","requiredChecks":["build"],"reviewStatus":"ci-review"}' >"$CFG"; }
cmain() { reset; main_fixtures; flag_on; cfg_main; }
cmain; merge 5; rc=$?
check "config: honours base main, required build, review ci-review" test $rc -eq 0
check "config: compares against configured base" grep -q 'compare/main\.\.\.' "$FX/gh.log"
cmain; mutate '.baseRefName="master"' view.json; refuses "config: PR base master when base is main" 5
cmain; echo '[]' >"$FX/checks.json"; refuses "config: required build missing" 5
cmain; mutate '.[0].conclusion="failure"' checks.json; refuses "config: build failing" 5
cmain; mutate '.[0].state="failure"' statuses.json; refuses "config: ci-review failing" 5
cmain; echo '[]' >"$FX/statuses.json"; refuses "config: ci-review missing" 5
cmain; echo '{"base":"main","requiredChecks":["build"],"reviewStatus":"ci-review","reviewStatusCreator":"reviewer-bot"}' >"$CFG"; refuses "config: ci-review from wrong creator" 5
cmain; echo '{"base":"main","requiredChecks":["build"],"reviewStatus":"ci-review","reviewStatusCreator":"reviewer-bot"}' >"$CFG"
mutate '.[0].creator.login="reviewer-bot"' statuses.json; merge 5; rc=$?
check "config: ci-review from configured creator merges" test $rc -eq 0

# ---- ship-merge: protected paths, fork PRs, self-base head
setfiles() { mutate ".files = $1" view.json; }
for p in .github/workflows/ci.yml .claude/settings.json .claude/hooks/x.sh .opencode/prompts/a.txt tools/agent-harness/lib.sh tools/ci/gate.sh opencode.jsonc AGENTS.md CLAUDE.md; do
  fresh; setfiles "[{\"path\":\"client/a.gd\"},{\"path\":\"$p\"}]"; merge 5; rc=$?
  check "harness path $p merges by default (config without protectedPaths)" test $rc -eq 0
  nocfg; setfiles "[{\"path\":\"$p\"}]"; merge 5; rc=$?
  check "harness path $p merges by default (no config)" test $rc -eq 0
done
reset; green_fixtures; flag_on; echo '{"base":"master","protectedPaths":[]}' >"$CFG"
setfiles '[{"path":".github/workflows/ci.yml"}]'; merge 5; rc=$?
check "empty protectedPaths array keeps the rail off" test $rc -eq 0
reset; green_fixtures; flag_on; echo '{"base":"master","protectedPaths":["^\\.github/","^tools/agent-harness/"]}' >"$CFG"
setfiles '[{"path":"tools/agent-harness/lib.sh"}]'; refuses "configured protectedPaths blocks harness path" 5
reset; green_fixtures; flag_on; echo '{"base":"master","protectedPaths":["^\\.github/"]}' >"$CFG"
setfiles '[{"path":"client/a.gd"}]'; merge 5; rc=$?
check "configured protectedPaths lets unrelated PR merge" test $rc -eq 0
fresh; setfiles '[{"path":"docs/AGENTS.md"},{"path":"src/.github/x"},{"path":"sub/opencode.jsonc"},{"path":"tools/other/x.sh"}]'; merge 5; rc=$?
check "protected paths are anchored: lookalikes merge" test $rc -eq 0
reset; green_fixtures; echo '{"base":"master","protectedPaths":["^secret/"]}' >"$CFG"
setfiles '[{"path":"secret/key.txt"}]'; merge 5 --confirmed; rc=$?
check "configured protected path allowed with --confirmed and autonomy off" test $rc -eq 0
reset; green_fixtures; echo '{"base":"master","protectedPaths":["^secret/"]}' >"$CFG"
setfiles '[{"path":"secret/key.txt"}]'; merge 5; rc=$?
check "configured protected path refused with autonomy off and no --confirmed" test $rc -ne 0
reset; green_fixtures; flag_on
echo '{"base":"master","protectedPaths":["^secret/"]}' >"$CFG"
setfiles '[{"path":"secret/key.txt"}]'; refuses "config protectedPaths blocks secret/" 5
reset; green_fixtures; flag_on
echo '{"base":"master","protectedPaths":["^secret/"]}' >"$CFG"
setfiles '[{"path":".github/workflows/ci.yml"}]'; merge 5; rc=$?
check "config protectedPaths replaces the default regex" test $rc -eq 0
fresh; mutate '.isCrossRepository=true' view.json; refuses "cross-repository PR (config)" 5
nocfg; mutate '.isCrossRepository=true' view.json; refuses "cross-repository PR (no config)" 5
fresh; mutate '.headRefName="master"' view.json; refuses "head branch equals base (config)" 5
nocfg; mutate '.headRefName="master"' view.json; refuses "head branch equals base (no config)" 5
nocfg; echo trunk >"$FX/default_branch"; mutate '.baseRefName="trunk" | .headRefName="trunk"' view.json; refuses "head branch equals default branch" 5

# ---- ship-merge runs cleanup
merge() { ( cd "$TMP/work" && CLAUDE_PROJECT_DIR="$TMP/work" bash "$H/ship-merge.sh" "$@" ) >"$FX/out" 2>&1; }
fresh; bash "$H/goal.sh" set g; bash "$H/goal.sh" pr 5; merge 5; rc=$?
check "ship-merge success runs cleanup (remote)" grep -q 'api -X DELETE repos/o/r/git/refs/heads/feat' "$FX/gh.log"
check "ship-merge success runs cleanup (local branch gone)" bash -c '! git -C "$1" show-ref --verify --quiet refs/heads/feat' _ "$TMP/work"
check "ship-merge success prints cleanup lines" grep -q '^cleanup: remote feat deleted' "$FX/out"
fresh; bash "$H/goal.sh" set g; bash "$H/goal.sh" pr 5; merge 5 --keep-branch; rc=$?
check "ship-merge --keep-branch exits 0" test $rc -eq 0
check "ship-merge --keep-branch no remote delete" bash -c '! grep -q "api -X DELETE" "$1"' _ "$FX/gh.log"
check "ship-merge --keep-branch keeps local branch" git -C "$TMP/work" show-ref --verify --quiet refs/heads/feat
fresh; mutate '.isDraft=true' view.json; refuses "draft (no cleanup)" 5
check "ship-merge refusal never deletes" bash -c '! grep -q "DELETE" "$1" 2>/dev/null' _ "$FX/gh.log"
merge() { ( cd "$TMP/work" && bash "$H/ship-merge.sh" "$@" ) >"$FX/out" 2>&1; }

# ---- cleanup.sh
cleanup() { ( cd "${CLEAN_CWD:-$TMP/work}" && CLAUDE_PROJECT_DIR="${CLEAN_CWD:-$TMP/work}" bash "$H/cleanup.sh" "$@" ) >"$FX/out" 2>&1; }
cfresh() { reset; fresh_work; green_fixtures; mutate '.state="MERGED"' view.json; }
no_delete() { ! grep -q 'DELETE' "$FX/gh.log" 2>/dev/null; }
remote_deleted() { grep -q 'api -X DELETE repos/o/r/git/refs/heads/feat' "$FX/gh.log"; }
local_exists() { git -C "$TMP/work" show-ref --verify --quiet "refs/heads/$1"; }
cur_branch() { git -C "${1:-$TMP/work}" rev-parse --abbrev-ref HEAD; }
origin_master() { git --git-dir="$TMP/origin.git" rev-parse master; }

cfresh; before="$(origin_master)"; cleanup 5; rc=$?
check "cleanup merged: exits 0" test $rc -eq 0
check "cleanup merged: deletes remote feat" remote_deleted
check "cleanup merged: never deletes base on remote" bash -c '! grep -q "DELETE.*heads/master" "$1"' _ "$FX/gh.log"
check "cleanup merged: deletes local feat" bash -c '! git -C "$1" show-ref --verify --quiet refs/heads/feat' _ "$TMP/work"
check "cleanup merged: checks out base" test "$(cur_branch)" = master
check "cleanup merged: origin base untouched" test "$(origin_master)" = "$before"
check "cleanup merged: reports remote deleted" grep -q '^cleanup: remote feat deleted' "$FX/out"
check "cleanup merged: reports local deleted" grep -q '^cleanup: local feat deleted' "$FX/out"
check "cleanup merged: reports checkout" grep -q '^cleanup: checkout master @ ' "$FX/out"

cfresh; echo '[{"number":9,"baseRefName":"feat","headRefName":"child"}]' >"$FX/open_prs.json"; cleanup 5; rc=$?
check "cleanup open child PR: exits 0" test $rc -eq 0
check "cleanup open child PR: remote kept" no_delete
check "cleanup open child PR: reports kept" grep -q '^cleanup: remote feat kept' "$FX/out"
check "cleanup open child PR: local deleted" bash -c '! git -C "$1" show-ref --verify --quiet refs/heads/feat' _ "$TMP/work"

cfresh; echo '[{"number":9,"baseRefName":"master","headRefName":"feat"}]' >"$FX/open_prs.json"; cleanup 5; rc=$?
check "cleanup other open PR from head: exits 0" test $rc -eq 0
check "cleanup other open PR from head: remote kept" no_delete
check "cleanup other open PR from head: reports kept" grep -q '^cleanup: remote feat kept' "$FX/out"

cfresh; echo '{"protected":true}' >"$FX/branch.json"; cleanup 5; rc=$?
check "cleanup protected: exits 0" test $rc -eq 0
check "cleanup protected: remote kept" no_delete
check "cleanup protected: reports kept" grep -q '^cleanup: remote feat kept' "$FX/out"

cfresh; : >"$FX/branch.gone"; cleanup 5; rc=$?
check "cleanup remote already gone: exits 0" test $rc -eq 0
check "cleanup remote already gone: no DELETE" no_delete
check "cleanup remote already gone: reports absent" grep -q '^cleanup: remote feat absent' "$FX/out"

cfresh; : >"$FX/branch.err"; cleanup 5; rc=$?
check "cleanup gh error other than 404: exits 0" test $rc -eq 0
check "cleanup gh error other than 404: no DELETE" no_delete
check "cleanup gh error other than 404: remote unknown, not absent" grep -q '^cleanup: remote feat unknown' "$FX/out"
check "cleanup gh error other than 404: never says absent" bash -c '! grep -q "remote feat absent" "$1"' _ "$FX/out"

cfresh; cleanup 5 --keep-branch; rc=$?
check "cleanup --keep-branch: exits 0" test $rc -eq 0
check "cleanup --keep-branch: no remote delete" no_delete
check "cleanup --keep-branch: local feat kept" local_exists feat
check "cleanup --keep-branch: checks out base" test "$(cur_branch)" = master

cfresh; bash "$H/goal.sh" set g; bash "$H/goal.sh" pr 5
git -C "$TMP/work" branch -q backup/old; git -C "$TMP/work" branch -q backup/unrecorded
jq '.backup_branches=["backup/old"]' "$TMP/state/goal.json" >"$FX/t" && mv "$FX/t" "$TMP/state/goal.json"
cleanup 5; rc=$?
check "cleanup backups: exits 0" test $rc -eq 0
check "cleanup backups: recorded backup deleted" bash -c '! git -C "$1" show-ref --verify --quiet refs/heads/backup/old' _ "$TMP/work"
check "cleanup backups: unrecorded backup kept" local_exists backup/unrecorded
check "cleanup backups: recorded list emptied" test "$(jq -c '.backup_branches' "$TMP/state/goal.json")" = "[]"
check "cleanup backups: reports deletion" grep -q '^cleanup: backup backup/old deleted' "$FX/out"

cfresh; bash "$H/goal.sh" set g; bash "$H/goal.sh" pr 6
git -C "$TMP/work" branch -q backup/old
jq '.backup_branches=["backup/old"]' "$TMP/state/goal.json" >"$FX/t" && mv "$FX/t" "$TMP/state/goal.json"
cleanup 5; rc=$?
check "cleanup foreign goal PR (autonomy off): exits 0" test $rc -eq 0
check "cleanup foreign goal PR (autonomy off): backup untouched" local_exists backup/old
check "cleanup foreign goal PR (autonomy off): list untouched" test "$(jq -c '.backup_branches' "$TMP/state/goal.json")" = '["backup/old"]'

cfresh; flag_on; bash "$H/goal.sh" set g; bash "$H/goal.sh" pr 6
cleanup 5; rc=$?
check "cleanup autonomy on with other goal PR: refused" test $rc -eq 1
check "cleanup autonomy on with other goal PR: nothing deleted" no_delete
check "cleanup autonomy on with other goal PR: local feat kept" local_exists feat

cfresh; flag_on; cleanup 5; rc=$?
check "cleanup autonomy on without goal file: refused" test $rc -eq 1
check "cleanup autonomy on without goal file: nothing deleted" no_delete

cfresh; flag_on; bash "$H/goal.sh" set g; cleanup 5; rc=$?
check "cleanup autonomy on with empty goal pr: refused" test $rc -eq 1
check "cleanup autonomy on with empty goal pr: nothing deleted" no_delete

cfresh; flag_on; bash "$H/goal.sh" set g; bash "$H/goal.sh" pr 5; cleanup 5; rc=$?
check "cleanup autonomy on with matching goal pr: exits 0" test $rc -eq 0
check "cleanup autonomy on with matching goal pr: deletes remote feat" remote_deleted

cfresh; : >"$FX/list.fail"; cleanup 5; rc=$?
check "cleanup PR list failure: exits 0" test $rc -eq 0
check "cleanup PR list failure: remote kept" no_delete
check "cleanup PR list failure: reports kept" grep -q '^cleanup: remote feat kept (cannot list open PRs)' "$FX/out"

cfresh; echo '{"protected":false,"commit":{"sha":"0000000000000000000000000000000000000000"}}' >"$FX/branch.json"; cleanup 5; rc=$?
check "cleanup remote tip moved: remote kept" no_delete
check "cleanup remote tip moved: reports kept" grep -q '^cleanup: remote feat kept (tip moved since merge)' "$FX/out"

cfresh; mutate '.isCrossRepository=null' view.json; cleanup 5; rc=$?
check "cleanup isCrossRepository null: exits 0" test $rc -eq 0
check "cleanup isCrossRepository null: remote kept" no_delete

cfresh; git -C "$TMP/work" checkout -q master; echo dirty >"$TMP/work/dirty.txt"; cleanup 5; rc=$?
check "cleanup dirty tree: exits 0" test $rc -eq 0
check "cleanup dirty tree: reports checkout skipped" grep -q '^cleanup: checkout skipped (dirty tree)' "$FX/out"
check "cleanup dirty tree: reports local kept" grep -q '^cleanup: local feat kept (dirty tree)' "$FX/out"
check "cleanup dirty tree: local feat kept" local_exists feat
check "cleanup dirty tree: dirty file untouched" test -f "$TMP/work/dirty.txt"
rm -f "$TMP/work/dirty.txt"

cfresh; bash "$H/goal.sh" set g; bash "$H/goal.sh" pr 5
git -C "$TMP/work" branch -q backup/merged
git -C "$TMP/work" checkout -q -b backup/unmerged && ( cd "$TMP/work" && echo u >u && git add u && git commit -qm U ) >/dev/null 2>&1
git -C "$TMP/work" checkout -q feat
jq '.backup_branches=["backup/merged","backup/unmerged"]' "$TMP/state/goal.json" >"$FX/t" && mv "$FX/t" "$TMP/state/goal.json"
cleanup 5; rc=$?
check "cleanup unmerged backup: exits 0" test $rc -eq 0
check "cleanup unmerged backup: merged backup deleted" bash -c '! git -C "$1" show-ref --verify --quiet refs/heads/backup/merged' _ "$TMP/work"
check "cleanup unmerged backup: unmerged backup kept" local_exists backup/unmerged
check "cleanup unmerged backup: reports kept" grep -q '^cleanup: backup backup/unmerged kept (not merged)' "$FX/out"

cfresh; mutate '.state="OPEN"' view.json; cleanup 5; rc=$?
check "cleanup not merged: refused" test $rc -eq 1
check "cleanup not merged: nothing deleted" no_delete
check "cleanup not merged: local feat kept" local_exists feat

cfresh; ( cd "$TMP/work" && echo extra >extra && git add extra && git commit -qm extra ) >/dev/null 2>&1
cleanup 5; rc=$?
check "cleanup local ahead of head: exits 0" test $rc -eq 0
check "cleanup local ahead of head: local kept" local_exists feat
check "cleanup local ahead of head: reports kept" grep -q '^cleanup: local feat kept' "$FX/out"

cfresh; mutate '.headRefName="master"' view.json; cleanup 5; rc=$?
check "cleanup head equals base: refused" test $rc -eq 1
check "cleanup head equals base: nothing deleted" no_delete

cfresh; cleanup; rc=$?
check "cleanup without PR number: usage exit 2" test $rc -eq 2

cfresh; git -C "$TMP/work" checkout -q master
git -C "$TMP/work" worktree add -q "$TMP/wt" feat >/dev/null 2>&1
CLEAN_CWD="$TMP/wt" cleanup 5; rc=$?
check "cleanup linked worktree: exits 0" test $rc -eq 0
check "cleanup linked worktree: detached at origin base" grep -q '^cleanup: checkout detached at origin/master' "$FX/out"
check "cleanup linked worktree: HEAD detached" test "$(cur_branch "$TMP/wt")" = HEAD
check "cleanup linked worktree: feat deleted" bash -c '! git -C "$1" show-ref --verify --quiet refs/heads/feat' _ "$TMP/work"
check "cleanup linked worktree: reports kept" grep -q '^cleanup: worktree .* kept' "$FX/out"
check "cleanup linked worktree: directory still exists" test -d "$TMP/wt"
rm -rf "$TMP/wt"; git -C "$TMP/work" worktree prune

# ---- goal backup-add
reset; fresh_work
goalw() { ( cd "$TMP/work" && bash "$H/goal.sh" "$@" ) >"$FX/out" 2>&1; }
goalw backup-add backup/feat-1; rc=$?
check "goal backup-add without goal: no-op exit 0" test $rc -eq 0
check "goal backup-add without goal: creates no goal file" test ! -e "$TMP/state/goal.json"
goalw set g
check "goal set initialises backup_branches" test "$(jq -c '.backup_branches' "$TMP/state/goal.json")" = "[]"
git -C "$TMP/work" branch -q backup/feat-1
goalw backup-add backup/feat-1; rc=$?
check "goal backup-add records branch" test "$rc" -eq 0 -a "$(jq -c '.backup_branches' "$TMP/state/goal.json")" = '["backup/feat-1"]'
goalw backup-add backup/feat-1
check "goal backup-add deduplicates" test "$(jq -c '.backup_branches' "$TMP/state/goal.json")" = '["backup/feat-1"]'
goalw backup-add feat/x; rc=$?
check "goal backup-add rejects non-backup name" test $rc -eq 2
goalw backup-add backup/missing; rc=$?
check "goal backup-add rejects missing branch" test $rc -eq 2
check "goal backup-add rejected names not recorded" test "$(jq -c '.backup_branches' "$TMP/state/goal.json")" = '["backup/feat-1"]'
fi
reset; fresh_work

# ---- git-guard
GUARD_CWD="$TMP/work"
guard_in() { ( cd "$GUARD_CWD" && jqn -n --arg c "$1" --arg d "$GUARD_CWD" '{cwd:$d,tool_input:{command:$c}}' | "$GUARD_BASH" "$HOOKS/autonomy-git-guard.sh" ); }
decision() { jq -r '.hookSpecificOutput.permissionDecision // ""' <<<"$(guard_in "$1")"; }
denied() { [ "$(decision "$1")" = deny ]; }
asked() { [ "$(decision "$1")" = ask ]; }
allowed() { [ -z "$(guard_in "$1")" ]; }
DENY_CMDS="$(cat <<'CMDS'
gh pr merge 1
bash -c 'gh pr merge 1'
gh -R o/r pr merge 1 --squash
gh api -X PUT repos/o/r/pulls/1/merge
gh api graphql -f query=mutation{mergePullRequest(input:{})}
gh api -X DELETE repos/o/r/git/refs/heads/master
git push -u origin master
git push origin main
git push origin HEAD:refs/heads/master
git push origin HEAD:master
git -C . push origin master
git reset --hard HEAD~1
git branch -D x
git commit --no-verify -m x
git push --no-verify origin feature/x
bash tools/agent-harness/ship-merge.sh 5; gh pr merge 1
sed -i s/a/b/ tools/agent-harness/lib.sh
echo x > .github/workflows/ci.yml
echo x | tee .claude/hooks/a.sh
cp /tmp/x .claude/settings.json
rm -rf .claude/hooks
mv x .claude/state/goal.json
/usr/bin/git push origin master
/usr/bin/git push origin main
\git push origin master
/usr/bin/gh pr merge 1
\gh pr merge 1
git push --mirror origin
git push --all origin
git -c core.hooksPath=/tmp/h commit -m x
git -c core.pager=less log
git -c core.sshCommand=evil push origin feature/x
gh api repos/o/r/merges -f base=master -f head=x
gh api graphql -f query=@/tmp/q.graphql
gh api graphql -F query=@q.gql
python -c "open('.github/workflows/ci.yml','w').write('x')"
python3 -c "open('.claude/settings.json','w').write('x')"
perl -e 'open F,">.claude/settings.json"'
node -e "require('fs').writeFileSync('.opencode/x','y')"
ruby -e 'File.write(".claude/hooks/a.sh","x")'
python3 -c "open('.claude/settings.local.json','w')"
node -e "require('fs').writeFileSync('.claude/x','')"
perl -e 'open F,">tools/agent-harness/x"'
node -r ./x.js -e "require('fs').writeFileSync('.claude/x','')"
perl -I lib.pl -e 'open F,">.claude/x"'
python3 -W ignore.py -c 'open(".claude/x","w")'
echo "open('.claude/x','w')" | python3
echo "require('fs').writeFileSync('.claude/x','')" | node
dd if=/tmp/x of=.claude/settings.json
xargs -I{} python3 -c "open('.claude/settings.json','w')"
xargs -n1 bash -c "echo x > .claude/settings.json"
nice -n 5 python3 -c "open('.claude/settings.json','w')"
timeout 5 node -e "require('fs').writeFileSync('.claude/settings.json','')"
git checkout -- .claude/settings.json
git restore -- .github/workflows/ci.yml
git checkout origin/master -- AGENTS.md
FOO=1 bash tools/agent-harness/ship-merge.sh 5
GH_BIN=/tmp/fake bash /Users/someone/.claude/scripts/agent-harness/ship-merge.sh 5
touch .claude/state/autonomy.on
touch /abs/proj/.claude/state/autonomy.on
git push origin mas\ter
git push origin ma's'ter
git push origin $BR
git push origin HEAD:$BR
git push origin ${BR}
git push --force origin main
git push --force origin master
git push origin +master
git push origin +x:master
git push -f origin HEAD:main
git push --force-with-lease origin master
git push -uf origin main
git push --force --no-verify origin feature/x
git push --force --mirror origin
git push origin -d x
git push origin -fd x
git push origin -df x
git push --prune origin
git push origin --delete x
git branch -d x
git branch --delete --force x
git branch -df x
git update-ref -d refs/heads/x
git update-ref --stdin
git send-pack origin :refs/heads/x
gh api graphql -f query='mutation{deleteRef(input:{refId:"x"})}'
gh api graphql --input /tmp/q.json
gh api -X DELETE repos/o/r/git/refs/heads%2Fx
gh api --method DELETE repos/o/r/git/refs/heads/x
gh api --method=DELETE repos/o/r/git/refs/$REF
bash /tmp/cleanup.sh 5
CMDS
)"
ALIAS_DENY_CMDS="$(cat <<'CMDS'
git -c alias.p=!sh status
git -c alias.x=!echo status
git -c alias.p=push p origin --delete x
CMDS
)"
ALLOW_CMDS="$(cat <<'CMDS'
git push origin feature/x
git push -u origin claude/x
git push --force origin feat/x
git push --force origin feature/x
git push --force-with-lease origin feat/x
git push --force-with-lease=feat:abc123 origin feat
git push -f origin feat/x
git push -uf origin feat/x
git push -fu origin feat/x
git push -u origin feat/x
git push --force-with-lease=feat/x:abc origin feat/x
git push origin +feat/x
git push origin +x:y
git push origin +HEAD:feat/x
git push origin claude/x && rm -f /tmp/foo
gh pr view 5
git status
bash tools/agent-harness/test/run.sh
git commit -m "never git push to master"
grep -rn mv tools
git push origin feature/master-fix
python3 -c "print(1)"
node tools/agent-harness/gen-cursor.mjs
bash tools/agent-harness/check.sh
python3 tools/x.py
echo hi | python3 tools/x.py
node tools/agent-harness/gen-cursor.mjs > .cursor/x
node build.js
dd if=/dev/zero of=/tmp/x count=1
xargs -n1 echo
git checkout -- src/a.ts
git restore -- docs/a.md
touch /tmp/x
CMDS
)"
ASK_CMDS="$(cat <<'CMDS'
agent-harness ship-merge 12 --confirmed
bash /Users/someone/.claude/scripts/agent-harness/ship-merge.sh 12 --confirmed
bash tools/agent-harness/ship-merge.sh 5 --confirmed
agent-harness ship-merge 12 --method rebase --confirmed
CMDS
)"
SHIP_ALLOW_CMDS="$(cat <<'CMDS'
agent-harness ship-merge 12
bash /Users/someone/.claude/scripts/agent-harness/ship-merge.sh 12
bash tools/agent-harness/ship-merge.sh 12
agent-harness ship-merge 12 --method rebase
agent-harness ship-merge 12 --method=merge
CMDS
)"
CLEAN_ALLOW_CMDS="$(cat <<'CMDS'
agent-harness cleanup 5
agent-harness cleanup 5 --keep-branch
bash /Users/someone/.claude/scripts/agent-harness/cleanup.sh 5
bash ~/.claude/scripts/agent-harness/cleanup.sh 5
agent-harness ship-merge 5 --keep-branch
agent-harness goal backup-add backup/feat-1
CMDS
)"
CLEAN_DENY_CMDS="$(cat <<'CMDS'
GH_BIN=/tmp/gh agent-harness cleanup 5
env AGENT_HARNESS_TEST=1 agent-harness cleanup 5
agent-harness cleanup 5 --force
agent-harness cleanup feat
git branch -D backup/x
git push origin --delete feat
git push origin :feat
gh api -X DELETE repos/o/r/git/refs/heads/feat
CMDS
)"
reset; flag_on
while IFS= read -r c; do check "git-guard denies: $c" denied "$c"; done <<<"$DENY_CMDS"
while IFS= read -r c; do check "git-guard denies: $c" denied "$c"; done <<<"$ALIAS_DENY_CMDS"
while IFS= read -r c; do check "git-guard allows: $c" allowed "$c"; done <<<"$ALLOW_CMDS"
while IFS= read -r c; do check "git-guard allows: $c" allowed "$c"; done <<<"$SHIP_ALLOW_CMDS"
while IFS= read -r c; do check "git-guard asks: $c" asked "$c"; done <<<"$ASK_CMDS"
while IFS= read -r c; do check "git-guard allows: $c" allowed "$c"; done <<<"$CLEAN_ALLOW_CMDS"
while IFS= read -r c; do check "git-guard denies: $c" denied "$c"; done <<<"$CLEAN_DENY_CMDS"
check "git-guard denies unknown merge method" denied "agent-harness ship-merge 12 --method octopus"
check "git-guard denies --method without value" denied "agent-harness ship-merge 12 --method"
echo '{"base":"trunk"}' >"$CFG"
check "git-guard denies push to configured base" denied "git push origin trunk"
check "git-guard denies absolute-path push to configured base" denied "/usr/bin/git push origin trunk"
check "git-guard allows push to other branch with configured base" allowed "git push origin feature/trunk-fix"
rm -f "$CFG"
git -C "$TMP/work" checkout -q master
check "git-guard denies bare push on the base branch" denied "git push"
check "git-guard denies push origin on the base branch" denied "git push origin"
check "git-guard denies push origin HEAD on the base branch" denied "git push origin HEAD"
check "git-guard denies bare force push on the base branch" denied "git push --force"
check "git-guard denies bare force-with-lease on the base branch" denied "git push --force-with-lease"
check "git-guard denies force push origin HEAD on the base branch" denied "git push -f origin HEAD"
check "git-guard allows non-push git on the base branch" allowed "git status"
git -C "$TMP/work" checkout -q feat
check "git-guard allows bare push on a feature branch" allowed "git push"
check "git-guard allows bare force-with-lease on a feature branch" allowed "git push --force-with-lease"
check "git-guard allows bare force on a feature branch" allowed "git push --force"
check "git-guard allows force push origin HEAD on a feature branch" allowed "git push --force origin HEAD"
check "git-guard allows push origin HEAD on a feature branch" allowed "git push origin HEAD"
check "git-guard allows a dollar sign in a commit message" allowed 'git commit -m "cost is $5"'
check "git-guard allows a dollar sign in a single-quoted commit message" allowed "git commit -m 'cost is \$5'"
check "git-guard denies command substitution in a push ref" denied 'git push origin $(echo master)'
check "git-guard denies a double-quoted command substitution in a push ref" denied 'git push origin "$(echo master)"'
check "git-guard denies backticks in a push ref" denied 'git push origin `echo master`'
check "git-guard denies a backtick inside a push ref" denied 'git push origin ma`echo ster`'
check "git-guard denies a command substitution inside a push ref" denied 'git push origin ma$(echo s)ter'
check "git-guard denies ANSI-C quoted git" denied "$(printf '%s' "\$'git' push origin master")"
check "git-guard denies ANSI-C quoted push" denied "$(printf '%s' "git \$'push' origin master")"
check "git-guard denies an ANSI-C split subcommand" denied "$(printf '%s' "git pu\$'sh' origin master")"
check "git-guard denies brace expansion of a base ref" denied 'git push origin ma{ster,in}'
check "git-guard denies a base ref hidden by a line continuation" denied "$(printf 'git push origin \\\nmaster')"
check "git-guard denies an assignment substitution in front of a base push" denied 'FOO=$(date) git push origin master'
check "git-guard denies a quoted assignment before gh pr merge" denied "FOO='a b' gh pr merge 12"
check "git-guard denies a double-quoted assignment before gh pr merge" denied 'FOO="a b" gh pr merge 12'
check "git-guard denies env with a quoted assignment before gh pr merge" denied "env FOO='a b' gh pr merge 12"
check "git-guard allows a quoted assignment before gh pr view" allowed "FOO='a b' gh pr view"
check "git-guard denies -c push.default on a bare push" denied 'git -c push.default=matching push'
check "git-guard denies -c push.default even with an explicit feature ref" denied 'git -c push.default=matching push origin feat'
check "git-guard denies -c remote.push" denied 'git -c remote.origin.push=refs/heads/master:refs/heads/master push origin feat'
check "git-guard denies --config-env equals form" denied 'git --config-env=push.default=VAR push'
check "git-guard denies --config-env split form" denied 'git --config-env push.default=VAR push'
check "git-guard denies GIT_CONFIG_COUNT injection" denied 'GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=push.default GIT_CONFIG_VALUE_0=matching git push'
check "git-guard denies GIT_CONFIG_PARAMETERS injection" denied 'GIT_CONFIG_PARAMETERS=push.default=matching git push'
git init -q -b master "$TMP/baserepo"
( cd "$TMP/baserepo" && git config user.email t@t && git config user.name t && echo z >z && git add z && git commit -qm Z )
check "git-guard denies a bare push through --git-dir of a base repo" denied "git --git-dir $TMP/baserepo/.git push"
check "git-guard denies a bare push through --git-dir= of a base repo" denied "git --git-dir=$TMP/baserepo/.git push"
check "git-guard denies --git-dir plus --work-tree of a base repo" denied "git --git-dir=$TMP/baserepo/.git --work-tree=$TMP/baserepo push"
check "git-guard denies -C of a feature repo combined with --git-dir of a base repo" denied "git -C $TMP/work --git-dir=$TMP/baserepo/.git push"
check "git-guard denies a GIT_DIR prefix pointing at a base repo" denied "GIT_DIR=$TMP/baserepo/.git git push"
check "git-guard denies env GIT_DIR pointing at a base repo" denied "env GIT_DIR=$TMP/baserepo/.git git push"
check "git-guard denies an exported GIT_DIR pointing at a base repo" denied "export GIT_DIR=$TMP/baserepo/.git; git push"
check "git-guard denies cd to a base repo before a bare push" denied "cd $TMP/baserepo && git push"
check "git-guard denies a bare push when --git-dir does not resolve" denied "git --git-dir=$TMP/no-such-git push"
check "git-guard allows a bare push through --git-dir of the feature repo" allowed "git --git-dir=$TMP/work/.git push"
check "git-guard allows a bare push through -C of the feature repo" allowed "git -C $TMP/work push"
check "git-guard fails open on empty input" bash -c 'echo "{}" | bash "$1" | test -z "$(cat)"' _ "$HOOKS/autonomy-git-guard.sh"
rm -f "$TMP/state/autonomy.on"
while IFS= read -r c; do check "git-guard (flag off) allows: $c" allowed "$c"; done <<<"$DENY_CMDS"
while IFS= read -r c; do check "git-guard (flag off) denies: $c" denied "$c"; done <<<"$ALIAS_DENY_CMDS"
while IFS= read -r c; do check "git-guard (flag off) allows: $c" allowed "$c"; done <<<"$ALLOW_CMDS"
while IFS= read -r c; do check "git-guard (flag off) allows: $c" allowed "$c"; done <<<"$ASK_CMDS"
while IFS= read -r c; do check "git-guard (flag off) allows: $c" allowed "$c"; done <<<"$CLEAN_DENY_CMDS"
while IFS= read -r c; do check "git-guard (flag off) allows: $c" allowed "$c"; done <<<"$CLEAN_ALLOW_CMDS"
git -C "$TMP/work" checkout -q master
check "git-guard (flag off) allows bare push on the base branch" allowed "git push"
git -C "$TMP/work" checkout -q feat
check "git-guard (flag off) allows a push substitution" allowed 'git push origin $(echo master)'
check "git-guard (flag off) allows a quoted assignment before gh pr merge" allowed "FOO='a b' gh pr merge 12"
check "git-guard (flag off) allows a quoted assignment before gh pr view" allowed "FOO='a b' gh pr view"
check "git-guard (flag off) allows -c push.default" allowed 'git -c push.default=matching push origin master'
check "git-guard (flag off) denies ANSI-C quoted git" denied "$(printf '%s' "\$'git' push origin master")"
check "git-guard (flag off) denies ANSI-C quoted push" denied "$(printf '%s' "git \$'push' origin master")"
check "git-guard (flag off) denies --config-env" denied 'git --config-env=push.default=VAR status'
check "git-guard (flag off) denies --config-env split form" denied 'git --config-env alias.x=VAR status'

PROBE_BASE="$TMP/baserepo"
probe_decision() { # mode cmd
  rm -f "$TMP/state/autonomy.on"; [ "$1" = on ] && flag_on
  local d; d="$(decision "$2")"; echo "${d:-allow}"
}
IFS= read -r -d '' PROBE_CMDS <<'CMDS' || true
allow|allow|git reset --har
allow|allow|git reset --ha HEAD~1
allow|allow|git commit --no-verif -m x
allow|allow|git push --no-ver origin feat
allow|allow|git push --mirro origin
allow|allow|git push --al origin
allow|allow|git push --delet origin feat
allow|allow|git push --prun origin
allow|allow|git branch --del feat
deny|allow|git branch -D feat
allow|allow|git push origin main~0
allow|allow|git push origin main^0
deny|allow|git push origin refs/heads/main:refs/heads/main
allow|allow|git push origin heads/main
allow|allow|git push origin HEAD:heads/main
allow|allow|git push origin HEAD:refs/heads//main
deny|allow|git push origin tag main
allow|allow|git push origin
allow|allow|git push
allow|allow|git push origin HEAD
allow|allow|git push origin @
deny|allow|git update-ref -d refs/heads/feat
allow|allow|git update-ref refs/heads/main HEAD
deny|allow|git push --force-with-lease origin main
deny|allow|git push origin +HEAD:main
deny|allow|git -c core.hooksPath=/dev/null commit -m x
allow|allow|git commit -n -m x
allow|allow|git merge feat
allow|allow|git pull origin main
deny|allow|git push origin HEAD:main HEAD:feat
deny|allow|git push origin feat main
deny|allow|git push origin --repo=x main
deny|allow|git -C @B@ push origin
deny|allow|GIT_DIR=@B@/.git git push origin
deny|allow|git --git-dir=@B@/.git push origin
deny|allow|cd @B@ && git push origin
deny|allow|cd @B@; git push origin HEAD
deny|allow|pushd @B@ && git push
deny|allow|export GIT_DIR=@B@/.git; git push origin
deny|allow|env GIT_DIR=@B@/.git git push origin
deny|allow|(cd @B@ && git push)
deny|allow|echo $(cd @B@ && git push)
deny|allow|cd ~/Workspace/isagri/gc.platform && git push
allow|allow|cd ../../../../Workspace/isagri/gc.platform && git push
allow|allow|echo main | xargs git push origin
deny|allow|cd /tmp && cd @B@ && git push
deny|allow|git --git-dir @B@/.git push
deny|allow|cd "@B@" && git push
deny|allow|cd $HOME/Workspace/isagri/gc.platform && git push
deny|allow|git push origin `echo main`
deny|allow|git push origin $'main'
deny|allow|git push origin {main,feat}
deny|allow|git push origin m{a,}in
deny|allow|git push origin "$B"
deny|allow|B=main; git push origin $B
deny|allow|sh -c 'cd @B@ && git push'
deny|deny|a=git; $a push origin main
deny|allow|command git push origin main
deny|allow|\git push origin main
deny|allow|/usr/bin/git push origin main
deny|allow|git push origin ma''in
deny|allow|nohup git push origin main
deny|allow|time git push origin main
deny|allow|timeout 5 git push origin main
deny|allow|sudo -u x git push origin main
deny|allow|exec git push origin main
deny|allow|git push origin main&
deny|allow|git push origin main|cat
deny|allow|git push -- origin main
deny|allow|git -c x=y push origin main
deny|allow|git push --repo origin main
allow|allow|git -C @B@ worktree list
allow|allow|GIT_WORK_TREE=@B@ git push origin
allow|allow|git --work-tree=@B@ push
allow|allow|git config remote.origin.push HEAD:main
allow|allow|git config push.default upstream
allow|allow|git branch -u origin/main
allow|allow|git config core.hooksPath /dev/null
deny|allow|gh alias set m "pr merge"
allow|allow|gh m 1
deny|allow|gh pr merge 1
deny|allow|gh -R o/r pr merge 1
deny|allow|X='a b' gh pr merge 1
deny|allow|gh api -X PUT repos/o/r/pulls/1/merge
deny|allow|gh api repos/o/r/pulls/1/merge -X PUT
deny|allow|gh api --method=put repos/o/r/pulls/1/merge
deny|allow|gh api repos/o/r/pulls/1/merge -f merge_method=squash
deny|allow|gh api repos/o/r/git/refs/heads/feat -X DELETE
deny|allow|gh api graphql -f query='mutation{mergePullRequest(input:{pullRequestId:"x"}){clientMutationId}}'
allow|allow|gh pr review 1 --approve
deny|allow|git push origin "main
deny|allow|git push origin 'main
allow|allow|git push origin main\
deny|allow|git push origin $'ma\x69n'
deny|allow|git push origin "ma"\@NL@in
deny|allow|git push origin "a@NL@:main
CMDS
PROBE_CMDS="${PROBE_CMDS%$'\n'}"
PROBE_HOME="$TMP/probehome"; mkdir -p "$PROBE_HOME/Workspace/isagri"
git clone -q "$TMP/baserepo" "$PROBE_HOME/Workspace/isagri/gc.platform" 2>/dev/null
REAL_HOME="$HOME"; export HOME="$PROBE_HOME"
while IFS='|' read -r p_on p_off p_cmd; do
  p_cmd="${p_cmd//@B@/$PROBE_BASE}"; p_cmd="${p_cmd//@NL@/$'\n'}"
  check "git-guard probe (flag on) $p_on: $p_cmd" test "$(probe_decision on "$p_cmd")" = "$p_on"
  check "git-guard probe (flag off) $p_off: $p_cmd" test "$(probe_decision off "$p_cmd")" = "$p_off"
done <<<"$PROBE_CMDS"
export HOME="$REAL_HOME"
perf_guard() { # name expected file [limit_ms]
  local json="$TMP/perf.json" t0 t1 out dec ms limit="${4:-1000}"
  jq -Rs --arg d "$GUARD_CWD" '{cwd:$d,tool_input:{command:.}}' <"$3" >"$json"
  t0="$(perl -MTime::HiRes=time -e 'printf "%.3f", time')"
  out="$(cd "$GUARD_CWD" && "$GUARD_BASH" "$HOOKS/autonomy-git-guard.sh" <"$json")"
  t1="$(perl -MTime::HiRes=time -e 'printf "%.3f", time')"
  ms="$(perl -e 'printf "%d", ($ARGV[1] - $ARGV[0]) * 1000' "$t0" "$t1")"
  dec="$(jq -r '.hookSpecificOutput.permissionDecision // "allow"' <<<"${out:-$EMPTY_JSON}")"
  echo "perf: $1 -> $dec in ${ms}ms (limit ${limit}ms)"
  check "git-guard perf decision: $1" test "$dec" = "$2"
  check "git-guard perf under ${limit}ms: $1" test "$ms" -lt "$limit"
}
perf_input() { # file prefix lineText lines suffix
  { printf '%s' "$2"; perl -e 'print "$ARGV[0]\n" x $ARGV[1]' "$3" "$4"; printf '%s' "$5"; } >"$1"
}
reset; flag_on
PF="$TMP/perf.cmd"
{ printf 'echo '; perl -e 'print "a" x 200000'; printf ' && git push origin main'; } >"$PF"
perf_guard "200K one-liner then push to base" deny "$PF"
perf_input "$PF" $'cat <<EOF\n' 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' 5000 'EOF'
perf_guard "5000-line heredoc without git" allow "$PF"
perf_input "$PF" '' 'git status' 5000 ''
perf_guard "5000 lines of git status" allow "$PF"
{ printf 'gh pr create --body "'; perl -e 'print "a" x 200000'; printf '"'; } >"$PF"
perf_guard "gh pr create with 200K body" allow "$PF"
{ printf "echo '"; perl -e 'print "a" x 200000'; printf "'"; } >"$PF"
perf_guard "200K single-quoted word" allow "$PF"
perf_input "$PF" '' 'python -c x' 5000 ''
perf_guard "5000 lines of python -c x" allow "$PF"
perf_input "$PF" $'cat <<EOF\n' 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' 2000 $'EOF\ngit push origin main'
perf_guard "push to base after 2000-line heredoc" deny "$PF"
perf_input "$PF" '' 'cd /tmp' 5000 ''
perf_guard "5000 lines of cd /tmp" allow "$PF"
perf_input "$PF" '' 'export A=b' 5000 ''
perf_guard "5000 lines of export A=b" allow "$PF"
perf_input "$PF" '' 'rm -f x' 5000 ''
perf_guard "5000 lines of rm -f x" allow "$PF"
perf_input "$PF" '' 'echo x > /tmp/f' 5000 ''
perf_guard "5000 lines of echo x > /tmp/f" allow "$PF"
perf_input "$PF" '' 'gh pr view 1' 5000 ''
perf_guard "5000 lines of gh pr view 1" allow "$PF"
perf_seq() { # file template count; $i in the template is the line number
  perl -e '$c = shift; $n = shift; for $i (1 .. $n) { ($l = $c) =~ s/\$i/$i/g; print "$l\n" }' "$2" "$3" >"$1"
}
perf_seq "$PF" 'cd /tmp/d$i' 2000
perf_guard "2000 distinct cd lines" allow "$PF"
perf_seq "$PF" 'cd /tmp/d$i' 8000
perf_guard "8000 distinct cd lines" allow "$PF" 2000
perf_seq "$PF" 'git -C /tmp/d$i push origin feat' 2000
perf_guard "2000 distinct git -C push lines (non-existent dirs)" allow "$PF"
PUSHREPO="$TMP/pushrepo"
git init -q -b feat/perf "$PUSHREPO" && git -C "$PUSHREPO" -c user.email=a@b -c user.name=n commit -q --allow-empty -m i
for i in $(seq 1 1000); do mkdir -p "$PUSHREPO/sd$i"; done
perf_seq "$PF" "git -C $PUSHREPO/sd\$i push origin feat" 1000
perf_guard "1000 distinct git -C push lines with an explicit destination (existing dirs, no branch lookup)" allow "$PF"
perf_seq "$PF" "git -C $PUSHREPO/sd\$i push" 20
perf_guard "20 distinct bare git -C push lines (existing dirs, one branch lookup each)" allow "$PF"
perf_seq "$PF" 'rm -f x$i' 5000
perf_guard "5000 distinct rm lines" allow "$PF"
{ printf 'echo "\n'; perl -e 'print "aaaaa\n" x 200000'; printf '"'; } >"$PF"
perf_guard "echo with a 200K-line quoted body" allow "$PF" 1500
UNI="$TMP/uni"; UA="$UNI/$(printf '\303\251')"; UB="$UNI/$(printf '\303\243')"
git init -q -b feat/uni "$UA" && git -C "$UA" -c user.email=a@b -c user.name=n commit -q --allow-empty -m i
git init -q -b master "$UB" && git -C "$UB" -c user.email=a@b -c user.name=n commit -q --allow-empty -m i
uni_decision() { # shell
  ( cd "$GUARD_CWD" && jqn -n --arg c "git -C \"$UA\" push; git -C \"$UB\" push" --arg d "$GUARD_CWD" '{cwd:$d,tool_input:{command:$c}}' | "$1" "$HOOKS/autonomy-git-guard.sh" ) \
    | jq -r '.hookSpecificOutput.permissionDecision // "allow"'
}
for ush in bash /bin/bash; do
  command -v "$ush" >/dev/null 2>&1 || continue
  check "git-guard does not share a branch lookup between non-ASCII paths that differ after the first byte ($ush)" test "$(uni_decision "$ush")" = deny
done
OSTYPE_WIN=msys
winguard() { # command -> decision with the hook told it runs under Git Bash
  ( cd "$GUARD_CWD" && jqn -n --arg c "$1" --arg d "$GUARD_CWD" '{cwd:$d,tool_input:{command:$c}}' | OSTYPE="$OSTYPE_WIN" "$GUARD_BASH" "$HOOKS/autonomy-git-guard.sh" ) \
    | { jq -r '.hookSpecificOutput.permissionDecision // empty'; echo; } | head -1 | sed 's/^$/allow/'
}
flag_on
while IFS= read -r c; do
  check "git-guard (Git Bash) denies: $c" test "$(winguard "$c")" = deny
done <<'WINCMDS'
git.exe push origin main
GIT.EXE push origin main
git push origin main
/usr/bin/git push origin main
/mingw64/bin/git.exe push origin master
"/c/Program Files/Git/cmd/git.exe" push origin main
"C:\Program Files\Git\cmd\git.exe" push origin main
'C:\Program Files\Git\cmd\GIT.EXE' push origin main
/usr/bin/gh.exe pr merge 1
gh.exe pr merge 1
echo x > .CLAUDE/settings.json
echo x > ".claude\settings.json"
WINCMDS
check "git-guard (Git Bash) allows an ordinary command" test "$(winguard 'git.exe status')" = allow
rm -f "$TMP/state/autonomy.on"
eval "$(sed -n '/^winconv() {/,/^}/p' "$HOOKS/autonomy-git-guard.sh")"
while IFS='|' read -r in want; do
  winconv "$in"
  check "winconv maps $in to $want" test "$WP" = "$want"
done <<'WINCONV'
C:\Users\me\x|/c/Users/me/x
C:/Users/me|/c/Users/me
d:|/d
\\?\C:\a\b|/c/a/b
//?/C:/a/b|/c/a/b
//./D:/a|/d/a
/cygdrive/c/x/y|/c/x/y
/cygdrive/D|/d
/c/x|/c/x
rel\a|rel/a
WINCONV
hook_commands() { jq -r '[.. | objects | select(has("command")) | .command] | .[]' "$1" | tr -d '\r'; }
check_registered_hooks() { # file regex script-dir: every command runs through bash and names a script that exists
  local file="$1" re="$2" dir="$3" c n=0 bad=0
  while IFS= read -r c; do
    n=$((n + 1))
    if [[ "$c" =~ $re ]] && [ -f "$dir/${BASH_REMATCH[1]}" ]; then :; else bad=$((bad + 1)); echo "  hook command not runnable through bash: $c"; fi
  done < <(hook_commands "$file")
  [ "$n" -gt 0 ] && [ "$bad" -eq 0 ]
}
check "claude settings register every hook as bash <existing script>" \
  check_registered_hooks "$HERE/.claude/settings.json" '^bash ~/\.claude/hooks/([A-Za-z0-9_.-]+\.sh)$' "$HERE/.claude/hooks"
check "cursor hooks.json registers every hook as bash <adapter> <existing script>" \
  check_registered_hooks "$HERE/plugins/fmflurry-harness/hooks/hooks.json" \
  '^bash \$\{CURSOR_PLUGIN_ROOT\}/hooks/scripts/cursor-adapter\.sh \$\{CURSOR_PLUGIN_ROOT\}/hooks/scripts/([A-Za-z0-9_.-]+\.sh) [A-Za-z]+$' \
  "$HERE/plugins/fmflurry-harness/hooks/scripts"
registered_guard_runs() { # the command registered for the git guard, run for real with a benign payload
  local c script out rc
  c="$(hook_commands "$HERE/.claude/settings.json" | grep 'autonomy-git-guard\.sh$' | head -1)"
  [[ "$c" =~ ^bash\ ~/(.*)$ ]] || return 1
  script="$HERE/${BASH_REMATCH[1]}"
  out="$(cd "$GUARD_CWD" && jqn -n --arg c 'git status' --arg d "$GUARD_CWD" '{cwd:$d,tool_input:{command:$c}}' | bash -c 'bash "$1"' _ "$script" 2>&1)"
  rc=$?
  [ "$rc" -eq 0 ] && [[ "$out" != *"Permission denied"* ]]
}
check "the registered git guard command runs through bash" registered_guard_runs
INSTALL_JQ="$(sed -n '/^        def bashify/,/^    '"'"' "\$settings"/p' "$HERE/install.sh" | sed '$d')"
install_merge() { jq --arg h "~/.claude/hooks" --arg mod /m --arg modTilde "~/.claude/mods/autonomy-status" "$INSTALL_JQ" <<<"$1"; }
LEGACY_SETTINGS='{"hooks":{"PreToolUse":[{"matcher":"Bash","hooks":[{"type":"command","command":"~/.claude/hooks/autonomy-git-guard.sh"},{"type":"command","command":"/opt/own/hook.sh"}]}]}}'
for seed in '{}' "$LEGACY_SETTINGS"; do
  merged="$(install_merge "$seed")"
  check "installer registers hooks through bash (seed ${seed:0:20})" test -n "$merged" -a "$(jq -r '[.. | objects | select(has("command")) | .command | select(test("\\.claude/hooks/")) | select(startswith("bash ") | not)] | length' <<<"$merged")" = 0
  check "installer registers the git guard once (seed ${seed:0:20})" test "$(jq -r '[.. | objects | select(has("command")) | .command | select(endswith("autonomy-git-guard.sh"))] | length' <<<"$merged")" = 1
done
check "installer leaves a user's own hook command alone" test "$(install_merge "$LEGACY_SETTINGS" | jq -r '[.. | objects | select(has("command")) | .command | select(. == "/opt/own/hook.sh")] | length')" = 1
FAKE_AWK_DIR="$TMP/fakeawk"; mkdir -p "$FAKE_AWK_DIR"
REAL_AWK="$(command -v awk)"
fake_awk() { # body
  printf '#!/bin/sh\n%s\n' "$1" >"$FAKE_AWK_DIR/awk"; chmod +x "$FAKE_AWK_DIR/awk"
}
awk_fault_cases=(
  'exit 2'
  'kill -9 $$'
  'case "$*" in *mode=seg*) exit 2 ;; esac; exec "$REAL_AWK" "$@"'
  'case "$*" in *mode=join*) exit 0 ;; esac; exec "$REAL_AWK" "$@"'
  'case "$*" in *mode=scan*) exit 0 ;; esac; exec "$REAL_AWK" "$@"'
  'case "$*" in *mode=seg*) exit 0 ;; esac; exec "$REAL_AWK" "$@"'
  'case "$*" in *mode=join*) ;; *) exec "$REAL_AWK" "$@" ;; esac; "$REAL_AWK" "$@" >"$FAKE_AWK_DIR/o"; head -c "$(($(wc -c <"$FAKE_AWK_DIR/o") / 2))" "$FAKE_AWK_DIR/o"'
  'case "$*" in *mode=scan*) ;; *) exec "$REAL_AWK" "$@" ;; esac; "$REAL_AWK" "$@" >"$FAKE_AWK_DIR/o"; head -c "$(($(wc -c <"$FAKE_AWK_DIR/o") / 2))" "$FAKE_AWK_DIR/o"'
  'case "$*" in *mode=seg*) ;; *) exec "$REAL_AWK" "$@" ;; esac; "$REAL_AWK" "$@" >"$FAKE_AWK_DIR/o"; head -c "$(($(wc -c <"$FAKE_AWK_DIR/o") / 2))" "$FAKE_AWK_DIR/o"'
)
guard_fake() { ( cd "$GUARD_CWD" && jqn -n --arg c "$1" --arg d "$GUARD_CWD" '{cwd:$d,tool_input:{command:$c}}' | PATH="$FAKE_AWK_DIR:$PATH" "$GUARD_BASH" "$HOOKS/autonomy-git-guard.sh" ); }
denied_fake() { [ "$(jq -r '.hookSpecificOutput.permissionDecision // ""' <<<"$(guard_fake "$1")")" = deny ]; }
for fa in "${awk_fault_cases[@]}"; do
  fake_awk "REAL_AWK='$REAL_AWK'; FAKE_AWK_DIR='$FAKE_AWK_DIR'; $fa"
  flag_on
  check "git-guard fails closed on awk fault (flag on, $fa): push to base" denied_fake "git push origin main"
  check "git-guard fails closed on awk fault (flag on, $fa): rm -rf worktree" denied_fake "rm -rf $GUARD_CWD"
  check "git-guard fails closed on awk fault (flag on, $fa): protected write" denied_fake "echo x > .claude/foo"
  rm -f "$TMP/state/autonomy.on"
  check "git-guard fails closed on awk fault (flag off, $fa): git worktree remove" denied_fake "git worktree remove x"
done
rm -f "$TMP/state/autonomy.on"

WGF="$(mktemp -d)"; WGF="$(cd -P "$WGF" && pwd)"
mkdir -p "$WGF/main" "$WGF/st"
git -C "$WGF/main" init -q . && git -C "$WGF/main" -c user.email=a@b -c user.name=n commit -q --allow-empty -m i
git -C "$WGF/main" worktree add -q "$WGF/sib" -b sib
git -C "$WGF/main" worktree add -q "$WGF/orca/workspaces/r/w" -b w
mkdir -p "$WGF/sib/node_modules" "$WGF/sib/build"
wg_decision() { # mode cwd cmd
  rm -f "$WGF/st/autonomy.on"; [ "$1" = on ] && : >"$WGF/st/autonomy.on"
  local out
  out="$(jqn -n --arg c "$3" --arg w "$2" '{tool_input:{command:$c},cwd:$w}' \
    | AGENT_HARNESS_TEST=1 AGENT_STATE_DIR="$WGF/st" CLAUDE_PROJECT_DIR="$WGF/main" "$GUARD_BASH" "$HOOKS/autonomy-git-guard.sh")"
  [ -n "$out" ] || { echo allow; return; }
  jq -r '.hookSpecificOutput.permissionDecision // "allow"' <<<"$out"
}
wg_rel_decision() {
  rm -f "$WGF/st/autonomy.on"
  jqn -n --arg c "rm -rf ../sib" --arg w "$WGF/main" '{tool_input:{command:$c},cwd:$w}' \
    | AGENT_HARNESS_TEST=1 AGENT_STATE_DIR="$WGF/st" CLAUDE_PROJECT_DIR="$WGF/main" "$NORM_SHELL" "$HOOKS/autonomy-git-guard.sh" \
    | jq -r '.hookSpecificOutput.permissionDecision // "allow"'
}
wg_escaped_field() { # shell cmd -> "<decision> stderr-bytes"
  local out err
  : >"$WGF/st/autonomy.on"
  err="$WGF/err"
  out="$(jqn -n --arg c "$2" --arg w "$WGF/main" '{tool_input:{command:$c},cwd:$w}' \
    | AGENT_HARNESS_TEST=1 AGENT_STATE_DIR="$WGF/st" CLAUDE_PROJECT_DIR="$WGF/main" "$1" "$HOOKS/autonomy-git-guard.sh" 2>"$err")"
  printf '%s %s' "$(jq -r '.hookSpecificOutput.permissionDecision // "allow"' <<<"$out")" "$(wc -c <"$err" | tr -d ' ')"
}
for esc_sh in "$GUARD_BASH" /bin/bash; do
  [ -x "$esc_sh" ] || continue
  for esc_cmd in 'git push origin ma\in' 'git push origin "ma\in"' 'git -C /tmp/a\ b push origin main'; do
    check "git-guard escaped field denies with empty stderr ($esc_sh): $esc_cmd" test "$(wg_escaped_field "$esc_sh" "$esc_cmd")" = "deny 0"
  done
done
rm -f "$WGF/st/autonomy.on"
wg() { local exp="$1" cwd="$2" m; shift 2; for m in off on; do check "git-guard worktree ($m) $exp: $*" test "$(wg_decision "$m" "$cwd" "$*")" = "$exp"; done; }
WM="$WGF/main"; WS="$WGF/sib"
wg deny "$WM" "if true; then git worktree remove /p; fi"
wg deny "$WM" "! git worktree remove /p"
wg deny "$WM" "env -i git worktree remove /p"
wg deny "$WM" "sudo -u me rm -rf $WS"
wg deny "$WM" "bash -x -c 'git worktree remove /p'"
wg deny "$WM" "git --git-dir .git worktree remove /p"
wg deny "$WM" "git -c alias.x='worktree remove' x /p"
wg deny "$WM" "git config alias.wr 'worktree remove'"
wg deny "$WM" "rm -rf ../sib"
for ush in bash /bin/bash; do
  command -v "$ush" >/dev/null 2>&1 || continue
  check "git-guard resolves a .. segment in a relative path ($ush)" test "$(NORM_SHELL="$ush" wg_rel_decision)" = deny
done
wg deny "$WS" "rm -rf ."
wg deny "$WS" "rm -rf *"
wg deny "$WM" "cd $WGF/orca/workspaces/r && rm -rf w"
wg deny "$WM" "mv $WS /tmp/x"
wg deny "$WM" "trash $WS"
wg deny "$WM" "find $WS -delete"
wg deny "$WS" "find . -delete"
wg deny "$WM" "echo /p | xargs rm -rf"
wg deny "$WM" "python3 -c 'import shutil; shutil.rmtree(\"/Users/x/orca/workspaces/r/w\")'"
wg deny "$WM" "orca --json worktree rm --worktree path:/x"
wg deny "$WM" "export ORCA_BIN=/t; agent-harness worktree-rm /x --confirmed"
wg ask "$WM" "bash -x scripts/agent-harness/worktree-rm.sh /p --confirmed"
wg ask "$WM" "agent-harness worktree-rm /x --confirmed"
wg allow "$WM" "git worktree prune -n"
wg allow "$WM" "git worktree list"
wg allow "$WM" "git worktree add ../y -b feat/y"
wg allow "$WM" "orca worktree list --json"
wg allow "$WS" "rm -rf node_modules"
wg allow "$WM" "cd $WS && rm -rf build"
wg allow "$WM" "rm -rf build"
wg allow "$WM" "mv a.txt b.txt"
wg deny "$WM" "rm -rf $WGF/{sib,foo}"
wg deny "$WM" "rm -rf $WGF/sib{2,}"
wg deny "$WM" "rm -rf $WGF/{a..c}"
wg deny "$WM" "rm -rf $WGF/{a,b}"
wg deny "$WM" "(cd $WGF && rm -rf sib)"
wg deny "$WM" "{ cd $WGF && rm -rf sib; }"
wg allow "$WM" "rm -rf client/{a,b}"
wg allow "$WM" "rm -rf build/{x,y}"
wg allow "$WM" "agent-harness worktree-rm /x"
wg allow "$WGF/st" "find . -name x -delete"
wg allow "$WM" "git commit -m 'doc git worktree remove'"
wg deny "$WM" 'git worktree ${x:-remove} /p'
wg deny "$WM" 'git worktree $x /p'
wg deny "$WS" 'rm -f .git'
wg deny "$WS" 'rm .git'
wg deny "$WM" "rm -rf $WS/.git"
wg deny "$WM" "rm -rf $WS/.git/"
wg deny "$WM" 'rm -rf $(echo /no/such/worktree)'
rm -rf "$WGF"

# ---- worktree-rm
cat >"$TMP/orcawt" <<'STUB'
#!/usr/bin/env bash
echo "$*" >>"$FX/orcawt.log"
case "${1:-} ${2:-}" in
  "repo list")
    [ ! -e "$FX/orca_repo_fail" ] || exit 1
    if [ -e "$FX/orca_repo_managed" ]; then jq -n --arg p "$WMAIN" '{ok:true,result:{repos:[{path:$p}]}}'; fi ;;
  "worktree list")
    [ ! -e "$FX/orca_wt_fail" ] || exit 1
    if [ -f "$FX/orca_wt.json" ]; then cat "$FX/orca_wt.json"; else echo '{"ok":true,"result":{"worktrees":[]}}'; fi ;;
  "worktree rm")
    [ -f "$FX/orca_rm_hook" ] && bash "$FX/orca_rm_hook"
    p=""; for a in "$@"; do case "$a" in path:*) p="${a#path:}" ;; esac; done
    git -C "$WMAIN" worktree remove --force "$p" >/dev/null 2>&1
    echo '{"ok":true,"result":{"removed":true,"removing":true}}' ;;
esac
STUB
chmod +x "$TMP/orcawt"
export AGENT_HARNESS_WORKTREE_RM_WAIT=3 AGENT_HARNESS_WORKTREE_RM_SETTLE=0

WTN=0
wtfx() {
  WTN=$((WTN + 1)); WB="$TMP/wtfx$WTN"; mkdir -p "$WB"; WB="$(cd "$WB" && pwd -P)"
  git init -q --bare "$WB/origin.git"
  git clone -q "$WB/origin.git" "$WB/main" 2>/dev/null
  ( cd "$WB/main" && git config user.email t@t && git config user.name t && git checkout -q -b master \
    && echo a >a && echo t >tracked && git add a tracked && git commit -qm A && git push -q origin master \
    && git worktree add -q -b feat-x "$WB/wt" origin/master && git worktree add -q -b feat-sib "$WB/sib" origin/master ) >/dev/null 2>&1
  export WMAIN="$WB/main"; WT="$WB/wt"; SIB="$WB/sib"
  reset; rm -f "$FX"/orca_wt.json "$FX"/orca_rm_hook "$FX"/orca_repo_fail "$FX"/orca_repo_managed "$FX"/orca_wt_fail; echo '{"base":"master"}' >"$CFG"
  WCWD="$WMAIN"
}
wtrm() { ( cd "$WCWD" && env ORCA_BIN="$TMP/orcawt" bash "$H/worktree-rm.sh" "$@" ); }
nrefs() { git -C "$WMAIN" for-each-ref 'refs/harness/snapshots/' | wc -l | tr -d ' '; }
listed() { git -C "$WMAIN" worktree list --porcelain | grep -qxF "worktree $1"; }
orca_activity() { jq -n --arg p "$WT" --argjson t "$1" '{ok:true,result:{worktrees:[{path:$p,lastActivityAt:$t}]}}' >"$FX/orca_wt.json"; }
now_ms() { echo $(($(date +%s) * 1000)); }
dirty_main() { echo "edit" >>"$WMAIN/tracked"; echo u >"$WMAIN/untracked.txt"; }
DESTROY_HOOK='git -C "$WMAIN" reset -q --hard && git -C "$WMAIN" clean -qfd'

if [ "$ONLY" != guard ]; then
wtfx; out="$(wtrm "$WT" 2>&1)"; rc=$?
check "worktree-rm: dry run exits 3" test $rc -eq 3
check "worktree-rm: dry run leaves target in place" test -d "$WT"
check "worktree-rm: dry run leaves target listed" listed "$WT"

wtfx; out="$(wtrm "$WT" --confirmed 2>&1)"; rc=$?
check "worktree-rm: clean git route exits 0" test $rc -eq 0
check "worktree-rm: clean git route removes directory" test ! -e "$WT"
check "worktree-rm: clean git route unlists worktree" bash -c '! git -C "$1" worktree list --porcelain | grep -qxF "worktree $2"' _ "$WMAIN" "$WT"
check "worktree-rm: clean git route reports route git" grep -q 'worktree-rm: route git' <<<"$out"
check "worktree-rm: clean git route reports removed" grep -q "worktree-rm: removed $WT" <<<"$out"
check "worktree-rm: clean git route leaves no snapshot refs" test "$(nrefs)" = 0

wtfx; orca_activity 0; out="$(wtrm "$WT" --confirmed 2>&1)"; rc=$?
check "worktree-rm: orca route exits 0" test $rc -eq 0
check "worktree-rm: orca route reports route orca" grep -q 'worktree-rm: route orca' <<<"$out"
check "worktree-rm: orca route calls orca worktree rm with path and json" grep -qF "worktree rm --worktree path:$WT --json" "$FX/orcawt.log"
check "worktree-rm: orca route never passes --force" bash -c '! grep "worktree rm" "$1" | grep -q -- "--force"' _ "$FX/orcawt.log"
check "worktree-rm: orca route never passes --run-hooks" bash -c '! grep "worktree rm" "$1" | grep -q -- "--run-hooks"' _ "$FX/orcawt.log"
check "worktree-rm: orca route removes directory" test ! -e "$WT"

wtfx; orca_activity "$(now_ms)"; out="$(wtrm "$WT" --confirmed 2>&1)"; rc=$?
check "worktree-rm: recent orca activity exits 1" test $rc -eq 1
check "worktree-rm: recent orca activity prints STOP" grep -q 'STOP' <<<"$out"
check "worktree-rm: recent orca activity keeps target" test -d "$WT"
check "worktree-rm: recent orca activity never calls orca rm" bash -c '! grep -q "worktree rm" "$1" 2>/dev/null' _ "$FX/orcawt.log"

wtfx; git -C "$WT" commit -q --allow-empty -m ahead; out="$(wtrm "$WT" --confirmed 2>&1)"; rc=$?
check "worktree-rm: target ahead of origin exits 1" test $rc -eq 1
check "worktree-rm: target ahead keeps target" test -d "$WT"
check "worktree-rm: target ahead prints STOP" grep -q 'STOP' <<<"$out"

wtfx; echo "mine" >"$WT/tracked"; out="$(wtrm "$WT" --confirmed 2>&1)"; rc=$?
check "worktree-rm: dirty target exits 1" test $rc -eq 1
check "worktree-rm: dirty target keeps edit intact" grep -q mine "$WT/tracked"

wtfx; out="$(wtrm "$WMAIN" --confirmed 2>&1)"; rc=$?
check "worktree-rm: main checkout exits 1" test $rc -eq 1
check "worktree-rm: main checkout survives" test -d "$WMAIN/.git"
wtfx; WCWD="$WT"; out="$(wtrm "$WT" --confirmed 2>&1)"; rc=$?
check "worktree-rm: cwd as target exits 1" test $rc -eq 1
check "worktree-rm: cwd as target survives" test -d "$WT"
wtfx; mkdir -p "$WB/stray"; out="$(wtrm "$WB/stray" --confirmed 2>&1)"; rc=$?
check "worktree-rm: unregistered path exits 1" test $rc -eq 1
check "worktree-rm: unregistered path survives" test -d "$WB/stray"

wtfx; dirty_main; out="$(wtrm "$WT" --confirmed 2>&1)"; rc=$?
check "worktree-rm: dirty main exits 0" test $rc -eq 0
check "worktree-rm: dirty main prints snapshot line" grep -q 'worktree-rm: snapshot ' <<<"$out"
check "worktree-rm: dirty main prints intact line" grep -q "worktree-rm: intact $WMAIN" <<<"$out"
check "worktree-rm: dirty main tracked edit intact" grep -q edit "$WMAIN/tracked"
check "worktree-rm: dirty main untracked file intact" test -f "$WMAIN/untracked.txt"
check "worktree-rm: dirty main releases snapshot ref" test "$(nrefs)" = 0
check "worktree-rm: dirty main prints snapshot released" grep -q 'worktree-rm: snapshot released ' <<<"$out"

wtfx; orca_activity 0; dirty_main; echo "$DESTROY_HOOK" >"$FX/orca_rm_hook"; out="$(wtrm "$WT" --confirmed 2>&1)"; rc=$?
check "worktree-rm: restore after destructive removal exits 0" test $rc -eq 0
check "worktree-rm: restore prints restored line" grep -q "worktree-rm: restored $WMAIN from " <<<"$out"
check "worktree-rm: restore brings tracked edit back" grep -q edit "$WMAIN/tracked"
check "worktree-rm: restore brings untracked file back" test -f "$WMAIN/untracked.txt"
check "worktree-rm: restore releases snapshot ref" test "$(nrefs)" = 0

wtfx; orca_activity 0
echo seed >>"$WMAIN/tracked"; git -C "$WMAIN" stash push -q -m other-session
dirty_main; echo "$DESTROY_HOOK" >"$FX/orca_rm_hook"
stash_before="$(git -C "$WMAIN" stash list --format=%H)"
out="$(wtrm "$WT" --confirmed 2>&1)"; rc=$?
check "worktree-rm: stash seeded run exits 0" test $rc -eq 0
check "worktree-rm: stash stack identical after restore" test "$(git -C "$WMAIN" stash list --format=%H)" = "$stash_before"
check "worktree-rm: pre-seeded stash is non-empty" test -n "$stash_before"

wtfx; orca_activity 0; dirty_main; echo "$DESTROY_HOOK"' && echo new >"$WMAIN/new.txt"' >"$FX/orca_rm_hook"
out="$(wtrm "$WT" --confirmed 2>&1)"; rc=$?
check "worktree-rm: unrestorable damage exits 4" test $rc -eq 4
check "worktree-rm: unrestorable damage prints damaged line" grep -q "worktree-rm: damaged $WMAIN (HEAD moved/unclean; inspect: git -C $WMAIN diff HEAD " <<<"$out"
check "worktree-rm: unrestorable damage keeps snapshot ref" test "$(nrefs)" = 1
check "worktree-rm: unrestorable damage keeps unknown edit" test -f "$WMAIN/new.txt"

wtfx; dirty_main; git init -q "$WMAIN/nested"; out="$(wtrm "$WT" --confirmed 2>&1)"; rc=$?
check "worktree-rm: nested repo in dirty main exits 0" test $rc -eq 0
check "worktree-rm: nested repo notes not snapshotted" grep -q "worktree-rm: note $WMAIN nested repo nested not snapshotted" <<<"$out"
check "worktree-rm: nested repo run reports intact" grep -q "worktree-rm: intact $WMAIN" <<<"$out"

wtfx; orca_activity 0; chmod +x "$WMAIN/a"; echo 'chmod -x "$WMAIN/a"' >"$FX/orca_rm_hook"; out="$(wtrm "$WT" --confirmed 2>&1)"; rc=$?
check "worktree-rm: chmod-only damage exits 0" test $rc -eq 0
check "worktree-rm: chmod-only damage restored" grep -q "worktree-rm: restored $WMAIN from " <<<"$out"
check "worktree-rm: chmod-only damage executable bit back" test -x "$WMAIN/a"

wtfx; orca_activity 0; echo s >>"$WMAIN/tracked"; git -C "$WMAIN" add tracked; echo "$DESTROY_HOOK" >"$FX/orca_rm_hook"; out="$(wtrm "$WT" --confirmed 2>&1)"; rc=$?
check "worktree-rm: staged-only loss exits 0" test $rc -eq 0
check "worktree-rm: staged-only loss restored" grep -q "worktree-rm: restored $WMAIN from " <<<"$out"
check "worktree-rm: staged-only loss keeps change staged" test "$(git -C "$WMAIN" diff --cached --name-only)" = tracked

wtfx; orca_activity 0; echo s >>"$WMAIN/tracked"; git -C "$WMAIN" add tracked; echo 'git -C "$WMAIN" reset -q' >"$FX/orca_rm_hook"; out="$(wtrm "$WT" --confirmed 2>&1)"; rc=$?
check "worktree-rm: index-only loss exits 4" test $rc -eq 4
check "worktree-rm: index-only loss keeps snapshot ref" test "$(nrefs)" = 1

wtfx; orca_activity 0; dirty_main; echo "$DESTROY_HOOK"' && git -C "$WMAIN" commit -q --allow-empty -m moved' >"$FX/orca_rm_hook"; out="$(wtrm "$WT" --confirmed 2>&1)"; rc=$?
check "worktree-rm: HEAD moved with damage exits 4" test $rc -eq 4
check "worktree-rm: HEAD moved prints damaged line" grep -q "worktree-rm: damaged $WMAIN (HEAD moved/unclean" <<<"$out"
check "worktree-rm: HEAD moved reports change" grep -q "worktree-rm: changed during removal $WMAIN" <<<"$out"
check "worktree-rm: HEAD moved keeps snapshot ref" test "$(nrefs)" = 1

wtfx; echo '{ "ok": true, "result": { "worktrees": [{ "path": "'"$WT"'", "lastActivityAt": null }] } }' >"$FX/orca_wt.json"; out="$(wtrm "$WT" --confirmed 2>&1)"; rc=$?
check "worktree-rm: null activity exits 1" test $rc -eq 1
check "worktree-rm: null activity prints activity unknown" grep -q 'activity unknown' <<<"$out"
check "worktree-rm: null activity keeps target" test -d "$WT"

wtfx; orca_activity $(( $(now_ms) - 1800000 )); echo '{"base":"master","worktreeIdleMinutes":"abc"}' >"$CFG"; out="$(wtrm "$WT" --confirmed 2>&1)"; rc=$?
check "worktree-rm: non-numeric idle config falls back to 60" grep -q 'active within 60 min' <<<"$out"
check "worktree-rm: non-numeric idle config exits 1" test $rc -eq 1

wtfx; : >"$FX/orca_repo_fail"; out="$(wtrm "$WT" --confirmed 2>&1)"; rc=$?
check "worktree-rm: an unreadable orca repo list is a STOP" test "$rc|$(grep -c 'check activity STOP (orca state unreadable)' <<<"$out")|$(test -d "$WT" && echo kept)" = "1|1|kept"
wtfx; : >"$FX/orca_repo_managed"; : >"$FX/orca_wt_fail"; out="$(wtrm "$WT" --confirmed 2>&1)"; rc=$?
check "worktree-rm: a managed repo with an unreadable worktree list is a STOP" test "$rc|$(grep -c 'check activity STOP (orca worktree list unreadable)' <<<"$out")|$(test -d "$WT" && echo kept)" = "1|1|kept"
wtfx; : >"$FX/orca_repo_managed"; orca_activity 0; out="$(wtrm "$WT" --confirmed 2>&1)"; rc=$?
check "worktree-rm: a managed repo with a readable idle worktree list proceeds" test "$rc|$(test -e "$WT" && echo kept || echo gone)" = "0|gone"

wtfx; mkdir -p "$WMAIN/.git/info"; echo ign >>"$WMAIN/.git/info/exclude"; echo x >"$WT/ign"; out="$(wtrm "$WT" 2>&1)"; rc=$?
check "worktree-rm: ignored files note in dry run" grep -q "worktree-rm: note $WT has ignored files that will be deleted: ign" <<<"$out"

wtfx; dirty_main; out="$(wtrm "$WT" --confirmed 2>&1)"
check "worktree-rm: release line prints sha" grep -Eq 'worktree-rm: snapshot refs/harness/snapshots/[0-9]+-1 = [0-9a-f]{40} \(recoverable until gc\)' <<<"$out"

wtfx; flag_on; out="$(wtrm "$WT" --confirmed 2>&1)"; rc=$?
check "worktree-rm: autonomy on refuses" test $rc -eq 1
check "worktree-rm: autonomy on keeps target" test -d "$WT"
wtfx; wtrm >/dev/null 2>&1; check "worktree-rm: no args exits 2" test $? -eq 2
wtrm "$WT" --bogus >/dev/null 2>&1; check "worktree-rm: unknown flag exits 2" test $? -eq 2
wtrm "$WT" "$SIB" --confirmed >/dev/null 2>&1; check "worktree-rm: two paths exits 2" test $? -eq 2
check "worktree-rm: usage errors change nothing" test -d "$WT"

wtfx; out="$( cd "$WMAIN" && ORCA_BIN="$TMP/orcawt" bash "$DISP" worktree-rm "$WT" 2>&1 )"; rc=$?
check "dispatcher: worktree-rm forwards (dry run exits 3)" test $rc -eq 3
check "dispatcher: worktree-rm forwarded target intact" test -d "$WT"

fi
# ---- worktree guard (every mode)
wtfx; reset; GUARD_CWD="$WMAIN"
G_DENY=(
  "orca worktree rm --worktree path:$WT --json"
  "orca worktree remove x"
  "orca worktree delete x"
  "git worktree remove $WT"
  "git -C $WMAIN worktree remove --force $WT"
  "git worktree prune"
  "git worktree move $WT $WB/moved"
  "rm -rf $WT"
  "rm -r $WT"
  "rm -R $WT"
  "rm --recursive $WT"
  "rm -rf $SIB"
  "rm -rf /Users/x/orca/workspaces/gc.platform/feat-y"
  "ORCA_BIN=/x agent-harness worktree-rm $WT"
  "agent-harness worktree-rm /x --force"
)
G_ASK=("agent-harness worktree-rm /x --confirmed")
G_ALLOW=("agent-harness worktree-rm /x" "git worktree list" "orca worktree list --json" "rm -rf build")
for mode in off on; do
  reset; [ "$mode" = on ] && flag_on
  for c in "${G_DENY[@]}"; do check "worktree guard (flag $mode) denies: $c" denied "$c"; done
  for c in "${G_ASK[@]}"; do check "worktree guard (flag $mode) asks: $c" asked "$c"; done
  for c in "${G_ALLOW[@]}"; do check "worktree guard (flag $mode) allows: $c" allowed "$c"; done
done
GUARD_CWD="$TMP/work"


if [ "$ONLY" != guard ]; then
# ---- goal worktree lifecycle (fake gh/orca on PATH, no env seams)
LROOT="$(cd "$TMP" && pwd -P)/lw"; mkdir -p "$LROOT" "$TMP/lbin" "$TMP/lsleep"
ln -sf "$TMP/gh" "$TMP/lbin/gh"
cat >"$TMP/lbin/orca" <<'STUB'
#!/usr/bin/env bash
echo "$*" >>"$FX/orca.log"
arg() { local k="$1"; shift; while [ $# -gt 1 ]; do [ "$1" = "$k" ] && { echo "$2"; return; }; shift; done; }
case "${1:-} ${2:-}" in
  "repo list")
    [ ! -e "$FX/orca.list.fail" ] || exit 1
    if [ -s "$FX/orca.managed" ]; then jq -n --arg p "$(cat "$FX/orca.managed")" '{id:"i",ok:true,result:{repos:[{id:"r",path:$p,displayName:"r"}]}}'
    else echo '{"id":"i","ok":true,"result":{"repos":[]}}'; fi ;;
  "worktree list")
    repo="$(arg --repo "$@")"; repo="${repo#path:}"
    act="$(cat "$FX/orca.activity" 2>/dev/null || echo 1)"
    noact=false; [ ! -e "$FX/orca.noactivity" ] || noact=true
    git -C "$repo" worktree list --porcelain | jq -Rn --argjson a "$act" --argjson noact "$noact" '
      [inputs] | join("\n") | split("\n\n") | map(select(length > 0) | split("\n")
        | {path: (.[0] | sub("^worktree "; "")), branch: ((map(select(startswith("branch "))) | .[0] // "") | sub("^branch "; "")),
           lastActivityAt: $a})
      | to_entries | map(.value + {isMainWorktree: (.key == 0)})
      | map(if $noact then del(.lastActivityAt) else . end)
      | {id: "i", ok: true, result: {worktrees: .}}' \
      | { if [ -e "$FX/orca.foreign" ]; then jq --arg p "$FX/orca-wt/$(cat "$FX/orca.foreign")" '.result.worktrees += [{path: $p, branch: "", isMainWorktree: false, lastActivityAt: 1}]'; else cat; fi; } ;;
  "worktree create")
    repo="$(arg --repo "$@")"; repo="${repo#path:}"; name="$(arg --name "$@")"; base="$(arg --base-branch "$@")"
    dest="$FX/orca-wt/$name"; mkdir -p "$FX/orca-wt"
    if [ -e "$FX/orca.foreign" ]; then
      echo "$name" >"$FX/orca.foreign"
      git -C "$FX/foreign" worktree add -q -b "$name" "$dest" >/dev/null 2>&1 || exit 1
    else
      git -C "$repo" worktree add -q -b "$name" "$dest" "$base" >/dev/null 2>&1 || exit 1
    fi
    echo '{"id":"i","ok":true,"result":{"created":true}}' ;;
  "worktree rm")
    if [ -e "$FX/orca.rm.fail" ]; then echo '{"id":"i","ok":false,"error":{"code":"rm_failed"}}'; exit 1; fi
    t="$(arg --worktree "$@")"; t="${t#path:}"
    main="$(dirname "$(git -C "$t" rev-parse --path-format=absolute --git-common-dir)")"
    git -C "$main" worktree remove "$t" >/dev/null 2>&1 || exit 1
    echo '{"id":"i","ok":true,"result":{"removed":true}}' ;;
esac
STUB
printf '#!/bin/sh\nexit 0\n' >"$TMP/lsleep/sleep"
cat >"$TMP/lbin/fake-chrome" <<'STUB'
#!/usr/bin/env bash
for a in "$@"; do case "$a" in --screenshot=*) printf '\211PNG\r\n\032\nfake' >"${a#--screenshot=}" ;; file://*) cp "${a#file://}" "$FX/chrome.html" ;; esac; done
echo "$*" >"$FX/chrome.args"
STUB
chmod +x "$TMP/lbin/orca" "$TMP/lsleep/sleep" "$TMP/lbin/fake-chrome"

LM="$LROOT/main"
FXR="$(cd "$FX" && pwd -P)"
LCWD=""
LH() {
  local sub="$1" unsets=(-u GH_BIN -u ORCA_BIN -u AGENT_STATE_DIR -u CLAUDE_PROJECT_DIR) sets=(); shift
  if [ -n "${LH_TEST:-}" ]; then sets+=(AGENT_HARNESS_TEST=1); else unsets+=(-u AGENT_HARNESS_TEST); fi
  ( cd "${LCWD:-$LM}" && env "${unsets[@]}" PATH="$TMP/lsleep:$TMP/lbin:$PATH" ${sets[@]+"${sets[@]}"} bash "$H/$sub.sh" "$@" )
}
lreg_file() { echo "$LM/.git/agent-harness/goals/$1.json"; }
lreg() { jq -r "$2" "$(lreg_file "$1")"; }
lw_listed() { git -C "$LM" worktree list --porcelain | grep -qx "worktree $1"; }
lw_fixture() {
  reset; rm -rf "${LROOT:?}"/* "$FX/orca-wt" "$FX/foreign" "$FX/orca.managed" "$FX"/orca.* "$FX/out" "$FX/err" "$FX/chrome.args" "$TMP/elsewhere"
  mkdir -p "$LROOT"
  git init -q --bare "$LROOT/origin.git"
  git clone -q "$LROOT/origin.git" "$LM" 2>/dev/null
  ( cd "$LM" && git config user.email t@t && git config user.name t && git checkout -q -b master \
    && echo a >a && echo b >b && git add a b && git commit -qm A && git push -q -u origin master \
    && git remote set-head origin master ) >/dev/null 2>&1
  mkdir -p "$LM/.git/info"; printf '.claude/state/\n' >>"$LM/.git/info/exclude"
  [ "${1:-git}" != orca ] || printf '%s' "$LM" >"$FX/orca.managed"
}

# registry and ship-init
lw_fixture git
LH ship-init feat ui hud-theme --goal "build the hud" >"$FX/out" 2>"$FX/err"; rc=$?
LT="$LROOT/main-wt/feat-ui-hud-theme"; LS=feat-ui-hud-theme
check "ship-init git: exits 0" test $rc -eq 0
check "ship-init git: prints the path" test "$(cat "$FX/out")" = "$LT"
check "ship-init git: sibling directory outside the repo" test "$(dirname "$LT")" = "$LM-wt"
check "ship-init git: worktree on the typed branch" test "$(git -C "$LT" branch --show-current)" = feat/ui-hud-theme
check "ship-init git: branch starts at origin/master" test "$(git -C "$LT" rev-parse HEAD)" = "$(git -C "$LM" rev-parse origin/master)"
check "ship-init git: registry lives in the git common dir" test -f "$LM/.git/agent-harness/goals/$LS.json"
check "ship-init git: registry schema" test "$(lreg $LS '[.v, .goal, .branch, .path, .base, .via, (.pr|tostring), .head_oid, .status, .reason, .report] | join("|")')" = "1|build the hud|feat/ui-hud-theme|$LT|master|git|null||active||"
check "ship-init git: registry has a creation time" test -n "$(lreg $LS '.created_at // empty')"
check "ship-init git: nothing tracked or untracked in main" test -z "$(git -C "$LM" status --porcelain)"
check "ship-init git: registry file is not tracked" test -z "$(git -C "$LM" ls-files agent-harness .git)"
check "ship-init git: fix cap is 3" test "$(jq -r .max_fix_iterations "$LM/.claude/state/goal.json")" = 3
LH ship-init fix ui other-goal >"$FX/out" 2>&1; rc=$?
LT2="$LROOT/main-wt/fix-ui-other-goal"
check "two concurrent goals: second ship-init succeeds" test $rc -eq 0
check "two concurrent goals: two registry files" test "$(find "$LM/.git/agent-harness/goals" -name '*.json' | wc -l | tr -d ' ')" = 2
check "two concurrent goals: distinct worktrees" test -d "$LT" -a -d "$LT2"
check "two concurrent goals: both active" test "$(lreg $LS .status)|$(lreg fix-ui-other-goal .status)" = "active|active"
LH ship-init feat ui hud-theme >"$FX/out" 2>"$FX/err"; rc=$?
check "ship-init refuses a slug that is already active" test $rc -eq 1
check "ship-init refusal names the active goal" grep -q 'already active' "$FX/err"
jq --arg s "$LS" --arg b feat/ui-hud-theme '.slug = $s | .branch = $b' "$LM/.claude/state/goal.json" >"$FX/t" && mv "$FX/t" "$LM/.claude/state/goal.json"
LCWD="$LT" LH goal set "g" >/dev/null 2>&1
check "goal set keeps the slug of the active goal" test "$(jq -r .slug "$LM/.claude/state/goal.json")" = "$LS"
LCWD="$LT" LH goal pr 7 >/dev/null 2>&1
check "goal pr mirrors the PR into the registry" test "$(lreg $LS '.pr')" = 7
check "goal pr leaves the other goal alone" test "$(lreg fix-ui-other-goal '.pr')" = null
LCWD="$LT" LH goal sha abc123 >/dev/null 2>&1
check "goal sha mirrors head_oid into the registry" test "$(lreg $LS .head_oid)" = abc123
LCWD="$LT" LH goal escalate "needs a human" >/dev/null 2>&1
check "goal escalate mirrors status and reason into the registry" test "$(lreg $LS '[.status, .reason] | join("|")')" = "escalated|needs a human"
LH ship-init feat ui hud-theme >"$FX/out" 2>"$FX/err"; rc=$?
check "ship-init refuses a slug whose worktree still exists" test $rc -eq 1
check "ship-init refusal creates nothing new" test "$(find "$LM/.git/agent-harness/goals" -name '*.json' | wc -l | tr -d ' ')" = 2

lw_fixture git
LH ship-init wip ui x >/dev/null 2>&1; rc=$?; check "ship-init rejects bad type" test $rc -eq 1
LH ship-init feat Ui x >/dev/null 2>&1; rc=$?; check "ship-init rejects uppercase scope" test $rc -eq 1
LH ship-init feat ui-kit x >/dev/null 2>&1; rc=$?; check "ship-init rejects hyphen in scope" test $rc -eq 1
LH ship-init feat ui Bad-Desc >/dev/null 2>&1; rc=$?; check "ship-init rejects uppercase description" test $rc -eq 1
LH ship-init feat ui bad_desc >/dev/null 2>&1; rc=$?; check "ship-init rejects non-kebab description" test $rc -eq 1
LH ship-init feat ui >/dev/null 2>&1; rc=$?; check "ship-init rejects a missing description" test $rc -eq 2
LH ship-init --adopt abc >/dev/null 2>&1; rc=$?; check "ship-init rejects a non-numeric PR" test $rc -eq 2
LH ship-init feat ui x --bogus >/dev/null 2>&1; rc=$?; check "ship-init rejects an unknown flag" test $rc -eq 2
check "ship-init refusals create no worktree" test ! -e "$LM-wt"
check "ship-init refusals write no registry" test ! -e "$LM/.git/agent-harness"

lw_fixture orca
LH ship-init fix ui orca-x >"$FX/out" 2>"$FX/err"; rc=$?
LT="$FX/orca-wt/fix-ui-orca-x"; LS=fix-ui-orca-x
LTN="$(cd "$LT" && pwd -P)"
check "ship-init orca: exits 0" test $rc -eq 0
check "ship-init orca: calls orca worktree create" grep -qF -- "worktree create --repo path:$LM --name $LS --base-branch origin/master --setup skip --json" "$FX/orca.log"
check "ship-init orca: resolves the path from worktree list" grep -qF -- "worktree list --repo path:$LM --json" "$FX/orca.log"
check "ship-init orca: branch renamed to the typed branch" test "$(git -C "$LT" branch --show-current)" = fix/ui-orca-x
check "ship-init orca: registry records via orca and the resolved path" test "$(lreg $LS '[.path, .via] | join("|")')" = "$LTN|orca"
lw_fixture orca
mkdir -p "$LROOT/elsewhere"; git -C "$LM" worktree add -q -b other-b "$LROOT/elsewhere/fix-ui-orca-x" >/dev/null 2>&1
LH ship-init fix ui orca-x >"$FX/out" 2>"$FX/err"; rc=$?
check "ship-init orca name collision: exits 1" test $rc -eq 1
check "ship-init orca name collision: names the pre-existing candidate" grep -qF "orphan worktree, not recorded: $LROOT/elsewhere/fix-ui-orca-x" "$FX/err"
check "ship-init orca name collision: names the created candidate" grep -qF "orphan worktree, not recorded: $FXR/orca-wt/fix-ui-orca-x" "$FX/err"
check "ship-init orca name collision: records nothing" test ! -e "$LM/.git/agent-harness/goals/fix-ui-orca-x.json"
lw_fixture git
printf '[]' >"$FX/orca.managed"
LH ship-init fix ui garbage-managed >/dev/null 2>&1; rc=$?
check "ship-init: an unusable orca repo list counts as not managed" test $rc -eq 0
check "ship-init: not-managed repo uses git" test "$(lreg fix-ui-garbage-managed .via)" = git

lw_adopt_fixture() {
  lw_fixture "$1"
  ( cd "$LM" && git checkout -q -b feat/adopt-me && echo d >d && git add d && git commit -qm D \
    && git push -q origin feat/adopt-me && git checkout -q master ) >/dev/null 2>&1
}
lw_adopt_fixture git; ( cd "$LM" && git branch -q -D feat/adopt-me ) >/dev/null 2>&1
jq -n '{headRefName:"feat/adopt-me",isCrossRepository:false}' >"$FX/view.json"
LH ship-init --adopt 9 >"$FX/out" 2>&1; rc=$?
LT="$LROOT/main-wt/feat-adopt-me"
check "ship-init adopt: exits 0" test $rc -eq 0
check "ship-init adopt: worktree on the PR head branch" test "$(git -C "$LT" branch --show-current)" = feat/adopt-me
check "ship-init adopt: tracks origin" test "$(git -C "$LT" rev-parse --abbrev-ref '@{upstream}')" = origin/feat/adopt-me
check "ship-init adopt: registry records the PR" test "$(lreg feat-adopt-me '[.branch, (.pr | tostring)] | join("|")')" = "feat/adopt-me|9"
lw_adopt_fixture git
jq -n '{headRefName:"feat/adopt-me",isCrossRepository:false}' >"$FX/view.json"
( cd "$LM" && git checkout -q feat/adopt-me ) >/dev/null 2>&1
LH ship-init --adopt 9 >"$FX/out" 2>"$FX/err"; rc=$?
check "ship-init adopt refuses a branch checked out elsewhere" test $rc -eq 1
check "ship-init adopt refusal creates nothing" test ! -e "$LM-wt/feat-adopt-me"
lw_adopt_fixture git; ( cd "$LM" && git branch -q -D feat/adopt-me ) >/dev/null 2>&1
jq -n '{headRefName:"feat/adopt-me",isCrossRepository:true}' >"$FX/view.json"
LH ship-init --adopt 9 >"$FX/out" 2>"$FX/err"; rc=$?
check "ship-init adopt refuses a fork PR" test $rc -eq 1
check "ship-init adopt fork refusal creates nothing" test ! -e "$LM-wt/feat-adopt-me"

# teardown-merged-worktree
lw_td() {
  lw_fixture "$1"
  LH ship-init feat td x >"$FX/out" 2>"$FX/err"; T="$(cat "$FX/out")"; LS=feat-td-x
  ( cd "$T" && echo c >c && git add c && git commit -qm C && git push -q origin HEAD ) >/dev/null 2>&1
  TN="$(cd "$T" && pwd -P)"
  TD_HEAD="$(git -C "$T" rev-parse HEAD)"
  jq -n --arg h "$TD_HEAD" '{state:"MERGED",baseRefName:"master",isDraft:false,headRefOid:$h,headRefName:"feat/td-x",isCrossRepository:false,files:[]}' >"$FX/view.json"
  LH goal pr 5 >/dev/null 2>&1
}
lw_td_run() { LH teardown-merged-worktree "$@" >"$FX/out" 2>&1; }
lw_td_refuses() {
  lw_td_run "${2:-5}"; rc=$?
  check "teardown refuses $1: exits 1" test $rc -eq 1
  check "teardown refuses $1: prints STOP" grep -q 'teardown: STOP (' "$FX/out"
  check "teardown refuses $1: directory kept" test -d "$T"
  check "teardown refuses $1: registry kept" test -f "$(lreg_file $LS)"
}
lw_set_reg() { jq "$1" "$(lreg_file "$LS")" >"$FX/t" && mv "$FX/t" "$(lreg_file "$LS")"; }
view_mut() { jq "$1" "$FX/view.json" >"$FX/t" && mv "$FX/t" "$FX/view.json"; }

lw_td git; view_mut '.state="OPEN"'; lw_td_refuses "an unmerged PR"
lw_td git; echo x >>"$T/b"; lw_td_refuses "a dirty tree"
lw_td git; echo x >"$T/new"; lw_td_refuses "an untracked file"
lw_td git; view_mut '.headRefOid="0000000000000000000000000000000000000000"'; lw_td_refuses "a head mismatch"
lw_td git; view_mut '.headRefName="feat/other"'; lw_td_refuses "a branch mismatch"
lw_td git; ( cd "$T" && echo y >y && git add y && git commit -qm Y ) >/dev/null 2>&1; lw_td_refuses "an extra local commit"
lw_td git; ln -s "$T" "$TMP/lw-link"; lw_set_reg ".path = \"$TMP/lw-link\""; lw_td_refuses "a symlinked path"; rm -f "$TMP/lw-link"
lw_td git; mkdir -p "$TMP/elsewhere"; lw_set_reg ".path = \"$TMP/elsewhere\""
lw_td_refuses "an unlisted path"; check "teardown unlisted path: other directory kept" test -d "$TMP/elsewhere"; rm -rf "$TMP/elsewhere"
lw_td git; lw_set_reg ".path = \"$LM\""
lw_td_refuses "the main checkout"; check "teardown main checkout: still the main checkout" test -d "$LM/.git"
lw_td git; lw_set_reg '.branch = "feat/forged"'; lw_td_refuses "a registered branch that is not the PR head"
lw_td git; lw_set_reg 'del(.path)'; lw_td_refuses "an entry without a path"
lw_td git; rm "$FX/view.json"; lw_td_refuses "an unreadable PR"
lw_td git; LCWD="$T" LH goal escalate "stuck" >/dev/null 2>&1; lw_td_refuses "an escalated goal"
check "teardown escalated goal: names the reason" grep -q 'escalated' "$FX/out"
lw_td orca; echo $(( $(date +%s) * 1000 )) >"$FX/orca.activity"; lw_td_refuses "recent orca activity"
lw_td orca; : >"$FX/orca.noactivity"; lw_td_refuses "unreadable orca activity"
lw_td git; lw_td_run 6; rc=$?
check "teardown with no registered worktree: exits 3" test $rc -eq 3
check "teardown with no registered worktree: says so" grep -q 'no registered worktree for PR 6' "$FX/out"
check "teardown with no registered worktree: directory kept" test -d "$T"
lw_td git; lw_td_run abc; rc=$?; check "teardown rejects a non-numeric PR" test $rc -eq 2
lw_td git; lw_td_run 5 --force; rc=$?; check "teardown rejects an unknown flag" test $rc -eq 2

for mode in git orca; do
  lw_td "$mode"
  lw_td_run 5; rc=$?
  check "teardown $mode: exits 0" test $rc -eq 0
  check "teardown $mode: directory gone" test ! -e "$T"
  check "teardown $mode: routes through $mode" grep -qx "teardown: route $mode" "$FX/out"
  check "teardown $mode: no longer listed" bash -c '! git -C "$1" worktree list --porcelain | grep -q "feat/td-x"' _ "$LM"
  check "teardown $mode: local branch deleted" bash -c '! git -C "$1" show-ref -q --verify refs/heads/feat/td-x' _ "$LM"
  check "teardown $mode: remote branch deleted" grep -q 'DELETE repos/o/r/git/refs/heads/feat/td-x' "$FX/gh.log"
  check "teardown $mode: registry removed" test ! -e "$(lreg_file feat-td-x)"
  check "teardown $mode: summary line" grep -qxF "teardown: worktree removed $TN; remote feat/td-x deleted; local feat/td-x deleted; registry removed" "$FX/out"
  check "teardown $mode: main checkout unchanged" test "$(git -C "$LM" status --porcelain)" = ""
  check "teardown $mode: main checkout back on master" test "$(git -C "$LM" branch --show-current)" = master
  check "teardown $mode: no stray snapshot refs" test -z "$(git -C "$LM" for-each-ref refs/harness)"
  check "teardown $mode: squash merge (branch tip is not on master)" bash -c '! git -C "$1" merge-base --is-ancestor "$2" master' _ "$LM" "$TD_HEAD"
done
check "teardown orca: removes through orca" grep -qF -- "worktree rm --worktree path:$TN --json" "$FX/orca.log"
check "teardown orca: never forces or runs hooks" bash -c '! grep -q -- "--force\|--run-hooks" "$1"' _ "$FX/orca.log"
lw_td git; : >"$FX/branch.gone"; lw_td_run 5; rc=$?
check "teardown with the remote already deleted: exits 0" test $rc -eq 0
check "teardown with the remote already deleted: counts as absent" grep -qxF "teardown: worktree removed $TN; remote feat/td-x absent; local feat/td-x deleted; registry removed" "$FX/out"
check "teardown with the remote already deleted: registry removed" test ! -e "$(lreg_file feat-td-x)"
lw_td git; echo dirty >>"$LM/a"; echo u >"$LM/untracked.txt"
MAIN_HEAD="$(git -C "$LM" rev-parse HEAD)"
lw_td_run 5; rc=$?
check "teardown dirty main: exits 0" test $rc -eq 0
check "teardown dirty main: full summary" grep -qxF "teardown: worktree removed $TN; remote feat/td-x deleted; local feat/td-x deleted; registry removed" "$FX/out"
check "teardown dirty main: registry removed" test ! -e "$(lreg_file feat-td-x)"
check "teardown dirty main: tracked edit survives" test "$(tail -n1 "$LM/a")" = dirty
check "teardown dirty main: untracked file survives" test -f "$LM/untracked.txt"
check "teardown dirty main: HEAD unchanged" test "$(git -C "$LM" rev-parse HEAD)" = "$MAIN_HEAD"
check "teardown dirty main: branch unchanged" test "$(git -C "$LM" branch --show-current)" = master
check "teardown dirty main: local branch gone from git branch" bash -c '! git -C "$1" show-ref -q --verify refs/heads/feat/td-x' _ "$LM"
check "teardown dirty main: branch is checked out nowhere" bash -c '! git -C "$1" worktree list --porcelain | grep -q "branch refs/heads/feat/td-x"' _ "$LM"
check "teardown dirty main: checkout untouched by cleanup" grep -q '^cleanup: checkout untouched' "$FX/out"
check "teardown dirty main: no fetch, switch or pull of main" test "$(git -C "$LM" reflog -n3 | grep -c 'checkout\|pull\|switch')" = 0
check "teardown dirty main: snapshot released" grep -q 'snapshot released refs/harness/snapshots/' "$FX/out"
lw_td orca; : >"$FX/orca.rm.fail"; lw_td_run 5; rc=$?
check "teardown orca refusal: exits 4" test $rc -eq 4
check "teardown orca refusal: worktree kept" test -d "$T"
check "teardown orca refusal: no git fallback" bash -c '! grep -q "route git" "$1"' _ "$FX/out"
check "teardown orca refusal: still listed" lw_listed "$TN"
check "teardown orca refusal: registry kept active" test "$(lreg feat-td-x .status)" = active
lw_td git; LCWD="$T" lw_td_run 5; rc=$?
check "teardown from inside the target: exits 0" test $rc -eq 0
check "teardown from inside the target: directory gone" test ! -e "$T"
lw_td git; poison() { local f; for f in gh git jq orca; do eval "$f() { echo hit >>\"\$FX/func.log\"; return 1; }"; export -f "${f?}"; done; }
( poison; lw_td_run 5 ); rc=$?
check "exported gh function does not affect teardown: exits 0" test $rc -eq 0
check "exported gh function does not affect teardown: function never ran" test ! -e "$FX/func.log"

# a partial result keeps the registry, and a rerun finishes the job
lw_td git; echo '{"protected":false,"commit":{"sha":"deadbeef"}}' >"$FX/branch.json"; lw_td_run 5; rc=$?
check "teardown partial result: exits 1" test $rc -eq 1
check "teardown partial result: worktree removed" test ! -e "$T"
check "teardown partial result: registry kept as merged" test "$(lreg feat-td-x .status)" = merged
check "teardown partial result: reason recorded" grep -q 'remote kept' <<<"$(lreg feat-td-x .reason)"
check "teardown partial result: prints the rerun command" grep -qF 'rerun: agent-harness teardown-merged-worktree 5' "$FX/out"
rm -f "$FX/branch.json"; lw_td_run 5; rc=$?
check "teardown rerun after a partial result: exits 0" test $rc -eq 0
check "teardown rerun after a partial result: registry removed" test ! -e "$(lreg_file feat-td-x)"
check "teardown rerun after a partial result: summary" grep -q 'registry removed' "$FX/out"

# ship-merge routes to teardown when the goal is registered, to cleanup otherwise
lw_td git
view_mut '.state="OPEN" | .files=[{path:"client/a.gd"}]'
echo '[{"name":"gate","status":"completed","conclusion":"success","app":{"slug":"github-actions"}}]' >"$FX/checks.json"
echo '{"data":{"repository":{"pullRequest":{"reviewThreads":{"pageInfo":{"hasNextPage":false},"nodes":[]}}}}}' >"$FX/threads.json"
echo 0 >"$FX/behind.txt"
LH ship-merge 5 --confirmed >"$FX/out" 2>&1; rc=$?
check "ship-merge registered: exits 0" test $rc -eq 0
check "ship-merge registered: merges the PR" grep -q '^pr merge 5' "$FX/gh.log"
check "ship-merge registered: routes to teardown" grep -q '^teardown: worktree removed' "$FX/out"
check "ship-merge registered: worktree gone" test ! -e "$T"
check "ship-merge registered: registry removed" test ! -e "$(lreg_file feat-td-x)"
[ -z "${SHOW_SAMPLE:-}" ] || { echo "--- sample: agent-harness ship-merge 5 --confirmed (registered goal)"; cat "$FX/out"; echo "---"; }
lw_td git; LCWD="$T" LH goal escalate "stuck" >/dev/null 2>&1
view_mut '.state="OPEN" | .files=[{path:"client/a.gd"}]'
LH ship-merge 5 --confirmed >"$FX/out" 2>&1; rc=$?
check "ship-merge with an escalated goal: still exits 0 after the merge" test $rc -eq 0
check "ship-merge with an escalated goal: worktree kept" test -d "$T"
check "ship-merge with an escalated goal: prints the rerun command" grep -qF 'rerun: agent-harness teardown-merged-worktree 5' "$FX/out"
lw_fixture git
( cd "$LM" && git checkout -q -b feat/plain && echo p >p && git add p && git commit -qm P && git push -q origin HEAD && git checkout -q master ) >/dev/null 2>&1
PLAIN_HEAD="$(git -C "$LM" rev-parse feat/plain)"
jq -n --arg h "$PLAIN_HEAD" '{state:"OPEN",baseRefName:"master",isDraft:false,headRefOid:$h,headRefName:"feat/plain",isCrossRepository:false,files:[{path:"client/a.gd"}]}' >"$FX/view.json"
echo '[{"name":"gate","status":"completed","conclusion":"success","app":{"slug":"github-actions"}}]' >"$FX/checks.json"
LH ship-merge 5 --confirmed >"$FX/out" 2>&1; rc=$?
check "ship-merge unregistered: exits 0" test $rc -eq 0
check "ship-merge unregistered: runs plain cleanup" grep -q '^cleanup: ' "$FX/out"
check "ship-merge unregistered: no teardown" bash -c '! grep -q "teardown" "$1"' _ "$FX/out"
check "ship-merge unregistered: local branch deleted" bash -c '! git -C "$1" show-ref -q --verify refs/heads/feat/plain' _ "$LM"

# report
lw_fixture git
LH ship-init docs ui hud-report >/dev/null 2>&1; LT="$(cd "$LM-wt/docs-ui-hud-report" && pwd -P)"; LS=docs-ui-hud-report
echo '<html><body>hi</body></html>' >"$FX/r.html"
LH_TEST=1 AGENT_HARNESS_CHROME="$TMP/lbin/fake-chrome" LH report "$LS" "$FX/r.html" >"$FX/out" 2>&1; rc=$?
LP="$LT/docs/agent-reports/$(date +%Y-%m-%d)-$LS.png"
check "report: exits 0" test $rc -eq 0
check "report: prints the default path" test "$(cat "$FX/out")" = "$LP"
check "report: writes a PNG" test "$(head -c 4 "$LP" | tail -c 3)" = PNG
check "report: records the path in the registry" test "$(lreg $LS .report)" = "$LP"
check "report: headless screenshot at 1200x1600 of the file" bash -c 'grep -q -- "--headless=new" "$1" && grep -q -- "--window-size=1200,1600" "$1" && grep -q -- "file://.*/report.html" "$1"' _ "$FX/chrome.args"
LH_TEST=1 AGENT_HARNESS_CHROME="$TMP/lbin/fake-chrome" LH report "$LS" "$FX/r.html" "$LT/docs/agent-reports/custom.png" >"$FX/out" 2>&1; rc=$?
check "report: explicit output path inside the worktree" test "$rc|$(cat "$FX/out")" = "0|$LT/docs/agent-reports/custom.png"
LH_TEST=1 AGENT_HARNESS_CHROME="$TMP/lbin/fake-chrome" LH report "$LS" "$FX/r.html" "$FX/custom.png" >"$FX/out" 2>&1; rc=$?
check "report: output outside the worktree is refused" test $rc -eq 1
check "report: nothing written outside the worktree" test ! -e "$FX/custom.png"
LH_TEST=1 AGENT_HARNESS_CHROME="$TMP/lbin/fake-chrome" LH report "$LS" "$FX/r.html" "$LT/docs/../../escape.png" >"$FX/out" 2>&1; rc=$?
check "report: .. in the output path is refused" test $rc -eq 1
LH_TEST=1 AGENT_HARNESS_CHROME="$TMP/lbin/fake-chrome" LH report docs/ui-hud-report "$FX/r.html" >"$FX/out" 2>&1; rc=$?
check "report: accepts the branch name as well as the slug" test "$rc" -eq 0
check "report: the rendered copy carries a strict CSP and the original body" bash -c 'grep -q "Content-Security-Policy.*default-src .none.; img-src data:; style-src .unsafe-inline.; font-src data:" "$1" && grep -q "<body>hi</body>" "$1"' _ "$FX/chrome.html"
check "report: the original HTML is left untouched" test "$(cat "$FX/r.html")" = "<html><body>hi</body></html>"
check "report: chrome runs without file-access flags" bash -c 'grep -q -- "--no-first-run" "$1" && grep -q -- "--disable-features=FileSystemAccessAPI" "$1" && ! grep -q -- "--allow-file-access" "$1"' _ "$FX/chrome.args"
check "report: renders a temp copy of the HTML, not the original" bash -c '! grep -q -- "file://$1" "$2"' _ "$FX/r.html" "$FX/chrome.args"
mkdir -p "$TMP/redir"; rm -rf "$LT/docs"; ln -s "$TMP/redir" "$LT/docs"
LH_TEST=1 AGENT_HARNESS_CHROME="$TMP/lbin/fake-chrome" LH report "$LS" "$FX/r.html" >"$FX/out" 2>&1; rc=$?
check "report: a symlinked docs directory is refused" test $rc -eq 1
check "report: nothing written through the symlink" test -z "$(ls -A "$TMP/redir")"
rm -f "$LT/docs"
LH_TEST=1 AGENT_HARNESS_CHROME="$TMP/lbin/missing-chrome" LH report "$LS" "$FX/r.html" >"$FX/out" 2>&1; rc=$?
check "report without Chrome: exits 2" test $rc -eq 2
check "report without Chrome: says so" grep -q 'no Chrome found' "$FX/out"
LH_TEST=1 AGENT_HARNESS_CHROME="$TMP/lbin/fake-chrome" LH report "$LS" "$FX/missing.html" >"$FX/out" 2>&1; rc=$?
check "report: missing HTML exits 1" test $rc -eq 1
LH_TEST=1 AGENT_HARNESS_CHROME="$TMP/lbin/fake-chrome" LH report no-such-goal "$FX/r.html" >"$FX/out" 2>&1; rc=$?
check "report: unknown goal without an output path exits 1" test $rc -eq 1
LH report "$LS" >/dev/null 2>&1; rc=$?; check "report: missing arguments exit 2" test $rc -eq 2
REAL_CHROME="$(command -v google-chrome chromium 2>/dev/null | head -n1)"
[ -n "$REAL_CHROME" ] || [ ! -x "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ] || REAL_CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
if [ -n "$REAL_CHROME" ]; then
  env -u AGENT_HARNESS_CHROME bash -c 'cd "$1" && shift && "$@"' _ "$LM" env -u GH_BIN -u ORCA_BIN -u AGENT_HARNESS_TEST -u AGENT_STATE_DIR -u CLAUDE_PROJECT_DIR PATH="$TMP/lsleep:$TMP/lbin:$PATH" bash "$H/report.sh" "$LS" "$FX/r.html" "$LT/docs/agent-reports/real.png" >"$FX/out" 2>&1; rc=$?
  check "report with real Chrome: renders a PNG" test "$rc|$(head -c 4 "$LT/docs/agent-reports/real.png" 2>/dev/null | tail -c 3)" = "0|PNG"
fi

# dispatcher
lw_fixture git
out="$( cd "$LM" && env -u CLAUDE_PROJECT_DIR PATH="$TMP/lsleep:$TMP/lbin:$PATH" bash "$H/agent-harness.sh" ship-init feat ui via-dispatcher 2>&1)"
check "dispatcher: ship-init forwards" test "$(head -n1 <<<"$out")" = "$LM-wt/feat-ui-via-dispatcher"
out="$( cd "$LM" && env -u CLAUDE_PROJECT_DIR PATH="$TMP/lsleep:$TMP/lbin:$PATH" bash "$H/agent-harness.sh" teardown-merged-worktree 99 2>&1)"; rc=$?
check "dispatcher: teardown-merged-worktree forwards" grep -q 'no registered worktree for PR 99' <<<"$out"
out="$( cd "$LM" && bash "$H/agent-harness.sh" report 2>&1)"; rc=$?
check "dispatcher: report forwards" grep -q 'usage: report.sh' <<<"$out"
check "dispatcher: usage lists the new commands" grep -q 'ship-init|ship-merge|cleanup|teardown-merged-worktree|worktree-rm|report' <<<"$(bash "$H/agent-harness.sh" 2>&1)"

# guard: teardown, ship-init, env and function injection
GUARD_CWD="$TMP/work"
LG_ALLOW=(
  "agent-harness teardown-merged-worktree 5"
  "agent-harness ship-init feat ui hud-theme"
  "agent-harness ship-init feat ui hud-theme --goal build the hud"
  "agent-harness ship-init --adopt 7"
  "agent-harness ship-init --adopt 7 --goal resume the hud"
  "$HOME/.local/bin/agent-harness ship-init fix ui y"
  "agent-harness report my-slug r.html"
  "agent-harness goal pr 5"
)
LG_DENY=(
  "bash ~/.claude/scripts/agent-harness/teardown-merged-worktree.sh 5"
  "bash $HOME/.claude/scripts/agent-harness/ship-init.sh fix ui y"
  "bash ~/.claude/scripts/agent-harness/agent-harness.sh teardown-merged-worktree 5"
  "bash -x $HOME/.claude/scripts/agent-harness/ship-init.sh fix ui y"
  "$HOME/.claude/scripts/agent-harness/teardown-merged-worktree.sh 5"
  "HOME'='/tmp/fake agent-harness ship-init feat ui x"
  "HOME=/tmp/fake agent-harness teardown-merged-worktree 5"
  "export HOME=/tmp/fake; agent-harness ship-init feat ui x"
  ". /tmp/evil.sh; agent-harness ship-init feat ui x"
  "source /tmp/evil.sh && agent-harness teardown-merged-worktree 5"
  "true && . /tmp/evil.sh && agent-harness ship-init feat ui x"
  "agent-harness ship-init feat ui x; . /tmp/evil.sh"
  "agent-harness teardown-merged-worktree"
  "agent-harness teardown-merged-worktree abc"
  "agent-harness teardown-merged-worktree 5 6"
  "agent-harness teardown-merged-worktree 5 --force"
  "agent-harness teardown-merged-worktree 5 --keep-branch"
  "agent-harness teardown-merged-worktree \$PR"
  "FOO=1 agent-harness teardown-merged-worktree 5"
  "GH_BIN=/x agent-harness teardown-merged-worktree 5"
  "ORCA_BIN=/x agent-harness teardown-merged-worktree 5"
  "PATH=/x:\$PATH agent-harness teardown-merged-worktree 5"
  "env AGENT_HARNESS_TEST=1 agent-harness ship-init feat ui x"
  "AGENT_STATE_DIR=/x agent-harness ship-init feat ui x"
  "CLAUDE_PROJECT_DIR=/x agent-harness ship-init feat ui x"
  "BASH_ENV=/x agent-harness ship-init feat ui x"
  "ENV=/x agent-harness ship-init feat ui x"
  "SHELLOPTS=xtrace agent-harness teardown-merged-worktree 5"
  "PS4=x agent-harness teardown-merged-worktree 5"
  "LD_PRELOAD=/x agent-harness ship-init feat ui x"
  "DYLD_INSERT_LIBRARIES=/x agent-harness ship-init feat ui x"
  "export -f gh; agent-harness ship-init feat ui x"
  "declare -fx gh; agent-harness teardown-merged-worktree 5"
  "set -a; agent-harness ship-init feat ui x"
  "bash --rcfile /x agent-harness ship-init feat ui x"
  "bash /tmp/evil/teardown-merged-worktree.sh 5"
  "bash ./scripts/agent-harness/teardown-merged-worktree.sh 5"
  "bash scripts/agent-harness/ship-init.sh feat ui y"
  "bash /tmp/x/scripts/agent-harness/ship-init.sh feat ui y"
  "bash /tmp/x/scripts/agent-harness/agent-harness.sh teardown-merged-worktree 5"
  "bash -x /tmp/x/scripts/agent-harness/ship-init.sh feat ui y"
  "bash /nonhome/.claude/scripts/agent-harness/ship-init.sh fix ui y"
  "bash $HOME/.claude/scripts/../../tmp/x/scripts/agent-harness/ship-init.sh fix ui y"
  "./scripts/agent-harness/teardown-merged-worktree.sh 5"
  "/tmp/x/scripts/agent-harness/ship-init.sh feat ui y"
  "agent-harness.sh teardown-merged-worktree 12"
  "/tmp/x/agent-harness teardown-merged-worktree 5"
  "./agent-harness ship-init feat ui y"
  "bash /tmp/evil/ship-init.sh feat ui x"
  "agent-harness ship-init wip ui x"
  "agent-harness ship-init feat Ui x"
  "agent-harness ship-init feat ui Bad_Desc"
  "agent-harness ship-init feat ui"
  "agent-harness ship-init feat ui x extra"
  "agent-harness ship-init feat ui x --goal"
  "agent-harness ship-init feat ui x --goal \$HOME"
  "agent-harness ship-init --adopt abc"
  "agent-harness ship-init --adopt 7 8"
  "FOO=1 agent-harness ship-init feat ui x"
)
for mode in off on; do
  reset; [ "$mode" = on ] && flag_on
  for c in "${LG_ALLOW[@]}"; do check "lifecycle guard (flag $mode) allows: $c" allowed "$c"; done
  for c in "${LG_DENY[@]}"; do check "lifecycle guard (flag $mode) denies: $c" denied "$c"; done
  check "lifecycle guard (flag $mode) still denies worktree-rm --force" denied "agent-harness worktree-rm /x --force"
  check "lifecycle guard (flag $mode) still denies a git worktree remove" denied "git worktree remove /x"
  check "lifecycle guard (flag $mode) still asks for worktree-rm --confirmed" asked "agent-harness worktree-rm /x --confirmed"
done
reset; flag_on
check "worktree-rm stays refused in autonomous mode" bash -c '! (cd "$1" && env -u CLAUDE_PROJECT_DIR AGENT_HARNESS_TEST=1 AGENT_STATE_DIR="$2" bash "$3/worktree-rm.sh" /x --confirmed) >/dev/null 2>&1' _ "$TMP/work" "$TMP/state" "$H"

# ---- review fixes: one state location, registry mirror, teardown trust, injection, guard
lw_stop() {
  ( cd "${LCWD:-$LM}" && echo '{}' | env -u AGENT_STATE_DIR CLAUDE_PROJECT_DIR="$LM" PATH="$TMP/lsleep:$TMP/lbin:$PATH" bash "$1" )
}
STOP_COPIES=("$HOOKS/ship-stop-gate.sh")
[ ! -f "$HERE/plugins/fmflurry-harness/hooks/scripts/ship-stop-gate.sh" ] || STOP_COPIES+=("$HERE/plugins/fmflurry-harness/hooks/scripts/ship-stop-gate.sh")
lw_goal_file() { echo "$LM/.claude/state/goal.json"; }

lw_fixture git
LH ship-init feat ui b1-main >"$FX/out" 2>"$FX/err"; LT="$(cat "$FX/out")"; LS=feat-ui-b1-main
check "ship-init prints slug=<slug>" grep -qx "slug=$LS" "$FX/err"
check "ship-init: stdout stays the bare worktree path" test "$(cat "$FX/out")" = "$LM-wt/$LS"
check "ship-init: goal.json lives in the main checkout" test -f "$(lw_goal_file)"
check "ship-init: goal.json records branch, slug and status" test "$(jq -r '[.branch, .slug, .status] | join("|")' "$(lw_goal_file)")" = "feat/ui-b1-main|$LS|active"
check "ship-init: the worktree has no state of its own" test ! -e "$LT/.claude/state/goal.json"
check "ship-init: registry records the slug" test "$(lreg $LS .slug)" = "$LS"
LH goal pr 41 >/dev/null 2>&1
check "goal pr from the main checkout mirrors into the registry" test "$(lreg $LS .pr)" = 41
LH goal sha cafe01 >/dev/null 2>&1
check "goal sha from the main checkout mirrors head_oid" test "$(lreg $LS .head_oid)" = cafe01
LCWD="$LT" LH goal pr 42 >/dev/null 2>&1
check "goal pr from inside the worktree gives the same result" test "$(lreg $LS .pr)|$(jq -r .pr "$(lw_goal_file)")" = "42|42"
LCWD="$LT" LH goal sha beef02 >/dev/null 2>&1
check "goal sha from inside the worktree gives the same result" test "$(lreg $LS .head_oid)" = beef02
LH goal escalate "from main" >/dev/null 2>&1
check "goal escalate from the main checkout mirrors status and reason" test "$(lreg $LS '[.status, .reason] | join("|")')" = "escalated|from main"
check "autonomy flag and goal share the main state dir from the worktree" bash -c 'cd "$1" && env -u CLAUDE_PROJECT_DIR -u AGENT_STATE_DIR bash "$2/autonomy.sh" on >/dev/null && test -f "$3/.claude/state/autonomy.on" && env -u CLAUDE_PROJECT_DIR -u AGENT_STATE_DIR bash "$2/autonomy.sh" off >/dev/null' _ "$LT" "$H" "$LM"
touch "$LM/.claude/state/autonomy.on"
out="$(cd "$LT" && env -u CLAUDE_PROJECT_DIR -u AGENT_STATE_DIR -u AGENT_HARNESS_TEST bash "$HOOKS/autonomy-context.sh" </dev/null)"
check "autonomy-context hook run from the worktree sees the main flag and goal" bash -c 'grep -q "AUTONOMOUS MODE ON" <<<"$1" && grep -q "status=escalated" <<<"$1"' _ "$out"
out="$(cd "$LT" && echo '{"tool_input":{"questions":[{"question":"q"}]}}' | env -u CLAUDE_PROJECT_DIR -u AGENT_STATE_DIR -u AGENT_HARNESS_TEST bash "$HOOKS/autonomy-ask-guard.sh")"
check "ask-guard run from the worktree denies via the main flag" grep -q '"permissionDecision": *"deny"' <<<"$out"
out="$(cd "$LT" && jqn -n --arg c "gh pr merge 1" '{cwd:"'"$LT"'",tool_input:{command:$c}}' | env -u CLAUDE_PROJECT_DIR -u AGENT_STATE_DIR -u AGENT_HARNESS_TEST bash "$HOOKS/autonomy-git-guard.sh")"
check "git-guard run from the worktree uses the main flag" grep -q '"permissionDecision": *"deny"' <<<"$out"
rm -f "$LM/.claude/state/autonomy.on"

lw_td git
check "ship-merge-style teardown from main: goal pr set from main" test "$(lreg feat-td-x .pr)" = 5
lw_td_run 5; rc=$?
check "teardown from the main checkout (PR set from main): exits 0" test $rc -eq 0
check "teardown from the main checkout: registry removed" test ! -e "$(lreg_file feat-td-x)"
lw_td git; lw_set_reg '.pr = null'; lw_td_run 5; rc=$?
check "teardown falls back to the goal.json slug when no registry entry has the PR" test "$rc|$(test -e "$T" && echo kept || echo gone)" = "0|gone"
lw_td git; lw_set_reg '.pr = null'; jq '.pr = 9' "$(lw_goal_file)" >"$FX/t" && mv "$FX/t" "$(lw_goal_file)"; lw_td_run 5; rc=$?
check "teardown: goal.json tracking another PR gives no fallback" test $rc -eq 3
lw_td git
view_mut '.state="OPEN" | .files=[{path:"client/a.gd"}]'
echo '[{"name":"gate","status":"completed","conclusion":"success","app":{"slug":"github-actions"}}]' >"$FX/checks.json"
echo '{"data":{"repository":{"pullRequest":{"reviewThreads":{"pageInfo":{"hasNextPage":false},"nodes":[]}}}}}' >"$FX/threads.json"
echo 0 >"$FX/behind.txt"
LH ship-merge 5 --confirmed >"$FX/out" 2>&1; rc=$?
check "ship-merge from the main checkout routes to teardown" test "$rc|$(grep -c '^teardown: worktree removed' "$FX/out")|$(test -e "$T" && echo kept || echo gone)" = "0|1|gone"
lw_td git
view_mut '.state="OPEN" | .files=[{path:"client/a.gd"}]'
LCWD="$T" LH ship-merge 5 --confirmed >"$FX/out" 2>&1; rc=$?
check "ship-merge from inside the worktree gives the same result" test "$rc|$(grep -c '^teardown: worktree removed' "$FX/out")|$(test -e "$T" && echo kept || echo gone)" = "0|1|gone"

# stop gate mirrors escalation and done into the registry, and teardown refuses escalated or blocked goals
for gate in "${STOP_COPIES[@]}"; do
  gl="${gate#"$HERE"/}"
  lw_td git; touch "$LM/.claude/state/autonomy.on"
  view_mut '.state="OPEN"'
  jq --arg h "$TD_HEAD" '.stop_blocks = 4 | .head_sha = $h' "$(lw_goal_file)" >"$FX/t" && mv "$FX/t" "$(lw_goal_file)"
  lw_stop "$gate" >/dev/null 2>&1
  check "stop-gate ($gl) escalation: goal.json escalated" test "$(jq -r .status "$(lw_goal_file)")" = escalated
  check "stop-gate ($gl) escalation: mirrored status and reason in the registry" test "$(lreg feat-td-x '[.status, (.reason | startswith("no progress after 5 stop blocks"))] | join("|")')" = "escalated|true"
  view_mut '.state="MERGED"'
  lw_td_run 5; rc=$?
  check "teardown refuses a goal the stop gate escalated: exits 1" test $rc -eq 1
  check "teardown refuses a goal the stop gate escalated: says escalated" grep -q 'is escalated' "$FX/out"
  check "teardown refuses a goal the stop gate escalated: directory kept" test -d "$T"
  lw_td git; touch "$LM/.claude/state/autonomy.on"
  lw_stop "$gate" >/dev/null 2>&1
  check "stop-gate ($gl) done: goal.json done" test "$(jq -r .status "$(lw_goal_file)")" = "done"
  check "stop-gate ($gl) done: mirrored status in the registry" test "$(lreg feat-td-x .status)" = "done"
done
lw_td git; lw_set_reg '.status = "blocked"'; lw_td_refuses "a blocked goal"
check "teardown blocked goal: says blocked" grep -q 'is blocked' "$FX/out"
lw_td git; lw_set_reg '.status = "escalated"'; lw_td_refuses "an escalated registry entry"

# H3: ship-init refuses an orca worktree that belongs to another repo
lw_fixture orca
git init -q "$FX/foreign"; ( cd "$FX/foreign" && git -c user.email=t@t -c user.name=t commit -q --allow-empty -m f )
: >"$FX/orca.foreign"
LH ship-init fix ui foreign-wt >"$FX/out" 2>"$FX/err"; rc=$?
check "ship-init orca: a worktree of another repo is refused" test $rc -eq 1
check "ship-init orca: refusal names the common-dir mismatch" grep -q 'is not a worktree of' "$FX/err"
check "ship-init orca: refusal writes no registry entry" test ! -e "$LM/.git/agent-harness/goals/fix-ui-foreign-wt.json"
check "ship-init orca: refusal writes no goal.json" test ! -e "$(lw_goal_file)"

# M1 (teardown): registry trust
lw_td git; mv "$(lreg_file feat-td-x)" "$LM/.git/agent-harness/goals/forged.json"; LS=forged
lw_td_refuses "a registry file whose name is not the slug of the PR head"
check "teardown forged name: says so" grep -q 'is not the goal of PR head' "$FX/out"
lw_td git; git -C "$LM" worktree add -q --detach "$LROOT/odd/feat-td-x" >/dev/null 2>&1 || { mkdir -p "$LROOT/odd"; git -C "$LM" worktree add -q --detach "$LROOT/odd/feat-td-x" >/dev/null 2>&1; }
lw_set_reg ".path = \"$(cd "$LROOT/odd/feat-td-x" && pwd -P)\""
lw_td_refuses "a path outside the ship-init layout"
check "teardown odd path: says layout" grep -q 'layout' "$FX/out"
check "teardown odd path: the odd worktree is kept" test -d "$LROOT/odd/feat-td-x"
lw_td git; lw_set_reg '.via = "orca"'; lw_td_run 5; rc=$?
check "teardown: a git-layout path is accepted whatever the recorded via" test $rc -eq 0

# M2: Orca detection fails closed in teardown
lw_td git
mkdir -p "$LROOT/orca/workspaces/r"
git -C "$LM" worktree move "$T" "$LROOT/orca/workspaces/r/feat-td-x" >/dev/null 2>&1
OT="$(cd "$LROOT/orca/workspaces/r/feat-td-x" && pwd -P)"
lw_set_reg ".path = \"$OT\" | .via = \"orca\""
T="$OT"; lw_td_run 5; rc=$?
check "teardown: a target under an Orca workspace of a non-Orca repo is a STOP" test $rc -eq 1
check "teardown orca workspace + unmanaged: names the reason" grep -q 'not Orca-managed' "$FX/out"
check "teardown orca workspace + unmanaged: directory kept" test -d "$OT"
lw_td git; : >"$FX/orca.list.fail"; lw_td_run 5; rc=$?
check "teardown: orca installed but repo list failing is a STOP" test $rc -eq 1
check "teardown orca list failure: names the reason" grep -q 'repo list is unreadable' "$FX/out"
check "teardown orca list failure: directory kept" test -d "$T"
lw_td orca; ln -s "$LM" "$TMP/lw-main-link"; printf '%s' "$TMP/lw-main-link" >"$FX/orca.managed"; lw_td_run 5; rc=$?
check "teardown: orca repo path through a symlink is matched by realpath" test "$rc|$(grep -cx 'teardown: route orca' "$FX/out")" = "0|1"
rm -f "$TMP/lw-main-link"

# M1 (report): slug or branch
lw_fixture git
LH ship-init feat ui slug-or-branch >/dev/null 2>&1; LT="$(cd "$LM-wt/feat-ui-slug-or-branch" && pwd -P)"
echo '<html></html>' >"$FX/r.html"
LH_TEST=1 AGENT_HARNESS_CHROME="$TMP/lbin/fake-chrome" LH report feat/ui-slug-or-branch "$FX/r.html" >"$FX/out" 2>&1; rc=$?
check "report: accepts the branch name" test "$rc|$(lreg feat-ui-slug-or-branch .report)" = "0|$(cat "$FX/out")"

# C1/H1/H2 (security): test seam, function injection
FH="$TMP/fakehome"; rm -rf "$FH"; mkdir -p "$FH/.claude/scripts" "$FH/.config/opencode/scripts"
cp -R "$H" "$FH/.claude/scripts/agent-harness"; cp -R "$H" "$FH/.config/opencode/scripts/agent-harness"
for inst in "$FH/.claude/scripts/agent-harness" "$FH/.config/opencode/scripts/agent-harness" "$TMP/inst/.cursor/plugins/x/agent-harness"; do
  [ -d "$inst" ] || { mkdir -p "$(dirname "$inst")"; cp -R "$H" "$inst"; }
  printf 'GH=\nORCA=\nJQ=\n' >"$inst/.installed"
  out="$(HOME="$FH" GH_BIN=/x/gh ORCA_BIN=/x/orca AGENT_STATE_DIR=/x/state AGENT_HARNESS_TEST=1 bash -c '. "$1/lib.sh"; echo "$GH|$ORCA|$STATE_DIR|$HARNESS_INSTALLED"' _ "$inst" 2>&1)"
  check "test seam ignored from an installed copy ($inst): GH_BIN, ORCA_BIN, AGENT_STATE_DIR" test "${out##*|}" = 1 -a "$(cut -d'|' -f1 <<<"$out")" != /x/gh -a "$(cut -d'|' -f2 <<<"$out")" != /x/orca -a "$(cut -d'|' -f3 <<<"$out")" != /x/state
done
out="$(HOME="$FH" GH_BIN=/x/gh ORCA_BIN=/x/orca AGENT_STATE_DIR=/x/state AGENT_HARNESS_TEST=1 bash -c '. "$1/lib.sh"; echo "$GH|$ORCA|$STATE_DIR|$HARNESS_INSTALLED"' _ "$H" 2>&1)"
check "test seam still works from a repo checkout" test "$out" = "/x/gh|/x/orca|/x/state|0"
( cd "$SDR" && rm -rf "$SDR/.claude/state" && env -u CLAUDE_PROJECT_DIR HOME="$FH" AGENT_HARNESS_TEST=1 AGENT_STATE_DIR="$TMP/ign3" bash "$FH/.claude/scripts/agent-harness/goal.sh" set gz )
check "installed goal.sh ignores AGENT_STATE_DIR" test ! -e "$TMP/ign3/goal.json" -a -f "$SDR/.claude/state/goal.json"
check "worktree-core timing seam is gated by the same check" grep -q 'HARNESS_INSTALLED" = 0 \] && \[ "${AGENT_HARNESS_TEST' "$H/worktree-core.sh"
check "report chrome override is gated by the same check" grep -q 'HARNESS_INSTALLED" = 0 \] && \[ "${AGENT_HARNESS_TEST' "$H/report.sh"

export INJ="$TMP/inj"; rm -rf "$INJ"; mkdir -p "$INJ"
lw_fixture git
# The functions are exported on purpose, to prove the dispatcher drops inherited ones.
# shellcheck disable=SC2329
inj_run() {
  ( dirname() { echo hit >>"$INJ/hit.log"; command dirname "$@"; }
    cd() { echo hit >>"$INJ/hit.log"; builtin cd "$@" || return; }
    export -f dirname cd
    builtin cd "$LM" || exit 1
    env -u GH_BIN -u ORCA_BIN -u AGENT_STATE_DIR -u CLAUDE_PROJECT_DIR PATH="$TMP/lsleep:$TMP/lbin:$PATH" bash "$DISP" teardown-merged-worktree 99 )
}
out="$(inj_run 2>&1)"
check "exported dirname/cd functions do not run in the dispatcher or its children" test ! -e "$INJ/hit.log"
check "the dispatcher still reaches teardown after the purge" grep -q 'no registered worktree for PR 99' <<<"$out"
check "the install wrapper launches with #!/bin/bash -p and builtin exec" grep -q "#!/bin/bash -p.nbuiltin exec /bin/bash -p" "$HERE/scripts/lib/install-agent-harness.sh"
check "the install wrapper records the .installed marker" grep -q 'write_harness_marker "$dest/.installed"' "$HERE/scripts/lib/install-agent-harness.sh"
check "install.sh installs the cli through the shared helper" grep -q 'install_agent_harness_tree' "$HERE/install.sh"
check "install-cursor.sh installs the cli through the shared helper" grep -q 'install_agent_harness_tree' "$HERE/install-cursor.sh"
check "the dispatcher launches children with bash -p" grep -q 'builtin exec /bin/bash -p' "$H/agent-harness.sh"
check "every harness script has a #!/bin/bash -p shebang" test "$(head -qn1 "$H"/*.sh | grep -vc '^#!/bin/bash -p$')" = 0
check "no harness script calls dirname before lib.sh" test "$(grep -c 'dirname "${BASH_SOURCE' "$H"/*.sh | awk -F: '{s+=$2} END {print s+0}')" = 0

# H1 (security): marker-based installed detection, trusted PATH, no HOME seam
INS="$TMP/ins"; rm -rf "$INS" "$TMP/fakegh" "$TMP/realtools"; mkdir -p "$TMP/fakegh" "$TMP/realtools"
cp -R "$H" "$INS"
printf '#!/bin/bash\necho fake\n' >"$TMP/fakegh/gh"; chmod +x "$TMP/fakegh/gh"
printf '#!/bin/bash\necho real\n' >"$TMP/realtools/gh"; chmod +x "$TMP/realtools/gh"
printf 'GH=%s\nORCA=\nJQ=\n' "$TMP/realtools/gh" >"$INS/.installed"
probe() { HOME="$1" PATH="$TMP/fakegh:$PATH" AGENT_HARNESS_TEST=1 GH_BIN=/x/gh STATE_DIR=/x bash -c '. "$1/lib.sh"; echo "$GH|$HARNESS_INSTALLED|${PATH%%:*}"' _ "$INS" 2>&1; }
check "installed (marker): a fake HOME does not enable the seam" test "$(probe "$TMP/otherhome")" = "$TMP/realtools/gh|1|/opt/homebrew/bin"
check "installed (marker) under the real HOME: seam stays off" test "$(probe "$HOME")" = "$TMP/realtools/gh|1|/opt/homebrew/bin"
printf 'GH=\nORCA=\nJQ=\n' >"$INS/.installed"
check "installed: a fake gh first on PATH is ignored" test "$(probe "$HOME" | cut -d'|' -f1)" != "$TMP/fakegh/gh"
rm -f "$INS/.installed"
check "no marker: checkout mode keeps the test seam even under HOME" test "$(probe "$TMP/otherhome" | cut -d'|' -f1-2)" = "/x/gh|0"

# H2 (security): exported builtin/dirname/cd/exec functions cannot reach the wrapper or its scripts
WH="$TMP/wrapper-home"; rm -rf "$WH"; mkdir -p "$WH/.claude/scripts" "$WH/bin"
cp -R "$H" "$WH/.claude/scripts/agent-harness"; printf 'GH=\nORCA=\nJQ=\n' >"$WH/.claude/scripts/agent-harness/.installed"
printf '#!/bin/bash -p\nbuiltin exec /bin/bash -p "%s/scripts/agent-harness/agent-harness.sh" "$@"\n' "$WH/.claude" >"$WH/bin/agent-harness"; chmod +x "$WH/bin/agent-harness"
rm -f "$INJ/hit.log"
# shellcheck disable=SC2329
wrapper_inj_run() {
  ( builtin() { echo builtin >>"$INJ/hit.log"; command builtin "$@"; }
    dirname() { echo dirname >>"$INJ/hit.log"; command dirname "$@"; }
    cd() { echo cd >>"$INJ/hit.log"; command cd "$@" || return; }
    exec() { echo exec >>"$INJ/hit.log"; command exec "$@"; }
    export -f builtin dirname cd exec
    command cd "$LM" || exit 1
    env -u GH_BIN -u ORCA_BIN -u AGENT_STATE_DIR -u CLAUDE_PROJECT_DIR "$WH/bin/agent-harness" "$@" )
}
out="$(wrapper_inj_run teardown-merged-worktree 99 2>&1)"
check "exported builtin/dirname/cd/exec functions do not affect the wrapper or its scripts" test ! -e "$INJ/hit.log"
check "the wrapper still reaches teardown with the functions exported" grep -q 'no registered worktree for PR 99' <<<"$out"
out="$(wrapper_inj_run goal status 2>&1)"
check "exported functions do not affect goal.sh via the wrapper" test ! -e "$INJ/hit.log"
check "ship-merge launches its helpers with bash -p" test "$(grep -c 'bash -p' "$H/ship-merge.sh")" -ge 3
check "teardown launches cleanup with bash -p and --no-checkout" grep -q 'bash -p "$HARNESS_DIR/cleanup.sh" "$pr" --no-checkout' "$H/teardown-merged-worktree.sh"
check "goal.sh launches notify with bash -p" test "$(grep -c 'bash -p "$NOTIFY"' "$H/goal.sh")" -ge 2

check "verify-this picks up the generated override and runs its commands" \
  node --test "$HERE/scripts/agent-harness/test/verify-override.test.mjs"

fi
reset
echo "tests: $pass passed, $failn failed"
[ "$failn" -eq 0 ]
