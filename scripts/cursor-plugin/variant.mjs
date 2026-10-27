import fs from 'node:fs';
import path from 'node:path';
import { claudeAgent, mdc, modelsSection, tierGuard, tierTable } from './lib.mjs';

export function normalizeVariant(value) {
  const text = String(value ?? '').trim().toLowerCase();
  if (!text) return '';
  if (text === 'monolith' || text === '2') return 'monolith';
  if (text === 'conductor' || text === 'orchestration' || text === '1') return 'conductor';
  const error = new Error(`unknown variant '${value}': use conductor or monolith (orchestration is an alias of conductor)`);
  error.code = 'VARIANT';
  throw error;
}

export function parseBuildArgs(argv) {
  let variantFlag = null;
  let out = null;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--variant' || arg === '--out') {
      const value = argv[i + 1];
      if (!value || value.startsWith('--')) {
        const error = new Error(`${arg} needs a value`);
        error.code = 'VARIANT';
        throw error;
      }
      i += 1;
      if (arg === '--variant') variantFlag = value;
      else out = value;
    } else if (arg.startsWith('--variant=')) variantFlag = arg.slice('--variant='.length);
    else if (arg.startsWith('--out=')) out = arg.slice('--out='.length);
    else {
      const error = new Error(`unknown argument: ${arg}`);
      error.code = 'VARIANT';
      throw error;
    }
  }
  return { variantFlag, out };
}

export function resolveBuildVariant(argv = process.argv.slice(2), env = process.env) {
  const { variantFlag } = parseBuildArgs(argv);
  const raw = variantFlag ?? env.HARNESS_VARIANT ?? '';
  const normalized = normalizeVariant(raw);
  return normalized || 'monolith';
}

export function resolveOutDir(argv, repoDir, pluginName) {
  const { out } = parseBuildArgs(argv);
  if (!out) return path.join(repoDir, 'plugins', pluginName);
  return path.resolve(out);
}

export function variantDescription(id) {
  if (id === 'monolith') {
    return 'Monolith harness for Cursor. The primary agent writes, skills load in this session, and review subagents stay isolated.';
  }
  return 'Conductor routing, specialist agents, skills, commands, rules and MCP servers from the fmflurry harness.';
}

export function readmeCopy(id) {
  if (id === 'monolith') {
    return {
      intro: 'Monolith for Cursor. The primary agent reads, writes, plans, and implements in this session. Nothing has to run before the first edit. Load a skill for the work, and spawn a subagent only for isolated review, parallel investigation, or noisy output. `/orchestrate` is optional.\n\nThis build is Monolith. `./install-cursor.sh --variant conductor` (or `HARNESS_VARIANT=conductor`) builds the conductor-led plugin instead.',
      agentsBlurb: 'Review and noisy-output subagents. Folded roles load as skills. The primary agent writes',
      skillsBlurb: 'Reusable skills, including the `threejs` and `openspec` umbrellas and an optional `conductor` skill for `/orchestrate`',
      rulesBlurb: 'Always-on Monolith baseline. The primary agent may write. There is no first-tool gate. TypeScript rules apply on matching files',
      dispatchLead: 'Subagents carry `tier:` and no `model:` in their frontmatter. The primary agent passes the tier\'s Cursor model on every `Task` call.',
      limits: [
        '- Cursor has no per-agent tool allowlist: agents can only be marked `readonly`.',
        '- The primary agent is allowed to write. Delegation is by instruction only.',
        '- Notification hooks are unsupported.',
        '- In cloud or grokbot environments CodeMemory is skipped. Set `FMFLURRY_CODEMEMORY=on` to force it. Hooks no-op quietly when it is off, and they let actions through when a dependency is missing.',
      ].join('\n'),
    };
  }
  return {
    intro: 'A conductor that routes every task to the matching specialist subagent (planner, coder, reviewers, git, database, E2E and more), bundled with the skills, rules, commands, hooks and the code-memory MCP server that support it.\n\nThis build is Conductor. `./install-cursor.sh` with no variant builds Monolith.',
    agentsBlurb: 'Specialist subagents the conductor delegates to',
    skillsBlurb: 'Reusable skills, including a `conductor` skill carrying the routing rules',
    rulesBlurb: 'Always-on baseline plus the conductor routing rule; TypeScript rules apply on matching files',
    dispatchLead: 'Subagents carry `tier:` and no `model:` in their frontmatter. The conductor passes the tier\'s Cursor model on every `Task` call.',
    limits: [
      '- Cursor has no per-agent tool allowlist: agents can only be marked `readonly`.',
      '- Conductor routing is by instruction only; nothing enforces delegation.',
      '- Notification hooks are unsupported.',
      '- In cloud or grokbot environments CodeMemory is skipped. Set `FMFLURRY_CODEMEMORY=on` to force it. Hooks no-op quietly when it is off, and they let actions through when a dependency is missing.',
    ].join('\n'),
  };
}

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

