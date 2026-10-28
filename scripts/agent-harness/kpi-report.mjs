import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const SMALL_TASKS = 5;
export const SMALL_PRS = 3;

const VARIANTS = ['conductor', 'monolith'];

export function parseSince(spec, now = Date.now()) {
  if (spec == null || spec === '' || spec === 'all') return null;
  const match = /^(\d+)([hdw])$/.exec(spec);
  if (!match) throw new Error(`bad --since ${spec} (use 12h, 30d, or 2w)`);
  const n = Number(match[1]);
  const unit = match[2] === 'h' ? 3600000 : match[2] === 'w' ? 7 * 86400000 : 86400000;
  return now - n * unit;
}

function guardBlockKey(event) {
  if (event.kind !== 'guard_block') return null;
  return [
    event.ts ?? '',
    event.guard ?? '',
    event.repo ?? '',
    event.branch ?? '',
    event.session_id ?? '',
    event.variant ?? '',
    event.tool ?? '',
  ].join('\0');
}

export function readEvents(text) {
  const events = [];
  const seen = new Set();
  for (const line of String(text).split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const event = JSON.parse(trimmed);
      if (!event || typeof event !== 'object' || Array.isArray(event)) continue;
      const key = guardBlockKey(event);
      if (key) {
        if (seen.has(key)) continue;
        seen.add(key);
      }
      events.push(event);
    } catch {
      /* skip a corrupt line */
    }
  }
  return events;
}

export function outcomeFromGh({ pr, view, checkRuns, laterCommits }) {
  const created = Date.parse(view?.createdAt ?? '');
  const merged = Date.parse(view?.mergedAt ?? '');
  let ci = null;
  if (Array.isArray(checkRuns) && checkRuns.length > 0) {
    ci = checkRuns.every((run) => {
      const conclusion = run?.conclusion;
      return run?.status === 'completed' && (conclusion === 'success' || conclusion === 'skipped' || conclusion === 'neutral');
    });
  }
  let reverted = null;
  if (Number.isFinite(merged) && Array.isArray(laterCommits)) {
    const until = merged + 7 * 86400000;
    const needle = new RegExp(`(revert|fix)[\\s\\S]{0,80}#${pr}\\b|#${pr}\\b[\\s\\S]{0,80}(revert|fix)`, 'i');
    reverted = laterCommits.some((commit) => {
      const at = Date.parse(commit?.date ?? '');
      return Number.isFinite(at) && at > merged && at <= until && needle.test(String(commit?.message ?? ''));
    });
  }
  return {
    kind: 'pr_outcome',
    pr: Number(pr),
    ci_first_pass: ci,
    time_to_merge_ms: Number.isFinite(created) && Number.isFinite(merged) ? merged - created : null,
    reverted_within_7d: reverted,
  };
}

function blank() {
  return {
    tasks: 0,
    tokenSum: 0,
    tokenN: 0,
    wallSum: 0,
    wallN: 0,
    toolSum: 0,
    toolN: 0,
    guardBlocks: 0,
    sessions: new Map(),
    evals: [],
    prs: new Map(),
  };
}

function session(group, id) {
  const key = id || 'unknown';
  if (!group.sessions.has(key)) group.sessions.set(key, { starts: 0, startTs: null, endTs: null, tools: 0, tokens: null });
  return group.sessions.get(key);
}

function prRow(group, pr) {
  if (!group.prs.has(pr)) {
    group.prs.set(pr, {
      reviewRounds: 0,
      sawReview: false,
      reviewKnown: false,
      important: null,
      ci: null,
      reverted: null,
      mergeMs: null,
    });
  }
  return group.prs.get(pr);
}

function addImportant(row, value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return;
  row.important = (row.important ?? 0) + value;
}

