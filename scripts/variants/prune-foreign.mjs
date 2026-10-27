#!/usr/bin/env node
// Drop Monolith-only install files when the target variant is Conductor.
// An additive copy does not delete paths the other variant added, and it can
// keep a newer destination file whose size did not change. Conductor sources
// are copied back only when the tree still looks like Monolith.
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);

function flag(name) {
  const i = args.indexOf(name);
  if (i === -1 || !args[i + 1] || args[i + 1].startsWith('--')) {
    console.error(`prune-foreign: ${name} needs a path`);
    process.exit(2);
  }
  return path.resolve(args[i + 1]);
}

const variantFlag = args.indexOf('--variant');
const variant = variantFlag === -1 ? '' : args[variantFlag + 1];
if (variant !== 'conductor') {
  console.error('prune-foreign: --variant conductor is required');
  process.exit(2);
}

const repo = flag('--repo');
const opencodeDir = args.includes('--opencode') ? flag('--opencode') : null;
const claudeDir = args.includes('--claude') ? flag('--claude') : null;

function canonicalPath(value) {
  const resolved = path.resolve(value);
  try {
    return fs.realpathSync(resolved);
  } catch {
    return resolved;
  }
}

function samePath(a, b) {
  return canonicalPath(a) === canonicalPath(b);
}

if (opencodeDir && samePath(opencodeDir, repo)) {
  console.error('prune-foreign: refusing to rewrite the source checkout');
  process.exit(1);
}
if (claudeDir && samePath(claudeDir, path.join(repo, '.claude'))) {
  console.error('prune-foreign: refusing to rewrite the source .claude');
  process.exit(1);
}

const MARKS = [
  'This install is Monolith.',
  'Those agents are not installed in Monolith.',
  'Monolith has no first-tool gate',
  'This file does not restate the counters',
  'This file does not restate the command matrix',
  'Optional Monolith mode.',
];

const OPENCODE_RESTORE = [
  'opencode.jsonc',
  'instructions/subagent-routing.md',
  'instructions/tool-budget.md',
  'instructions/verification-gate.md',
  'commands/orchestrate.md',
];

function readText(file) {
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
}

function marked(file) {
  const text = readText(file);
  return MARKS.some((mark) => text.includes(mark));
}

function markerOf(dir) {
  return readText(path.join(dir, '.harness-variant')).trim().toLowerCase();
}

function looksLikeMonolith(dir) {
  if (markerOf(dir) === 'monolith') return true;
  return [
    'instructions/monolith.md',
    'skills/conductor/SKILL.md',
    'agent-sources',
    'rule-sources',
    'mcp.deferred.example.jsonc',
    'prompts/agents/main.txt',
    'agents/cop.md',
  ].some((rel) => fs.existsSync(path.join(dir, rel)));
}

function restoreDifferent(target, source) {
  if (!fs.existsSync(source)) return;
  if (fs.existsSync(target) && fs.readFileSync(target).equals(fs.readFileSync(source))) return;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
}

function restoreTree(sourceRoot, targetRoot) {
  if (!fs.existsSync(sourceRoot)) return;
  for (const entry of fs.readdirSync(sourceRoot, { withFileTypes: true })) {
    const source = path.join(sourceRoot, entry.name);
    const target = path.join(targetRoot, entry.name);
    if (entry.isDirectory()) restoreTree(source, target);
    else if (entry.isFile()) restoreDifferent(target, source);
  }
}

function restoreKnown(dir, pairs, force) {
  for (const [rel, sourceRel] of pairs) {
    const target = path.join(dir, rel);
    if (!force && !marked(target)) continue;
    restoreDifferent(target, path.join(repo, sourceRel));
  }
}

function removePath(file) {
  fs.rmSync(file, { recursive: true, force: true });
}

function removeLeftovers(dir) {
  for (const rel of ['agent-sources', 'rule-sources', 'skills/conductor']) {
    removePath(path.join(dir, rel));
  }
  for (const rel of [
    'instructions/monolith.md',
    'mcp.deferred.example.jsonc',
    'prompts/agents/main.txt',
    'prompts/agents/cop.txt',
    'agents/cop.md',
  ]) {
    removePath(path.join(dir, rel));
  }
  const agentsMd = path.join(dir, 'AGENTS.md');
  if (marked(agentsMd)) removePath(agentsMd);
}

function prune(dir, kind) {
  const force = looksLikeMonolith(dir);
  if (kind === 'claude') {
    restoreKnown(dir, [
      ['CLAUDE.md', '.claude/CLAUDE.md'],
      ['commands/orchestrate.md', '.claude/commands/orchestrate.md'],
    ], force);
    if (force) {
      restoreTree(path.join(repo, '.claude/agents'), path.join(dir, 'agents'));
      restoreTree(path.join(repo, '.claude/rules'), path.join(dir, 'rules'));
    }
  } else {
    restoreKnown(dir, OPENCODE_RESTORE.map((rel) => [rel, rel]), force);
  }
  removeLeftovers(dir);
  console.log(`prune-foreign: ${kind} ${dir}`);
}

if (opencodeDir) prune(opencodeDir, 'opencode');
if (claudeDir) prune(claudeDir, 'claude');
