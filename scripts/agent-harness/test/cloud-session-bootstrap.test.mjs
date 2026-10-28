import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildHooks } from '../../cursor-plugin/lib.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const hook = path.join(repo, '.claude/hooks/cloud-session-bootstrap.sh');
const install = path.join(repo, 'install.sh');
const settingsSync = path.join(repo, 'scripts/settings-sync.sh');
const repoUrl = 'https://github.com/fmflurry/settings-opencode';

function baseEnv(extra = {}) {
  const env = { ...process.env };
  delete env.CLAUDE_CODE_REMOTE;
  delete env.CLAUDE_PROJECT_DIR;
  delete env.HARNESS_VARIANT;
  delete env.CLOUD_BOOTSTRAP_GIT_FAIL;
  delete env.CLOUD_BOOTSTRAP_INSTALL_EXIT;
  return { ...env, ...extra };
}

function writeFakeGit(bin) {
  fs.mkdirSync(bin, { recursive: true });
  const gitLog = path.join(bin, 'git.log');
  const installLog = path.join(bin, 'install.log');
  const template = path.join(bin, 'install-template.sh');
  fs.writeFileSync(template, `#!/usr/bin/env bash
printf '%s\\n' "$*" >> ${JSON.stringify(installLog)}
exit "\${CLOUD_BOOTSTRAP_INSTALL_EXIT:-0}"
`);
  fs.chmodSync(template, 0o755);
  fs.writeFileSync(path.join(bin, 'git'), `#!/usr/bin/env bash
set -u
printf '%s\\n' "$*" >> ${JSON.stringify(gitLog)}
if [ "\${CLOUD_BOOTSTRAP_GIT_FAIL:-}" = 1 ]; then
  exit 1
fi
dest="\${@: -1}"
mkdir -p "$dest"
cp ${JSON.stringify(template)} "$dest/install.sh"
chmod +x "$dest/install.sh"
exit 0
`);
  fs.chmodSync(path.join(bin, 'git'), 0o755);
  return { gitLog, installLog };
}

function runHook(project, extra = {}) {
  return spawnSync('bash', [hook], {
    cwd: repo,
    encoding: 'utf8',
    env: baseEnv({
      CLAUDE_PROJECT_DIR: project,
      PATH: extra.PATH || process.env.PATH,
      ...extra,
    }),
  });
}