export function aggregate(events, options = {}) {
  const since = options.since ?? null;
  const by = options.by === 'tool' ? 'tool' : 'variant';
  const groups = new Map();
  const ensure = (key) => {
    if (!groups.has(key)) groups.set(key, blank());
    return groups.get(key);
  };
  if (by === 'variant') for (const name of VARIANTS) ensure(name);

  const filtered = [];
  for (const event of events) {
    if (since != null) {
      const at = Date.parse(event.ts ?? '');
      if (!Number.isFinite(at) || at < since) continue;
    }
    filtered.push(event);
  }

  for (const event of filtered) {
    const key = by === 'tool' ? String(event.tool || 'unknown') : (event.variant === 'monolith' ? 'monolith' : event.variant === 'conductor' ? 'conductor' : 'unknown');
    const group = ensure(key);
    if (event.kind === 'session_start') {
      const row = session(group, event.session_id);
      row.starts += 1;
      const at = Date.parse(event.ts ?? '');
      if (Number.isFinite(at)) row.startTs = row.startTs == null ? at : Math.min(row.startTs, at);
      if (typeof event.tokens === 'number' && row.tokens == null) row.tokens = event.tokens;
    } else if (event.kind === 'session_end') {
      const row = session(group, event.session_id);
      const at = Date.parse(event.ts ?? '');
      if (Number.isFinite(at)) row.endTs = row.endTs == null ? at : Math.max(row.endTs, at);
      if (typeof event.tokens === 'number') row.tokens = event.tokens;
    } else if (event.kind === 'tool_call') {
      session(group, event.session_id).tools += 1;
    } else if (event.kind === 'eval_result') {
      group.evals.push(event);
    } else if (event.kind === 'guard_block') {
      group.guardBlocks += 1;
    } else if (event.kind === 'review_round' && Number.isInteger(event.pr)) {
      const row = prRow(group, event.pr);
      row.reviewRounds += 1;
      row.sawReview = true;
      row.reviewKnown = true;
      addImportant(row, event.important);
    } else if ((event.kind === 'pr_open' || event.kind === 'ship' || event.kind === 'pr_outcome') && Number.isInteger(event.pr)) {
      const row = prRow(group, event.pr);
      if (event.kind === 'pr_outcome') {
        if (typeof event.ci_first_pass === 'boolean') row.ci = event.ci_first_pass;
        if (typeof event.reverted_within_7d === 'boolean') row.reverted = event.reverted_within_7d;
        if (typeof event.time_to_merge_ms === 'number') row.mergeMs = event.time_to_merge_ms;
        if (!row.sawReview && typeof event.review_rounds === 'number') {
          row.reviewRounds = event.review_rounds;
          row.reviewKnown = true;
        }
        if (row.important == null && typeof event.important === 'number') row.important = event.important;
      }
    }
  }

  const variants = {};
  const reasons = [];
  for (const [key, group] of groups) {
    let tasks = group.evals.length;
    for (const row of group.sessions.values()) {
      if (row.starts > 0) {
        tasks += 1;
        if (typeof row.tokens === 'number') {
          group.tokenSum += row.tokens;
          group.tokenN += 1;
        }
        if (row.startTs != null && row.endTs != null && row.endTs >= row.startTs) {
          group.wallSum += row.endTs - row.startTs;
          group.wallN += 1;
        }
        group.toolSum += row.tools;
        group.toolN += 1;
      }
    }
    for (const event of group.evals) {
      if (typeof event.tokens === 'number') {
        group.tokenSum += event.tokens;
        group.tokenN += 1;
      }
      if (typeof event.wall_ms === 'number') {
        group.wallSum += event.wall_ms;
        group.wallN += 1;
      }
      if (typeof event.tool_calls === 'number') {
        group.toolSum += event.tool_calls;
        group.toolN += 1;
      }
    }
    const prs = [...group.prs.values()];
    const reviewKnown = prs.filter((row) => row.reviewKnown);
    const importantKnown = prs.filter((row) => typeof row.important === 'number');
    const ciKnown = prs.filter((row) => typeof row.ci === 'boolean');
    const revertKnown = prs.filter((row) => typeof row.reverted === 'boolean');
    const mergeKnown = prs.filter((row) => typeof row.mergeMs === 'number');
    const mean = (sum, n) => (n > 0 ? sum / n : null);
    const row = {
      tasks,
      tokens_per_task: mean(group.tokenSum, group.tokenN),
      tokens_known: group.tokenN,
      wall_ms_per_task: mean(group.wallSum, group.wallN),
      wall_known: group.wallN,
      tool_calls_per_task: mean(group.toolSum, group.toolN),
      tool_calls_known: group.toolN,
      review_rounds_per_pr: reviewKnown.length ? mean(reviewKnown.reduce((sum, item) => sum + item.reviewRounds, 0), reviewKnown.length) : null,
      ci_first_pass_pct: ciKnown.length ? (100 * ciKnown.filter((item) => item.ci).length) / ciKnown.length : null,
      ci_known: ciKnown.length,
      important_per_pr: importantKnown.length ? mean(importantKnown.reduce((sum, item) => sum + item.important, 0), importantKnown.length) : null,
      important_known: importantKnown.length,
      guard_blocks: group.guardBlocks,
      revert_rate: revertKnown.length ? revertKnown.filter((item) => item.reverted).length / revertKnown.length : null,
      revert_known: revertKnown.length,
      merge_ms: mergeKnown.length ? mean(mergeKnown.reduce((sum, item) => sum + item.mergeMs, 0), mergeKnown.length) : null,
      n_pr: group.prs.size,
    };
    variants[key] = row;
    if (row.tasks < SMALL_TASKS) reasons.push(`${key} tasks ${row.tasks} < ${SMALL_TASKS}`);
    if (row.n_pr < SMALL_PRS) reasons.push(`${key} PRs ${row.n_pr} < ${SMALL_PRS}`);
  }

  return {
    since: since == null ? null : new Date(since).toISOString(),
    by,
    small_n: reasons.length > 0,
    small_n_reasons: reasons,
    thresholds: { tasks: SMALL_TASKS, prs: SMALL_PRS },
    variants,
  };
}

