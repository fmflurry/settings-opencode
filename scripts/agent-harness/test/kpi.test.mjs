import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { matchSkill, readSkills, runEval } from '../eval-run.mjs';
import {
  aggregate, formatHtml, formatText, outcomeFromGh, parseSince, readEvents, reportMain,
} from '../kpi-report.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const emit = path.join(repo, '.claude/hooks/kpi-emit.sh');

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'kpi-'));
}

function emitEnv(home, log) {
  return {
    ...process.env,
    HOME: home,
    AGENT_HARNESS_KPI: '1',
    AGENT_HARNESS_KPI_LOG: log,
    AGENT_HARNESS_TEST: '1',
    AGENT_HARNESS_TOOL: 'cursor',
    AGENT_HARNESS_VARIANT: 'orchestration',
  };
}

test('kpi-emit appends a stamped event and drops prompt text', () => {
  const home = tmpdir();
  const log = path.join(home, 'events.jsonl');
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(home, '.claude', '.harness-variant'), 'orchestration\n');
  const payload = JSON.stringify({
    hook_event_name: 'PreToolUse',
    session_id: 'sess-1',
    tool_name: 'Bash',
    tool_input: { command: 'cat super-secret-token' },
  });
  const ran = spawnSync('bash', [emit], { encoding: 'utf8', input: payload, env: emitEnv(home, log) });
  assert.equal(ran.status, 0, ran.stderr);
  const lines = fs.readFileSync(log, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  assert.equal(lines.length, 1);
  assert.equal(lines[0].kind, 'tool_call');
  assert.equal(lines[0].variant, 'conductor');
  assert.equal(lines[0].tool, 'cursor');
  assert.equal(lines[0].tool_name, 'Bash');
  assert.equal(lines[0].session_id, 'sess-1');
  assert.equal(lines[0].tokens, null);
  assert.equal(lines[0].harness_version, '0.4.18');
  assert.match(lines[0].ts, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(JSON.stringify(lines[0]).includes('super-secret-token'), false);
  assert.equal(JSON.stringify(lines[0]).includes('tool_input'), false);
});

test('kpi-emit records host token totals and ignores the test log when no path is set', () => {
  const home = tmpdir();
  const log = path.join(home, 'events.jsonl');
  const payload = JSON.stringify({
    hook_event_name: 'SessionStart',
    session_id: 'sess-2',
    source: 'startup',
    usage: { input_tokens: 3, output_tokens: 4 },
  });
  const ran = spawnSync('bash', [emit], { encoding: 'utf8', input: payload, env: emitEnv(home, log) });
  assert.equal(ran.status, 0, ran.stderr);
  const event = JSON.parse(fs.readFileSync(log, 'utf8'));
  assert.equal(event.kind, 'session_start');
  assert.equal(event.tokens, 7);
  assert.equal(event.source, 'startup');

  const quiet = tmpdir();
  const skipped = spawnSync('bash', [emit, 'tool_call', 'tool_name=Read'], {
    encoding: 'utf8',
    env: { ...process.env, HOME: quiet, AGENT_HARNESS_TEST: '1', AGENT_HARNESS_KPI: '1' },
  });
  assert.equal(skipped.status, 0);
  assert.equal(fs.existsSync(path.join(quiet, '.agent-harness', 'kpi', 'events.jsonl')), false);
});

test('version stamp matches the cursor plugin', () => {
  const config = JSON.parse(fs.readFileSync(path.join(repo, 'scripts/cursor-plugin/config.json'), 'utf8'));
  const script = fs.readFileSync(emit, 'utf8');
  assert.equal(config.version, '0.4.18');
  assert.match(script, new RegExp(`AGENT_HARNESS_VERSION:-${config.version}`));
});

test('report aggregates fixtures and flags a small sample', () => {
  const base = {
    variant: 'conductor', tool: 'cursor', repo: 'o/r', branch: 'feat', tokens: null, harness_version: '0.4.17',
  };
  const events = [];
  for (let i = 0; i < 2; i += 1) {
    events.push({ ...base, ts: '2026-10-20T00:00:00Z', kind: 'session_start', session_id: `c${i}` });
    events.push({ ...base, ts: '2026-10-20T00:01:00Z', kind: 'session_end', session_id: `c${i}`, tokens: 50 });
    events.push({ ...base, ts: '2026-10-20T00:00:30Z', kind: 'tool_call', session_id: `c${i}`, tool_name: 'Read' });
  }
  events.push({ ...base, ts: '2026-10-20T00:02:00Z', kind: 'guard_block', guard: 'git', session_id: 'c0' });
  events.push({ ...base, ts: '2026-10-20T00:03:00Z', kind: 'review_round', pr: 7, review: 'code', verdict: 'fail', important: 2, nit: 1, pre_existing: 0, session_id: 'c0' });
  events.push({ ...base, ts: '2026-10-20T00:04:00Z', kind: 'pr_outcome', pr: 7, ci_first_pass: false, reverted_within_7d: true, time_to_merge_ms: 60000, session_id: 'c0' });
  events.push({ ...base, variant: 'monolith', ts: '2020-01-01T00:00:00Z', kind: 'session_start', session_id: 'old' });

  const report = aggregate(events, { since: parseSince('30d', Date.parse('2026-10-26T00:00:00Z')) });
  assert.equal(report.variants.conductor.tasks, 2);
  assert.equal(report.variants.conductor.tokens_per_task, 50);
  assert.equal(report.variants.conductor.wall_ms_per_task, 60000);
  assert.equal(report.variants.conductor.tool_calls_per_task, 1);
  assert.equal(report.variants.conductor.guard_blocks, 1);
  assert.equal(report.variants.conductor.important_per_pr, 2);
  assert.equal(report.variants.conductor.ci_first_pass_pct, 0);
  assert.equal(report.variants.conductor.revert_rate, 1);
  assert.equal(report.variants.conductor.n_pr, 1);
  assert.equal(report.variants.monolith.tasks, 0);
  assert.equal(report.small_n, true);
  assert.match(report.small_n_reasons.join('\n'), /conductor tasks 2 < 5/);
  assert.match(report.small_n_reasons.join('\n'), /PRs 1 < 3/);

  const text = formatText(report);
  assert.match(text, /too small to conclude/);
  assert.match(text, /conductor/);
  assert.match(text, /monolith/);
  const html = formatHtml(report);
  assert.equal(/https?:/.test(html), false);
  assert.match(html, /too small to conclude/);

  const wide = [];
  for (const variant of ['conductor', 'monolith']) {
    for (let i = 0; i < 6; i += 1) {
      wide.push({ ...base, variant, ts: '2026-10-20T00:00:00Z', kind: 'session_start', session_id: `${variant}-${i}` });
    }
    for (const pr of [1, 2, 3]) {
      wide.push({
        ...base, variant, ts: '2026-10-20T00:05:00Z', kind: 'pr_outcome', pr, session_id: `${variant}-0`,
        ci_first_pass: pr !== 3, reverted_within_7d: false, review_rounds: 1, important: 0,
      });
    }
  }
  const enough = aggregate(wide);
  assert.equal(enough.small_n, false);
  assert.equal(enough.variants.conductor.tasks, 6);
  assert.equal(enough.variants.conductor.n_pr, 3);
  assert.equal(Math.round(enough.variants.conductor.ci_first_pass_pct), 67);
});

test('gh outcome mapping does not invent missing checks or tokens', () => {
  const merged = outcomeFromGh({
    pr: 9,
    view: { createdAt: '2026-10-01T00:00:00Z', mergedAt: '2026-10-01T01:00:00Z' },
    checkRuns: [{ status: 'completed', conclusion: 'success' }],
    laterCommits: [{ date: '2026-10-02T00:00:00Z', message: 'fix follow-up for #9' }],
  });
  assert.equal(merged.ci_first_pass, true);
  assert.equal(merged.time_to_merge_ms, 3600000);
  assert.equal(merged.reverted_within_7d, true);
  const unknown = outcomeFromGh({
    pr: 9,
    view: { createdAt: '2026-10-01T00:00:00Z', mergedAt: null },
    checkRuns: [],
    laterCommits: null,
  });
  assert.equal(unknown.ci_first_pass, null);
  assert.equal(unknown.reverted_within_7d, null);
  assert.equal(unknown.tokens, undefined);
});

test('report command reads a fixture log offline', () => {
  const home = tmpdir();
  const log = path.join(home, 'events.jsonl');
  fs.writeFileSync(log, `${JSON.stringify({
    ts: '2026-10-20T00:00:00Z', kind: 'session_start', variant: 'monolith', tool: 'claude',
    repo: 'o/r', branch: 'm', session_id: 'm1', tokens: null, harness_version: '0.4.17',
  })}\n`);
  let out = '';
  const code = reportMain(['--log', log, '--no-live', '--json', '--since', '30d'], {
    stdout: (text) => { out += text; },
    stderr: () => {},
  });
  assert.equal(code, 0);
  const report = JSON.parse(out);
  assert.equal(report.variants.monolith.tasks, 1);
  assert.equal(report.small_n, true);
  assert.equal(readEvents(fs.readFileSync(log, 'utf8')).length, 1);
  assert.equal(readEvents('not json\n').length, 0);
});

test('fix CI prompt selects the fix-ci skill', () => {
  const skills = readSkills(path.join(repo, 'skills'));
  const matched = matchSkill('fix CI', skills);
  assert.equal(matched.skill, 'fix-ci');
  assert.equal(matchSkill('rename this helper', skills).skill === 'fix-ci', false);
});

test('eval checkers pass under both variants', { timeout: 120000 }, () => {
  const home = tmpdir();
  const log = path.join(home, 'events.jsonl');
  const summary = runEval({ log });
  const failed = summary.results.filter((item) => !item.pass).map((item) => `${item.variant}:${item.task}`);
  assert.deepEqual(failed, []);
  assert.equal(summary.results.length, 20);
  const events = readEvents(fs.readFileSync(log, 'utf8'));
  assert.equal(events.length, 20);
  assert.equal(events.every((event) => event.kind === 'eval_result' && event.tokens === null), true);
  assert.equal(events.some((event) => event.variant === 'conductor' && event.task === 'skill-trigger-fix-ci' && event.pass === true), true);
  assert.equal(events.some((event) => event.variant === 'monolith' && event.task === 'bugfix-add' && event.pass === true), true);
  const report = aggregate(events);
  assert.equal(report.variants.conductor.tasks, 10);
  assert.equal(report.small_n, true);
  assert.match(formatText(report), /PRs 0 < 3/);
});
