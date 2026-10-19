#!/usr/bin/env node
// Runs a seeded corpus of shell commands through the 0.4.8 autonomy git guard and the current one,
// autonomy on and off, and fails on any difference in stdout or exit code.
import { execFileSync, spawn } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '../../..')
const baselineSha = process.env.GUARD_BASELINE_SHA || 'a4fbb48'
const current = join(root, '.claude/hooks/autonomy-git-guard.sh')
const randomCases = Number(process.env.GUARD_DIFF_CASES || 300)

const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'guard-diff-')))
const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.email=a@b', '-c', 'user.name=n', ...args], { cwd, stdio: 'pipe' })
const baseline = join(tmp, 'baseline.sh')
writeFileSync(baseline, execFileSync('git', ['show', `${baselineSha}:.claude/hooks/autonomy-git-guard.sh`], { cwd: root }))

const repo = join(tmp, 'repo')
const wt = join(tmp, 'wt')
const other = join(tmp, 'other')
for (const [dir, branch] of [[repo, 'main'], [other, 'main']]) {
  mkdirSync(dir, { recursive: true })
  git(dir, 'init', '-q', '-b', branch)
  git(dir, 'commit', '-q', '--allow-empty', '-m', 'i')
}
git(repo, 'worktree', 'add', '-q', '-b', 'feat/x', wt)
mkdirSync(join(repo, 'sub'), { recursive: true })
const states = { on: join(tmp, 'state-on'), off: join(tmp, 'state-off') }
for (const dir of Object.values(states)) mkdirSync(dir)
writeFileSync(join(states.on, 'autonomy.on'), '')

