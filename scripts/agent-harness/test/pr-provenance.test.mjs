import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const baseDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const provenance = path.join(baseDir, 'pr-provenance.mjs');
const commit = path.join(baseDir, 'commit-provenance.mjs');
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

test('PR body preserves each agent commit and rejects an omitted session', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pr-provenance-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  git(dir, 'init', '-q'); git(dir, 'config', 'user.name', 'Test'); git(dir, 'config', 'user.email', 'test@example.invalid');
  git(dir, 'commit', '--allow-empty', '-qm', 'chore: base');
  const base = git(dir, 'rev-parse', 'HEAD');
  const sha = '1234567890abcdef1234567890abcdef12345678';
  for (const session of ['session-a', 'session-b']) {
    execFileSync('node', [commit, 'run', session, '0.4.35', sha, 'git commit --allow-empty -qm "feat: work"'], { cwd: dir });
  }
  const report = execFileSync('node', [provenance, 'list', base, 'HEAD'], { cwd: dir, encoding: 'utf8' });
  assert.match(report, /session-a/); assert.match(report, /session-b/);
  const body = path.join(dir, 'body'); fs.writeFileSync(body, report);
  assert.equal(spawnSync('node', [provenance, 'check', base, 'HEAD', body], { cwd: dir }).status, 0);
  fs.writeFileSync(body, report.split('\n').filter(line => !line.includes('session-a')).join('\n'));
  assert.notEqual(spawnSync('node', [provenance, 'check', base, 'HEAD', body], { cwd: dir }).status, 0);
});

test('merge check uses the PR base and latest head, rejecting stale body', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pr-provenance-merge-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  git(dir, 'init', '-q'); git(dir, 'config', 'user.name', 'Test'); git(dir, 'config', 'user.email', 'test@example.invalid');
  git(dir, 'commit', '--allow-empty', '-qm', 'chore: base');
  const base = git(dir, 'rev-parse', 'HEAD');
  const sha = '1234567890abcdef1234567890abcdef12345678';
  execFileSync('node', [commit, 'run', 'session-a', '0.4.35', sha, 'git commit --allow-empty -qm "feat: work"'], { cwd: dir });
  const report = execFileSync('node', [provenance, 'list', base, 'HEAD'], { cwd: dir, encoding: 'utf8' });
  const bin = path.join(dir, 'bin'); fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'gh'), '#!/bin/sh\ncat "$TEST_PR_JSON"\n', { mode: 0o755 });
  const data = path.join(dir, 'pr.json');
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, TEST_PR_JSON: data };
  fs.writeFileSync(data, JSON.stringify({ baseRefOid: base, headRefOid: git(dir, 'rev-parse', 'HEAD'), body: report }));
  assert.equal(spawnSync('node', [provenance, 'merge', '42', git(dir, 'rev-parse', 'HEAD')], { cwd: dir, env }).status, 0);
  assert.equal(spawnSync('node', [provenance, 'merge-json', '42', git(dir, 'rev-parse', 'HEAD')], { cwd: dir, input: fs.readFileSync(data), env }).status, 0);
  assert.notEqual(spawnSync('node', [provenance, 'merge-json', '42', 'a'.repeat(40)], { cwd: dir, input: fs.readFileSync(data), env }).status, 0);
  execFileSync('node', [commit, 'run', 'session-b', '0.4.35', sha, 'git commit --allow-empty -qm "feat: more"'], { cwd: dir });
  fs.writeFileSync(data, JSON.stringify({ baseRefOid: base, headRefOid: git(dir, 'rev-parse', 'HEAD'), body: report }));
  assert.notEqual(spawnSync('node', [provenance, 'merge', '42', git(dir, 'rev-parse', 'HEAD')], { cwd: dir, env }).status, 0);
});

test('PR hook blocks a merge when the latest PR body is stale', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pr-provenance-hook-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  git(dir, 'init', '-q'); git(dir, 'config', 'user.name', 'Test'); git(dir, 'config', 'user.email', 'test@example.invalid');
  git(dir, 'commit', '--allow-empty', '-qm', 'chore: base');
  const base = git(dir, 'rev-parse', 'HEAD');
  execFileSync('node', [commit, 'run', 'session-a', '0.4.35', '1234567890abcdef1234567890abcdef12345678', 'git commit --allow-empty -qm "feat: work"'], { cwd: dir });
  const bin = path.join(dir, 'bin'); fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'gh'), '#!/bin/sh\ncat "$TEST_PR_JSON"\n', { mode: 0o755 });
  const data = path.join(dir, 'pr.json');
  fs.writeFileSync(data, JSON.stringify({ baseRefOid: base, headRefOid: git(dir, 'rev-parse', 'HEAD'), body: '## Summary\nNo provenance' }));
  const hook = path.resolve(baseDir, '../../.claude/hooks/pr-visual-report.sh');
  const result = spawnSync('bash', [hook], { cwd: dir, input: JSON.stringify({ cwd: dir, tool_input: { command: `gh pr merge 42 --squash --match-head-commit ${git(dir, 'rev-parse', 'HEAD')}` } }), encoding: 'utf8', env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, TEST_PR_JSON: data, AGENT_HARNESS_KPI: '0' } });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).hookSpecificOutput.permissionDecision, 'deny');
});

test('rebase and merge retain agent commit trailers', t => {
  for (const method of ['rebase', 'merge']) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'provenance-history-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    git(dir, 'init', '-q', '-b', 'base'); git(dir, 'config', 'user.name', 'Test'); git(dir, 'config', 'user.email', 'test@example.invalid');
    git(dir, 'commit', '--allow-empty', '-qm', 'chore: base');
    git(dir, 'checkout', '-qb', 'feature');
    execFileSync('node', [commit, 'run', 'session-history', '0.4.36', '1234567890abcdef1234567890abcdef12345678', 'git commit --allow-empty -qm "feat: work"'], { cwd: dir });
    git(dir, 'checkout', '-q', 'base'); git(dir, 'commit', '--allow-empty', '-qm', 'chore: advance base');
    if (method === 'rebase') { git(dir, 'checkout', '-q', 'feature'); git(dir, 'rebase', '-q', 'base'); }
    else git(dir, 'merge', '--no-ff', '-qm', 'merge feature', 'feature');
    assert.match(git(dir, 'log', '--format=%B'), /Session-Id: session-history/);
  }
});
