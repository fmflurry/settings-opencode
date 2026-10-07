#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { splitFrontmatter, unquote } from './lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(here, '../../plugins/fmflurry-harness');
const config = JSON.parse(fs.readFileSync(path.join(here, 'config.json'), 'utf8'));
const errors = [];

const pluginPath = path.join(out, '.cursor-plugin/plugin.json');
if (!fs.existsSync(pluginPath)) {
  errors.push('missing .cursor-plugin/plugin.json');
} else {
  const plugin = JSON.parse(fs.readFileSync(pluginPath, 'utf8'));
  if (!plugin.name) errors.push('plugin.json: missing name');
  for (const key of Object.keys(plugin)) {
    if (!config.pluginKeys.includes(key)) errors.push(`plugin.json: key not in schema: ${key}`);
  }
}

const skillsDir = path.join(out, 'skills');
if (fs.existsSync(skillsDir)) {
  for (const e of fs.readdirSync(skillsDir, { withFileTypes: true })) {
    const file = path.join(skillsDir, e.name, 'SKILL.md');
    if (!e.isDirectory() || !fs.existsSync(file)) continue;
    const name = unquote(splitFrontmatter(fs.readFileSync(file, 'utf8')).fm.name);
    if (name !== e.name) errors.push(`skills/${e.name}/SKILL.md: name "${name}" != dir`);
  }
}

const agentsDir = path.join(out, 'agents');
if (fs.existsSync(agentsDir)) {
  for (const f of fs.readdirSync(agentsDir).filter((x) => x.endsWith('.md'))) {
    const { fm } = splitFrontmatter(fs.readFileSync(path.join(agentsDir, f), 'utf8'));
    for (const key of Object.keys(fm)) {
      if (!config.agentKeys.includes(key)) errors.push(`agents/${f}: frontmatter key not allowed: ${key}`);
    }
    if (!Object.values(config.modelTiers).includes(unquote(fm.model))) errors.push(`agents/${f}: model "${fm.model}" is not a modelTiers value`);
  }
}

const hooksPath = path.join(out, 'hooks/hooks.json');
if (fs.existsSync(hooksPath)) {
  const hooksFile = JSON.parse(fs.readFileSync(hooksPath, 'utf8'));
  if (hooksFile.version !== 1) errors.push('hooks.json: version must be 1');
  const rootPrefix = '${CURSOR_PLUGIN_ROOT}/';
  for (const [event, entries] of Object.entries(hooksFile.hooks ?? {})) {
    if (!config.cursorHookEvents.includes(event)) errors.push(`hooks.json: unknown Cursor event: ${event}`);
    for (const { command = '' } of entries) {
      if (!command.startsWith(rootPrefix)) errors.push(`hooks.json: ${event}: command lacks \${CURSOR_PLUGIN_ROOT} prefix: ${command}`);
      for (const ref of command.split(/\s+/).filter((t) => t.startsWith(rootPrefix))) {
        const file = path.join(out, ref.slice(rootPrefix.length));
        if (!fs.existsSync(file)) errors.push(`hooks.json: ${event}: missing script ${ref}`);
        else if (!(fs.statSync(file).mode & 0o111)) errors.push(`hooks.json: ${event}: script not executable ${ref}`);
        else if (/(\$HOME|~)\/\.claude/.test(fs.readFileSync(file, 'utf8'))) errors.push(`${ref}: references ~/.claude state`);
      }
    }
  }
}

function scan(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) scan(p);
    else if (e.isFile() && fs.readFileSync(p).includes('/Users/')) {
      errors.push(`${path.relative(out, p)}: contains /Users/`);
    }
  }
}
if (fs.existsSync(out)) scan(out);
else errors.push('plugins/fmflurry-harness does not exist');

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log('cursor-plugin check OK');
