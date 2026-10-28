import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { resolveBuildVariant } from './variant.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const build = path.join(repo, 'scripts/build-cursor-plugin.mjs');

test('cursor build variant defaults to monolith and the flag wins', () => {
  assert.equal(resolveBuildVariant([], {}), 'monolith');
  assert.equal(resolveBuildVariant([], { HARNESS_VARIANT: 'orchestration' }), 'conductor');
  assert.equal(resolveBuildVariant(['--variant', 'conductor'], { HARNESS_VARIANT: 'monolith' }), 'conductor');
  assert.throws(() => resolveBuildVariant(['--variant', 'lean'], {}), /unknown variant/);
});

function built(args, env) {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'cursor-variant-'));
  const result = spawnSync(process.execPath, [build, '--out', out, ...args], {
    cwd: repo,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  return out;
}

test('default cursor plugin build is monolith', () => {
  const out = built([], { HARNESS_VARIANT: '' });
  try {
    assert.equal(fs.readFileSync(path.join(out, '.harness-variant'), 'utf8').trim(), 'monolith');
    assert.equal(fs.existsSync(path.join(out, 'agents/coder.md')), false);
    assert.equal(fs.existsSync(path.join(out, 'agents/conductor.md')), false);
    assert.equal(fs.existsSync(path.join(out, 'agents/cop.md')), true);
    assert.equal(fs.existsSync(path.join(out, 'agents/comment-judge.md')), true);
    assert.equal(fs.existsSync(path.join(out, 'rules/conductor.mdc')), false);
    const rules = fs.readdirSync(path.join(out, 'rules')).filter((name) => name.endsWith('.mdc'));
    const joined = rules.map((name) => fs.readFileSync(path.join(out, 'rules', name), 'utf8')).join('\n');
    assert.doesNotMatch(joined, /First-Tool Gate/);
    assert.doesNotMatch(joined, /cannot write or edit files directly/i);
    const baseline = fs.readFileSync(path.join(out, 'rules/monolith.mdc'), 'utf8');
    assert.match(baseline, /may write|allowed to write/i);
    assert.match(baseline, /grok-4\.7-xhigh/);
    assert.match(baseline, /grok-4\.7-medium/);
    assert.match(baseline, /composer-2\.5/);
    assert.match(baseline, /Never `-fast`/);
    assert.doesNotMatch(baseline, /claude-|gpt-|gemini-/);
    assert.equal(fs.existsSync(path.join(out, 'skills/threejs/SKILL.md')), true);
    assert.equal(fs.existsSync(path.join(out, 'skills/openspec/SKILL.md')), true);
    const conductor = fs.readFileSync(path.join(out, 'skills/conductor/SKILL.md'), 'utf8');
    assert.match(conductor, /optional/i);
    assert.match(conductor, /The primary agent still writes\./);
    const orchestrate = fs.readFileSync(path.join(out, 'commands/orchestrate.md'), 'utf8');
    assert.match(orchestrate, /optional/i);
    assert.match(orchestrate, /monolith/i);
    const plugin = JSON.parse(fs.readFileSync(path.join(out, '.cursor-plugin/plugin.json'), 'utf8'));
    assert.equal(plugin.version, '0.4.25');
    assert.match(plugin.description, /primary agent writes/i);
    const setup = fs.readFileSync(path.join(out, 'skills/setup-harness/SKILL.md'), 'utf8');
    assert.match(setup, /build-error-resolver/);
    assert.doesNotMatch(setup, /\| coding \|[^\n]*\bcoder\b/);
    assert.doesNotMatch(setup, /\| smart \|[^\n]*\bplanner\b/);
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
});

test('conductor cursor plugin build keeps the first-tool gate', () => {
  const out = built(['--variant', 'conductor'], { HARNESS_VARIANT: 'monolith' });
  try {
    assert.equal(fs.readFileSync(path.join(out, '.harness-variant'), 'utf8').trim(), 'conductor');
    assert.equal(fs.existsSync(path.join(out, 'agents/coder.md')), true);
    assert.equal(fs.existsSync(path.join(out, 'agents/cop.md')), false);
    assert.equal(fs.existsSync(path.join(out, 'rules/monolith.mdc')), false);
    assert.match(fs.readFileSync(path.join(out, 'rules/orchestration.mdc'), 'utf8'), /First-Tool Gate/);
    assert.match(fs.readFileSync(path.join(out, 'rules/conductor.mdc'), 'utf8'), /grok-4\.7-medium/);
    const plugin = JSON.parse(fs.readFileSync(path.join(out, '.cursor-plugin/plugin.json'), 'utf8'));
    assert.match(plugin.description, /Conductor routing/);
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
});
