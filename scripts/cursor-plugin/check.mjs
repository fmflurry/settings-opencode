#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { splitFrontmatter, unquote } from './lib.mjs';
import { scanReviewSeverities } from './review-tags.mjs';
import {
  assessPluginVersion,
  changelogHasVersion,
  parseSemver,
  pluginSourcePaths,
} from './version-guard.mjs';
import { formatHits, scanMonolithTree } from '../variants/dangling-agents.mjs';

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
  if (plugin.version !== config.version) {
    errors.push(`plugin.json version ${JSON.stringify(plugin.version)} != config.json version ${JSON.stringify(config.version)} (source of truth: scripts/cursor-plugin/config.json; run node scripts/build-cursor-plugin.mjs)`);
  }
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
    const name = unquote(fm.name);
    const tier = unquote(fm.tier);
    for (const key of Object.keys(fm)) {
      if (!config.agentKeys.includes(key)) errors.push(`agents/${f}: frontmatter key not allowed: ${key}`);
    }
    if ('model' in fm) errors.push(`agents/${f}: must not set model (chosen at Task time)`);
    if (!tier) errors.push(`agents/${f}: missing tier (agents use tier:, not model:)`);
    else if (!config.agentTiers[tier]?.includes(name)) errors.push(`agents/${f}: tier "${tier}" does not list ${name}`);
  }
}

if (!fs.existsSync(path.join(skillsDir, 'setup-harness/SKILL.md'))) errors.push('missing skills/setup-harness/SKILL.md');
const variantFile = path.join(out, '.harness-variant');
const variant = fs.existsSync(variantFile) ? fs.readFileSync(variantFile, 'utf8').trim().toLowerCase() : '';
if (variant !== 'monolith' && variant !== 'conductor') {
  errors.push(`.harness-variant must be monolith or conductor, got ${JSON.stringify(variant)}`);
}
const modelRuleRel = variant === 'conductor' ? 'rules/conductor.mdc' : 'rules/monolith.mdc';
const modelRulePath = path.join(out, modelRuleRel);
const modelText = fs.existsSync(modelRulePath) ? fs.readFileSync(modelRulePath, 'utf8') : '';
for (const slug of Object.values(config.defaultTierModels)) {
  if (!modelText.includes(slug)) errors.push(`${modelRuleRel}: missing default slug ${slug}`);
}
for (const [tier, slugs] of Object.entries(config.tierFallbacks ?? {})) {
  for (const slug of slugs) {
    if (!modelText.includes(slug)) errors.push(`${modelRuleRel}: missing ${tier} fallback ${slug}`);
  }
}
for (const family of config.cursorModelFamilies ?? []) {
  if (!modelText.includes(family)) errors.push(`${modelRuleRel}: missing Cursor family ${family}`);
}
if (!/third-party/.test(modelText) || !/-fast/.test(modelText)) {
  errors.push(`${modelRuleRel}: missing Cursor-only model hard rule`);
}
if (variant === 'monolith') {
  const folded = [
    'conductor', 'coder', 'planner', 'writer', 'doc-updater', 'scout', 'tdd-guide', 'git-specialist',
    'architect', 'angular-cop', 'dotnet-cop', 'haruspex-commentorum', 'why-synthesizer',
  ];
  for (const name of folded) {
    if (fs.existsSync(path.join(agentsDir, `${name}.md`))) errors.push(`monolith plugin still has agents/${name}.md`);
  }
  if (fs.existsSync(path.join(out, 'rules/conductor.mdc'))) errors.push('monolith plugin still has rules/conductor.mdc');
  const rulesDir = path.join(out, 'rules');
  if (fs.existsSync(rulesDir)) {
    for (const file of fs.readdirSync(rulesDir).filter((name) => name.endsWith('.mdc'))) {
      const text = fs.readFileSync(path.join(rulesDir, file), 'utf8');
      if (/First-Tool Gate/.test(text)) errors.push(`rules/${file}: still has a first-tool gate`);
      if (/cannot write or edit files directly/i.test(text)) errors.push(`rules/${file}: still forbids the primary agent from writing`);
    }
  }
  if (!/primary agent/i.test(modelText) || !/allowed to write|may write/i.test(modelText)) {
    errors.push('rules/monolith.mdc does not allow the primary agent to write');
  }
  for (const skill of ['threejs', 'openspec']) {
    if (!fs.existsSync(path.join(skillsDir, skill, 'SKILL.md'))) errors.push(`missing umbrella skill ${skill}`);
  }
  const conductorSkillPath = path.join(skillsDir, 'conductor/SKILL.md');
  const conductorSkill = fs.existsSync(conductorSkillPath) ? fs.readFileSync(conductorSkillPath, 'utf8') : '';
  if (!/optional/i.test(conductorSkill) || !conductorSkill.includes('The primary agent still writes.')) {
    errors.push('skills/conductor/SKILL.md is not the Monolith overlay');
  }
  const orchestratePath = path.join(out, 'commands/orchestrate.md');
  const orchestrate = fs.existsSync(orchestratePath) ? fs.readFileSync(orchestratePath, 'utf8') : '';
  if (!/optional/i.test(orchestrate) || !/monolith/i.test(orchestrate)) {
    errors.push('commands/orchestrate.md is not the optional Monolith command');
  }
  for (const name of ['cop', 'comment-judge']) {
    if (!fs.existsSync(path.join(agentsDir, `${name}.md`))) errors.push(`monolith plugin missing agents/${name}.md`);
  }
  const copText = fs.existsSync(path.join(agentsDir, 'cop.md')) ? fs.readFileSync(path.join(agentsDir, 'cop.md'), 'utf8') : '';
  if (!copText.includes('tier: smart') || !copText.includes('angular-cop') || !copText.includes('dotnet-cop')) {
    errors.push('agents/cop.md must be the merged smart-tier cop');
  }
  const judgeText = fs.existsSync(path.join(agentsDir, 'comment-judge.md'))
    ? fs.readFileSync(path.join(agentsDir, 'comment-judge.md'), 'utf8')
    : '';
  if (!/persona=haruspex|haruspex/.test(judgeText)) errors.push('agents/comment-judge.md must cover the haruspex persona');
  const manifest = JSON.parse(fs.readFileSync(path.resolve(here, '../../variants/monolith/manifest.json'), 'utf8'));
  const dangling = scanMonolithTree(out, manifest);
  if (dangling.length) {
    errors.push(`monolith output still dispatches to a removed agent:\n${formatHits(dangling)}`);
  }
}
if (variant === 'conductor') {
  if (!fs.existsSync(path.join(agentsDir, 'coder.md'))) errors.push('conductor plugin is missing agents/coder.md');
  if (fs.existsSync(path.join(agentsDir, 'cop.md'))) errors.push('conductor plugin includes the Monolith cop agent');
  if (fs.existsSync(path.join(out, 'rules/monolith.mdc'))) errors.push('conductor plugin has rules/monolith.mdc');
  const orchestration = path.join(out, 'rules/orchestration.mdc');
  const orchestrationText = fs.existsSync(orchestration) ? fs.readFileSync(orchestration, 'utf8') : '';
  if (!/First-Tool Gate/.test(orchestrationText)) errors.push('rules/orchestration.mdc: conductor build lost the first-tool gate');
}
const setupText = fs.existsSync(path.join(skillsDir, 'setup-harness/SKILL.md'))
  ? fs.readFileSync(path.join(skillsDir, 'setup-harness/SKILL.md'), 'utf8')
  : '';