test('bootstrap runs only when remote and the project does not vendor the harness', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cloud-bootstrap-'));
  const project = path.join(root, 'project');
  const bin = path.join(root, 'bin');
  fs.mkdirSync(project);
  const { gitLog, installLog } = writeFakeGit(bin);
  try {
    const result = runHook(project, {
      CLAUDE_CODE_REMOTE: 'true',
      PATH: `${bin}:${process.env.PATH}`,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, '');
    const gitArgs = fs.readFileSync(gitLog, 'utf8');
    assert.match(gitArgs, /clone --depth 1 --quiet/);
    assert.match(gitArgs, new RegExp(repoUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.equal(fs.readFileSync(installLog, 'utf8').trim(), '--yes monolith');

    const again = runHook(project, {
      CLAUDE_CODE_REMOTE: 'true',
      PATH: `${bin}:${process.env.PATH}`,
    });
    assert.equal(again.status, 0, again.stderr);
    assert.equal(again.stderr, '');
    assert.equal(fs.readFileSync(installLog, 'utf8').trim().split('\n').length, 2);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('bootstrap is a no-op when not remote, when the harness is vendored, or when clone or install fails', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cloud-bootstrap-'));
  const bin = path.join(root, 'bin');
  const { gitLog, installLog } = writeFakeGit(bin);
  const pathEnv = `${bin}:${process.env.PATH}`;
  try {
    const plain = path.join(root, 'plain');
    fs.mkdirSync(plain);
    fs.mkdirSync(path.join(plain, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(plain, '.claude/settings.json'), '{}\n');
    const local = runHook(plain, { PATH: pathEnv });
    assert.equal(local.status, 0);
    assert.equal(local.stderr, '');
    assert.equal(fs.existsSync(gitLog), false);

    const other = runHook(plain, { CLAUDE_CODE_REMOTE: 'false', PATH: pathEnv });
    assert.equal(other.status, 0);
    assert.equal(fs.existsSync(gitLog), false);

    const variant = path.join(root, 'variant');
    fs.mkdirSync(path.join(variant, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(variant, '.claude/.harness-variant'), 'monolith\n');
    const stamped = runHook(variant, { CLAUDE_CODE_REMOTE: 'true', PATH: pathEnv });
    assert.equal(stamped.status, 0);
    assert.equal(stamped.stderr, '');
    assert.equal(fs.existsSync(gitLog), false);

    const vendored = path.join(root, 'vendored');
    fs.mkdirSync(path.join(vendored, '.claude/hooks'), { recursive: true });
    fs.writeFileSync(path.join(vendored, '.claude/CLAUDE.md'), '# harness\n');
    fs.writeFileSync(path.join(vendored, '.claude/hooks/autonomy-context.sh'), '#!/bin/sh\nexit 0\n');
    const vendoredRun = runHook(vendored, { CLAUDE_CODE_REMOTE: 'true', PATH: pathEnv });
    assert.equal(vendoredRun.status, 0);
    assert.equal(fs.existsSync(gitLog), false);

    const plugin = path.join(root, 'plugin');
    const marker = path.join(plugin, 'plugins/fmflurry-harness/.cursor-plugin');
    fs.mkdirSync(marker, { recursive: true });
    fs.writeFileSync(path.join(marker, 'plugin.json'), '{"name":"fmflurry-harness","version":"0.4.28"}\n');
    const marked = runHook(plugin, { CLAUDE_CODE_REMOTE: 'true', PATH: pathEnv });
    assert.equal(marked.status, 0);
    assert.equal(fs.existsSync(gitLog), false);

    const rootMarker = path.join(root, 'root-plugin');
    fs.mkdirSync(path.join(rootMarker, '.cursor-plugin'), { recursive: true });
    fs.writeFileSync(path.join(rootMarker, '.cursor-plugin/plugin.json'), '{"version":"1.2.3"}\n');
    const rootMarked = runHook(rootMarker, { CLAUDE_CODE_REMOTE: 'true', PATH: pathEnv });
    assert.equal(rootMarked.status, 0);
    assert.equal(fs.existsSync(gitLog), false);

    const unnamed = path.join(root, 'unnamed');
    fs.mkdirSync(path.join(unnamed, '.cursor-plugin'), { recursive: true });
    fs.writeFileSync(path.join(unnamed, '.cursor-plugin/plugin.json'), '{"name":"fmflurry-harness"}\n');
    const unnamedRun = runHook(unnamed, { CLAUDE_CODE_REMOTE: 'true', PATH: pathEnv });
    assert.equal(unnamedRun.status, 0, unnamedRun.stderr);
    assert.match(fs.readFileSync(gitLog, 'utf8'), /--depth 1/);
    assert.equal(fs.readFileSync(installLog, 'utf8').trim(), '--yes monolith');

    const cloneFail = runHook(plain, {
      CLAUDE_CODE_REMOTE: 'true',
      PATH: pathEnv,
      CLOUD_BOOTSTRAP_GIT_FAIL: '1',
    });
    assert.equal(cloneFail.status, 0);
    assert.match(cloneFail.stderr, /cloud-session-bootstrap: warning: shallow clone/);
    assert.equal(cloneFail.stdout, '');

    fs.writeFileSync(installLog, '');
    const installFail = runHook(plain, {
      CLAUDE_CODE_REMOTE: 'true',
      PATH: pathEnv,
      CLOUD_BOOTSTRAP_INSTALL_EXIT: '1',
    });
    assert.equal(installFail.status, 0);
    assert.match(installFail.stderr, /cloud-session-bootstrap: warning: install\.sh --yes monolith failed/);
    assert.equal(fs.readFileSync(installLog, 'utf8').trim(), '--yes monolith');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('settings and the plugin mirror wire the SessionStart bootstrap', () => {
  const settings = JSON.parse(fs.readFileSync(path.join(repo, '.claude/settings.json'), 'utf8'));
  const commands = settings.hooks.SessionStart.flatMap((entry) => entry.hooks.map((item) => item.command));
  assert.equal(commands[0], 'bash ~/.claude/hooks/cloud-session-bootstrap.sh');
  const config = JSON.parse(fs.readFileSync(path.join(repo, 'scripts/cursor-plugin/config.json'), 'utf8'));
  assert.ok(config.hooks.include.includes('cloud-session-bootstrap.sh'));
  const built = buildHooks(settings, config.hooks.include);
  assert.ok(built.scripts.includes('cloud-session-bootstrap.sh'));
  assert.match(built.json.hooks.sessionStart[0].command, /cloud-session-bootstrap\.sh sessionStart$/);
  const installer = fs.readFileSync(install, 'utf8');
  assert.match(installer, /cloud-session-bootstrap\.sh/);
  assert.match(installer, /HARNESS_VARIANT=monolith/);
  assert.doesNotMatch(installer, /HARNESS_VARIANT=conductor/);
});

test('install.sh --help and settings-sync default to Monolith and keep conductor explicit', () => {
  const help = spawnSync('bash', [install, '--help'], { encoding: 'utf8' });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /Monolith is the default/);
  assert.match(help.stdout, /conductor selects Conductor/);
  assert.doesNotMatch(help.stdout, /stays Conductor/);

  const syncHelp = spawnSync('bash', [settingsSync, '--help'], { encoding: 'utf8', env: baseEnv() });
  assert.equal(syncHelp.status, 0);
  assert.match(syncHelp.stdout, /Monolith is the default/);
  assert.match(syncHelp.stdout, /conductor selects Conductor/);

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'settings-sync-'));
  const fakeRepo = path.join(root, 'repo');
  const log = path.join(root, 'install.log');
  fs.mkdirSync(fakeRepo);
  fs.writeFileSync(path.join(fakeRepo, 'install.sh'), `#!/usr/bin/env bash
printf 'variant=%s\\n' "\${HARNESS_VARIANT-}" >> ${JSON.stringify(log)}
printf 'args=%s\\n' "$*" >> ${JSON.stringify(log)}
exit 0
`);
  fs.chmodSync(path.join(fakeRepo, 'install.sh'), 0o755);
  try {
    const def = spawnSync('bash', [settingsSync], {
      encoding: 'utf8',
      env: baseEnv({ SETTINGS_OPENCODE_REPO: fakeRepo, HOME: root }),
    });
    assert.equal(def.status, 0, def.stderr);
    assert.match(fs.readFileSync(log, 'utf8'), /variant=monolith\nargs=--yes\n/);

    fs.writeFileSync(log, '');
    const explicit = spawnSync('bash', [settingsSync, 'conductor'], {
      encoding: 'utf8',
      env: baseEnv({ SETTINGS_OPENCODE_REPO: fakeRepo, HOME: root }),
    });
    assert.equal(explicit.status, 0, explicit.stderr);
    assert.match(fs.readFileSync(log, 'utf8'), /args=--yes conductor\n/);
    assert.doesNotMatch(fs.readFileSync(log, 'utf8'), /variant=monolith/);

    fs.writeFileSync(log, '');
    const kept = spawnSync('bash', [settingsSync], {
      encoding: 'utf8',
      env: baseEnv({
        SETTINGS_OPENCODE_REPO: fakeRepo,
        HOME: root,
        HARNESS_VARIANT: 'conductor',
      }),
    });
    assert.equal(kept.status, 0, kept.stderr);
    assert.match(fs.readFileSync(log, 'utf8'), /variant=conductor\nargs=--yes\n/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
