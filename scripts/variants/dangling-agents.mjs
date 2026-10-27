// Monolith must not dispatch to agents the variant does not install.
// Conductor sources stay as they are. This module rewrites install output and scans it.
import fs from 'node:fs';
import path from 'node:path';

const SKILL_FOR = {
  conductor: 'conductor',
  scout: 'scout',
  planner: 'planner',
  coder: 'coder',
  writer: 'writer',
  'doc-updater': 'doc-updater',
  'tdd-guide': 'tdd',
  'git-specialist': 'git-workflow',
  architect: 'architect',
  'api-spec-architect': 'api-spec-openapi',
  'gdpr-specialist': 'gdpr-compliance',
  gaudi: 'gaudi',
  'refactor-cleaner': 'refactor-cleaner',
  'angular-cop': 'angular-cop',
  'dotnet-cop': 'dotnet-cop',
  'haruspex-commentorum': 'comment-judge',
  'why-synthesizer': 'why',
};

const TEXT_EXT = new Set(['.md', '.mdc', '.txt', '.json', '.jsonc']);

export function installedAgentNames(manifest) {
  return new Set([...manifest.keptAgents, ...manifest.overlayAgents, 'main']);
}

export function removedAgentNames(manifest) {
  const installed = installedAgentNames(manifest);
  return manifest.removeAgents.filter((name) => !installed.has(name));
}

export function remapAgentName(name, manifest) {
  if (installedAgentNames(manifest).has(name)) return name;
  if (name === 'postgres-dba') return 'database-reviewer';
  return 'main';
}

export function inlinePhrase(name) {
  if (name === 'postgres-dba') return '`database-reviewer`';
  if (name === 'angular-cop' || name === 'dotnet-cop') {
    return `If \`${name}\` is installed, dispatch to that agent. Otherwise dispatch to \`cop\` when that agent is installed (it loads the \`${name}\` skill). Otherwise the main agent loads the \`${name}\` skill and does the work inline`;
  }
  if (name === 'haruspex-commentorum') {
    return 'If `haruspex-commentorum` is installed, dispatch to that agent. Otherwise dispatch to `comment-judge` with `persona=haruspex`';
  }
  if (name === 'why-synthesizer') {
    return 'If `why-synthesizer` is installed, dispatch to that agent. Otherwise synthesize in this session';
  }
  if (name === 'conductor') {
    return '`conductor` is not installed. Do this in the primary session and load the `conductor` skill when coordinating';
  }
  const skill = SKILL_FOR[name] || name;
  return `\`${name}\` is not installed. The main agent does this inline and loads the \`${skill}\` skill`;
}

