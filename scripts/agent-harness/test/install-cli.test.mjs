import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const lib = path.join(repo, 'scripts/lib/install-agent-harness.sh');

function bash(home, bin, body) {
  return spawnSync('bash', ['-c', body], {
    encoding: 'utf8',
    env: {
      ...process.env,
      HOME: home,
      REPO_DIR: repo,
      LIB: lib,
      AGENT_HARNESS_BIN_DIR: bin,
      AGENT_HARNESS_HOME: path.join(home, 'share', 'fmflurry-harness'),
    },
  });
}

const installBody = `
set -euo pipefail
source "$LIB"
ok() { printf 'OK %s\\n' "$*"; }
info() { printf 'INFO %s\\n' "$*"; }
root="$(agent_harness_cursor_root)"
install_agent_harness_tree "$root/scripts/agent-harness"
install_agent_harness_wrapper "$root"
printf 'ROOT %s\\n' "$root"
`;

test('cursor install prints the cli paths and is idempotent', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ah-cli-'));
  const bin = path.join(home, 'bin');
  const first = bash(home, bin, installBody);
  assert.equal(first.status, 0, first.stderr);
  const root = path.join(home, 'share', 'fmflurry-harness');
  const dest = path.join(root, 'scripts', 'agent-harness');
  const link = path.join(bin, 'agent-harness');
  const target = path.join(dest, 'agent-harness.sh');
  assert.match(first.stdout, new RegExp(`installed agent-harness scripts into ${dest}`));
  assert.match(first.stdout, new RegExp(`installed ${link} -> ${target}`));
  assert.equal(fs.existsSync(path.join(dest, '.installed')), true);
  assert.equal(fs.statSync(link).mode & 0o111, 0o111);
  const wrapper = fs.readFileSync(link, 'utf8');
  assert.match(wrapper, /^#!\/bin\/bash -p\n/);
  assert.match(wrapper, new RegExp(`builtin exec /bin/bash -p "${target}"`));

  const second = bash(home, bin, installBody);
  assert.equal(second.status, 0, second.stderr);
  assert.match(second.stdout, new RegExp(`installed ${link} -> ${target}`));
  assert.equal(fs.readdirSync(bin).filter((name) => name === 'agent-harness').length, 1);
  assert.equal(fs.readFileSync(link, 'utf8'), wrapper);

  const ran = spawnSync(link, [], { encoding: 'utf8' });
  assert.equal(ran.status, 2);
  assert.match(ran.stderr, /usage: agent-harness\.sh/);

  const removed = bash(home, bin, `
    set -euo pipefail
    source "$LIB"
    ok() { printf 'OK %s\\n' "$*"; }
    info() { printf 'INFO %s\\n' "$*"; }
    uninstall_agent_harness_cli "$(agent_harness_cursor_root)"
  `);
  assert.equal(removed.status, 0, removed.stderr);
  assert.match(removed.stdout, new RegExp(`removed ${link}`));
  assert.match(removed.stdout, new RegExp(`removed ${dest}`));
  assert.equal(fs.existsSync(link), false);
  assert.equal(fs.existsSync(dest), false);

  const again = bash(home, bin, `
    set -euo pipefail
    source "$LIB"
    ok() { printf 'OK %s\\n' "$*"; }
    info() { printf 'INFO %s\\n' "$*"; }
    uninstall_agent_harness_cli "$(agent_harness_cursor_root)"
  `);
  assert.equal(again.status, 0, again.stderr);
  assert.match(again.stdout, /nothing to remove/);
});

test('installed tree copies mjs siblings and kpi feature --help runs', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ah-mjs-'));
  const bin = path.join(home, 'bin');
  const installed = bash(home, bin, installBody);
  assert.equal(installed.status, 0, installed.stderr);
  const dest = path.join(home, 'share', 'fmflurry-harness', 'scripts', 'agent-harness');
  for (const name of ['kpi-feature.mjs', 'kpi-report.mjs', 'eval-run.mjs']) {
    assert.equal(fs.existsSync(path.join(dest, name)), true, name);
  }
  const link = path.join(bin, 'agent-harness');
  const installPath = ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin'];
  const nodeVisible = installPath.some((dir) => fs.existsSync(path.join(dir, 'node')));
  let help;
  if (nodeVisible) {
    help = spawnSync(link, ['kpi', 'feature', '--help'], { encoding: 'utf8' });
  } else {
    const nodeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ah-node-'));
    fs.symlinkSync(process.execPath, path.join(nodeDir, 'node'));
    // The installed dispatcher replaces PATH. Bind the test node over /usr/local/bin in a private mount.
    help = spawnSync('unshare', [
      '--user', '--mount', '--map-root-user',
      'bash', '-c',
      'mount --bind "$1" /usr/local/bin && exec "$2" kpi feature --help',
      '_', nodeDir, link,
    ], { encoding: 'utf8' });
  }
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /usage: agent-harness kpi feature/);
  assert.equal(`${help.stdout}${help.stderr}`.includes('Cannot find module'), false);
});

test('cursor uninstall leaves a wrapper that points somewhere else', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ah-foreign-'));
  const bin = path.join(home, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  const link = path.join(bin, 'agent-harness');
  fs.writeFileSync(link, '#!/bin/bash\necho foreign\n');
  const removed = bash(home, bin, `
    set -euo pipefail
    source "$LIB"
    ok() { printf 'OK %s\\n' "$*"; }
    info() { printf 'INFO %s\\n' "$*"; }
    uninstall_agent_harness_cli "$(agent_harness_cursor_root)"
  `);
  assert.equal(removed.status, 0, removed.stderr);
  assert.match(removed.stdout, /left .* in place/);
  assert.equal(fs.readFileSync(link, 'utf8'), '#!/bin/bash\necho foreign\n');
});