let seed = 20261019
const rnd = () => {
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
const pick = (list) => list[Math.floor(rnd() * list.length)]

const fixed = [
  'git push origin main', 'git push origin HEAD:main', 'git push origin feat', 'git push', 'git push origin',
  'git push --force origin main', 'git push origin :main', 'git push origin +main', 'git push --delete origin feat',
  'git reset --hard', 'git branch -D feat', 'git update-ref -d refs/heads/main', 'git commit --no-verify -m x',
  'git checkout .claude/settings.json', 'git worktree remove x', 'git worktree prune', 'git -c alias.x=y status',
  'git --config-env alias.x=V status', 'GIT_CONFIG=a git status', 'git push origin $B', "git push origin $'ma\\x69n'",
  'git push origin "ma"\\\nin', 'echo main | xargs git push origin', 'cd sub && git push origin main',
  `cd ${repo} && git push`, `cd ${wt} && git push`, `git -C ${wt} push`, `git -C ${repo} push`, `git -C ${other} push`,
  `git --git-dir ${repo}/.git push`, `rm -rf ${wt}`, `rm -rf ${wt}/.git`, 'rm -rf .', 'rm -rf *', 'rm -rf build',
  `mv ${wt} ${tmp}/moved`, `find ${wt} -delete`, 'orca worktree rm x', 'echo x > .claude/settings.json',
  'echo x >> .claude/state/autonomy.on', 'tee .claude/x', 'sed -i s/a/b/ .claude/x', 'python -c "open(\'.claude/x\',\'w\')"',
  'gh pr merge 1', 'gh api -X PUT repos/o/r/pulls/1/merge', 'gh api graphql -f query=mutation{mergePullRequest}',
  'gh pr view 1', 'gh api repos/o/r/git/refs/heads/feat -X DELETE', "FOO='a b' gh pr merge 1",
  'agent-harness ship-merge 1', 'agent-harness ship-merge 1 --confirmed', 'agent-harness cleanup 1',
  'agent-harness worktree-rm /x', 'AGENT_STATE_DIR=/x agent-harness ship-merge 1', 'PATH=/x agent-harness cleanup 1',
  'export GIT_DIR=/x; git push', 'export GIT_CONFIG=a\ngit status', 'true; git push origin main',
]
const words = ['git', 'push', 'origin', 'main', 'master', 'feat', 'HEAD', 'rm', '-rf', 'cd', 'sub', '..', 'echo', 'x', '>', '>>',
  '.claude/x', '-C', '-c', '--git-dir', 'worktree', 'remove', 'gh', 'pr', 'merge', 'api', '-X', 'PUT', 'env', 'sudo', 'bash',
  'export', 'GIT_DIR=/x', 'FOO=1', 'status', 'reset', '--hard', 'branch', '-D', 'commit', '--no-verify', 'xargs', 'time', wt, repo]
const seps = [' ', ' ', ' ', '\t', ' ; ', ' && ', ' | ', '\n', ' & ', ' \\\n']
const frag = () => {
  const w = pick(words)
  const r = rnd()
  if (r < 0.15) return `"${w}"`
  if (r < 0.25) return `'${w}'`
  if (r < 0.3) return `${w}$X`
  if (r < 0.35 && w.length > 2) return `${w.slice(0, 2)}\\${w.slice(2)}`
  if (r < 0.38) return `$(${w})`
  if (r < 0.4) return `{${w},x}`
  return w
}
const cases = [...fixed]
for (const end of [repo, '..', '../x', '-', '~', '', '$X', '-P /tmp']) {
  for (const tail of ['git push', 'git push origin HEAD', 'rm -rf .', 'git -C . push']) {
    for (const head of ['', 'cd rel\n', 'cd -x\n', 'cd $Y\n', 'pushd ..\n']) {
      cases.push(`${head}cd /tmp/a\ncd /tmp/b\ncd ${repo}\ncd /tmp/c\ncd ${end}\n${tail}`)
      cases.push(`${head}cd /tmp/a; cd sub; cd /tmp/b && cd ${end}; ${tail}`)
    }
  }
}
for (let i = 0; i < randomCases; i++) {
  let c = ''
  const n = 1 + Math.floor(rnd() * 8)
  for (let k = 0; k < n; k++) c += frag() + (k < n - 1 ? pick(seps) : '')
  if (rnd() < 0.08) c += pick(['"', "'", '\\', '$', '`'])
  if (rnd() < 0.05) c = `cat <<EOF\n${c}\nEOF`
  cases.push(c)
}

const run = (shell, script, command, mode) => new Promise((done, fail) => {
  const env = { ...process.env, AGENT_HARNESS_TEST: '1', AGENT_STATE_DIR: states[mode], CLAUDE_PROJECT_DIR: repo }
  const child = spawn(shell, [script], { cwd: repo, env })
  const out = []
  const err = []
  child.stdout.on('data', (d) => out.push(d))
  child.stderr.on('data', (d) => err.push(d))
  child.on('error', fail)
  child.on('close', (code) => done({ code, out: Buffer.concat(out).toString(), err: Buffer.concat(err).toString() }))
  child.stdin.end(JSON.stringify({ cwd: repo, tool_input: { command } }))
})

const shells = ['bash']
if (process.platform === 'darwin') shells.push('/bin/bash')
const jobs = []
for (const shell of shells) for (const mode of ['on', 'off']) for (const command of cases) jobs.push({ shell, mode, command })

const diffs = []
const stderrRuns = []
const seen = { deny: 0, ask: 0, allow: 0 }
let next = 0
const worker = async () => {
  while (next < jobs.length) {
    const { shell, mode, command } = jobs[next++]
    const [a, b] = await Promise.all([run(shell, baseline, command, mode), run(shell, current, command, mode)])
    seen[b.out.includes('"deny"') ? 'deny' : b.out.includes('"ask"') ? 'ask' : 'allow']++
    if (a.code !== b.code || a.out !== b.out) diffs.push({ shell, mode, command, a, b })
    if (b.err !== '') stderrRuns.push({ shell, mode, command, err: b.err })
  }
}
await Promise.all(Array.from({ length: 4 }, worker))

console.log(`guard differential: ${cases.length} cases x ${shells.length} shell(s) x 2 modes = ${jobs.length} comparisons vs ${baselineSha}, ${diffs.length} differences`)
console.log(`decisions: ${seen.deny} deny, ${seen.ask} ask, ${seen.allow} allow`)
if (seen.deny === 0 || seen.allow === 0) { console.log('corpus exercised only one decision'); process.exit(1) }
for (const d of diffs.slice(0, 10)) {
  console.log(`--- ${d.shell} autonomy ${d.mode}: ${JSON.stringify(d.command)}`)
  console.log(`baseline exit ${d.a.code}: ${d.a.out.slice(-200)}`)
  console.log(`current  exit ${d.b.code}: ${d.b.out.slice(-200)}`)
}
console.log(`current hook runs with stderr output: ${stderrRuns.length}`)
for (const s of stderrRuns.slice(0, 10)) console.log(`--- ${s.shell} autonomy ${s.mode}: ${JSON.stringify(s.command)}\n${s.err.slice(0, 200)}`)
process.exit(diffs.length === 0 && stderrRuns.length === 0 ? 0 : 1)
