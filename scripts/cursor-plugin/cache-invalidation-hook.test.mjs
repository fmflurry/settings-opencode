import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const hook = path.join(repo, '.claude/hooks/cache-invalidation.sh');
const adapter = path.join(repo, 'scripts/cursor-plugin/cursor-adapter.sh');

const ORIGINAL = [
  'export class Facade {',
  "  @SkipIfCached('LIST', (i) => i.store, true, CACHE_NO_TIMEOUT)",
  '  load() {}',
  '}',
  '',
].join('\n');

function git(dir, args) {
  const result = spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
  assert.equal(result.status, 0, `${args.join(' ')}\n${result.stderr}`);
}

function initRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cache-inv-'));
  git(dir, ['init', '-q', '-b', 'master']);
  git(dir, ['config', 'user.email', 't@t']);
  git(dir, ['config', 'user.name', 't']);
  fs.writeFileSync(path.join(dir, 'facade.ts'), ORIGINAL);
  git(dir, ['add', 'facade.ts']);
  git(dir, ['commit', '-qm', 'base']);
  git(dir, ['checkout', '-q', '-b', 'feat']);
  return dir;
}

function run(dir, args, input, extraEnv = {}) {
  return spawnSync('bash', [hook, ...args], {
    cwd: dir,
    encoding: 'utf8',
    input,
    env: { ...process.env, TMPDIR: dir, ...extraEnv },
  });
}

function warns(result) {
  return `${result.stdout}${result.stderr}`.includes('cache-invalidation:');
}