for (const needle of ['~/.cursor/rules/fmflurry-harness-models.mdc', '~/.agents/fmflurry-harness-models.md', ...Object.values(config.defaultTierModels)]) {
  if (!setupText.includes(needle)) errors.push(`skills/setup-harness/SKILL.md: missing ${needle}`);
}
if (!setupText.includes('## Visual report')) errors.push('skills/setup-harness/SKILL.md: missing ## Visual report');
const visualSkillPath = path.join(skillsDir, 'pr-visual-report/SKILL.md');
if (!fs.existsSync(visualSkillPath)) errors.push('missing skills/pr-visual-report/SKILL.md');
else {
  const visualSkill = fs.readFileSync(visualSkillPath, 'utf8');
  for (const needle of ['docs/pr-reports/', '## Visual report', 'pr-report-check']) {
    if (!visualSkill.includes(needle)) errors.push(`skills/pr-visual-report/SKILL.md: missing ${needle}`);
  }
}

const TEXT_EXT = new Set(['.md', '.mdc', '.json', '.txt', '.yml', '.yaml', '.mjs', '.js', '.py', '.sh']);
const allowedSlug = new RegExp(`^(?:${(config.cursorModelFamilies ?? []).map((f) => f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})(?:-(?:none|minimal|low|medium|high|xhigh|max))?$`);
const MODEL_SLUG = /\b(?:claude-(?:opus|sonnet|haiku|fable)[a-z0-9.-]*|gpt-[a-z0-9.-]+|gemini-[a-z0-9.-]+|kimi-[a-z0-9.-]+|glm-[a-z0-9.-]+|fable-[a-z0-9.-]+|muse-[a-z0-9.-]+|mistral-[a-z0-9.-]+|llama-[a-z0-9.-]+|grok-[a-z0-9.-]+|composer-[a-z0-9.-]+)\b/gi;
const BARE_ALIAS = /`(opus|sonnet|haiku)`/g;

function scanModels(rel, text) {
  for (const match of text.matchAll(MODEL_SLUG)) {
    const slug = match[0];
    if (slug.endsWith('-fast') || !allowedSlug.test(slug)) {
      const line = text.slice(0, match.index).split('\n').length;
      errors.push(`${rel}:${line}: disallowed model slug ${slug}`);
    }
  }
  for (const match of text.matchAll(BARE_ALIAS)) {
    const line = text.slice(0, match.index).split('\n').length;
    errors.push(`${rel}:${line}: disallowed model slug ${match[1]}`);
  }
}

