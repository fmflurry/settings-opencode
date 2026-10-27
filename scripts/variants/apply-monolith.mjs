#!/usr/bin/env node
// Overlay the Monolith variant onto an installed OpenCode tree, Claude tree, or both.
// Reads Conductor files from the install target and variant files from the repo.
// Refuses to rewrite the source checkout.
import fs from 'node:fs';
import path from 'node:path';
import { parseJsonc, splitFrontmatter, unquote } from '../cursor-plugin/lib.mjs';

const args = process.argv.slice(2);

function flag(name) {
  const i = args.indexOf(name);
  if (i === -1 || !args[i + 1] || args[i + 1].startsWith('--')) {
    console.error(`apply-monolith: ${name} needs a path`);
    process.exit(2);
  }
  return path.resolve(args[i + 1]);
}

const repo = flag('--repo');
const claudeDir = args.includes('--claude') ? flag('--claude') : null;
const opencodeDir = args.includes('--opencode') ? flag('--opencode') : null;
if (!claudeDir && !opencodeDir) {
  console.error('apply-monolith: pass --claude and/or --opencode');
  process.exit(2);
}

const manifest = JSON.parse(fs.readFileSync(path.join(repo, 'variants/monolith/manifest.json'), 'utf8'));
const baseline = fs.readFileSync(path.join(repo, manifest.baseline), 'utf8');
const agentsMd = fs.readFileSync(path.join(repo, 'variants/monolith/AGENTS.md'), 'utf8');
if (baseline !== agentsMd) {
  console.error('apply-monolith: CLAUDE.md and AGENTS.md differ');
  process.exit(1);
}

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

if (claudeDir && samePath(claudeDir, path.join(repo, '.claude'))) {
  console.error('apply-monolith: refusing to rewrite the source .claude');
  process.exit(1);
}
if (opencodeDir && samePath(opencodeDir, repo)) {
  console.error('apply-monolith: refusing to rewrite the source checkout');
  process.exit(1);
}

const BAD_MODEL = /(opus|sonnet|haiku|claude-|gpt-|gemini-|-fast)/i;

function read(rel) {
  return fs.readFileSync(path.join(repo, rel), 'utf8');
}

function write(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text.endsWith('\n') ? text : `${text}\n`);
}

function copyRecursive(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) copyRecursive(from, to);
    else if (entry.isFile()) fs.copyFileSync(from, to);
  }
}

function replaceDescription(text, description) {
  const line = `description: ${JSON.stringify(description)}`;
  if (!/^description:/m.test(text)) throw new Error('agent is missing description');
  return text.replace(/^description:.*$/m, line);
}

function stripBadModel(text) {
  return text.replace(/^model:\s*(.+)$/m, (full, value) => (BAD_MODEL.test(value) ? '' : full));
}

function promptBody(md) {
  return splitFrontmatter(md).body.replace(/^\n/, '');
}

function readOnlyTools() {
  return {
    read: true,
    bash: true,
    grep: true,
    glob: true,
    skill: true,
    write: false,
    edit: false,
    'code-memory_*': true,
  };
}

function agentRecord(name, md, modelEnv) {
  const { fm } = splitFrontmatter(md);
  const description = unquote(fm.description) || manifest.descriptions[name];
  return {
    description,
    mode: 'subagent',
    model: `{env:${modelEnv}}`,
    prompt: `{file:prompts/agents/${name}.txt}`,
    temperature: 0.3,
    topP: 0.9,
    tools: readOnlyTools(),
  };
}

function applyClaude(dir) {
  const hook = path.join(dir, 'hooks', 'ship-stop-gate.sh');
  if (!fs.existsSync(hook)) {
    console.error(`apply-monolith: missing hook ${hook}`);
    process.exit(1);
  }
  write(path.join(dir, 'CLAUDE.md'), baseline);
  write(path.join(dir, 'AGENTS.md'), baseline);
  write(path.join(dir, '.harness-variant'), 'monolith\n');

  const rules = path.join(dir, 'rules');
  const ruleSources = path.join(dir, 'rule-sources');
  if (fs.existsSync(rules)) {
    fs.rmSync(ruleSources, { recursive: true, force: true });
    fs.mkdirSync(ruleSources, { recursive: true });
    for (const entry of fs.readdirSync(rules)) {
      fs.renameSync(path.join(rules, entry), path.join(ruleSources, entry));
    }
  }
  write(path.join(ruleSources, 'common', 'tool-budget.md'), read('variants/monolith/stubs/tool-budget.md'));
  write(path.join(ruleSources, 'common', 'verification-gate.md'), read('variants/monolith/stubs/verification-gate.md'));
  write(path.join(ruleSources, 'common', 'orchestration.md'), read('variants/monolith/stubs/routing.md'));

  const agentsDir = path.join(dir, 'agents');
  const sources = path.join(dir, 'agent-sources');
  fs.mkdirSync(sources, { recursive: true });
  const remove = new Set(manifest.removeAgents);
  for (const file of fs.readdirSync(agentsDir).filter((name) => name.endsWith('.md'))) {
    const agent = file.slice(0, -3);
    if (!remove.has(agent)) continue;
    fs.rmSync(path.join(sources, file), { force: true });
    fs.renameSync(path.join(agentsDir, file), path.join(sources, file));
  }
  write(path.join(sources, 'conductor.md'), [
    '# Conductor',
    '',
    'Monolith does not install the conductor agent. `/orchestrate` loads the `conductor` skill.',
    'The primary agent may write.',
    '',
  ].join('\n'));

  for (const name of manifest.overlayAgents) {
    const md = read(`variants/monolith/agents/${name}.md`);
    write(path.join(agentsDir, `${name}.md`), stripBadModel(md));
  }
  for (const name of manifest.keptAgents) {
    const file = path.join(agentsDir, `${name}.md`);
    if (!fs.existsSync(file)) {
      console.error(`apply-monolith: missing kept agent ${file}`);
      process.exit(1);
    }
    let text = fs.readFileSync(file, 'utf8');
    text = replaceDescription(text, manifest.descriptions[name]);
    write(file, stripBadModel(text));
  }
  for (const file of fs.readdirSync(agentsDir).filter((name) => name.endsWith('.md'))) {
    const full = path.join(agentsDir, file);
    write(full, stripBadModel(fs.readFileSync(full, 'utf8')));
  }

  const command = path.join(dir, 'commands', 'orchestrate.md');
  if (fs.existsSync(path.dirname(command))) {
    write(command, read('variants/monolith/commands/orchestrate.md'));
  }
  copyRecursive(path.join(repo, 'variants/monolith/skills'), path.join(dir, 'skills'));
  console.log(`apply-monolith: claude ${dir}`);
}

