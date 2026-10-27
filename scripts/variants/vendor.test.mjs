import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const vendor = path.join(repo, 'scripts/variants/vendor-project.mjs');

function writePlugin(dir, files) {
  for (const [rel, text] of Object.entries(files)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, text);
  }
}

function run(args, env = {}) {
  return spawnSync(process.execPath, [vendor, ...args], {
    encoding: 'utf8',
    env: { ...process.env, HARNESS_VARIANT: '', ...env },
  });
}

test('vendor refuses the settings repo', () => {
  const result = spawnSync(process.execPath, [vendor, '--repo', repo, '--project', repo, '--variant', 'monolith'], {
    cwd: os.tmpdir(),
    encoding: 'utf8',
    env: { ...process.env, HARNESS_VARIANT: '' },
  });
  assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stderr, /settings repo/);
});

test('vendor defaults to monolith, keeps a custom baseline, and switches back', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vendor-'));
  const monolithPlugin = path.join(root, 'monolith-plugin');
  const conductorPlugin = path.join(root, 'conductor-plugin');
  const project = path.join(root, 'project');
  fs.mkdirSync(project);
  writePlugin(monolithPlugin, {
    'rules/monolith.mdc': 'primary agent may write\n',
    'rules/orchestration.mdc': 'no gate\n',
    'agents/cop.md': 'cop\n',
  });
  writePlugin(conductorPlugin, {
    'rules/conductor.mdc': 'First-Tool Gate\n',
    'agents/coder.md': 'coder\n',
  });
  try {
    const first = run(['--repo', repo, '--project', project, '--plugin', monolithPlugin]);
    assert.equal(first.status, 0, `${first.stdout}\n${first.stderr}`);
    assert.match(fs.readFileSync(path.join(project, 'AGENTS.md'), 'utf8'), /This install is Monolith\./);
    assert.equal(fs.readFileSync(path.join(project, '.cursor/.harness-variant'), 'utf8').trim(), 'monolith');
    assert.equal(fs.readFileSync(path.join(project, '.agents/.harness-variant'), 'utf8').trim(), 'monolith');
    assert.equal(fs.existsSync(path.join(project, '.cursor/rules/monolith.mdc')), true);
    assert.equal(fs.existsSync(path.join(project, '.agents/cop.md')), true);
    assert.match(
      fs.readFileSync(path.join(project, '.agents/skills/conductor/SKILL.md'), 'utf8'),
      /The primary agent still writes\./,
    );

    const flagged = run(
      ['--repo', repo, '--project', project, '--plugin', monolithPlugin, '--variant', 'monolith'],
      { HARNESS_VARIANT: 'conductor' },
    );
    assert.equal(flagged.status, 0, flagged.stderr);
    assert.equal(fs.readFileSync(path.join(project, '.cursor/.harness-variant'), 'utf8').trim(), 'monolith');

    fs.writeFileSync(path.join(project, 'AGENTS.md'), 'Custom project instructions.\n');
    const kept = run(['--repo', repo, '--project', project, '--plugin', monolithPlugin, '--variant', 'monolith']);
    assert.equal(kept.status, 0, kept.stderr);
    assert.equal(fs.readFileSync(path.join(project, 'AGENTS.md'), 'utf8'), 'Custom project instructions.\n');

    const back = run(['--repo', repo, '--project', project, '--plugin', conductorPlugin, '--variant', 'conductor']);
    assert.equal(back.status, 0, `${back.stdout}\n${back.stderr}`);
    assert.equal(fs.readFileSync(path.join(project, 'AGENTS.md'), 'utf8'), 'Custom project instructions.\n');
    assert.equal(fs.existsSync(path.join(project, '.cursor/rules/monolith.mdc')), false);
    assert.equal(fs.existsSync(path.join(project, '.cursor/rules/conductor.mdc')), true);
    assert.equal(fs.existsSync(path.join(project, '.agents/cop.md')), false);
    assert.equal(fs.existsSync(path.join(project, '.agents/coder.md')), true);
    assert.equal(fs.existsSync(path.join(project, '.agents/skills/conductor/SKILL.md')), false);
    assert.equal(fs.readFileSync(path.join(project, '.agents/.harness-variant'), 'utf8').trim(), 'conductor');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
