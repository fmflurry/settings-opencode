#!/usr/bin/env node
// Source check for the two harness variants. Read-only.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseJsonc } from '../cursor-plugin/lib.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const errors = [];
const fail = (message) => errors.push(message);
const read = (rel) => fs.readFileSync(path.join(repo, rel), 'utf8');
const exists = (rel) => fs.existsSync(path.join(repo, rel));

function tokens(text) {
  return Math.ceil(text.length / 4);
}

const claude = read('variants/monolith/CLAUDE.md');
const agents = read('variants/monolith/AGENTS.md');
if (claude !== agents) fail('variants/monolith/CLAUDE.md and AGENTS.md differ');
if (tokens(claude) > 2000) fail(`monolith baseline is ${tokens(claude)} tokens; cap is 2000`);
if (/first-tool gate/i.test(claude)) fail('monolith baseline still has a first-tool gate');
if (/cannot write/i.test(claude)) fail('monolith baseline still forbids the primary agent from writing');
if (!claude.includes('grok-4.7-xhigh') || !claude.includes('grok-4.7-medium')) {
  fail('monolith baseline is missing Cursor model defaults');
}
if (/-fast/.test(claude)) fail('monolith baseline names a -fast model');

const manifest = JSON.parse(read('variants/monolith/manifest.json'));
const kept = new Set(manifest.keptAgents);
for (const name of ['code-reviewer', 'security-reviewer', 'database-reviewer', 'ecosystem-auditor', 'e2e-runner', 'why-investigator', 'build-error-resolver']) {
  if (!kept.has(name)) fail(`manifest dropped kept agent ${name}`);
}
if (manifest.overlayAgents.join(',') !== 'cop,comment-judge') fail('overlay agents must be cop and comment-judge');
for (const text of Object.values(manifest.descriptions)) {
  if (/MUST delegate/i.test(text)) fail(`shouty description: ${text}`);
}
if (manifest.deferredMcp.join(',') !== 'blender,smartbear-swagger') fail('deferred MCP list changed');

const sourceConfig = parseJsonc(read('opencode.jsonc'));
if (sourceConfig.default_agent !== 'conductor') fail('conductor default agent changed');
if (!/First-Tool Gate/.test(read('instructions/subagent-routing.md'))) fail('conductor routing lost the first-tool gate');
if (!/First-Tool Gate/.test(read('.claude/rules/common/orchestration.md'))) fail('conductor rule lost the first-tool gate');
if (!/You CANNOT write or edit/.test(read('.claude/agents/conductor.md'))) fail('conductor agent can write');
if (sourceConfig.mcp?.blender == null || sourceConfig.mcp?.['smartbear-swagger'] == null) {
  fail('conductor mcp dropped blender or smartbear-swagger');
}
const conductorVariant = JSON.parse(read('variants/conductor/manifest.json'));
if (conductorVariant.id !== 'conductor') fail('conductor variant id changed');
if (exists('variants/orchestration')) fail('orchestration variant directory should stay an alias, not a tree');

const hooks = [
  'autonomy-ask-guard.sh', 'autonomy-context.sh', 'autonomy-git-guard.sh', 'codememory-mode.sh',
  'notification.sh', 'orca-notify.sh', 'prefer-code-memory.sh', 'pre-tool-use.sh', 'rtk-rewrite.sh',
  'ship-stop-gate.sh', 'stop.sh', 'subagent-stop.sh', 'tool-budget.sh',
];
for (const hook of hooks) {
  if (!exists(path.join('.claude/hooks', hook))) fail(`missing hook ${hook}`);
}

for (const family of ['threejs', 'openspec']) {
  for (const root of ['skills', '.claude/skills']) {
    if (!exists(`${root}/${family}/SKILL.md`)) fail(`missing umbrella ${root}/${family}`);
  }
  const left = path.join(repo, 'skills', family);
  const right = path.join(repo, '.claude/skills', family);
  const files = (dir) => fs.readdirSync(dir, { recursive: true }).filter((rel) => fs.statSync(path.join(dir, rel)).isFile()).sort();
  const a = files(left);
  const b = files(right);
  if (a.join('\n') !== b.join('\n')) fail(`${family} file lists differ across skill roots`);
  for (const rel of a) {
    const la = fs.readFileSync(path.join(left, rel));
    const lb = fs.readFileSync(path.join(right, rel));
    if (!la.equals(lb)) fail(`${family} content differs: ${rel}`);
  }
}
for (const root of ['skills', '.claude/skills']) {
  for (const name of fs.readdirSync(path.join(repo, root))) {
    if (/^(threejs|openspec)-/.test(name)) fail(`old family skill still present: ${root}/${name}`);
  }
}
if (exists('skills/conductor') || exists('.claude/skills/conductor')) {
  fail('conductor skill must stay a Monolith overlay, not a shared skill');
}
if (!exists('variants/monolith/skills/conductor/SKILL.md')) fail('missing monolith conductor skill');

const folded = [
  'planner', 'coder', 'writer', 'doc-updater', 'architect', 'refactor-cleaner', 'scout', 'gaudi',
  'testing', 'security', 'coding-style', 'code-comments', 'autonomy', 'question-handling',
  'enforcement-ladder', 'tool-budget', 'verification-gate',
];
for (const name of folded) {
  if (!exists(`skills/${name}/SKILL.md`)) fail(`missing shared skill ${name}`);
  if (exists(`.claude/skills/${name}`)) fail(`skill ${name} is duplicated under .claude/skills`);
}
for (const twin of ['tdd', 'git-workflow', 'api-spec-openapi', 'gdpr-compliance', 'postgres-health-check']) {
  if (!exists(`skills/${twin}/SKILL.md`) && !exists(`.claude/skills/${twin}/SKILL.md`)) fail(`missing twin skill ${twin}`);
}

const parityA = read('skills/harness-parity/SKILL.md');
const parityB = read('.claude/skills/harness-parity/SKILL.md');
if (parityA !== parityB) fail('harness-parity copies differ');
if (!parityA.includes('## D. Variants')) fail('harness-parity does not describe variants');
if (!parityA.includes('**Conductor**')) fail('harness-parity does not name the Conductor variant');

const BAD = /\b(?:claude-(?:opus|sonnet|haiku|fable)[a-z0-9.-]*|gpt-[a-z0-9.-]+|gemini-[a-z0-9.-]+)\b|(?:^|[\s`])(opus|sonnet|haiku)(?:[\s`]|$)|-fast\b/i;
function scan(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) scan(full);
    else if (/\.(md|json|txt)$/.test(entry.name)) {
      const text = fs.readFileSync(full, 'utf8');
      if (BAD.test(text)) fail(`${path.relative(repo, full)} names a non-Cursor model default`);
    }
  }
}
scan(path.join(repo, 'variants'));
for (const name of folded) scan(path.join(repo, 'skills', name));

if (errors.length) {
  for (const error of errors) console.error(`parity: ${error}`);
  process.exit(1);
}
console.log('variants parity: ok');
