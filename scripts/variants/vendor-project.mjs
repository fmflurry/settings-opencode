#!/usr/bin/env node
// Vendor AGENTS.md, .cursor/rules, and .agents into a project for one harness variant.
// .claude and .opencode stay the job of install.sh. Refuses the settings repo itself.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeVariant } from '../cursor-plugin/variant.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);

function flag(name) {
  const inline = args.find((arg) => arg.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = args.indexOf(name);
  if (index === -1) return '';
  const value = args[index + 1];
  if (!value || value.startsWith('--')) {
    console.error(`vendor-project: ${name} needs a value`);
    process.exit(2);
  }
  return value;
}

function canonicalPath(value) {
  const resolved = path.resolve(value);
  try {
    return fs.realpathSync(resolved);
  } catch {
    return resolved;
  }
}

const projectArg = flag('--project');
const repo = canonicalPath(flag('--repo') || path.resolve(here, '../..'));
const project = canonicalPath(projectArg || '.');
const pluginArg = flag('--plugin');
if (!projectArg) {
  console.error('vendor-project: --project needs a path');
  process.exit(2);
}
if (project === repo) {
  console.error('vendor-project: refusing to vendor into the settings repo');
  process.exit(1);
}

let variant;
try {
  const requested = flag('--variant') || process.env.HARNESS_VARIANT || 'monolith';
  variant = normalizeVariant(requested) || 'monolith';
} catch (error) {
  console.error(`vendor-project: ${error.message}`);
  process.exit(2);
}

function ownedNames(stamp) {
  if (!fs.existsSync(stamp)) return [];
  return fs.readFileSync(stamp, 'utf8').split('\n').map((line) => line.trim()).filter(Boolean);
}

function rewriteOwned(dir, stamp, entries) {
  fs.mkdirSync(dir, { recursive: true });
  for (const name of ownedNames(stamp)) {
    const target = path.join(dir, name);
    if (target.startsWith(`${dir}${path.sep}`)) fs.rmSync(target, { force: true });
  }
  const names = [];
  for (const entry of entries) {
    if (entry.name.includes('..') || path.isAbsolute(entry.name)) {
      console.error(`vendor-project: bad relative name ${entry.name}`);
      process.exit(1);
    }
    const target = path.join(dir, entry.name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(entry.src, target);
    names.push(entry.name);
  }
  fs.writeFileSync(stamp, `${names.join('\n')}\n`);
}

function listFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = entry.name;
    const full = path.join(dir, rel);
    if (entry.isDirectory()) {
      for (const nested of listFiles(full)) out.push(path.join(rel, nested));
    } else if (entry.isFile()) out.push(rel);
  }
  return out;
}

const baselineName = variant === 'monolith' ? 'variants/monolith/AGENTS.md' : 'variants/conductor/AGENTS.md';
const baseline = fs.readFileSync(path.join(repo, baselineName), 'utf8');
const agentsMd = path.join(project, 'AGENTS.md');
const existing = fs.existsSync(agentsMd) ? fs.readFileSync(agentsMd, 'utf8') : '';
if (
  !existing.trim()
  || existing.includes('This install is Monolith.')
  || existing.includes('This install is Conductor.')
) {
  fs.writeFileSync(agentsMd, baseline.endsWith('\n') ? baseline : `${baseline}\n`);
}

let plugin = pluginArg ? path.resolve(pluginArg) : '';
let temp = '';
if (!plugin) {
  temp = fs.mkdtempSync(path.join(os.tmpdir(), 'vendor-cursor-'));
  plugin = path.join(temp, 'plugin');
  execFileSync(process.execPath, [
    path.join(repo, 'scripts/build-cursor-plugin.mjs'),
    '--variant',
    variant,
    '--out',
    plugin,
  ], { stdio: 'inherit' });
}

const ruleDir = path.join(plugin, 'rules');
const agentDir = path.join(plugin, 'agents');
if (!fs.existsSync(ruleDir) || !fs.existsSync(agentDir)) {
  console.error(`vendor-project: ${plugin} is not a built Cursor plugin`);
  process.exit(1);
}

rewriteOwned(
  path.join(project, '.cursor/rules'),
  path.join(project, '.cursor/.harness-rules'),
  listFiles(ruleDir).map((name) => ({ name, src: path.join(ruleDir, name) })),
);
rewriteOwned(
  path.join(project, '.agents'),
  path.join(project, '.agents/.harness-agents'),
  fs.readdirSync(agentDir).filter((name) => name.endsWith('.md')).map((name) => ({
    name,
    src: path.join(agentDir, name),
  })),
);

execFileSync('bash', [
  path.join(repo, 'scripts/sync-skills.sh'),
  path.join(project, '.agents/skills'),
], { stdio: 'inherit' });

const conductorSkill = path.join(project, '.agents/skills/conductor');
if (variant === 'monolith') {
  fs.cpSync(path.join(repo, 'variants/monolith/skills/conductor'), conductorSkill, { recursive: true });
} else if (fs.existsSync(path.join(conductorSkill, 'SKILL.md'))) {
  const text = fs.readFileSync(path.join(conductorSkill, 'SKILL.md'), 'utf8');
  if (text.includes('The primary agent still writes.')) fs.rmSync(conductorSkill, { recursive: true, force: true });
}

fs.writeFileSync(path.join(project, '.cursor/.harness-variant'), `${variant}\n`);
fs.writeFileSync(path.join(project, '.agents/.harness-variant'), `${variant}\n`);
if (temp) fs.rmSync(temp, { recursive: true, force: true });
console.log(`vendor-project: ${variant} ${project}`);
