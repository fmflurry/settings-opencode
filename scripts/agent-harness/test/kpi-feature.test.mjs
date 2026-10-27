import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { readEvents } from '../kpi-report.mjs';
import {
  aggregateFeature, featureMain, formatFeatureHtml, formatFeatureText, formatMetricsMarkdown,
  injectMetricsPanel, leaksPath,
} from '../kpi-feature.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const fixturePath = path.join(repo, 'scripts/agent-harness/test/fixtures/kpi-feature.jsonl');
const kpiSh = path.join(repo, 'scripts/agent-harness/kpi.sh');
const events = readEvents(fs.readFileSync(fixturePath, 'utf8'));

function feature(extra = {}) {
  return aggregateFeature(events, { repo: 'o/r', branch: 'feat/demo', gapMin: 5, ...extra });
}

test('feature report sums one branch and drops secrets', () => {
  const report = feature();
  assert.deepEqual(report.feature, { repo: 'o/r', branch: 'feat/demo', pr: 12 });
  assert.equal(report.wall_ms, 21 * 60 * 1000);
  assert.equal(report.active_ms, 7 * 60 * 1000);
  assert.equal(report.idle_gap_min, 5);
  assert.deepEqual(report.sessions, { cursor: 2, claude: 1, opencode: 1 });
  assert.deepEqual(report.tools, [
    { name: 'Read', count: 3 },
    { name: 'Shell', count: 1 },
    { name: 'Skill', count: 1 },
    { name: 'Task', count: 1 },
  ]);
  assert.deepEqual(report.skills, [{ name: 'pr-visual-report', count: 1 }]);
  assert.deepEqual(report.agents, [
    { name: 'main', calls: 4 },
    { name: 'coder', calls: 2 },
  ]);
  assert.equal(report.tool_failures, 1);
  assert.deepEqual(report.failure_tools, [{ name: 'Shell', count: 1 }]);
  assert.deepEqual(report.duration_ms, { n: 3, sum: 1550, mean: 517, max: 1500 });
  assert.equal(report.guard_blocks, 2);
  assert.deepEqual(report.guards, { ask: 1, git: 1 });
  assert.equal(report.review_rounds, 1);
  assert.equal(report.fix_rounds, 1);
  assert.equal(report.tokens, 29);
  assert.equal(report.tokens_known, 2);
  assert.equal(report.partial, false);
  assert.equal(report.events, 22);
  const packed = JSON.stringify(report);
  assert.equal(packed.includes('SUPER_SECRET'), false);
  assert.equal(packed.includes('/tmp'), false);
  assert.equal(packed.includes('/home'), false);
  assert.equal(packed.includes('/var'), false);
  assert.equal(leaksPath(packed), false);
  const text = formatFeatureText(report);
  assert.match(text, /wall\s+21m00s/);
  assert.match(text, /active\s+7m00s \(gaps over 5m excluded\)/);
  assert.match(text, /cursor 2, claude 1, opencode 1/);
  assert.match(text, /partial\s+no/);
  const html = formatFeatureHtml(report);
  assert.match(html, /id="kpi-metrics"/);
  assert.match(html, /@media/);
  assert.equal(/https?:/.test(html), false);
  const md = formatMetricsMarkdown(report);
  assert.match(md, /## Metrics/);
  assert.match(md, /\| Wall \| 21m00s \|/);
  assert.match(md, /\| Tokens \| 29 \|/);
  assert.match(md, /Status: complete/);
});

test('gaps equal to N minutes stay in active time and longer gaps do not', () => {
  const base = { kind: 'tool_call', tool: 'cursor', repo: 'o/r', branch: 'feat', session_id: 's', tool_name: 'Read' };
  const t0 = Date.parse('2026-10-27T10:00:00.000Z');
  const rows = [0, 5 * 60 * 1000, 10 * 60 * 1000 + 1].map((delta, i) => ({
    ...base,
    ts: new Date(t0 + delta).toISOString().replace('.000Z', 'Z'),
    session_id: `s${i}`,
  }));
  const report = aggregateFeature(rows, { repo: 'o/r', branch: 'feat', gapMin: 5 });
  assert.equal(report.wall_ms, 10 * 60 * 1000 + 1);
  assert.equal(report.active_ms, 5 * 60 * 1000);
});

test('feature key keeps pre-PR events and the PR number once known', () => {
  const rows = [
    { ts: '2026-10-27T10:00:00Z', kind: 'tool_call', tool: 'cursor', repo: 'o/r', branch: 'feat', session_id: 's', tool_name: 'Read' },
    { ts: '2026-10-27T10:05:00Z', kind: 'pr_open', tool: 'cursor', repo: 'o/r', branch: 'feat', session_id: 's', pr: 12 },
    { ts: '2026-10-27T10:09:00Z', kind: 'tool_call', tool: 'cursor', repo: 'o/r', branch: 'feat', session_id: 's', tool_name: 'Shell', pr: 99 },
    { ts: '2026-10-27T11:00:00Z', kind: 'tool_call', tool: 'cursor', repo: 'o/r', branch: 'other', session_id: 's', tool_name: 'Read', pr: 13 },
  ];
  const scoped = aggregateFeature(rows, { repo: 'o/r', pr: 12 });
  assert.equal(scoped.feature.branch, 'feat');
  assert.equal(scoped.feature.pr, 12);
  assert.deepEqual(scoped.tools.map((row) => row.name), ['Read']);
  const all = aggregateFeature(rows, { repo: 'o/r', branch: 'feat' });
  assert.equal(all.feature.pr, 99);
  assert.deepEqual(all.prs, [12, 99]);
});

test('OpenCode child session calls count for the subagent', () => {
  const rows = [
    { ts: '2026-10-27T10:00:00Z', kind: 'tool_call', tool: 'opencode', repo: 'o/r', branch: 'feat', session_id: 'root', tool_name: 'Read' },
    { ts: '2026-10-27T10:00:01Z', kind: 'subagent_spawn', tool: 'opencode', repo: 'o/r', branch: 'feat', session_id: 'child', agent: 'coder' },
    { ts: '2026-10-27T10:00:02Z', kind: 'tool_call', tool: 'opencode', repo: 'o/r', branch: 'feat', session_id: 'child', tool_name: 'Shell' },
    { ts: '2026-10-27T10:00:03Z', kind: 'subagent_stop', tool: 'opencode', repo: 'o/r', branch: 'feat', session_id: 'child', agent: 'coder' },
  ];
  const report = aggregateFeature(rows, { repo: 'o/r', branch: 'feat' });
  assert.deepEqual(report.agents, [
    { name: 'main', calls: 1 },
    { name: 'coder', calls: 1 },
  ]);
});

test('tokens stay n/a when the host sent none', () => {
  const rows = [
    { ts: '2026-10-27T10:00:00Z', kind: 'session_start', tool: 'cursor', repo: 'o/r', branch: 'feat', session_id: 's', tokens: null },
    { ts: '2026-10-27T10:01:00Z', kind: 'session_end', tool: 'cursor', repo: 'o/r', branch: 'feat', session_id: 's', tokens: null },
  ];
  const report = aggregateFeature(rows, { repo: 'o/r', branch: 'feat' });
  assert.equal(report.tokens, null);
  assert.match(formatFeatureText(report), /tokens\s+n\/a/);
  assert.match(formatMetricsMarkdown(report), /\| Tokens \| n\/a \|/);
  assert.equal(report.partial, false);
});

test('an empty match is partial and omits absolute paths', () => {
  const report = aggregateFeature([], { repo: 'o/r', branch: 'feat/demo' });
  assert.equal(report.partial, true);
  assert.equal(report.wall_ms, null);
  assert.match(formatMetricsMarkdown(report), /Status: partial/);
  assert.equal(leaksPath(JSON.stringify(report)), false);
});

test('cli writes sanitised metrics json', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kpi-feature-'));
  const out = path.join(dir, 'feat-demo.metrics.json');
  let text = '';
  const code = featureMain([
    '--log', fixturePath, '--repo', 'o/r', '--branch', 'feat/demo', '--json', '--metrics', out,
  ], { stdout: (chunk) => { text += chunk; } });
  assert.equal(code, 0);
  const written = fs.readFileSync(out, 'utf8');
  assert.equal(written, text);
  assert.equal(JSON.parse(written).feature.pr, 12);
  assert.equal(leaksPath(written), false);
  assert.equal(written.includes('SUPER_SECRET'), false);
});

test('cli rejects a path-shaped repo', () => {
  assert.throws(
    () => featureMain(['--repo', '/home/secret', '--branch', 'feat', '--no-metrics'], { stdout() {} }),
    /--repo/,
  );
});

test('dispatcher accepts feature and rejects an unknown kpi command', () => {
  const help = spawnSync('bash', [kpiSh, 'feature', '--help'], { encoding: 'utf8' });
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /--branch X \| --pr N/);
  const bad = spawnSync('bash', [kpiSh, 'nope'], { encoding: 'utf8' });
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /kpi feature/);
});

test('inject adds one metrics panel and keeps the page offline', () => {
  const report = feature();
  const html = '<!doctype html><style>@media (max-width:600px){body{color:#111}}</style><main><p>demo</p></main>';
  const next = injectMetricsPanel(html, report);
  assert.equal(next.includes('@media'), true);
  assert.equal(next.includes('id="kpi-metrics"'), true);
  assert.equal(next.includes('<p>demo</p>'), true);
  assert.equal(/https?:/.test(next), false);
  assert.equal(injectMetricsPanel(next, report), next);
});
