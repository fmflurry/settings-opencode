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
  "repo view"*) echo "o/r" ;;
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
reset() { rm -f "$FX"/*.log "$FX"/merge.* "$FX"/default_branch "$TMP/state"/* "$CFG"; }
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

# ---- ship-merge (configured: base master, required gate+export, tltb-review by the bot)
merge() { ( cd "$TMP/work" && bash "$H/ship-merge.sh" "$@" ) >"$FX/out" 2>&1; }
refuses() {
  local name="$1"; shift
  merge "$@"; local rc=$?
  check "ship-merge refuses: $name" test $rc -ne 0
  check "ship-merge no merge call: $name" bash -c '! grep -q "pr merge" "$1" 2>/dev/null' _ "$FX/gh.log"
}
fresh() { reset; green_fixtures; flag_on; cfg_ci; }

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
check "ship-merge deletes remote branch via API" grep -q 'api -X DELETE repos/o/r/git/refs/heads/feat' "$FX/gh.log"
check "ship-merge marks goal done" test "$(jq -r .status "$TMP/state/goal.json")" = "done"
fresh; ORCA_WORKTREE_ID='repo::/p' merge 5
check "ship-merge notifies done with PR number" grep -q -- 'done: PR #5 merged' "$FX/orca.log"
fresh; mutate '.isDraft=true' view.json; ORCA_WORKTREE_ID='repo::/p' merge 5
check "ship-merge refusal sends no done notification" bash -c '! grep -q "done:" "$1" 2>/dev/null' _ "$FX/orca.log"
fresh; rm -f "$TMP/state/autonomy.on"; merge 5 --confirmed; rc=$?
check "ship-merge --confirmed works with flag off" test $rc -eq 0
fresh; echo 1 >"$FX/merge.rc"; merge 5; rc=$?
check "ship-merge succeeds when merge exits non-zero but PR is MERGED" test $rc -eq 0

# ---- ship-merge: no config (base = repo default branch, all checks green, review rail skipped)
nocfg() { reset; green_fixtures; flag_on; }
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
git -c alias.p=!sh status
git -c alias.x=!echo status
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
CMDS
)"
SHIP_ALLOW_CMDS="$(cat <<'CMDS'
agent-harness ship-merge 12
bash /Users/someone/.claude/scripts/agent-harness/ship-merge.sh 12
bash tools/agent-harness/ship-merge.sh 12
CMDS
)"
reset; flag_on
while IFS= read -r c; do check "git-guard denies: $c" denied "$c"; done <<<"$DENY_CMDS"
while IFS= read -r c; do check "git-guard allows: $c" allowed "$c"; done <<<"$ALLOW_CMDS"
while IFS= read -r c; do check "git-guard allows: $c" allowed "$c"; done <<<"$SHIP_ALLOW_CMDS"
while IFS= read -r c; do check "git-guard asks: $c" asked "$c"; done <<<"$ASK_CMDS"
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
while IFS= read -r c; do check "git-guard (flag off) allows: $c" allowed "$c"; done <<<"$ALLOW_CMDS"
while IFS= read -r c; do check "git-guard (flag off) allows: $c" allowed "$c"; done <<<"$ASK_CMDS"
git -C "$TMP/work" checkout -q master
check "git-guard (flag off) allows bare push on the base branch" allowed "git push"
git -C "$TMP/work" checkout -q feat

echo "tests: $pass passed, $failn failed"
[ "$failn" -eq 0 ]