function write(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text.endsWith('\n') ? text : `${text}\n`);
}

function replaceDescription(text, description) {
  const line = `description: ${JSON.stringify(description)}`;
  if (!/^description:/m.test(text)) throw new Error('agent is missing description');
  return text.replace(/^description:.*$/m, line);
}

export function configForInstalledAgents(config, out) {
  const names = new Set(
    fs.readdirSync(path.join(out, 'agents'))
      .filter((name) => name.endsWith('.md'))
      .map((name) => name.slice(0, -3)),
  );
  return {
    ...config,
    agentTiers: Object.fromEntries(
      Object.entries(config.agentTiers).map(([tier, list]) => [tier, list.filter((name) => names.has(name))]),
    ),
  };
}

export function applyCursorMonolith(out, repo, config) {
  const manifest = JSON.parse(read(path.join(repo, 'variants/monolith/manifest.json')));
  const agentsDir = path.join(out, 'agents');
  const stay = new Set([...manifest.keptAgents, ...manifest.overlayAgents]);
  for (const file of fs.readdirSync(agentsDir).filter((name) => name.endsWith('.md'))) {
    if (!stay.has(file.slice(0, -3))) fs.rmSync(path.join(agentsDir, file));
  }

  const assertTiered = tierGuard(config);
  for (const name of manifest.overlayAgents) {
    const agent = claudeAgent(read(path.join(repo, 'variants/monolith/agents', `${name}.md`)), assertTiered);
    write(path.join(agentsDir, `${agent.name}.md`), agent.out);
  }
  for (const name of manifest.keptAgents) {
    const file = path.join(agentsDir, `${name}.md`);
    if (!fs.existsSync(file)) throw new Error(`monolith cursor build missing kept agent ${name}`);
    write(file, replaceDescription(read(file), manifest.descriptions[name]));
  }
  for (const file of fs.readdirSync(agentsDir).filter((name) => name.endsWith('.md'))) {
    const full = path.join(agentsDir, file);
    write(full, read(full).replaceAll(
      'the conductor passes the Cursor model on Task',
      'the primary agent passes the Cursor model on Task',
    ));
  }

  write(
    path.join(out, 'skills/conductor/SKILL.md'),
    read(path.join(repo, 'variants/monolith/skills/conductor/SKILL.md')),
  );
  write(path.join(out, 'commands/orchestrate.md'), read(path.join(repo, 'variants/monolith/commands/orchestrate.md')));

  const rules = path.join(out, 'rules');
  const stubs = [
    ['orchestration.mdc', 'variants/monolith/stubs/routing.md', 'Monolith routing. The primary agent may write. There is no first-tool gate.'],
    ['tool-budget.mdc', 'variants/monolith/stubs/tool-budget.md', 'Tool budget hook. Load the tool-budget skill.'],
    ['verification-gate.mdc', 'variants/monolith/stubs/verification-gate.md', 'Verification gate hook. Load the verification-gate skill.'],
  ];
  for (const [name, rel, description] of stubs) {
    write(path.join(rules, name), mdc({ description, globs: '', alwaysApply: true }, read(path.join(repo, rel))));
  }
  fs.rmSync(path.join(rules, 'conductor.mdc'), { force: true });
  const installed = configForInstalledAgents(config, out);
  const baseline = read(path.join(repo, 'variants/monolith/AGENTS.md')).replace(/\n*$/, '\n');
  write(path.join(rules, 'monolith.mdc'), mdc(
    { description: 'Monolith: the primary agent writes. Optional /orchestrate.', alwaysApply: true },
    `${baseline}\n${modelsSection(installed)}`,
  ));
  return installed;
}

export function readmeValues(variant, config, out, counts) {
  const copy = readmeCopy(variant);
  const tierSource = variant === 'monolith' ? configForInstalledAgents(config, out) : config;
  return {
    ...counts,
    ...copy,
    tierTable: tierTable(tierSource),
    version: config.version,
  };
}
