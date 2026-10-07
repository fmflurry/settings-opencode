import fs from 'node:fs';
import path from 'node:path';

export function parseJsonc(text) {
  const stripped = text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:"])\/\/[^\n]*/g, '$1')
    .replace(/,(\s*[}\]])/g, '$1');
  return JSON.parse(stripped);
}

export function fromOpencode(cfg) {
  if (cfg.enabled === false) return null;
  if (cfg.type === 'remote' && cfg.url) {
    const out = { url: cfg.url };
    if (cfg.headers && Object.keys(cfg.headers).length) out.headers = cfg.headers;
    return out;
  }
  if (cfg.type === 'local' && Array.isArray(cfg.command) && cfg.command.length) {
    const out = { command: cfg.command[0], args: cfg.command.slice(1) };
    if (cfg.environment) out.env = cfg.environment;
    return out;
  }
  return null;
}

export function buildMcp(opencodeCfg) {
  const mcpServers = {};
  for (const [name, cfg] of Object.entries(opencodeCfg.mcp ?? {})) {
    const server = fromOpencode(cfg);
    if (server) mcpServers[name] = server;
  }
  return { mcpServers };
}

export function splitFrontmatter(text) {
  const m = text.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/);
  if (!m) return { fm: {}, body: text };
  const fm = {};
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (kv) fm[kv[1]] = kv[2].trim();
  }
  return { fm, body: text.slice(m[0].length) };
}

export function unquote(v) {
  if (v === undefined) return '';
  if (/^".*"$/.test(v)) return JSON.parse(v);
  if (/^'.*'$/.test(v)) return v.slice(1, -1).replace(/''/g, "'");
  return v;
}

function toolList(v) {
  if (v === undefined) return null;
  return v.replace(/^\[|\]$/g, '').split(',').map((t) => unquote(t.trim())).filter(Boolean);
}

const WRITE_TOOLS = ['Write', 'Edit'];
const MUTATING_TOOLS = [...WRITE_TOOLS, 'Bash'];

export function isReadonly({ tools, disallowedTools }) {
  const denied = toolList(disallowedTools) ?? [];
  if (WRITE_TOOLS.some((t) => denied.includes(t))) return true;
  const allowed = toolList(tools);
  return allowed !== null && !MUTATING_TOOLS.some((t) => allowed.includes(t));
}

export function emitAgent({ name, description, readonly }, body) {
  return [
    '---',
    `name: ${name}`,
    `description: ${JSON.stringify(description)}`,
    `readonly: ${readonly}`,
    '---',
    '',
  ].join('\n') + body;
}

export function tierGuard(config) {
  const byAgent = new Map();
  for (const [tier, names] of Object.entries(config.agentTiers)) {
    if (!(tier in config.defaultTierModels)) throw new Error(`agentTiers: unknown tier "${tier}"`);
    for (const name of names) {
      if (byAgent.has(name)) throw new Error(`agent "${name}" is in several tiers (${byAgent.get(name)}, ${tier})`);
      byAgent.set(name, tier);
    }
  }
  return (name) => {
    if (!byAgent.has(name)) throw new Error(`agent "${name}" is in no tier of agentTiers`);
  };
}

export function claudeAgent(text, assertTiered) {
  const { fm, body } = splitFrontmatter(text);
  assertTiered(unquote(fm.name));
  return {
    name: unquote(fm.name),
    out: emitAgent(
      { name: unquote(fm.name), description: unquote(fm.description), readonly: isReadonly(fm) },
      body,
    ),
  };
}

