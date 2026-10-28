import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { formatDuration, readEvents } from './kpi-report.mjs';

export const IDLE_GAP_MIN = 5;
export const TOP_N = 8;
const DAY_MS = 24 * 60 * 60 * 1000;
const HOSTS = ['cursor', 'claude', 'opencode'];
const SPAWN_TOOL = /^(task|agent)$/i;
const LEAK = /(?:^|[^A-Za-z0-9._-])(?:\/(?:home|Users|opt|var|tmp|private|workspace)\/|~\/|[A-Za-z]:\\)|https?:\/\//i;

export function leaksPath(text) {
  return LEAK.test(String(text));
}

function cleanRepo(value) {
  if (typeof value !== 'string' || value.length > 200 || value.includes('..')) return null;
  if (!/^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)?$/.test(value)) return null;
  return value;
}

function cleanBranch(value) {
  if (typeof value !== 'string' || value.length > 200 || value.includes('..')) return null;
  if (value.startsWith('/') || value.includes('\\')) return null;
  if (!/^[A-Za-z0-9._/-]+$/.test(value)) return null;
  return value;
}

function cleanTool(value) {
  return typeof value === 'string' && /^[A-Za-z0-9._:-]{1,64}$/.test(value) ? value : null;
}

function cleanSkill(value) {
  return typeof value === 'string' && /^[a-z0-9:-]{1,64}$/.test(value) ? value : null;
}

function cleanAgent(value) {
  return typeof value === 'string' && /^[A-Za-z0-9._:-]{1,64}$/.test(value) ? value : null;
}

function cleanSession(value) {
  if (typeof value !== 'string' || value === 'unknown') return null;
  return /^[A-Za-z0-9._:@+-]{1,200}$/.test(value) ? value : null;
}

function cleanHost(value) {
  return HOSTS.includes(value) ? value : null;
}

function cleanGuard(value) {
  return value === 'git' || value === 'ask' || value === 'secret' || value === 'budget' || value === 'pr-visual-report' ? value : null;
}

function cleanStamp(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value) ? value : null;
}

function finite(value, max) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > max) return null;
  return value;
}

function int(value, max) {
  const n = finite(value, max);
  if (n == null || !Number.isInteger(n)) return null;
  return n;
}

function topCounts(map, limit = TOP_N) {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([name, count]) => ({ name, count }));
}

function bump(map, key) {
  if (!key) return;
  map.set(key, (map.get(key) ?? 0) + 1);
}

// Spawn on the parent session (Claude Task) must not label that session as the child.
// A stop on the same session, or a spawn with no stop elsewhere, is the child session.
function childSessions(events) {
  const spawned = new Map();
  const stopped = new Map();
  for (const event of events) {
    const agent = cleanAgent(event.agent);
    const session = cleanSession(event.session_id);
    if (!agent || !session) continue;
    if (event.kind === 'subagent_spawn') spawned.set(session, agent);
    else if (event.kind === 'subagent_stop') stopped.set(session, agent);
  }
  const children = new Map();
  for (const [session, agent] of spawned) {
    if (stopped.has(session)) {
      children.set(session, stopped.get(session));
      continue;
    }
    const stoppedElsewhere = [...stopped.entries()].some(([id, name]) => id !== session && name === agent);
    if (!stoppedElsewhere) children.set(session, agent);
  }
  for (const [session, agent] of stopped) children.set(session, agent);
  return children;
}

function callOwner(event, children) {
  const session = cleanSession(event.session_id);
  if (session && children.has(session)) return children.get(session);
  const agent = cleanAgent(event.agent);
  const tool = cleanTool(event.tool_name);
  if (agent && !(tool && SPAWN_TOOL.test(tool))) return agent;
  return 'main';
}