function escapeReg(name) {
  return name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function word(name) {
  return new RegExp(`(?:^|[^A-Za-z0-9_-])${escapeReg(name)}(?![A-Za-z0-9_-])`);
}

export function namesInLine(line, manifest) {
  return removedAgentNames(manifest).filter((name) => word(name).test(line));
}

function backtickNames(line) {
  return [...line.matchAll(/`([A-Za-z][A-Za-z0-9_-]*)`/g)].map((match) => match[1]);
}

function dispatchVerb(line) {
  return /\b(?:dispatch(?:es|ed|ing)?|delegat(?:e|es|ed|ing)|rout(?:e|es|ing)|spawn(?:s|ed|ing)?|handoffs?|\bhand\b|\bvia\b|\bthrough\b|\buse\b)\b/i.test(line);
}

export function allowedLine(line) {
  if (/\bif\b/i.test(line) && /\binstalled\b/i.test(line)) return true;
  if (/\b(?:not installed|aren't installed|are not installed|is not installed|folded agents)\b/i.test(line)) return true;
  if (/\b(?:do not|don't|never)\s+(?:spawn|delegate|dispatch|route|invoke)\b/i.test(line)) return true;
  if (/loads? the `conductor` skill/i.test(line) && !/subagent_type|^\s*agent:/i.test(line)) return true;
  return false;
}

function skillList(line, names) {
  if (dispatchVerb(line)) return false;
  const ticks = backtickNames(line);
  if (ticks.length < 2) return false;
  return names.every((name) => ticks.includes(name));
}

function targetPattern(name) {
  const n = escapeReg(name);
  const quoted = `[\`\\"']?${n}[\`\\"']?`;
  return [
    new RegExp(String.raw`^\s*agent:\s*${n}\s*$`),
    new RegExp(String.raw`"agent"\s*:\s*"${n}"`),
    new RegExp(String.raw`subagent_type\s*:\s*[\`\\"']?${n}\b`),
    new RegExp(String.raw`\`Agent\`\s*→\s*\`${n}\``),
    new RegExp(String.raw`\b(?:dispatch(?:es|ed|ing)?|delegat(?:e|es|ed|ing)|rout(?:e|es|ing)|spawn(?:s|ed|ing)?|handoffs?)(?:\s+\w+){0,6}\s+(?:to\s+)?(?:the\s+)?(?:dedicated\s+)?${quoted}\b`, 'i'),
    new RegExp(String.raw`\bhand\s+(?:the\s+\w+\s+)?to\s+${quoted}\b`, 'i'),
    new RegExp(String.raw`\bvia\s+the\s+${quoted}\b`, 'i'),
    new RegExp(String.raw`\bvia\s+${quoted}\s+(?:agent|subagent|workflow)\b`, 'i'),
    new RegExp(String.raw`\bthrough\s+${quoted}\b`, 'i'),
    new RegExp(String.raw`\buse\s+(?:the\s+)?(?:\*\*)?${quoted}(?:\*\*)?(?:\s+agent|\s+workflow)?\b`, 'i'),
    new RegExp(String.raw`\b(?:task|Task)\s+(?:→\s*)?${quoted}\b`),
    new RegExp(String.raw`${quoted}[^|\n]{0,40}\bdispatch\b`, 'i'),
  ];
}

export function commandLineHits(line, manifest) {
  if (allowedLine(line)) return [];
  const names = namesInLine(line, manifest);
  if (!names.length) return [];
  if (/^>\s*CC:/.test(line) && /\b(?:delegat\w*|spawns?|orchestrat\w*)\b/i.test(line)) {
    return names.map((name) => ({ name }));
  }
  if (skillList(line, names)) return [];
  return names.filter((name) => targetPattern(name).some((pattern) => pattern.test(line))).map((name) => ({ name }));
}

function replacePhrases(line, name) {
  const n = escapeReg(name);
  const phrase = inlinePhrase(name);
  const agentTail = '(?:\\s+agent|\\s+subagent)?(?:\\s*\\(sonnet\\))?';
  const patterns = [
    new RegExp(String.raw`\bdelegat\w*(?:\s+\w+){0,10}\s+to\s+(?:the\s+)?\`?${n}\`?${agentTail}`, 'gi'),
    new RegExp(String.raw`\b(?:dispatch(?:es)?|spawn(?:s)?|handoffs?)\s+(?:this\s+)?(?:to\s+)?(?:the\s+)?\`?${n}\`?${agentTail}`, 'gi'),
    new RegExp(String.raw`\bhand\s+(?:the\s+\w+\s+)?to\s+\`?${n}\`?`, 'gi'),
    new RegExp(String.raw`\bvia\s+the\s+\`?${n}\`?`, 'gi'),
    new RegExp(String.raw`\bvia\s+\`?${n}\`?\s+(?:agent|subagent|workflow)`, 'gi'),
    new RegExp(String.raw`\bthrough\s+\`?${n}\`?`, 'gi'),
    new RegExp(String.raw`\buse\s+\`${n}\`(?:\s+workflow)?`, 'gi'),
    new RegExp(String.raw`\brout\w*\s+(?:to\s+)?(?:the\s+)?\`?${n}\`?${agentTail}`, 'gi'),
    new RegExp('subagent_type:\\s*[`"\']' + n + '[`"\']', 'g'),
    new RegExp(String.raw`subagent_type:\s*${n}\b`, 'g'),
    new RegExp(String.raw`\bfor the\s+\`${n}\`\s+agent`, 'g'),
    new RegExp(String.raw`per the\s+\`${n}\`\s+agent specification`, 'g'),
    new RegExp(String.raw`\`Agent\`\s*→\s*\`${n}\``, 'g'),
  ];
  let edited = line;
  for (const pattern of patterns) edited = edited.replace(pattern, phrase);
  return edited;
}

function rewriteFrontmatterAgent(text, manifest) {
  return text.replace(/^(---\r?\n[\s\S]*?\r?\n---)/, (front) => front.replace(
    /^agent:\s*(\S+)\s*$/m,
    (_, name) => `agent: ${remapAgentName(name, manifest)}`,
  ));
}

function rewriteKnownClauses(line) {
  return line
    .replace(
      /handoffs to `coder` via the conductor/g,
      'handoffs. If `coder` is installed, hand the repo change to that agent. Otherwise the main agent loads the `coder` skill and writes it inline',
    )
    .replace(
      /Routing to the `api-spec-architect` subagent is handled by the `agent:` field on this command in `opencode\.jsonc` — no manual delegation needed\./g,
      `${inlinePhrase('api-spec-architect')}.`,
    )
    .replace(
      /\(\.NET via `dotnet-cop`, Angular via `angular-cop`, or both\)/g,
      'for .NET and Angular. If `dotnet-cop` or `angular-cop` is installed, that agent reviews its stack. Otherwise dispatch to `cop` when that agent is installed (it loads the matching skill). Otherwise the main agent loads the matching skill and reviews inline',
    );
}

function rewriteCommandLine(line, manifest) {
  const prepared = rewriteKnownClauses(line);
  if (prepared !== line && !commandLineHits(prepared, manifest).length) return prepared;
  line = prepared;
  if (!commandLineHits(line, manifest).length) return line;
  if (/^>\s*CC:/.test(line)) {
    const names = [...new Set(commandLineHits(line, manifest).map((hit) => hit.name))];
    const extra = /\bwhy-investigator\b/.test(line)
      ? 'Spawn `why-investigator` for each evidence category. '
      : '';
    return `> ${extra}${names.map((name) => inlinePhrase(name)).join(' ')}`;
  }
  let edited = line;
  for (const name of removedAgentNames(manifest)) {
    if (!word(name).test(edited)) continue;
    edited = replacePhrases(edited, name);
    if (!commandLineHits(edited, manifest).length) return edited;
  }
  if (!commandLineHits(edited, manifest).length) return edited;
  const names = [...new Set(commandLineHits(line, manifest).map((hit) => hit.name))];
  return names.map((name) => inlinePhrase(name)).join(' ');
}

export function rewriteCommandText(text, manifest) {
  const withDba = text.replaceAll('postgres-dba', 'database-reviewer');
  const withAgent = rewriteFrontmatterAgent(withDba, manifest);
  return withAgent.split('\n').map((line) => rewriteCommandLine(line, manifest)).join('\n');
}

export function rewriteCommandTree(root, manifest) {
  if (!root || !fs.existsSync(root)) return;
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name.endsWith('.md')) {
        const text = fs.readFileSync(full, 'utf8');
        const next = rewriteCommandText(text, manifest);
        if (next !== text) fs.writeFileSync(full, next.endsWith('\n') ? next : `${next}\n`);
      }
    }
  };
  walk(root);
}

export function scanText(text, manifest, file = '') {
  const hits = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    for (const hit of commandLineHits(lines[i], manifest)) {
      hits.push({ file, line: i + 1, name: hit.name, text: lines[i].trim().slice(0, 180) });
    }
  }
  return hits;
}

function skipRelative(rel, manifest) {
  const norm = rel.replaceAll('\\', '/');
  if (norm === 'agent-sources' || norm.startsWith('agent-sources/') || norm.includes('/agent-sources/')) return true;
  const prompt = norm.match(/(?:^|\/)prompts\/agents\/([^/]+)\.txt$/);
  if (prompt && !installedAgentNames(manifest).has(prompt[1])) return true;
  return false;
}

export function scanMonolithTree(root, manifest) {
  const hits = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      const full = path.join(dir, entry.name);
      const rel = path.relative(root, full);
      if (skipRelative(rel, manifest)) continue;
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && TEXT_EXT.has(path.extname(entry.name))) {
        const text = fs.readFileSync(full, 'utf8');
        for (const hit of scanText(text, manifest, rel)) hits.push(hit);
      }
    }
  };
  if (fs.existsSync(root)) walk(root);
  return hits;
}

export function formatHits(hits) {
  return hits.map((hit) => `${hit.file}:${hit.line}: ${hit.name}: ${hit.text}`).join('\n');
}