function resolvePrompt(repoDir, placeholder) {
  if (!placeholder) return null;
  const m = placeholder.match(/\{(.+?)\}/);
  const rel = m ? m[1] : placeholder;
  const candidates = [
    path.join(repoDir, rel.replace(/^\.config\/opencode\//, '')),
    path.join(repoDir, rel),
  ];
  return candidates.find((c) => fs.existsSync(c)) ?? null;
}

export function opencodeAgent(repoDir, name, def, assertTiered) {
  const promptPath = resolvePrompt(repoDir, def.prompt);
  if (!promptPath) throw new Error(`opencode agent ${name}: prompt not found (${def.prompt})`);
  assertTiered(name);
  const tools = def.tools ?? {};
  return emitAgent(
    {
      name,
      description: def.description ?? '',
      readonly: tools.write === false && tools.edit === false,
    },
    fs.readFileSync(promptPath, 'utf8'),
  );
}

export function slug(s) {
  return s.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase();
}

export function mdc({ description, globs, alwaysApply }, body) {
  const lines = ['---', `description: ${JSON.stringify(description)}`];
  if (globs) lines.push(`globs: ${JSON.stringify(globs)}`);
  lines.push(`alwaysApply: ${alwaysApply}`, '---', '');
  return lines.join('\n') + body;
}

export function firstHeading(body, fallback) {
  const m = body.match(/^#\s+(.+)$/m);
  return m ? m[1].trim() : fallback;
}

export function globsFromPaths(text) {
  const m = text.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!m) return '';
  return [...m[1].matchAll(/^\s*-\s*"?([^"\n]+?)"?\s*$/gm)].map((x) => x[1]).join(',');
}

export function walkMd(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walkMd(full, out);
    else if (e.name.endsWith('.md')) out.push(full);
  }
  return out;
}

const CURSOR_NOTE =
  'Cursor cannot block the primary agent from writing; routing is by instruction, not enforcement.';

export const SETUP_RULE_FILE = 'fmflurry-harness-models.mdc';

const TIER_USE = {
  coding: 'implementation, tests, build fixes',
  smart: 'planning, architecture, review, security; expensive, so dispatch it only when needed',
  cheap: 'git, codebase search, docs, comment triage',
};

export function tierTable(config) {
  return [
    '| Tier | Default slug | Use | Agents |',
    '| --- | --- | --- | --- |',
    ...Object.entries(config.agentTiers).map(
      ([tier, names]) => `| ${tier} | \`${config.defaultTierModels[tier]}\` | ${TIER_USE[tier]} | ${names.join(', ')} |`,
    ),
  ].join('\n');
}

export function modelsSection(config) {
  const d = config.defaultTierModels;
  return [
    '## Models',
    '',
    `- Every \`Task\` dispatch MUST pass \`model\` = the slug for the target agent's tier. Subagents carry no model of their own.`,
    `- Read the tier slugs from the \`${SETUP_RULE_FILE.replace('.mdc', '')}\` rule if present. Otherwise use the defaults (coding \`${d.coding}\`, smart \`${d.smart}\`, cheap \`${d.cheap}\`).`,
    '- When a tier value is `inherit` or `auto`, omit `model` from the `Task` call.',
    '- If `Task` rejects a slug, retry with the tier default and say so. If the default is rejected too, use the closest valid slug of the same family from the error message, preferring the highest effort.',
    '- Escalation: you may dispatch a cheap- or coding-tier agent with the smart slug when a task proves harder than expected; say so.',
    "- The primary agent's model is chosen by the user in Cursor's model picker (Grok 4.7 xhigh recommended); a plugin can't set it.",
    '- Cloud agents and grokbot may not receive user rules, in which case the defaults apply.',
    '- Suggest running `/setup-harness` once after install to detect available models and write the tier rule.',
    '',
    tierTable(config),
    '',
  ].join('\n');
}

export function setupSkill(template, config) {
  const d = config.defaultTierModels;
  const values = {
    ruleFile: SETUP_RULE_FILE,
    tierTable: tierTable(config),
    codingDefault: d.coding,
    smartDefault: d.smart,
    cheapDefault: d.cheap,
  };
  return template.replace(/\{\{(\w+)\}\}/g, (_, k) => values[k]);
}

export function conductorRuleBody(conductorMd, config) {
  const { body } = splitFrontmatter(conductorMd);
  const translated = body
    .replace(/^> Harness note:.*$/m, `> ${CURSOR_NOTE} Delegate with the \`Task\` tool (set \`subagent_type\` to the specialist name); ask the user directly when a load-bearing fact is missing.`)
    .replace(/`AskUserQuestion`/g, 'ask the user')
    .replace(/`Agent`/g, '`Task`')
    .replace(/\bAgent calls?\b/g, (s) => s.replace('Agent', 'Task'));
  return `${translated.replace(/\n*$/, '\n')}\n${modelsSection(config)}`;
}

export function conductorSkill(config) {
  return [
    '---',
    'name: conductor',
    'description: "Adopt the conductor routing role: route every task to the matching specialist subagent via the Task tool instead of doing the work directly."',
    'disable-model-invocation: true',
    '---',
    '',
    '# Conductor',
    '',
    'Adopt the conductor routing rule (`conductor` rule, always loaded) for this session.',
    'Route each task to the matching specialist with the `Task` tool (`subagent_type` = specialist name) before doing any exploration yourself.',
    '',
    CURSOR_NOTE,
    '',
    modelsSection(config),
  ].join('\n');
}

export function stripAtImports(body) {
  return body.replace(/^@\S+[ \t]*\n/gm, '').replace(/\n{3,}/g, '\n\n');
}

export function sanitize(text, repoDir) {
  const repoName = repoDir.split('/').pop().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const authorCheckout = new RegExp(`/(?:Users|home)/[^/\\s"'\`)]+/Workspace/${repoName}(?![\\w-])`, 'g');
  return text.split(repoDir).join('<repo>').replace(authorCheckout, '<repo>').replace(/\/Users\/[^/\s"'`)]+/g, '/home/user');
}

const HOOK_EVENT_MAP = { PreToolUse: 'preToolUse', Stop: 'stop', SubagentStop: 'subagentStop' };
const CURSOR_TOOL = {
  Bash: 'Shell', Edit: 'Write', MultiEdit: 'Write', Write: 'Write', Read: 'Read', Grep: 'Grep', Task: 'Task', Agent: 'Task',
};
export const HOOK_SCRIPTS_DIR = '${CURSOR_PLUGIN_ROOT}/hooks/scripts';

// '' = match every tool; null = no Cursor tool equivalent, so the hook is dropped.
export function cursorMatcher(claudeMatcher) {
  if (!claudeMatcher || claudeMatcher === '*') return '';
  const tools = [...new Set(claudeMatcher.split('|').map((t) => CURSOR_TOOL[t]).filter(Boolean))];
  return tools.length ? tools.join('|') : null;
}

export function buildHooks(settings, include) {
  const hooks = {};
  const scripts = new Set();
  for (const [claudeEvent, entries] of Object.entries(settings.hooks ?? {})) {
    const event = HOOK_EVENT_MAP[claudeEvent];
    if (!event) continue;
    for (const entry of entries) {
      const matcher = cursorMatcher(entry.matcher);
      if (matcher === null) continue;
      for (const h of entry.hooks ?? []) {
        if (h.type !== 'command' || !h.command) continue;
        const script = path.basename(h.command);
        if (!include.includes(script)) continue;
        const hook = { command: `${HOOK_SCRIPTS_DIR}/cursor-adapter.sh ${HOOK_SCRIPTS_DIR}/${script} ${event}` };
        if (matcher) hook.matcher = matcher;
        if (typeof h.timeout === 'number') hook.timeout = h.timeout;
        (hooks[event] ??= []).push(hook);
        scripts.add(script);
      }
    }
  }
  const missing = include.filter((s) => !scripts.has(s));
  if (missing.length) throw new Error(`hooks.include not wired in .claude/settings.json: ${missing.join(', ')}`);
  return { json: { version: 1, hooks }, scripts: [...scripts] };
}

const PORTABLE_STATE = '${TMPDIR:-/tmp}/fmflurry-harness';

export function portableHookScript(text) {
  return text
    .replaceAll('$HOME/.claude/state/notify', `${PORTABLE_STATE}/state/notify`)
    .replaceAll('$HOME/.claude/session-env', `${PORTABLE_STATE}/session-env`)
    .replaceAll('"$HOME/.claude/scripts" "$HOME/.config/opencode/scripts" ', '');
}
