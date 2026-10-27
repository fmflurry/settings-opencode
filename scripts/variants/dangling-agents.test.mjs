import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { parseJsonc } from '../cursor-plugin/lib.mjs';
import {
  formatHits,
  remapAgentName,
  removedAgentNames,
  rewriteCommandText,
  scanMonolithTree,
  scanText,
} from './dangling-agents.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const manifest = JSON.parse(fs.readFileSync(path.join(repo, 'variants/monolith/manifest.json'), 'utf8'));

function hits(text) {
  return scanText(text, manifest).map((hit) => hit.name);
}

test('remap sends removed command agents to main and postgres-dba to database-reviewer', () => {
  assert.equal(remapAgentName('planner', manifest), 'main');
  assert.equal(remapAgentName('conductor', manifest), 'main');
  assert.equal(remapAgentName('git-specialist', manifest), 'main');
  assert.equal(remapAgentName('postgres-dba', manifest), 'database-reviewer');
  assert.equal(remapAgentName('code-reviewer', manifest), 'code-reviewer');
  assert.equal(remapAgentName('comment-judge', manifest), 'comment-judge');
  assert.equal(remapAgentName('cop', manifest), 'cop');
  assert.ok(removedAgentNames(manifest).includes('planner'));
  assert.equal(removedAgentNames(manifest).includes('comment-judge'), false);
  assert.equal(removedAgentNames(manifest).includes('code-reviewer'), false);
});