function instructionEntry(dir) {
  const globalDir = path.join(process.env.HOME || '', '.config', 'opencode');
  if (samePath(dir, globalDir)) return '~/.config/opencode/instructions/monolith.md';
  if (path.basename(path.resolve(dir)) === '.opencode') return '.opencode/instructions/monolith.md';
  return path.join(dir, 'instructions', 'monolith.md');
}

function applyOpencode(dir) {
  const configPath = path.join(dir, 'opencode.jsonc');
  if (!fs.existsSync(configPath)) {
    console.error(`apply-monolith: missing ${configPath}`);
    process.exit(1);
  }
  const cfg = parseJsonc(fs.readFileSync(configPath, 'utf8'));
  write(path.join(dir, 'instructions', 'monolith.md'), baseline);
  write(path.join(dir, 'AGENTS.md'), baseline);
  write(path.join(dir, 'instructions', 'subagent-routing.md'), read('variants/monolith/stubs/routing.md'));
  write(path.join(dir, 'instructions', 'tool-budget.md'), read('variants/monolith/stubs/tool-budget.md'));
  write(path.join(dir, 'instructions', 'verification-gate.md'), read('variants/monolith/stubs/verification-gate.md'));
  cfg.instructions = [instructionEntry(dir)];
  cfg.default_agent = 'main';

  const deferred = {};
  cfg.mcp = cfg.mcp ?? {};
  for (const name of manifest.deferredMcp) {
    if (cfg.mcp[name]) deferred[name] = cfg.mcp[name];
    delete cfg.mcp[name];
  }
  write(
    path.join(dir, 'mcp.deferred.example.jsonc'),
    `// Per-project MCP for Monolith. The installer does not enable these.\n${JSON.stringify({ mcp: deferred }, null, 2)}\n`,
  );

  const remove = new Set(manifest.removeAgents);
  const kept = new Set(manifest.keptAgents);
  const task = { '*': 'deny' };
  for (const name of [...manifest.keptAgents, ...manifest.overlayAgents]) task[name] = 'allow';

  const mainMd = baseline;
  write(path.join(dir, 'prompts', 'agents', 'main.txt'), mainMd);
  const agents = {
    main: {
      description: 'Primary agent. Reads, writes, and plans. Loads skills on demand and spawns a subagent only for isolated review, parallel investigation, or noisy output.',
      mode: 'primary',
      model: `{env:${manifest.primaryModelEnv}}`,
      prompt: '{file:prompts/agents/main.txt}',
      temperature: 0.3,
      topP: 0.9,
      tools: {
        read: true,
        write: true,
        edit: true,
        bash: true,
        grep: true,
        glob: true,
        skill: true,
        'code-memory_*': true,
      },
      permission: { '*': 'allow', edit: 'allow', write: 'allow', bash: 'allow', task },
    },
  };
  for (const [name, def] of Object.entries(cfg.agent ?? {})) {
    if (remove.has(name) || name === 'main') continue;
    if (manifest.descriptions[name]) def.description = manifest.descriptions[name];
    agents[name] = def;
    if (!kept.has(name) && name !== 'build' && name !== 'plan') {
      console.error(`apply-monolith: unexpected agent left in place: ${name}`);
      process.exit(1);
    }
  }
  for (const name of manifest.keptAgents) {
    if (!agents[name]) {
      console.error(`apply-monolith: missing kept OpenCode agent ${name}`);
      process.exit(1);
    }
  }
  for (const name of manifest.overlayAgents) {
    const md = read(`variants/monolith/agents/${name}.md`);
    write(path.join(dir, 'prompts', 'agents', `${name}.txt`), promptBody(md));
    agents[name] = agentRecord(name, md, manifest.reviewModelEnv);
  }
  cfg.agent = agents;

  const stay = new Set([...manifest.keptAgents, ...manifest.overlayAgents, 'main']);
  for (const def of Object.values(cfg.command ?? {})) {
    if (def && typeof def === 'object' && def.agent && !stay.has(def.agent)) def.agent = 'main';
  }

  write(configPath, `${JSON.stringify(cfg, null, 2)}\n`);
  const command = path.join(dir, 'commands', 'orchestrate.md');
  if (fs.existsSync(path.dirname(command))) {
    write(command, read('variants/monolith/commands/orchestrate.md'));
  }
  copyRecursive(path.join(repo, 'variants/monolith/skills'), path.join(dir, 'skills'));
  write(path.join(dir, '.harness-variant'), 'monolith\n');
  console.log(`apply-monolith: opencode ${dir}`);
}

if (claudeDir) applyClaude(claudeDir);
if (opencodeDir) applyOpencode(opencodeDir);
