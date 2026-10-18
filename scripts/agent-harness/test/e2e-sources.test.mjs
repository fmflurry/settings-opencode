import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

const sources = [
  'commands/e2e.md',
  '.claude/commands/e2e.md',
  '.claude/agents/e2e-runner.md',
  'prompts/agents/e2e-runner.txt',
  'skills/e2e/SKILL.md',
];

const forbidden = ['4200', '5100', 'gc.platform', 'docker-compose', 'GcPlatform', 'frontend/src/app/modules'];

test('e2e command and agent stay free of one consumer stack', () => {
  for (const rel of sources) {
    const text = fs.readFileSync(path.join(repo, rel), 'utf8');
    for (const needle of forbidden) {
      assert.equal(text.includes(needle), false, `${rel} contains ${needle}`);
    }
    assert.match(text, /e2e\.json/);
    assert.match(text, /resolve\.mjs/);
    assert.match(text, /enabled/);
  }
});

test('playbook skills load only when the override names them', () => {
  for (const rel of ['.claude/agents/e2e-runner.md', 'prompts/agents/e2e-runner.txt', 'skills/e2e/SKILL.md']) {
    const text = fs.readFileSync(path.join(repo, rel), 'utf8');
    assert.match(text, /skills/);
    assert.match(text, /only when|named by the override|override names/);
  }
});
