#!/usr/bin/env bash
# shellcheck disable=SC2016
set -uo pipefail
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
    [ -e "$FX/branch.gone" ] && exit 1
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
reset() { rm -f "$FX"/*.log "$FX"/merge.* "$FX"/merge_settings.txt "$FX"/open_prs.json "$FX"/branch.json "$FX"/branch.gone "$FX"/list.fail "$FX"/default_branch "$TMP/state"/* "$CFG"; }
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

fresh_work() {
  ( cd "$TMP/work" && git worktree prune && git checkout -q -f master && git reset -q --hard origin/master \
    && git branch -q --set-upstream-to=origin/master master \
    && { git branch -q -D feat || true; } \
    && for b in $(git for-each-ref --format='%(refname:short)' refs/heads/backup); do git branch -q -D "$b"; done \
    && git checkout -q -b feat && echo "b$RANDOM" >b && git add b && git commit -qm B ) >/dev/null 2>&1
  HEAD_SHA="$(git -C "$TMP/work" rev-parse HEAD)"
}

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
reset; fresh_work

# ---- git-guard
GUARD_CWD="$TMP/work"
guard_in() { ( cd "$GUARD_CWD" && jq -n --arg c "$1" --arg d "$GUARD_CWD" '{cwd:$d,tool_input:{command:$c}}' | bash "$HOOKS/autonomy-git-guard.sh" ); }
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

WGF="$(mktemp -d)"; WGF="$(cd -P "$WGF" && pwd)"
mkdir -p "$WGF/main" "$WGF/st"
git -C "$WGF/main" init -q . && git -C "$WGF/main" -c user.email=a@b -c user.name=n commit -q --allow-empty -m i
git -C "$WGF/main" worktree add -q "$WGF/sib" -b sib
git -C "$WGF/main" worktree add -q "$WGF/orca/workspaces/r/w" -b w
mkdir -p "$WGF/sib/node_modules" "$WGF/sib/build"
wg_decision() { # mode cwd cmd
  rm -f "$WGF/st/autonomy.on"; [ "$1" = on ] && : >"$WGF/st/autonomy.on"
  local out
  out="$(jq -n --arg c "$3" --arg w "$2" '{tool_input:{command:$c},cwd:$w}' \
    | AGENT_HARNESS_TEST=1 AGENT_STATE_DIR="$WGF/st" CLAUDE_PROJECT_DIR="$WGF/main" bash "$HOOKS/autonomy-git-guard.sh")"
  [ -n "$out" ] || { echo allow; return; }
  jq -r '.hookSpecificOutput.permissionDecision // "allow"' <<<"$out"
}
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
wg allow "$WM" "agent-harness worktree-rm /x"
wg allow "$WGF/st" "find . -name x -delete"
wg allow "$WM" "git commit -m 'doc git worktree remove'"
rm -rf "$WGF"

# ---- worktree-rm
cat >"$TMP/orcawt" <<'STUB'
#!/usr/bin/env bash
echo "$*" >>"$FX/orcawt.log"
case "${1:-} ${2:-}" in
  "worktree list")
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
  reset; rm -f "$FX"/orca_wt.json "$FX"/orca_rm_hook; echo '{"base":"master"}' >"$CFG"
  WCWD="$WMAIN"
}
wtrm() { ( cd "$WCWD" && env ORCA_BIN="$TMP/orcawt" bash "$H/worktree-rm.sh" "$@" ); }
nrefs() { git -C "$WMAIN" for-each-ref 'refs/harness/snapshots/' | wc -l | tr -d ' '; }
listed() { git -C "$WMAIN" worktree list --porcelain | grep -qxF "worktree $1"; }
orca_activity() { jq -n --arg p "$WT" --argjson t "$1" '{ok:true,result:{worktrees:[{path:$p,lastActivityAt:$t}]}}' >"$FX/orca_wt.json"; }
now_ms() { echo $(($(date +%s) * 1000)); }
dirty_main() { echo "edit" >>"$WMAIN/tracked"; echo u >"$WMAIN/untracked.txt"; }
DESTROY_HOOK='git -C "$WMAIN" reset -q --hard && git -C "$WMAIN" clean -qfd'

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

echo "tests: $pass passed, $failn failed"
[ "$failn" -eq 0 ]