export function selectFeature(events, options = {}) {
  const repo = options.repo ?? null;
  const requestedPr = Number.isInteger(options.pr) ? options.pr : null;
  let branch = options.branch ?? null;
  let rows = events.filter((event) => event && typeof event === 'object' && !Array.isArray(event));
  if (repo) rows = rows.filter((event) => event.repo === repo);
  if (!branch && requestedPr != null) {
    const found = [];
    for (const event of rows) {
      if (event.pr !== requestedPr) continue;
      const name = cleanBranch(event.branch);
      if (name && !found.includes(name)) found.push(name);
    }
    if (found.length === 1) branch = found[0];
  }
  if (branch) rows = rows.filter((event) => event.branch === branch);
  if (requestedPr != null && branch) {
    rows = rows.filter((event) => event.pr == null || event.pr === requestedPr);
  } else if (requestedPr != null) {
    rows = rows.filter((event) => event.pr === requestedPr);
  }
  const prs = [];
  for (const event of rows) {
    if (Number.isInteger(event.pr) && event.pr > 0 && event.pr < 1e9 && !prs.includes(event.pr)) prs.push(event.pr);
  }
  prs.sort((a, b) => a - b);
  let pr = requestedPr;
  if (pr == null && prs.length) {
    const stamped = rows.filter((event) => Number.isInteger(event.pr) && prs.includes(event.pr));
    stamped.sort((a, b) => Date.parse(a.ts || '') - Date.parse(b.ts || ''));
    pr = stamped.length ? stamped[stamped.length - 1].pr : prs[prs.length - 1];
  }
  return { repo, branch, pr, prs, events: rows };
}

function summarise(selected, gapMin) {
  const events = selected.events;
  const children = childSessions(events);
  const tools = new Map();
  const skills = new Map();
  const calls = new Map();
  const spawns = new Map();
  const failures = new Map();
  const sessions = new Map(HOSTS.map((host) => [host, new Set()]));
  const guards = new Map();
  const tokenByKey = new Map();
  let failureCount = 0;
  let guardCount = 0;
  let review = 0;
  let fix = 0;
  let durationSum = 0;
  let durationN = 0;
  let durationMax = 0;
  const reviewFallback = [];
  const fixFallback = [];
  const times = [];

  for (const event of events) {
    const at = Date.parse(event.ts ?? '');
    if (Number.isFinite(at)) times.push({ at, ts: cleanStamp(event.ts) });
    const host = cleanHost(event.tool);
    const session = cleanSession(event.session_id);
    if (host && session) sessions.get(host).add(session);
    if (event.kind === 'tool_call') {
      bump(tools, cleanTool(event.tool_name));
      bump(skills, cleanSkill(event.skill));
      bump(calls, callOwner(event, children));
    } else if (event.kind === 'tool_result') {
      if (event.ok === false) {
        failureCount += 1;
        bump(failures, cleanTool(event.tool_name));
      }
      const duration = finite(event.duration_ms, DAY_MS - 1);
      if (duration != null) {
        durationSum += duration;
        durationN += 1;
        if (duration > durationMax) durationMax = duration;
      }
    } else if (event.kind === 'subagent_spawn') {
      bump(spawns, cleanAgent(event.agent));
    } else if (event.kind === 'guard_block') {
      guardCount += 1;
      bump(guards, cleanGuard(event.guard));
    } else if (event.kind === 'review_round') {
      review += 1;
    } else if (event.kind === 'fix_round') {
      fix += 1;
    }
    if ((event.kind === 'session_end' || event.kind === 'subagent_stop') && session) {
      const tokens = int(event.tokens, 1e12);
      if (tokens != null) tokenByKey.set(`${event.kind}:${session}`, tokens);
    }
    const reviewN = int(event.review_rounds, 10000);
    if (reviewN != null) reviewFallback.push(reviewN);
    const fixN = int(event.fix_iterations, 10000);
    if (fixN != null) fixFallback.push(fixN);
  }

  for (const [agent, count] of spawns) {
    if (!calls.has(agent)) calls.set(agent, count);
  }
  if (!calls.has('main')) calls.set('main', 0);

  times.sort((a, b) => a.at - b.at);
  let wall = null;
  let active = null;
  if (times.length === 1) {
    wall = 0;
    active = 0;
  } else if (times.length > 1) {
    wall = times[times.length - 1].at - times[0].at;
    const limit = gapMin * 60 * 1000;
    active = 0;
    for (let i = 1; i < times.length; i += 1) {
      const gap = times[i].at - times[i - 1].at;
      if (gap <= limit) active += gap;
    }
  }
  if (review === 0 && reviewFallback.length) review = Math.max(...reviewFallback);
  if (fix === 0 && fixFallback.length) fix = Math.max(...fixFallback);

  const repo = cleanRepo(selected.repo);
  const branch = cleanBranch(selected.branch);
  const pr = int(selected.pr, 1e9 - 1);
  const partial = events.length === 0 || !repo || !branch || times.length === 0;
  const sessionCounts = {};
  for (const host of HOSTS) sessionCounts[host] = sessions.get(host).size;
  const agents = [...calls.entries()]
    .map(([name, count]) => ({ name, calls: count }))
    .sort((a, b) => {
      if (a.name === 'main') return -1;
      if (b.name === 'main') return 1;
      return b.calls - a.calls || a.name.localeCompare(b.name);
    });
  let tokenSum = 0;
  for (const value of tokenByKey.values()) tokenSum += value;

  return {
    feature: { repo, branch, pr: pr && pr > 0 ? pr : null },
    prs: selected.prs.filter((n) => int(n, 1e9 - 1)),
    wall_ms: wall,
    active_ms: active,
    idle_gap_min: gapMin,
    sessions: sessionCounts,
    tools: topCounts(tools),
    skills: topCounts(skills),
    agents,
    tool_failures: failureCount,
    failure_tools: topCounts(failures),
    duration_ms: durationN > 0
      ? { n: durationN, sum: durationSum, mean: Math.round(durationSum / durationN), max: durationMax }
      : null,
    guard_blocks: guardCount,
    guards: Object.fromEntries([...guards.entries()].sort((a, b) => a[0].localeCompare(b[0]))),
    review_rounds: review,
    fix_rounds: fix,
    tokens: tokenByKey.size > 0 ? tokenSum : null,
    tokens_known: tokenByKey.size,
    events: events.length,
    first_ts: times.length ? times[0].ts : null,
    last_ts: times.length ? times[times.length - 1].ts : null,
    partial,
  };
}

