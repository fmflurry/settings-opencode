import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  assessPluginVersion,
  changelogHasVersion,
  compareSemver,
  evaluateVersionBump,
  isPluginSource,
  pluginSourcePaths,
  suggestBumps,
} from './version-guard.mjs';

const PATHS = pluginSourcePaths({ hooks: { include: ['stop.sh'] } });

function decision(overrides) {
  return evaluateVersionBump({
    baseAvailable: true,
    currentVersion: '0.1.0',
    baseVersion: '0.1.0',
    changedPluginPaths: ['plugins/fmflurry-harness/agents/coder.md'],
    baseRef: 'origin/master',
    ...overrides,
  });
}

test('requires a strictly greater version when plugin sources change', () => {
  const result = decision({ currentVersion: '0.2.0', baseVersion: '0.1.0' });
  assert.equal(result.ok, true);
  assert.equal(result.skipped, false);
  assert.equal(result.message, null);
});

test('rejects a missing bump and names both versions plus the suggested bump', () => {
  const result = decision({ currentVersion: '0.1.0', baseVersion: '0.1.0' });
  assert.equal(result.ok, false);
  assert.match(result.message, /version 0\.1\.0 is equal to base 0\.1\.0/);
  assert.match(result.message, /patch 0\.1\.1/);
  assert.match(result.message, /minor 0\.2\.0/);
  assert.match(result.message, /major 1\.0\.0/);
  assert.match(result.message, /plugins\/fmflurry-harness\/agents\/coder\.md/);
});

test('rejects a version lower than the base and suggests a bump above the base', () => {
  const result = decision({ currentVersion: '0.1.0', baseVersion: '0.2.0' });
  assert.equal(result.ok, false);
  assert.match(result.message, /version 0\.1\.0 is lower than base 0\.2\.0/);
  assert.match(result.message, /patch 0\.2\.1/);
  assert.match(result.message, /minor 0\.3\.0/);
  assert.match(result.message, /major 1\.0\.0/);
});

test('a non-plugin change does not require a bump', () => {
  const changed = [
    'README.md',
    'plugins/notification-gate.test.mts',
    'scripts/cursor-plugin/check.mjs',
    '.claude/hooks/notification.sh',
    '.github/workflows/cursor-plugin.yml',
  ].filter((file) => isPluginSource(file, PATHS));
  assert.deepEqual(changed, []);
  const result = decision({ changedPluginPaths: changed });
  assert.equal(result.ok, true);
  assert.equal(result.message, null);
});

test('skips with a message when no base is available', () => {
  const result = evaluateVersionBump({
    baseAvailable: false,
    currentVersion: '0.1.0',
    baseVersion: null,
    changedPluginPaths: ['plugins/fmflurry-harness/agents/coder.md'],
    unavailableMessage: 'cursor-plugin version guard skipped: no base ref available (tried origin/master, master). Fetch the base branch or set CURSOR_PLUGIN_BASE to enforce the bump check.',
  });
  assert.equal(result.ok, true);
  assert.equal(result.skipped, true);
  assert.match(result.message, /no base ref available/);
  assert.match(result.message, /CURSOR_PLUGIN_BASE/);
});

test('semver ordering is numeric', () => {
  assert.equal(compareSemver('0.1.10', '0.1.9'), 1);
  assert.equal(compareSemver('1.0.0', '0.9.9'), 1);
  assert.equal(compareSemver('0.1.0', '0.1.0'), 0);
  assert.equal(compareSemver('0.1', '0.1.0'), null);
  assert.deepEqual(suggestBumps('1.2.3'), { patch: '1.2.4', minor: '1.3.0', major: '2.0.0' });
});

test('plugin source paths follow the build inputs', () => {
  assert.equal(isPluginSource('plugins/fmflurry-harness/agents/coder.md', PATHS), true);
  assert.equal(isPluginSource('skills/git-workflow/SKILL.md', PATHS), true);
  assert.equal(isPluginSource('commands/git.md', PATHS), true);
  assert.equal(isPluginSource('.claude/hooks/stop.sh', PATHS), true);
  assert.equal(isPluginSource('.claude/hooks/notification.sh', PATHS), false);
  assert.equal(isPluginSource('scripts/cursor-plugin/lib.mjs', PATHS), true);
  assert.equal(isPluginSource('scripts/cursor-plugin/assets/logo.png', PATHS), true);
  assert.equal(isPluginSource('scripts/cursor-plugin/assets/logo.svg', PATHS), false);
  assert.equal(isPluginSource('scripts/cursor-plugin/templates/setup-harness.md', PATHS), true);
  assert.equal(isPluginSource('scripts/cursor-plugin/check.mjs', PATHS), false);
  assert.equal(isPluginSource('scripts/cursor-plugin/version-guard.mjs', PATHS), false);
  assert.equal(isPluginSource('opencode.jsonc', PATHS), true);
  assert.equal(isPluginSource('package.json', PATHS), false);
});

test('changelog heading matches the current version only', () => {
  const text = '## [0.1.0] - 2026-10-07\n\n- Initial\n\n## [0.2.0] - 2026-10-17\n\n- Guard\n';
  assert.equal(changelogHasVersion(text, '0.2.0'), true);
  assert.equal(changelogHasVersion(text, '0.1.0'), true);
  assert.equal(changelogHasVersion('## 0.2.0\n', '0.2.0'), true);
  assert.equal(changelogHasVersion(text, '0.20.0'), false);
  assert.equal(changelogHasVersion('version 0.2.0 is mentioned\n', '0.2.0'), false);
  assert.equal(changelogHasVersion('### [0.2.0]\n', '0.2.0'), false);
});

