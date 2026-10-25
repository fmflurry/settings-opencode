import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const script = path.join(repo, 'scripts/variants/prune-foreign.mjs');

function run(args) {
  return spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
}

test('conductor prune removes monolith leftovers and restores marked files', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'prune-foreign-'));
  const opencode = path.join(tmp, 'opencode');
  const claude = path.join(tmp, 'claude');
  fs.mkdirSync(path.join(opencode, 'instructions'), { recursive: true });
  fs.mkdirSync(path.join(opencode, 'prompts/agents'), { recursive: true });
  fs.mkdirSync(path.join(opencode, 'skills/conductor'), { recursive: true });
  fs.mkdirSync(path.join(opencode, 'commands'), { recursive: true });
  fs.writeFileSync(path.join(opencode, '.harness-variant'), 'monolith\n');
  fs.writeFileSync(path.join(opencode, 'opencode.jsonc'), '{ "default_agent": "main" }\n');
  fs.writeFileSync(path.join(opencode, 'instructions/monolith.md'), 'This install is Monolith.\n');
  fs.writeFileSync(path.join(opencode, 'instructions/subagent-routing.md'), 'Monolith has no first-tool gate\n');
  fs.writeFileSync(path.join(opencode, 'instructions/question-handling.md'), 'keep me\n');
  fs.writeFileSync(path.join(opencode, 'AGENTS.md'), 'This install is Monolith.\n');
  fs.writeFileSync(path.join(opencode, 'USER.md'), 'user notes\n');
  fs.writeFileSync(path.join(opencode, 'prompts/agents/main.txt'), 'main\n');
  fs.writeFileSync(path.join(opencode, 'prompts/agents/cop.txt'), 'cop\n');
  fs.writeFileSync(path.join(opencode, 'prompts/agents/planner.txt'), 'planner\n');
  fs.writeFileSync(path.join(opencode, 'mcp.deferred.example.jsonc'), '{}\n');
  fs.writeFileSync(path.join(opencode, 'skills/conductor/SKILL.md'), 'skill\n');
  fs.writeFileSync(path.join(opencode, 'commands/orchestrate.md'), 'Optional Monolith mode.\n');

  fs.mkdirSync(path.join(claude, 'agent-sources'), { recursive: true });
  fs.mkdirSync(path.join(claude, 'rule-sources/common'), { recursive: true });
  fs.mkdirSync(path.join(claude, 'agents'), { recursive: true });
  fs.writeFileSync(path.join(claude, '.harness-variant'), 'monolith\n');
  fs.writeFileSync(path.join(claude, 'agent-sources/conductor.md'), 'The primary agent may write.\n');
  fs.writeFileSync(path.join(claude, 'rule-sources/common/orchestration.md'), 'stub\n');
  fs.writeFileSync(path.join(claude, 'agents/cop.md'), 'cop\n');
  fs.writeFileSync(path.join(claude, 'agents/conductor.md'), 'monolith stub\n');
  fs.writeFileSync(path.join(claude, 'CLAUDE.md'), 'This install is Monolith.\n');
  fs.writeFileSync(path.join(claude, 'AGENTS.md'), '# Custom project agents\n');

  const result = run(['--repo', repo, '--variant', 'conductor', '--opencode', opencode, '--claude', claude]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(fs.readFileSync(path.join(opencode, 'opencode.jsonc'), 'utf8'), /"default_agent": "conductor"/);
  assert.match(fs.readFileSync(path.join(opencode, 'instructions/subagent-routing.md'), 'utf8'), /First-Tool Gate/);
  assert.equal(fs.readFileSync(path.join(opencode, 'instructions/question-handling.md'), 'utf8'), 'keep me\n');
  assert.equal(fs.existsSync(path.join(opencode, 'instructions/monolith.md')), false);
  assert.equal(fs.existsSync(path.join(opencode, 'AGENTS.md')), false);
  assert.equal(fs.readFileSync(path.join(opencode, 'USER.md'), 'utf8'), 'user notes\n');
  assert.equal(fs.existsSync(path.join(opencode, 'prompts/agents/main.txt')), false);
  assert.equal(fs.existsSync(path.join(opencode, 'prompts/agents/cop.txt')), false);
  assert.equal(fs.readFileSync(path.join(opencode, 'prompts/agents/planner.txt'), 'utf8'), 'planner\n');
  assert.equal(fs.existsSync(path.join(opencode, 'mcp.deferred.example.jsonc')), false);
  assert.equal(fs.existsSync(path.join(opencode, 'skills/conductor')), false);
  assert.doesNotMatch(fs.readFileSync(path.join(opencode, 'commands/orchestrate.md'), 'utf8'), /Optional Monolith mode/);

  assert.equal(fs.existsSync(path.join(claude, 'agent-sources')), false);
  assert.equal(fs.existsSync(path.join(claude, 'rule-sources')), false);
  assert.equal(fs.existsSync(path.join(claude, 'agents/cop.md')), false);
  assert.match(fs.readFileSync(path.join(claude, 'agents/conductor.md'), 'utf8'), /You CANNOT write or edit/);
  assert.match(fs.readFileSync(path.join(claude, 'CLAUDE.md'), 'utf8'), /@rules/);
  assert.equal(fs.readFileSync(path.join(claude, 'AGENTS.md'), 'utf8'), '# Custom project agents\n');

  const again = run(['--repo', repo, '--variant', 'conductor', '--opencode', opencode, '--claude', claude]);
  assert.equal(again.status, 0, again.stderr);
  assert.equal(fs.readFileSync(path.join(opencode, 'USER.md'), 'utf8'), 'user notes\n');
  assert.equal(fs.readFileSync(path.join(claude, 'AGENTS.md'), 'utf8'), '# Custom project agents\n');
});

test('conductor prune leaves a conductor tree that has no monolith marker', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'prune-foreign-keep-'));
  const dir = path.join(tmp, 'opencode');
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'opencode.jsonc'), '{ "default_agent": "custom" }\n');
  fs.writeFileSync(path.join(dir, '.harness-variant'), 'conductor\n');
  const result = run(['--repo', repo, '--variant', 'conductor', '--opencode', dir]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.readFileSync(path.join(dir, 'opencode.jsonc'), 'utf8'), '{ "default_agent": "custom" }\n');
});

test('prune refuses the source checkout', () => {
  const before = fs.readFileSync(path.join(repo, 'opencode.jsonc'));
  const result = run(['--repo', repo, '--variant', 'conductor', '--opencode', repo]);
  assert.equal(result.status, 1, result.stderr);
  assert.ok(fs.readFileSync(path.join(repo, 'opencode.jsonc')).equals(before));
});