export function aggregateFeature(events, options = {}) {
  const gapMin = options.gapMin ?? IDLE_GAP_MIN;
  return summarise(selectFeature(events, options), gapMin);
}

export function formatMs(ms) {
  if (ms == null || !Number.isFinite(ms)) return 'n/a';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return formatDuration(ms);
}

function sessionText(report) {
  const parts = HOSTS.map((host) => `${host} ${report.sessions[host] ?? 0}`);
  return parts.join(', ');
}

function listText(rows, field) {
  if (!rows.length) return 'none';
  return rows.map((row) => `${row.name} ${row[field]}`).join(', ');
}

export function formatActive(report) {
  if (report.active_ms == null) return 'n/a';
  return `${formatDuration(report.active_ms)} (gaps over ${report.idle_gap_min}m excluded)`;
}

function featureLine(report) {
  const feature = report.feature;
  const pr = feature.pr == null ? 'n/a' : String(feature.pr);
  const extra = report.prs.length > 1 ? ` (also ${report.prs.filter((n) => n !== feature.pr).join(', ')})` : '';
  return `${feature.repo || 'unknown'}  ${feature.branch || 'unknown'}  pr ${pr}${extra}`;
}

export function formatFeatureText(report) {
  const duration = report.duration_ms
    ? `mean ${formatMs(report.duration_ms.mean)} max ${formatMs(report.duration_ms.max)} n ${report.duration_ms.n}`
    : 'n/a';
  const guardDetail = Object.entries(report.guards).map(([name, count]) => `${name} ${count}`).join(', ');
  return [
    `feature  ${featureLine(report)}`,
    `wall     ${formatDuration(report.wall_ms)}`,
    `active   ${formatActive(report)}`,
    `sessions ${sessionText(report)}`,
    `tokens   ${report.tokens == null ? 'n/a' : String(report.tokens)}`,
    `tools    ${listText(report.tools, 'count')}`,
    `skills   ${listText(report.skills, 'count')}`,
    `agents   ${listText(report.agents, 'calls')}`,
    `failures ${report.tool_failures}${report.failure_tools.length ? ` (${listText(report.failure_tools, 'count')})` : ''}`,
    `durations ${duration}`,
    `guards   ${report.guard_blocks}${guardDetail ? ` (${guardDetail})` : ''}`,
    `review   ${report.review_rounds}`,
    `fix      ${report.fix_rounds}`,
    `events   ${report.events}`,
    `partial  ${report.partial ? 'yes' : 'no'}`,
    '',
  ].join('\n');
}