function gitEnv(extra = {}) {
  const env = { ...process.env, ...extra };
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;
  delete env.GIT_INDEX_FILE;
  delete env.CURSOR_PLUGIN_BASE;
  delete env.GITHUB_BASE_REF;
  delete env.GITHUB_ACTIONS;
  env.GIT_AUTHOR_NAME = 'Test';
  env.GIT_AUTHOR_EMAIL = 'test@example.com';
  env.GIT_COMMITTER_NAME = 'Test';
  env.GIT_COMMITTER_EMAIL = 'test@example.com';
  return env;
}

function git(repoDir, args, env = gitEnv()) {
  execFileSync('git', args, { cwd: repoDir, env, stdio: 'pipe' });
}

function writeConfig(repoDir, version) {
  const file = path.join(repoDir, 'scripts/cursor-plugin/config.json');
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify({ version, hooks: { include: [] } }, null, 2)}\n`);
}

function initRepo(version = '0.1.0', branch = 'master') {
  const repoDir = mkdtempSync(path.join(tmpdir(), 'plugin-semver-'));
  const env = gitEnv();
  git(repoDir, ['init', '-b', branch], env);
  writeConfig(repoDir, version);
  writeFileSync(path.join(repoDir, 'README.md'), 'root\n');
  git(repoDir, ['add', '.'], env);
  git(repoDir, ['commit', '-m', 'init'], env);
  return { repoDir, env };
}

function assess(repoDir, env, currentVersion) {
  return assessPluginVersion({
    repoDir,
    env,
    paths: PATHS,
    currentVersion,
  });
}

test('an untracked plugin source requires a bump', () => {
  const { repoDir } = initRepo();
  try {
    writeFileSync(path.join(repoDir, 'scripts/cursor-plugin/lib.mjs'), 'export {}\n');
    const result = assess(repoDir, gitEnv({ CURSOR_PLUGIN_BASE: 'master' }), '0.1.0');
    assert.equal(result.errors.length, 1);
    assert.match(result.errors[0], /equal to base 0\.1\.0/);
    assert.match(result.errors[0], /scripts\/cursor-plugin\/lib\.mjs/);
  } finally {
    rmSync(repoDir, { recursive: true, force: true });
  }
});

test('a committed non-plugin change does not require a bump', () => {
  const { repoDir } = initRepo();
  try {
    const env = gitEnv();
    git(repoDir, ['checkout', '-b', 'feature'], env);
    writeFileSync(path.join(repoDir, 'README.md'), 'docs only\n');
    git(repoDir, ['add', 'README.md'], env);
    git(repoDir, ['commit', '-m', 'docs'], env);
    const result = assess(repoDir, gitEnv({ CURSOR_PLUGIN_BASE: 'master' }), '0.1.0');
    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.notices, []);
  } finally {
    rmSync(repoDir, { recursive: true, force: true });
  }
});

test('a greater version passes for a committed plugin source change', () => {
  const { repoDir } = initRepo();
  try {
    const env = gitEnv();
    git(repoDir, ['checkout', '-b', 'feature'], env);
    writeFileSync(path.join(repoDir, 'scripts/cursor-plugin/lib.mjs'), 'export {}\n');
    writeConfig(repoDir, '0.2.0');
    git(repoDir, ['add', '.'], env);
    git(repoDir, ['commit', '-m', 'bump'], env);
    const result = assess(repoDir, gitEnv({ CURSOR_PLUGIN_BASE: 'master' }), '0.2.0');
    assert.deepEqual(result.errors, []);
  } finally {
    rmSync(repoDir, { recursive: true, force: true });
  }
});

test('version must exceed the base branch tip, not only the merge-base', () => {
  const { repoDir } = initRepo('0.1.0');
  try {
    const env = gitEnv();
    git(repoDir, ['checkout', '-b', 'feature'], env);
    git(repoDir, ['checkout', 'master'], env);
    writeConfig(repoDir, '0.3.0');
    const agent = path.join(repoDir, 'plugins/fmflurry-harness/agents/coder.md');
    mkdirSync(path.dirname(agent), { recursive: true });
    writeFileSync(agent, 'master\n');
    git(repoDir, ['add', '.'], env);
    git(repoDir, ['commit', '-m', 'master bump'], env);
    git(repoDir, ['checkout', 'feature'], env);
    const skill = path.join(repoDir, 'skills/demo/SKILL.md');
    mkdirSync(path.dirname(skill), { recursive: true });
    writeFileSync(skill, 'feature\n');
    writeConfig(repoDir, '0.2.0');
    git(repoDir, ['add', '.'], env);
    git(repoDir, ['commit', '-m', 'feature'], env);
    const result = assess(repoDir, gitEnv({ CURSOR_PLUGIN_BASE: 'master' }), '0.2.0');
    assert.equal(result.errors.length, 1);
    assert.match(result.errors[0], /version 0\.2\.0 is lower than base 0\.3\.0/);
  } finally {
    rmSync(repoDir, { recursive: true, force: true });
  }
});

test('no base ref skips the guard even if plugin sources changed', () => {
  const { repoDir } = initRepo('0.1.0', 'main');
  try {
    writeFileSync(path.join(repoDir, 'scripts/cursor-plugin/lib.mjs'), 'export {}\n');
    const result = assess(repoDir, gitEnv(), '0.1.0');
    assert.deepEqual(result.errors, []);
    assert.equal(result.notices.length, 1);
    assert.match(result.notices[0], /no base ref available/);
    assert.match(result.notices[0], /CURSOR_PLUGIN_BASE/);
  } finally {
    rmSync(repoDir, { recursive: true, force: true });
  }
});
