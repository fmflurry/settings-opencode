#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  parseJsonc, buildMcp, splitFrontmatter, unquote, claudeAgent, opencodeAgent, slug, mdc,
  firstHeading, globsFromPaths, walkMd, conductorRuleBody, conductorSkill, stripAtImports, sanitize,
  buildHooks, portableHookScript, tierGuard, setupSkill,
} from './cursor-plugin/lib.mjs';
import {
  applyCursorMonolith, readmeValues, resolveBuildVariant, resolveOutDir, variantDescription,
} from './cursor-plugin/variant.mjs';

const repoDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const buildArgs = process.argv.slice(2);
let variant;
try {
  variant = resolveBuildVariant(buildArgs);
} catch (error) {
  console.error(error.message);
  process.exit(error.code === 'VARIANT' ? 2 : 1);
}
const config = JSON.parse(fs.readFileSync(path.join(repoDir, 'scripts/cursor-plugin/config.json'), 'utf8'));
const repoName = (config.repository ?? '').split('/').pop().replace(/\.git$/, '') || path.basename(repoDir);
let out;
try {
  out = resolveOutDir(buildArgs, repoDir, config.name);
} catch (error) {
  console.error(error.message);
  process.exit(error.code === 'VARIANT' ? 2 : 1);
}
const claudeDir = path.join(repoDir, '.claude');
const assertTiered = tierGuard(config);