export function collectPrNumbers(events) {
  const numbers = new Set();
  for (const event of events) {
    if (Number.isInteger(event.pr) && event.pr > 0) numbers.add(event.pr);
  }
  return [...numbers];
}

export function variantForPr(events, pr) {
  for (const event of events) {
    if (event.pr === pr && (event.variant === 'conductor' || event.variant === 'monolith')) return event.variant;
  }
  return 'unknown';
}

function ghJson(exec, args) {
  const text = exec(args);
  if (text == null || text === '') return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function liveOutcomeEvents(events, exec) {
  const repoText = exec(['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner']);
  const repo = String(repoText ?? '').trim();
  if (!/^[^/\s]+\/[^/\s]+$/.test(repo)) return [];
  const extra = [];
  for (const pr of collectPrNumbers(events)) {
    const view = ghJson(exec, ['pr', 'view', String(pr), '--json', 'number,state,createdAt,mergedAt']);
    if (!view) continue;
    const commits = ghJson(exec, ['api', `repos/${repo}/pulls/${pr}/commits`, '--jq', '[.[] | {sha:.sha}]']);
    const first = Array.isArray(commits) ? commits[0]?.sha : null;
    let checkRuns = null;
    if (typeof first === 'string' && /^[0-9a-f]{7,40}$/.test(first)) {
      checkRuns = ghJson(exec, ['api', `repos/${repo}/commits/${first}/check-runs`, '--jq', '[.check_runs[] | {status,conclusion}]']);
    }
    let laterCommits = null;
    if (view.mergedAt) {
      const until = new Date(Date.parse(view.mergedAt) + 7 * 86400000).toISOString();
      laterCommits = ghJson(exec, [
        'api',
        `repos/${repo}/commits?since=${encodeURIComponent(view.mergedAt)}&until=${encodeURIComponent(until)}&per_page=100`,
        '--jq',
        '[.[] | {date:.commit.committer.date, message:.commit.message}]',
      ]);
    }
    extra.push({
      ...outcomeFromGh({ pr, view, checkRuns, laterCommits }),
      variant: variantForPr(events, pr),
      ts: new Date().toISOString(),
    });
  }
  return extra;
}

export function defaultGh(args) {
  const result = spawnSync('gh', args, { encoding: 'utf8', timeout: 20000 });
  if (result.status !== 0) return null;
  return result.stdout;
}

function na(value) {
  return value == null || !Number.isFinite(value) ? 'n/a' : null;
}

export function formatDuration(ms) {
  if (ms == null || !Number.isFinite(ms)) return 'n/a';
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m${String(seconds % 60).padStart(2, '0')}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h${String(minutes % 60).padStart(2, '0')}m`;
}

function cell(value, format) {
  if (na(value)) return 'n/a';
  if (format === 'int') return String(Math.round(value));
  if (format === '1') return value.toFixed(1);
  if (format === 'pct') return `${Math.round(value)}%`;
  if (format === 'rate') return `${Math.round(value * 100)}%`;
  if (format === 'dur') return formatDuration(value);
  return String(value);
}

const COLUMNS = [
  ['tasks', (row) => String(row.tasks)],
  ['tokens/task', (row) => cell(row.tokens_per_task, 'int')],
  ['wall/task', (row) => cell(row.wall_ms_per_task, 'dur')],
  ['tools/task', (row) => cell(row.tool_calls_per_task, '1')],
  ['review/PR', (row) => cell(row.review_rounds_per_pr, '1')],
  ['CI first-pass', (row) => cell(row.ci_first_pass_pct, 'pct')],
  ['Important/PR', (row) => cell(row.important_per_pr, '1')],
  ['guard blocks', (row) => String(row.guard_blocks)],
  ['revert rate', (row) => cell(row.revert_rate, 'rate')],
  ['merge time', (row) => cell(row.merge_ms, 'dur')],
];

function pad(value, width) {
  const text = String(value);
  return text.length >= width ? text : text + ' '.repeat(width - text.length);
}

export function formatText(report) {
  const keys = Object.keys(report.variants);
  const header = ['variant', ...COLUMNS.map(([name]) => name)];
  const rows = keys.map((key) => [key, ...COLUMNS.map(([, fmt]) => fmt(report.variants[key]))]);
  const widths = header.map((name, index) => Math.max(name.length, ...rows.map((row) => row[index].length)));
  const line = (row) => row.map((value, index) => pad(value, widths[index])).join('  ');
  const samples = keys.map((key) => {
    const row = report.variants[key];
    return `${key} tasks=${row.tasks} (tokens ${row.tokens_known}, wall ${row.wall_known}) prs=${row.n_pr}`;
  }).join('; ');
  const flag = report.small_n
    ? `too small to conclude: ${report.small_n_reasons.join('; ')}`
    : 'sample size is large enough to compare (tasks >= 5 and PRs >= 3 in each column)';
  return `${line(header)}\n${rows.map(line).join('\n')}\nsamples: ${samples}\n${flag}\n`;
}

function escapeHtml(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function formatHtml(report) {
  const keys = Object.keys(report.variants);
  const head = ['variant', ...COLUMNS.map(([name]) => name)].map((name) => `<th>${escapeHtml(name)}</th>`).join('');
  const body = keys.map((key) => {
    const cells = [key, ...COLUMNS.map(([, fmt]) => fmt(report.variants[key]))].map((value) => `<td>${escapeHtml(value)}</td>`).join('');
    return `<tr>${cells}</tr>`;
  }).join('');
  const flag = report.small_n
    ? `too small to conclude: ${report.small_n_reasons.join('; ')}`
    : 'sample size is large enough to compare';
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Harness variant KPIs</title>
<style>
  body { font: 15px/1.4 ui-sans-serif, sans-serif; margin: 2rem; color: #1c1917; background: #fafaf9; }
  h1 { font-size: 1.4rem; }
  table { border-collapse: collapse; background: white; }
  th, td { border: 1px solid #d6d3d1; padding: 0.4rem 0.7rem; text-align: left; }
  th { background: #f5f5f4; }
  .flag { margin-top: 1rem; padding: 0.7rem 0.9rem; background: ${report.small_n ? '#fef3c7' : '#ecfdf5'}; }
</style>
</head>
<body>
<h1>Conductor vs Monolith</h1>
<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>
<p class="flag">${escapeHtml(flag)}</p>
<p>Thresholds: tasks &lt; ${report.thresholds.tasks}, PRs &lt; ${report.thresholds.prs}. Tokens stay blank when the host did not report them.</p>
</body>
</html>
`;
}

function usage() {
  return `usage: agent-harness kpi report [--since 30d] [--by variant|tool] [--json | --html] [--no-live] [--log path]
Reads the local JSONL KPI log and prints Conductor next to Monolith.
--no-live skips read-only gh lookups for CI, merge time, and revert rate.
`;
}

function defaultLog() {
  return process.env.AGENT_HARNESS_KPI_LOG || path.join(os.homedir(), '.agent-harness', 'kpi', 'events.jsonl');
}

export function reportMain(argv, io = {}) {
  const stdout = io.stdout ?? ((text) => process.stdout.write(text));
  const stderr = io.stderr ?? ((text) => process.stderr.write(text));
  const exec = io.gh ?? defaultGh;
  const opts = { since: null, by: 'variant', format: 'text', live: true, log: defaultLog(), help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--json') opts.format = 'json';
    else if (arg === '--html') opts.format = 'html';
    else if (arg === '--no-live') opts.live = false;
    else if (arg === '--live') opts.live = true;
    else if (arg === '--help' || arg === '-h') opts.help = true;
    else if (arg === '--since') {
      opts.since = argv[++i];
      if (!opts.since) throw new Error('--since needs a value');
    } else if (arg === '--by') {
      opts.by = argv[++i];
      if (!opts.by) throw new Error('--by needs variant or tool');
    } else if (arg === '--log') {
      opts.log = argv[++i];
      if (!opts.log) throw new Error('--log needs a path');
    } else throw new Error(`unknown argument ${arg}`);
  }
  if (opts.help) {
    stdout(usage());
    return 0;
  }
  if (argv.includes('--json') && argv.includes('--html')) throw new Error('pass only one of --json or --html');
  if (opts.by !== 'variant' && opts.by !== 'tool') throw new Error('--by must be variant or tool');
  const since = parseSince(opts.since);
  const text = opts.log && fs.existsSync(opts.log) ? fs.readFileSync(opts.log, 'utf8') : '';
  let events = readEvents(text);
  if (opts.live && collectPrNumbers(events).length > 0) {
    try {
      events = events.concat(liveOutcomeEvents(events, exec));
    } catch {
      /* gh is optional */
    }
  }
  const report = aggregate(events, { since, by: opts.by });
  if (opts.format === 'json') stdout(`${JSON.stringify(report, null, 2)}\n`);
  else if (opts.format === 'html') stdout(formatHtml(report));
  else stdout(formatText(report));
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exitCode = reportMain(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error.message}\n${usage()}`);
    process.exitCode = 2;
  }
}