test('command rewrite remaps agent frontmatter and strips removed subagent_type targets', () => {
  const plan = rewriteCommandText('---\ndescription: Plan\nagent: planner\nsubtask: true\n---\n\n# Plan\n', manifest);
  assert.match(plan, /^agent: main$/m);
  assert.deepEqual(hits(plan), []);

  const db = rewriteCommandText('---\ndescription: Health\nagent: postgres-dba\n---\n\nDelegate to the `postgres-dba` agent to run the battery.\n', manifest);
  assert.match(db, /^agent: database-reviewer$/m);
  assert.match(db, /database-reviewer/);
  assert.equal(db.includes('postgres-dba'), false);
  assert.deepEqual(hits(db), []);

  const cc = rewriteCommandText(
    '> CC: delegate this to the `planner` subagent via the Agent tool (subagent_type: `planner`). The subagent inspects the repo and runs the steps below.\n',
    manifest,
  );
  assert.equal(cc.includes('subagent_type'), false);
  assert.match(cc, /planner` is not installed/);
  assert.match(cc, /planner` skill/);
  assert.deepEqual(hits(cc), []);

  const why = rewriteCommandText(
    '> CC: conductor orchestrates (spawns why-investigator; why-synthesizer merges).\n',
    manifest,
  );
  assert.match(why, /Spawn `why-investigator`/);
  assert.match(why, /why-synthesizer` is installed/);
  assert.deepEqual(hits(why), []);

  const hand = rewriteCommandText('4. Hand the restructure to `coder`. Production code changes.\n', manifest);
  assert.match(hand, /Production code changes/);
  assert.match(hand, /coder` is not installed/);
  assert.deepEqual(hits(hand), []);

  const spec = rewriteCommandText(
    'Routing to the `api-spec-architect` subagent is handled by the `agent:` field on this command in `opencode.jsonc` — no manual delegation needed.\n',
    manifest,
  );
  assert.match(spec, /api-spec-openapi` skill\./);
  assert.equal(spec.includes('is handled'), false);
  assert.deepEqual(hits(spec), []);

  const health = rewriteCommandText(
    'Repo changes are recommended as handoffs to `coder` via the conductor.\n',
    manifest,
  );
  assert.match(health, /If `coder` is installed/);
  assert.equal(health.includes('via the conductor'), false);
  assert.deepEqual(hits(health), []);

  const cop = rewriteCommandText(
    '- This applies to every `/cop-review` run (.NET via `dotnet-cop`, Angular via `angular-cop`, or both).\n',
    manifest,
  );
  assert.match(cop, /If `dotnet-cop` or `angular-cop` is installed/);
  assert.equal(cop.includes('via `dotnet-cop`'), false);
  assert.deepEqual(hits(cop), []);

  const kept = rewriteCommandText('---\nagent: code-reviewer\n---\n\n> CC: delegate this to the `e2e-runner` subagent via the Agent tool (subagent_type: `e2e-runner`). The subagent inspects the repo and runs the steps below.\n', manifest);
  assert.match(kept, /^agent: code-reviewer$/m);
  assert.match(kept, /subagent_type: `e2e-runner`/);
  assert.deepEqual(hits(kept), []);
});

test('scanner allows folded-agent lists and the conductor skill, and flags a real dispatch', () => {
  const folded = 'Folded agents are not installed: conductor, scout, planner, coder, writer, tdd-guide, git-specialist.';
  assert.deepEqual(hits(folded), []);
  const skill = 'Load the `conductor` skill and do the coordination in this session.\nDo not spawn `planner` or `conductor`. Those agents are not installed.';
  assert.deepEqual(hits(skill), []);
  const list = '- plans and design: `planner`, `architect`, `socratic-design`';
  assert.deepEqual(hits(list), []);
  const conditional = 'If the `planner` agent is installed, dispatch to that agent. Otherwise the main agent loads the `planner` skill.';
  assert.deepEqual(hits(conditional), []);
  assert.deepEqual(hits('agent: planner'), ['planner']);
  assert.deepEqual(hits('subagent_type: `tdd-guide`'), ['tdd-guide']);
  assert.ok(hits('Delegate the git operations to `git-specialist`.').includes('git-specialist'));
  assert.deepEqual(hits('"agent": "postgres-dba"'), ['postgres-dba']);
});

function copyTree(src, dest) {
  fs.cpSync(src, dest, {
    recursive: true,
    filter: (item) => !item.includes(`${path.sep}node_modules${path.sep}`) && !item.includes(`${path.sep}.git${path.sep}`),
  });
}

test('monolith outputs for every target have no removed-agent dispatch', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'monolith-dangling-'));
  const opencode = path.join(tmp, 'opencode');
  const claude = path.join(tmp, 'claude');
  const cursor = path.join(tmp, 'cursor');
  const project = path.join(tmp, 'project');
  fs.mkdirSync(opencode);
  fs.mkdirSync(project);
  copyTree(path.join(repo, 'prompts'), path.join(opencode, 'prompts'));
  copyTree(path.join(repo, 'instructions'), path.join(opencode, 'instructions'));
  copyTree(path.join(repo, 'commands'), path.join(opencode, 'commands'));
  fs.copyFileSync(path.join(repo, 'opencode.jsonc'), path.join(opencode, 'opencode.jsonc'));
  copyTree(path.join(repo, '.claude'), claude);

  const sync = spawnSync('bash', [
    path.join(repo, 'scripts/sync-skills.sh'),
    path.join(claude, 'skills'),
    path.join(opencode, 'skills'),
  ], { encoding: 'utf8' });
  assert.equal(sync.status, 0, `${sync.stdout}\n${sync.stderr}`);

  const apply = spawnSync(process.execPath, [
    path.join(repo, 'scripts/variants/apply-monolith.mjs'),
    '--repo', repo,
    '--opencode', opencode,
    '--claude', claude,
  ], { encoding: 'utf8' });
  assert.equal(apply.status, 0, `${apply.stdout}\n${apply.stderr}`);

  const build = spawnSync(process.execPath, [
    path.join(repo, 'scripts/build-cursor-plugin.mjs'),
    '--variant', 'monolith',
    '--out', cursor,
  ], { encoding: 'utf8', cwd: repo });
  assert.equal(build.status, 0, `${build.stdout}\n${build.stderr}`);

  const vendor = spawnSync(process.execPath, [
    path.join(repo, 'scripts/variants/vendor-project.mjs'),
    '--repo', repo,
    '--project', project,
    '--variant', 'monolith',
    '--plugin', cursor,
  ], { encoding: 'utf8' });
  assert.equal(vendor.status, 0, `${vendor.stdout}\n${vendor.stderr}`);

  const conductor = spawnSync(process.execPath, [
    path.join(repo, 'scripts/build-cursor-plugin.mjs'),
    '--variant', 'conductor',
    '--out', path.join(tmp, 'conductor'),
  ], { encoding: 'utf8', cwd: repo });
  assert.equal(conductor.status, 0, `${conductor.stdout}\n${conductor.stderr}`);

  const cfg = parseJsonc(fs.readFileSync(path.join(opencode, 'opencode.jsonc'), 'utf8'));
  assert.equal(cfg.command.plan.agent, 'main');
  assert.equal(cfg.command.git.agent, 'main');
  assert.equal(cfg.command['db-health'].agent, 'database-reviewer');
  assert.equal(cfg.command['db-backup-check'].agent, 'database-reviewer');
  assert.equal(cfg.command['cop-review'].agent, 'code-reviewer');
  assert.match(fs.readFileSync(path.join(opencode, 'commands/plan.md'), 'utf8'), /^agent: main$/m);
  assert.doesNotMatch(fs.readFileSync(path.join(claude, 'commands/plan.md'), 'utf8'), /subagent_type:\s*`?planner/);
  assert.match(fs.readFileSync(path.join(cursor, 'commands/db-health.md'), 'utf8'), /^agent: database-reviewer$/m);
  assert.match(fs.readFileSync(path.join(repo, 'commands/plan.md'), 'utf8'), /^agent: planner$/m);
  assert.match(fs.readFileSync(path.join(repo, '.claude/commands/plan.md'), 'utf8'), /subagent_type:\s*`planner`/);
  assert.match(fs.readFileSync(path.join(tmp, 'conductor/commands/plan.md'), 'utf8'), /planner/);

  const trees = [
    ['cursor', cursor],
    ['claude', claude],
    ['opencode', opencode],
    ['project', project],
  ];
  const problems = [];
  for (const [label, root] of trees) {
    const found = scanMonolithTree(root, manifest);
    if (found.length) problems.push(`${label}\n${formatHits(found)}`);
  }
  assert.equal(problems.join('\n\n'), '');
  fs.rmSync(tmp, { recursive: true, force: true });
});