test('staged removal of a cache marker warns and exits 0', () => {
  const dir = initRepo();
  fs.writeFileSync(path.join(dir, 'facade.ts'), 'export class Facade {\n  load() {}\n}\n');
  git(dir, ['add', 'facade.ts']);
  const result = run(dir, ['--text']);
  assert.equal(result.status, 0);
  assert.equal(warns(result), true);
  assert.match(result.stdout, /explicitly instructed/);
  assert.match(result.stdout, /invalidate on the write/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('invalidateCacheFor on an added line keeps the warning quiet', () => {
  const dir = initRepo();
  fs.writeFileSync(
    path.join(dir, 'facade.ts'),
    "export class Facade {\n  load() { this.store.invalidateCacheFor('LIST'); }\n}\n",
  );
  const result = run(dir, ['--text']);
  assert.equal(result.status, 0);
  assert.equal(warns(result), false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('onCacheInvalidate keeps the warning quiet', () => {
  const dir = initRepo();
  fs.writeFileSync(
    path.join(dir, 'facade.ts'),
    'export class Facade {\n  load() { this.store.onCacheInvalidate(); }\n}\n',
  );
  const result = run(dir, ['--text']);
  assert.equal(result.status, 0);
  assert.equal(warns(result), false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('shortening CACHE_NO_TIMEOUT warns', () => {
  const dir = initRepo();
  fs.writeFileSync(
    path.join(dir, 'facade.ts'),
    "export class Facade {\n  @SkipIfCached('LIST', (i) => i.store, true, 1000)\n  load() {}\n}\n",
  );
  const result = run(dir, ['--text']);
  assert.equal(result.status, 0);
  assert.equal(warns(result), true);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('moving the decorator does not warn', () => {
  const dir = initRepo();
  fs.writeFileSync(
    path.join(dir, 'facade.ts'),
    "export class Facade {\n  load() {}\n  @SkipIfCached('LIST', (i) => i.store, true, CACHE_NO_TIMEOUT)\n  other() {}\n}\n",
  );
  const result = run(dir, ['--text']);
  assert.equal(result.status, 0);
  assert.equal(warns(result), false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('commenting out the decorator warns', () => {
  const dir = initRepo();
  fs.writeFileSync(
    path.join(dir, 'facade.ts'),
    "export class Facade {\n  // @SkipIfCached('LIST', (i) => i.store, true, CACHE_NO_TIMEOUT)\n  load() {}\n}\n",
  );
  const result = run(dir, ['--text']);
  assert.equal(result.status, 0);
  assert.equal(warns(result), true);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a committed branch diff warns, and a worktree restore does not', () => {
  const dir = initRepo();
  fs.writeFileSync(path.join(dir, 'facade.ts'), 'export class Facade {\n  load() {}\n}\n');
  git(dir, ['add', 'facade.ts']);
  git(dir, ['commit', '-qm', 'drop cache']);
  const removed = run(dir, ['--text']);
  assert.equal(warns(removed), true);
  fs.writeFileSync(path.join(dir, 'facade.ts'), ORIGINAL);
  const restored = run(dir, ['--text']);
  assert.equal(warns(restored), false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('IMemoryCache removal warns unless the write evicts', () => {
  const dir = initRepo();
  git(dir, ['checkout', '-q', 'master']);
  fs.writeFileSync(path.join(dir, 'Cache.cs'), 'public class Cache {\n  private readonly IMemoryCache cache;\n}\n');
  git(dir, ['add', 'Cache.cs']);
  git(dir, ['commit', '-qm', 'cache']);
  git(dir, ['checkout', '-q', 'feat']);
  git(dir, ['merge', '-q', 'master']);
  fs.writeFileSync(path.join(dir, 'Cache.cs'), 'public class Cache {\n}\n');
  const dropped = run(dir, ['--text']);
  assert.equal(warns(dropped), true);
  fs.writeFileSync(path.join(dir, 'Cache.cs'), 'public class Cache {\n  void Save() { cache.Remove(key); }\n}\n');
  const evicted = run(dir, ['--text']);
  assert.equal(warns(evicted), false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('outside a git repo the hook stays quiet', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cache-inv-nogit-'));
  const result = run(dir, ['--text']);
  assert.equal(result.status, 0);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, '');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('PreToolUse warns once per session and Stop does not block', () => {
  const dir = initRepo();
  fs.writeFileSync(path.join(dir, 'facade.ts'), 'export class Facade {\n  load() {}\n}\n');
  const payload = JSON.stringify({ hook_event_name: 'PreToolUse', session_id: 'sess-1' });
  const first = run(dir, [], payload);
  assert.equal(first.status, 0);
  const body = JSON.parse(first.stdout);
  assert.match(body.hookSpecificOutput.additionalContext, /explicitly instructed/);
  assert.match(body.hookSpecificOutput.additionalContext, /invalidate on the write/);
  const second = run(dir, [], payload);
  assert.equal(second.status, 0);
  assert.equal(second.stdout, '');
  const stop = run(dir, [], JSON.stringify({ hook_event_name: 'Stop', session_id: 'sess-1' }));
  assert.equal(stop.status, 0);
  assert.equal(stop.stdout, '');
  assert.match(stop.stderr, /explicitly instructed/);
  assert.match(stop.stderr, /invalidate on the write/);
  assert.equal(stop.stderr.includes('decision'), false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('Cursor preToolUse allows the tool and surfaces the rule', () => {
  const dir = initRepo();
  fs.writeFileSync(path.join(dir, 'facade.ts'), 'export class Facade {\n  load() {}\n}\n');
  const input = JSON.stringify({
    tool_name: 'Write',
    tool_input: { path: 'facade.ts' },
    conversation_id: 'conv-cache',
    hook_event_name: 'preToolUse',
  });
  const result = spawnSync('bash', [adapter, hook, 'preToolUse'], {
    cwd: dir,
    encoding: 'utf8',
    input,
    env: { ...process.env, TMPDIR: dir },
  });
  assert.equal(result.status, 0, result.stderr);
  const body = JSON.parse(result.stdout);
  assert.equal(body.permission, 'allow');
  assert.match(body.agent_message, /explicitly instructed/);
  assert.match(body.agent_message, /cache-invalidation\.mdc/);
  const again = spawnSync('bash', [adapter, hook, 'preToolUse'], {
    cwd: dir,
    encoding: 'utf8',
    input,
    env: { ...process.env, TMPDIR: dir },
  });
  assert.equal(JSON.parse(again.stdout).permission, 'allow');
  assert.equal(JSON.parse(again.stdout).agent_message, undefined);
  const stop = spawnSync('bash', [adapter, hook, 'stop'], {
    cwd: dir,
    encoding: 'utf8',
    input: JSON.stringify({ conversation_id: 'conv-cache', hook_event_name: 'stop', loop_count: 0 }),
    env: { ...process.env, TMPDIR: dir },
  });
  assert.equal(stop.status, 0);
  assert.deepEqual(JSON.parse(stop.stdout), {});
  fs.rmSync(dir, { recursive: true, force: true });
});