const read = (p) => fs.readFileSync(p, 'utf8');
function write(rel, content, mode) {
  const p = path.join(out, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
  if (mode) fs.chmodSync(p, mode);
}

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

write('.cursor-plugin/plugin.json', JSON.stringify({
  name: config.name,
  displayName: config.displayName,
  description: variantDescription(variant),
  version: config.version,
  author: { name: 'fmflurry' },
  homepage: config.homepage,
  repository: config.repository,
  license: 'MIT',
  logo: 'assets/logo.png',
  keywords: config.keywords,
  category: config.category,
  tags: config.tags,
  skills: './skills/',
  agents: './agents/',
  commands: './commands/',
  rules: './rules/',
  hooks: './hooks/hooks.json',
  mcpServers: './mcp.json',
}, null, 2) + '\n');

const changelog = path.join(repoDir, 'scripts/cursor-plugin/CHANGELOG.md');
if (!fs.existsSync(changelog)) {
  console.error('missing scripts/cursor-plugin/CHANGELOG.md');
  process.exit(1);
}
fs.copyFileSync(changelog, path.join(out, 'CHANGELOG.md'));

execFileSync('bash', [path.join(repoDir, 'scripts/sync-skills.sh'), path.join(out, 'skills')], { stdio: 'ignore' });
for (const entry of fs.readdirSync(path.join(out, 'skills'), { withFileTypes: true })) {
  const skillFile = path.join(out, 'skills', entry.name, 'SKILL.md');
  if (!entry.isDirectory() || !fs.existsSync(skillFile)) continue;
  const text = read(skillFile);
  const { fm } = splitFrontmatter(text);
  if (unquote(fm.name) === entry.name) continue;
  fs.writeFileSync(skillFile, text.replace(/^(---\s*\n[\s\S]*?)^name:.*$/m, `$1name: ${entry.name}`));
}
fs.mkdirSync(path.join(out, 'assets'), { recursive: true });
fs.copyFileSync(path.join(repoDir, 'scripts/cursor-plugin/assets/logo.png'), path.join(out, 'assets/logo.png'));
write('skills/conductor/SKILL.md', conductorSkill(config));
write('skills/setup-harness/SKILL.md', setupSkill(read(path.join(repoDir, 'scripts/cursor-plugin/templates/setup-harness.md')), config));

const claudeAgentsDir = path.join(claudeDir, 'agents');
const emitted = new Set();
for (const file of fs.readdirSync(claudeAgentsDir).filter((f) => f.endsWith('.md')).sort()) {
  if (file === 'conductor.md') continue;
  const agent = claudeAgent(read(path.join(claudeAgentsDir, file)), assertTiered);
  write(`agents/${agent.name}.md`, agent.out);
  emitted.add(agent.name);
}

const opencodeCfg = parseJsonc(read(path.join(repoDir, 'opencode.jsonc')));
for (const [name, def] of Object.entries(opencodeCfg.agent ?? {})) {
  if (name === 'conductor' || def.disable || emitted.has(name)) continue;
  write(`agents/${name}.md`, opencodeAgent(repoDir, name, def, assertTiered));
  emitted.add(name);
}

const commandSources = [path.join(claudeDir, 'commands'), path.join(repoDir, 'commands')];
for (const root of commandSources) {
  for (const file of walkMd(root)) write(`commands/${path.relative(root, file)}`, read(file));
}

const rulesRoot = path.join(claudeDir, 'rules');
const listed = new Set([...config.rules.always, ...config.rules.requested, ...config.rules.drop]);
const unlisted = walkMd(rulesRoot)
  .map((f) => path.relative(rulesRoot, f).replace(/\.md$/, ''))
  .filter((r) => !listed.has(r));
if (unlisted.length) {
  console.error(`rules missing from config.json always/requested/drop:\n  ${unlisted.join('\n  ')}`);
  process.exit(1);
}
for (const rel of [...config.rules.always, ...config.rules.requested]) {
  const text = read(path.join(rulesRoot, `${rel}.md`));
  const body = splitFrontmatter(text).body;
  const alwaysApply = config.rules.always.includes(rel);
  const description = firstHeading(body, rel);
  write(`rules/${slug(rel.replace('/', '-').replace(/^common-/, ''))}.mdc`, mdc(
    { description, globs: alwaysApply ? '' : globsFromPaths(text), alwaysApply },
    body,
  ));
}

const harnessBody = stripAtImports(read(path.join(claudeDir, 'CLAUDE.md')));
if (harnessBody.trim()) {
  write('rules/always__harness.mdc', mdc(
    { description: 'Always-on baseline from CLAUDE.md', alwaysApply: true },
    harnessBody,
  ));
}
write('rules/conductor.mdc', mdc(
  { description: 'Conductor: route every task to the matching specialist subagent', alwaysApply: true },
  conductorRuleBody(read(path.join(claudeAgentsDir, 'conductor.md')), config),
));

const hooks = buildHooks(JSON.parse(read(path.join(claudeDir, 'settings.json'))), config.hooks.include);
write('hooks/hooks.json', JSON.stringify(hooks.json, null, 2) + '\n');
write('hooks/scripts/cursor-adapter.sh', read(path.join(repoDir, 'scripts/cursor-plugin/cursor-adapter.sh')), 0o755);
for (const script of hooks.scripts) {
  write(`hooks/scripts/${script}`, portableHookScript(read(path.join(claudeDir, 'hooks', script))), 0o755);
}
write('hooks/scripts/goal-state.sh', portableHookScript(read(path.join(claudeDir, 'hooks', 'goal-state.sh'))), 0o755);
write('hooks/scripts/codememory-mode.sh', portableHookScript(read(path.join(claudeDir, 'hooks', 'codememory-mode.sh'))), 0o755);

write('mcp.json', JSON.stringify(buildMcp(opencodeCfg), null, 2) + '\n');

if (variant === 'monolith') {
  try {
    const installed = applyCursorMonolith(out, repoDir, config);
    write('skills/setup-harness/SKILL.md', setupSkill(read(path.join(repoDir, 'scripts/cursor-plugin/templates/setup-harness.md')), installed));
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
write('.harness-variant', `${variant}\n`);

// Source files embed author-machine paths (examples, config-sync docs); a published plugin must not.
const TEXT_EXT = new Set(['.md', '.mdc', '.json', '.txt', '.yaml', '.yml']);
(function scrub(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) scrub(p);
    else if (e.isFile() && TEXT_EXT.has(path.extname(e.name))) {
      const text = read(p);
      const clean = sanitize(text, repoDir, repoName);
      if (clean !== text) fs.writeFileSync(p, clean);
    }
  }
})(out);

const count = (d, ext) => fs.readdirSync(path.join(out, d), { recursive: true }).filter((f) => f.endsWith(ext)).length;
const counts = {
  skills: fs.readdirSync(path.join(out, 'skills')).length,
  agents: count('agents', '.md'),
  commands: count('commands', '.md'),
  rules: count('rules', '.mdc'),
};
const values = readmeValues(variant, config, out, counts);
write('README.md', read(path.join(repoDir, 'scripts/cursor-plugin/README.template.md')).replace(/\{\{(\w+)\}\}/g, (_, k) => {
  if (!(k in values)) throw new Error(`README template: unknown placeholder {{${k}}}`);
  return values[k];
}));
console.log(`variant=${variant}`);
console.log(Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(' '));