function scanTree(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) scanTree(p);
    else if (e.isFile() && TEXT_EXT.has(path.extname(e.name))) scanModels(path.relative(out, p), fs.readFileSync(p, 'utf8'));
  }
}
if (fs.existsSync(out)) scanTree(out);

const hooksPath = path.join(out, 'hooks/hooks.json');
if (fs.existsSync(hooksPath)) {
  const hooksFile = JSON.parse(fs.readFileSync(hooksPath, 'utf8'));
  if (hooksFile.version !== 1) errors.push('hooks.json: version must be 1');
  if (!JSON.stringify(hooksFile).includes('pr-visual-report.sh')) errors.push('hooks.json: missing pr-visual-report.sh');
  const rootPrefix = '${CURSOR_PLUGIN_ROOT}/';
  for (const [event, entries] of Object.entries(hooksFile.hooks ?? {})) {
    if (!config.cursorHookEvents.includes(event)) errors.push(`hooks.json: unknown Cursor event: ${event}`);
    for (const { command = '' } of entries) {
      if (!command.startsWith(`bash ${rootPrefix}`)) errors.push(`hooks.json: ${event}: command must start with "bash \${CURSOR_PLUGIN_ROOT}/": ${command}`);
      for (const ref of command.split(/\s+/).filter((t) => t.startsWith(rootPrefix))) {
        const file = path.join(out, ref.slice(rootPrefix.length));
        if (!fs.existsSync(file)) errors.push(`hooks.json: ${event}: missing script ${ref}`);
        else if (!(fs.statSync(file).mode & 0o111)) errors.push(`hooks.json: ${event}: script not executable ${ref}`);
        else if (/(\$HOME|~)\/\.claude/.test(fs.readFileSync(file, 'utf8'))) errors.push(`${ref}: references ~/.claude state`);
      }
    }
  }
}

const TMP_EXEC = /\b(?:bash|sh|source|exec)\b[^\n]*(?:\$\{?TMPDIR|\/tmp\/)|(?:\$\{?TMPDIR[^}\s]*\}?|\/tmp)\/[^\s"']*\/(?:scripts|bin)\b/;
const hookScriptsDir = path.join(out, 'hooks/scripts');
if (fs.existsSync(hookScriptsDir)) {
  for (const f of fs.readdirSync(hookScriptsDir)) {
    const text = fs.readFileSync(path.join(hookScriptsDir, f), 'utf8');
    text.split('\n').forEach((line, i) => {
      if (TMP_EXEC.test(line)) errors.push(`hooks/scripts/${f}:${i + 1}: executes from TMPDIR or /tmp`);
    });
  }
}
if (fs.existsSync(hooksPath)) {
  const raw = fs.readFileSync(hooksPath, 'utf8');
  if (/TMPDIR|\/tmp\b/.test(raw)) errors.push('hooks.json: references TMPDIR or /tmp');
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

if (!parseSemver(config.version)) {
  errors.push(`config.json version ${JSON.stringify(config.version)} must be MAJOR.MINOR.PATCH`);
}

function readChangelog(label, file) {
  if (!fs.existsSync(file)) {
    errors.push(`${label}: missing changelog (need a heading for ${config.version})`);
    return null;
  }
  const text = fs.readFileSync(file, 'utf8');
  if (parseSemver(config.version) && !changelogHasVersion(text, config.version)) {
    errors.push(`${label}: missing changelog heading for ${config.version} (for example "## [${config.version}]")`);
  }
  return text;
}

const sourceChangelog = readChangelog('scripts/cursor-plugin/CHANGELOG.md', path.join(here, 'CHANGELOG.md'));
const builtChangelog = readChangelog('plugins/fmflurry-harness/CHANGELOG.md', path.join(out, 'CHANGELOG.md'));
if (sourceChangelog != null && builtChangelog != null && sourceChangelog !== builtChangelog) {
  errors.push('plugins/fmflurry-harness/CHANGELOG.md differs from scripts/cursor-plugin/CHANGELOG.md; run node scripts/build-cursor-plugin.mjs');
}

const marketplacePath = path.join(here, '../../.cursor-plugin/marketplace.json');
if (fs.existsSync(marketplacePath)) {
  const marketplace = JSON.parse(fs.readFileSync(marketplacePath, 'utf8'));
  for (const entry of marketplace.plugins ?? []) {
    if (entry.name !== config.name || entry.version === undefined) continue;
    if (entry.version !== config.version) {
      errors.push(`marketplace.json: ${entry.name} version ${JSON.stringify(entry.version)} != config.json version ${JSON.stringify(config.version)}`);
    }
  }
}

const guard = assessPluginVersion({
  repoDir: path.resolve(here, '../..'),
  paths: pluginSourcePaths(config),
  currentVersion: String(config.version ?? ''),
});
for (const notice of guard.notices) console.log(notice);
errors.push(...guard.errors);

for (const hit of scanReviewSeverities(path.resolve(here, '../..'))) {
  errors.push(`${hit.file}:${hit.line}: review severity ${hit.word} is not a finding tag: ${hit.text.slice(0, 160)}`);
}

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log('cursor-plugin check OK');