function escapeHtml(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function metricsPanelHtml(report) {
  const rows = [
    ['Wall', formatDuration(report.wall_ms)],
    ['Active', formatActive(report)],
    ['Sessions', sessionText(report)],
    ['Tokens', report.tokens == null ? 'n/a' : String(report.tokens)],
    ['Tool failures', String(report.tool_failures)],
    ['Guard blocks', String(report.guard_blocks)],
    ['Review rounds', String(report.review_rounds)],
    ['Fix rounds', String(report.fix_rounds)],
  ];
  const body = rows.map(([name, value]) => (
    `<tr><th style="text-align:left;padding:6px 10px;border-bottom:1px solid #d6d3d1">${escapeHtml(name)}</th>`
    + `<td style="padding:6px 10px;border-bottom:1px solid #d6d3d1">${escapeHtml(value)}</td></tr>`
  )).join('');
  const duration = report.duration_ms
    ? `mean ${formatMs(report.duration_ms.mean)}, max ${formatMs(report.duration_ms.max)}, n ${report.duration_ms.n}`
    : 'n/a';
  return `<section id="kpi-metrics" style="margin-top:28px">
<h2 style="font-size:18px;margin:0 0 8px">Metrics</h2>
<p style="margin:0 0 10px;color:#57534e">${escapeHtml(featureLine(report))}. Status: ${report.partial ? 'partial' : 'complete'}.</p>
<table style="width:100%;border-collapse:collapse;background:#fff;border:1px solid #d6d3d1">${body}</table>
<p style="margin:10px 0 0">Tools: ${escapeHtml(listText(report.tools, 'count'))}</p>
<p style="margin:4px 0 0">Skills: ${escapeHtml(listText(report.skills, 'count'))}</p>
<p style="margin:4px 0 0">Agents: ${escapeHtml(listText(report.agents, 'calls'))}</p>
<p style="margin:4px 0 0">Failure tools: ${escapeHtml(listText(report.failure_tools, 'count'))}. Durations: ${escapeHtml(duration)}.</p>
</section>`;
}

export function injectMetricsPanel(html, report) {
  if (String(html).includes('id="kpi-metrics"')) return String(html);
  const panel = `\n${metricsPanelHtml(report)}\n`;
  const source = String(html);
  const mainAt = source.lastIndexOf('</main>');
  if (mainAt !== -1) return `${source.slice(0, mainAt)}${panel}${source.slice(mainAt)}`;
  const bodyAt = source.lastIndexOf('</body>');
  if (bodyAt !== -1) return `${source.slice(0, bodyAt)}${panel}${source.slice(bodyAt)}`;
  return `${source}${panel}`;
}

export function formatFeatureHtml(report) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Feature KPI</title>
<style>
  body { font: 15px/1.4 ui-sans-serif, sans-serif; margin: 2rem; color: #1c1917; background: #fafaf9; }
  h1 { font-size: 1.4rem; }
  @media (max-width: 700px) { body { margin: 1rem; } }
</style>
</head>
<body>
<h1>Feature KPI</h1>
${metricsPanelHtml(report)}
</body>
</html>
`;
}

export function formatMetricsMarkdown(report) {
  const rows = [
    ['Wall', formatDuration(report.wall_ms)],
    ['Active', formatActive(report)],
    ['Sessions', sessionText(report)],
    ['Tokens', report.tokens == null ? 'n/a' : String(report.tokens)],
    ['Tool failures', String(report.tool_failures)],
    ['Guard blocks', String(report.guard_blocks)],
    ['Review rounds', String(report.review_rounds)],
    ['Fix rounds', String(report.fix_rounds)],
  ];
  const lines = rows.map(([name, value]) => `| ${name} | ${value} |`);
  return [
    '## Metrics',
    '',
    '| Metric | Value |',
    '| --- | --- |',
    ...lines,
    '',
    `Status: ${report.partial ? 'partial' : 'complete'}`,
    '',
  ].join('\n');
}

function usage() {
  return `usage: agent-harness kpi feature [--branch X | --pr N] [--json|--html] [--log path]
Writes docs/pr-reports/<branch-slug>.metrics.json unless --no-metrics or --metrics path is set.
Active time keeps gaps of --gap minutes or less (default ${IDLE_GAP_MIN}).
`;
}

function defaultLog() {
  return process.env.AGENT_HARNESS_KPI_LOG || path.join(os.homedir(), '.agent-harness', 'kpi', 'events.jsonl');
}

function gitText(args, cwd) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) return '';
  return result.stdout.trim();
}

export function detectRepo(cwd = process.cwd()) {
  const root = gitText(['rev-parse', '--show-toplevel'], cwd);
  if (!root) return { root: null, repo: null, branch: null };
  const remote = gitText(['-C', root, 'remote', 'get-url', 'origin'], cwd);
  let repo = null;
  if (remote) {
    const slug = remote
      .replace(/^[A-Za-z][A-Za-z0-9+.-]*:\/\//, '')
      .replace(/^[^@]+@/, '')
      .replace(/:[0-9]+\//, '/')
      .replace(/\.git$/, '')
      .replace(/^[^/:]+[:/]/, '');
    repo = cleanRepo(slug);
  }
  if (!repo) repo = cleanRepo(path.basename(root));
  const branch = cleanBranch(gitText(['-C', root, 'rev-parse', '--abbrev-ref', 'HEAD'], cwd));
  return { root, repo, branch: branch === 'HEAD' ? null : branch };
}

function branchSlug(branch) {
  const slug = String(branch).replaceAll('/', '-');
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(slug) ? slug : null;
}

function parseArgs(argv) {
  const opts = {
    branch: null,
    pr: null,
    repo: null,
    format: 'text',
    log: null,
    gapMin: IDLE_GAP_MIN,
    metrics: undefined,
    help: false,
    inject: null,
    metricsIn: null,
    out: null,
    metricsOut: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const need = (flag) => {
      const value = argv[i + 1];
      if (!value || value.startsWith('--')) throw new Error(`${flag} needs a value`);
      i += 1;
      return value;
    };
    if (arg === '--json') opts.format = 'json';
    else if (arg === '--html') opts.format = 'html';
    else if (arg === '--markdown') opts.format = 'markdown';
    else if (arg === '--no-metrics') opts.metrics = null;
    else if (arg === '--help' || arg === '-h') opts.help = true;
    else if (arg === '--branch') opts.branch = need('--branch');
    else if (arg === '--pr') opts.pr = need('--pr');
    else if (arg === '--repo') opts.repo = need('--repo');
    else if (arg === '--log') opts.log = need('--log');
    else if (arg === '--gap') opts.gapMin = need('--gap');
    else if (arg === '--metrics') opts.metricsIn = need('--metrics');
    else if (arg === '--inject') opts.inject = need('--inject');
    else if (arg === '--out') opts.out = need('--out');
    else if (arg === '--metrics-out') opts.metricsOut = need('--metrics-out');
    else throw new Error(`unknown argument ${arg}`);
  }
  if (opts.metricsIn && opts.metrics === undefined) opts.metrics = opts.metricsIn;
  return opts;
}

function namedRows(list, field, clean) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const row of list) {
    if (!row || typeof row !== 'object') continue;
    const name = clean(row.name);
    const count = int(row[field], 1e12);
    if (!name || count == null) continue;
    out.push(field === 'calls' ? { name, calls: count } : { name, count });
  }
  return out.slice(0, TOP_N);
}

export function copyReport(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('metrics must be a JSON object');
  const feature = input.feature && typeof input.feature === 'object' ? input.feature : {};
  const sessions = input.sessions && typeof input.sessions === 'object' ? input.sessions : {};
  const duration = input.duration_ms && typeof input.duration_ms === 'object' ? input.duration_ms : null;
  const guardsIn = input.guards && typeof input.guards === 'object' ? input.guards : {};
  const guards = {};
  for (const [key, value] of Object.entries(guardsIn)) {
    const name = cleanGuard(key);
    const count = int(value, 1e12);
    if (name && count != null) guards[name] = count;
  }
  const pr = int(feature.pr, 1e9 - 1);
  const durationN = duration ? int(duration.n, 1e12) : null;
  return {
    feature: {
      repo: cleanRepo(feature.repo),
      branch: cleanBranch(feature.branch),
      pr: pr > 0 ? pr : null,
    },
    prs: Array.isArray(input.prs) ? input.prs.map((n) => int(n, 1e9 - 1)).filter((n) => n > 0) : [],
    wall_ms: finite(input.wall_ms, 365 * DAY_MS),
    active_ms: finite(input.active_ms, 365 * DAY_MS),
    idle_gap_min: int(input.idle_gap_min, 1440) || IDLE_GAP_MIN,
    sessions: {
      cursor: int(sessions.cursor, 1e12) || 0,
      claude: int(sessions.claude, 1e12) || 0,
      opencode: int(sessions.opencode, 1e12) || 0,
    },
    tools: namedRows(input.tools, 'count', cleanTool),
    skills: namedRows(input.skills, 'count', cleanSkill),
    agents: namedRows(input.agents, 'calls', cleanAgent),
    tool_failures: int(input.tool_failures, 1e12) || 0,
    failure_tools: namedRows(input.failure_tools, 'count', cleanTool),
    duration_ms: durationN > 0 ? {
      n: durationN,
      sum: finite(duration.sum, 1e15) || 0,
      mean: finite(duration.mean, DAY_MS) || 0,
      max: finite(duration.max, DAY_MS) || 0,
    } : null,
    guard_blocks: int(input.guard_blocks, 1e12) || 0,
    guards,
    review_rounds: int(input.review_rounds, 10000) || 0,
    fix_rounds: int(input.fix_rounds, 10000) || 0,
    tokens: input.tokens == null ? null : int(input.tokens, 1e12),
    tokens_known: int(input.tokens_known, 1e12) || 0,
    events: int(input.events, 1e12) || 0,
    first_ts: cleanStamp(input.first_ts),
    last_ts: cleanStamp(input.last_ts),
    partial: input.partial === true,
  };
}

function storedReport(report) {
  const text = `${JSON.stringify(report, null, 2)}\n`;
  if (leaksPath(text)) throw new Error('metrics failed sanitising');
  return text;
}

function writeFile(file, text) {
  if (fs.existsSync(file) && fs.lstatSync(file).isSymbolicLink()) throw new Error(`refuse to write through a symlink: ${file}`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

export function featureMain(argv, io = {}) {
  const stdout = io.stdout ?? ((text) => process.stdout.write(text));
  const stderr = io.stderr ?? ((text) => process.stderr.write(text));
  const detect = io.detect ?? detectRepo;
  const opts = parseArgs(argv);
  if (opts.help) {
    stdout(usage());
    return 0;
  }
  if (argv.includes('--json') && argv.includes('--html')) throw new Error('pass only one of --json or --html');
  if (argv.includes('--json') && argv.includes('--markdown')) throw new Error('pass only one of --json or --markdown');
  if (argv.includes('--html') && argv.includes('--markdown')) throw new Error('pass only one of --html or --markdown');
  const gapMin = Number(opts.gapMin);
  if (!Number.isInteger(gapMin) || gapMin < 1 || gapMin > 1440) throw new Error('--gap must be a whole number of minutes from 1 to 1440');
  if (opts.inject || (opts.format === 'markdown' && opts.metricsIn && !opts.log && !opts.branch && !opts.pr && !opts.repo)) {
    if (!opts.metricsIn) throw new Error('--metrics needs a path');
    const report = copyReport(JSON.parse(fs.readFileSync(opts.metricsIn, 'utf8')));
    const text = storedReport(report);
    if (opts.inject) {
      const html = injectMetricsPanel(fs.readFileSync(opts.inject, 'utf8'), report);
      if (leaksPath(html.slice(html.indexOf('id="kpi-metrics"')))) throw new Error('metrics panel failed sanitising');
      if (opts.out) writeFile(opts.out, html);
      else stdout(html);
    }
    if (opts.metricsOut) writeFile(opts.metricsOut, text);
    if (!opts.inject && opts.format === 'markdown') stdout(formatMetricsMarkdown(report));
    return 0;
  }
  if (opts.repo != null && !cleanRepo(opts.repo)) throw new Error('--repo must be owner/name or a repository name');
  if (opts.branch != null && !cleanBranch(opts.branch)) throw new Error('--branch must be a branch name');
  if (opts.pr != null && !/^[1-9][0-9]{0,8}$/.test(String(opts.pr))) throw new Error('--pr must be a pull request number');
  const pr = opts.pr == null ? null : Number(opts.pr);
  const detected = (!opts.repo || !opts.branch || opts.metrics === undefined) ? detect() : { root: null, repo: null, branch: null };
  const repo = opts.repo ? cleanRepo(opts.repo) : detected.repo;
  const branch = opts.branch ? cleanBranch(opts.branch) : detected.branch;
  const log = opts.log ?? defaultLog();
  const raw = log && fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '';
  const report = aggregateFeature(readEvents(raw), { repo, branch, pr, gapMin });
  const body = storedReport(report);
  if (opts.metrics !== null) {
    let dest = opts.metricsIn || null;
    if (!dest && detected.root && report.feature.branch) {
      const slug = branchSlug(report.feature.branch);
      if (slug) dest = path.join(detected.root, 'docs', 'pr-reports', `${slug}.metrics.json`);
    }
    if (dest) writeFile(dest, body);
    else stderr('kpi feature: metrics file not written (pass --metrics or run inside a git branch)\n');
  }
  if (opts.format === 'json') stdout(body);
  else if (opts.format === 'html') stdout(formatFeatureHtml(report));
  else if (opts.format === 'markdown') stdout(formatMetricsMarkdown(report));
  else stdout(formatFeatureText(report));
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exitCode = featureMain(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error.message}\n${usage()}`);
    process.exitCode = 2;
  }
}
