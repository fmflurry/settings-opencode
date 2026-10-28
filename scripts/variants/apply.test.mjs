import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { parseJsonc } from '../cursor-plugin/lib.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const applyScript = path.join(repo, 'scripts/variants/apply-monolith.mjs');

function copyTree(src, dest) {
  fs.cpSync(src, dest, { recursive: true, filter: (item) => !item.includes(`${path.sep}node_modules${path.sep}`) });
}

test('monolith overlay keeps conductor sources and installs the lean roster', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'monolith-apply-'));
  const opencode = path.join(tmp, 'opencode');
  const claude = path.join(tmp, 'claude');
  fs.mkdirSync(opencode);
  copyTree(path.join(repo, 'prompts'), path.join(opencode, 'prompts'));
  copyTree(path.join(repo, 'instructions'), path.join(opencode, 'instructions'));
  copyTree(path.join(repo, 'commands'), path.join(opencode, 'commands'));
  fs.copyFileSync(path.join(repo, 'opencode.jsonc'), path.join(opencode, 'opencode.jsonc'));
  copyTree(path.join(repo, '.claude'), claude);
  const conductorOpencode = path.join(tmp, 'conductor-opencode');
  fs.cpSync(opencode, conductorOpencode, { recursive: true });

  const before = fs.readFileSync(path.join(repo, 'opencode.jsonc'), 'utf8');
  const result = spawnSync(process.execPath, [applyScript, '--repo', repo, '--opencode', opencode, '--claude', claude], {
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.equal(fs.readFileSync(path.join(repo, 'opencode.jsonc'), 'utf8'), before);

  const cfg = parseJsonc(fs.readFileSync(path.join(opencode, 'opencode.jsonc'), 'utf8'));
  assert.equal(cfg.instructions[0], path.join(opencode, 'instructions', 'monolith.md'));
  assert.equal(cfg.default_agent, 'main');
  assert.equal(cfg.agent.conductor, undefined);
  assert.equal(cfg.agent.planner, undefined);
  assert.equal(cfg.agent['why-synthesizer'], undefined);
  assert.equal(cfg.agent['angular-cop'], undefined);
  assert.equal(cfg.agent['dotnet-cop'], undefined);
  assert.equal(cfg.agent['haruspex-commentorum'], undefined);
  assert.ok(cfg.agent['code-reviewer']);
  assert.ok(cfg.agent.cop);
  assert.ok(cfg.agent['comment-judge']);
  assert.equal(cfg.agent.main.tools.write, true);
  assert.equal(cfg.agent.main.permission.task['code-reviewer'], 'allow');
  assert.equal(cfg.agent.main.permission.task.conductor, undefined);
  assert.equal(cfg.mcp.blender, undefined);
  assert.equal(cfg.mcp['smartbear-swagger'], undefined);
  assert.ok(cfg.mcp['code-memory']);
  assert.match(fs.readFileSync(path.join(opencode, 'mcp.deferred.example.jsonc'), 'utf8'), /blender/);
  assert.equal(cfg.command.git.agent, 'main');
  assert.equal(cfg.command.plan.agent, 'main');
  assert.equal(cfg.command['cop-review'].agent, 'code-reviewer');
  assert.doesNotMatch(cfg.agent['code-reviewer'].description, /MUST delegate/);
  assert.match(fs.readFileSync(path.join(opencode, 'prompts/agents/cop.txt'), 'utf8'), /angular-cop/);
  assert.match(fs.readFileSync(path.join(opencode, 'prompts/agents/comment-judge.txt'), 'utf8'), /persona/);
  assert.equal(
    fs.readFileSync(path.join(opencode, 'AGENTS.md'), 'utf8'),
    fs.readFileSync(path.join(claude, 'CLAUDE.md'), 'utf8'),
  );
  assert.equal(fs.readFileSync(path.join(claude, 'AGENTS.md'), 'utf8'), fs.readFileSync(path.join(claude, 'CLAUDE.md'), 'utf8'));
  assert.doesNotMatch(fs.readFileSync(path.join(claude, 'CLAUDE.md'), 'utf8'), /First-Tool Gate|cannot write/i);
  assert.equal(fs.existsSync(path.join(claude, 'agents/planner.md')), false);
  assert.equal(fs.existsSync(path.join(claude, 'agents/conductor.md')), false);
  assert.equal(fs.existsSync(path.join(claude, 'agents/code-reviewer.md')), true);
  assert.equal(fs.existsSync(path.join(claude, 'agents/cop.md')), true);
  assert.equal(fs.existsSync(path.join(claude, 'agent-sources/planner.md')), true);
  assert.doesNotMatch(fs.readFileSync(path.join(claude, 'agents/code-reviewer.md'), 'utf8'), /^model:/m);
  assert.equal(fs.existsSync(path.join(claude, 'hooks/ship-stop-gate.sh')), true);
  assert.equal(fs.existsSync(path.join(claude, 'hooks/tool-budget.sh')), true);
  assert.equal(fs.existsSync(path.join(claude, 'hooks/autonomy-git-guard.sh')), true);
  assert.doesNotMatch(fs.readFileSync(path.join(claude, 'rule-sources/common/orchestration.md'), 'utf8'), /First-Tool Gate/);
  assert.match(fs.readFileSync(path.join(claude, 'rule-sources/common/testing.md'), 'utf8'), /80%/);
  assert.equal(fs.readFileSync(path.join(claude, '.harness-variant'), 'utf8').trim(), 'monolith');
  assert.equal(fs.existsSync(path.join(claude, 'skills/conductor/SKILL.md')), true);
  assert.equal(fs.existsSync(path.join(opencode, 'skills/conductor/SKILL.md')), true);
  assert.match(fs.readFileSync(path.join(claude, 'agents/security-reviewer.md'), 'utf8'), /references\/ATTACK-CLASSES\.md/);
  assert.match(fs.readFileSync(path.join(opencode, 'prompts/agents/security-reviewer.txt'), 'utf8'), /references\/ATTACK-CLASSES\.md/);
  assert.equal(fs.existsSync(path.join(claude, 'skills/security-review/references/ATTACK-CLASSES.md')), true);
  assert.equal(fs.existsSync(path.join(claude, 'skills/security-review/references/LICENSE-cloudflare-security-audit')), true);

  const projectOpencode = path.join(tmp, '.opencode');
  fs.cpSync(conductorOpencode, projectOpencode, { recursive: true });
  const local = spawnSync(process.execPath, [applyScript, '--repo', repo, '--opencode', projectOpencode], {
    encoding: 'utf8',
  });
  assert.equal(local.status, 0, `${local.stdout}\n${local.stderr}`);
  const localCfg = parseJsonc(fs.readFileSync(path.join(projectOpencode, 'opencode.jsonc'), 'utf8'));
  assert.deepEqual(localCfg.instructions, ['.opencode/instructions/monolith.md']);

  const home = path.join(tmp, 'home');
  const globalDir = path.join(home, '.config', 'opencode');
  fs.cpSync(conductorOpencode, globalDir, { recursive: true });
  const globalApply = spawnSync(process.execPath, [applyScript, '--repo', repo, '--opencode', globalDir], {
    encoding: 'utf8',
    env: { ...process.env, HOME: home },
  });
  assert.equal(globalApply.status, 0, `${globalApply.stdout}\n${globalApply.stderr}`);
  const globalCfg = parseJsonc(fs.readFileSync(path.join(globalDir, 'opencode.jsonc'), 'utf8'));
  assert.deepEqual(globalCfg.instructions, ['~/.config/opencode/instructions/monolith.md']);
  fs.rmSync(tmp, { recursive: true, force: true });
});
