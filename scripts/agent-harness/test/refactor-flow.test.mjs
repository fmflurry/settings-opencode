import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

function read(rel) {
  return fs.readFileSync(path.join(repo, rel), 'utf8');
}

const pinSources = [
  'commands/tdd.md',
  '.claude/commands/tdd.md',
  '.claude/agents/tdd-guide.md',
  'prompts/agents/tdd-guide.txt',
  'skills/tdd/SKILL.md',
  '.claude/skills/tdd/SKILL.md',
  'skills/tdd-workflow/SKILL.md',
  '.claude/skills/tdd-workflow/SKILL.md',
];

test('refactor mode pins current behavior and freezes those tests', () => {
  for (const rel of pinSources) {
    const text = read(rel);
    assert.match(text, /\/tdd refactor/, rel);
    assert.match(text, /characterization/, rel);
    assert.match(text, /pass immediately/, rel);
    assert.match(text, /does not edit/, rel);
  }
});

test('tdd-guide says a refactor already passes', () => {
  assert.match(read('.claude/agents/tdd-guide.md'), /already pass/);
  const agent = read('opencode.jsonc').split('"tdd-guide": {')[1]?.slice(0, 800) ?? '';
  assert.match(agent, /already pass/);
});

test('planner names the pin before blast-radius and verify', () => {
  for (const rel of ['.claude/agents/planner.md', 'prompts/agents/planner.txt']) {
    const section = read(rel).split('## When Planning Refactors')[1]?.split('\n## ')[0] ?? '';
    assert.notEqual(section, '', rel);
    for (const needle of [
      /\/tdd refactor/,
      /characterization/,
      /pass immediately/,
      /does not edit/,
      /blast-radius/,
      /baseline/,
      /treatment/,
      /\/pr/,
      /cop-review/,
      /ship-merge/,
    ]) {
      assert.match(section, needle, `${rel} ${needle}`);
    }
  }
});

test('conductor hands a refactor to the pin before the restructure', () => {
  for (const rel of ['.claude/agents/conductor.md', 'prompts/agents/conductor.txt']) {
    const text = read(rel);
    for (const needle of [/\/tdd refactor/, /characterization/, /blast-radius/, /baseline/, /does not edit/]) {
      assert.match(text, needle, `${rel} ${needle}`);
    }
  }
});

test('verify compares the same pin as baseline and treatment', () => {
  for (const rel of ['commands/verify.md', '.claude/commands/verify.md']) {
    const text = read(rel);
    for (const needle of [/\/tdd refactor/, /characterization/, /baseline/, /treatment/, /does not edit/]) {
      assert.match(text, needle, `${rel} ${needle}`);
    }
  }
});

test('blast-radius runs the characterization pin', () => {
  const text = read('skills/blast-radius/SKILL.md');
  assert.match(text, /\/tdd refactor/);
  assert.match(text, /characterization/);
  assert.match(text, /pass immediately/);
});

test('readme refactor flow names the pin, blast-radius, and baseline', () => {
  const parts = read('README.md').split('<a id="harness-fr"></a>');
  assert.equal(parts.length, 2);
  for (const part of parts) {
    for (const needle of [/\/tdd refactor/, /characterization/, /blast-radius/, /baseline/, /treatment/]) {
      assert.match(part, needle, String(needle));
    }
  }
});
