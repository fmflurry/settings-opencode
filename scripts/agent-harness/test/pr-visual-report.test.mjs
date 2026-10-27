import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const hook = path.join(repo, '.claude/hooks/pr-visual-report.sh');
const report = path.join(repo, 'scripts/agent-harness/pr-report.sh');
const check = path.join(repo, 'scripts/agent-harness/pr-report-check.sh');
const dispatcher = path.join(repo, 'scripts/agent-harness/agent-harness.sh');

const good = [
  '## Visual report',
  '',
  '- [x] Report: HTML and PNG committed, PNG embedded, HTML linked.',
  '',
  '![Visual report](docs/pr-reports/feat-x.png)',
  '',
  '[HTML report](docs/pr-reports/feat-x.html)',
  '',
].join('\n');

const skipped = [
  '## Summary',
  '',
  'Typo.',
  '',
  '## Visual report',
  '',
  '- [ ] Report: HTML and PNG committed, PNG embedded, HTML linked.',
  '- [x] Skip — trivial PR (docs typo or version bump only). Reason: docs typo in the README only.',
  '',
].join('\n');

function bash(file, args, { input, cwd, env } = {}) {
  return spawnSync('bash', [file, ...args], {
    encoding: 'utf8',
    input,
    cwd,
    env: env ?? process.env,
  });
}

function hookRun(command, cwd = repo) {
  return bash(hook, [], {
    input: JSON.stringify({ cwd, tool_input: { command } }),
  });
}

function decision(result) {
  const text = (result.stdout || '').trim();
  if (!text) return null;
  return JSON.parse(text).hookSpecificOutput?.permissionDecision ?? null;
}

test('check accepts a report section', () => {
  const result = bash(hook, ['--check'], { input: good });
  assert.equal(result.status, 0, result.stderr);
});

test('check rejects a body with no visual report section', () => {
  const result = bash(hook, ['--check'], { input: '## Summary\n\nNo diagram.\n' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /missing a ## Visual report section/);
});

test('check rejects the unchecked template', () => {
  const result = bash(hook, ['--check'], {
    input: [
      '## Visual report',
      '',
      '- [ ] Report: HTML and PNG are committed under `docs/pr-reports/<branch-slug>.html` and `.png`.',
      '- [ ] Skip — trivial PR (docs typo or version bump only). Reason:',
      '',
    ].join('\n'),
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /checked Report line/);
});

test('check accepts a documented skip', () => {
  const result = bash(hook, ['--check'], { input: skipped });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /skip recorded/);
});

test('check rejects a skip without a reason', () => {
  const result = bash(hook, ['--check'], {
    input: '## Visual report\n\n- [x] Skip — trivial PR (docs typo or version bump only). Reason:\n',
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /skip reason/);
});

test('hook allows git status', () => {
  const result = hookRun('git status');
  assert.equal(result.status, 0);
  assert.equal(decision(result), null);
});

test('hook blocks gh pr create without a visual report', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pr-body-'));
  const body = path.join(dir, 'body.md');
  fs.writeFileSync(body, '## Summary\n\nNothing to see.\n');
  const result = hookRun(`gh pr create --base feat/harness-kpis --title "feat: x" --body-file ${body}`, dir);
  assert.equal(decision(result), 'deny');
  assert.match(result.stdout, /Visual report/);
});

test('hook allows gh pr create when the body file has the report', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pr-body-'));
  const body = path.join(dir, 'body.md');
  fs.writeFileSync(body, good);
  const result = hookRun(`gh pr create --body-file ${body}`, dir);
  assert.equal(result.status, 0);
  assert.equal(decision(result), null, result.stderr + result.stdout);
});

test('hook allows a title-only gh pr edit', () => {
  const result = hookRun('gh pr edit 12 --title "feat: rename"');
  assert.equal(decision(result), null, result.stdout);
});

test('hook blocks an edit that replaces the body', () => {
  const result = hookRun('gh pr edit 12 --body "no diagram here"');
  assert.equal(decision(result), 'deny');
});

test('hook blocks a substituted body', () => {
  const result = hookRun('gh pr create --body "$(cat body.md)"');
  assert.equal(decision(result), 'deny');
  assert.match(result.stdout, /substitution/);
});

test('hook allows an echoed mention of gh pr create', () => {
  const result = hookRun('echo "gh pr create --body x" && echo "$HOME"');
  assert.equal(decision(result), null, result.stdout);
});

test('hook blocks az repos pr create without a description section', () => {
  const result = hookRun('az repos pr create --source-branch feat --target-branch master --title "feat: x" --description "just text"');
  assert.equal(decision(result), 'deny');
});

test('hook allows az repos pr update without a description', () => {
  const result = hookRun('az repos pr update --id 4 --title "feat: x"');
  assert.equal(decision(result), null, result.stdout);
});

test('pr-report-check forwards to the hook', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pr-body-'));
  const body = path.join(dir, 'body.md');
  fs.writeFileSync(body, good);
  const result = bash(check, ['--body-file', body]);
  assert.equal(result.status, 0, result.stderr);
});

test('dispatcher lists pr-report', () => {
  const result = bash(dispatcher, []);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /pr-report\|pr-report-check/);
});

test('pr-report writes the html and png for the branch slug', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pr-report-'));
  const git = (...args) => {
    const result = spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  };
  git('init', '-q', '-b', 'feat/demo-report');
  git('config', 'user.email', 't@t');
  git('config', 'user.name', 't');
  const html = path.join(dir, 'in.html');
  fs.writeFileSync(html, '<!doctype html><style>@media (max-width:600px){body{color:#111}}</style><p>demo</p>');
  const stub = path.join(dir, 'shot.sh');
  fs.writeFileSync(stub, '#!/bin/bash\nbase=$(basename "$1" .html)\nprintf png > "$2/$base.png"\nprintf "%s\\n" "$2/$base.png"\n');
  fs.chmodSync(stub, 0o755);
  const art = path.join(dir, 'artifacts');
  fs.mkdirSync(art);
  const result = bash(report, [html], {
    cwd: dir,
    env: {
      ...process.env,
      AGENT_HARNESS_TEST: '1',
      PR_REPORT_SCREENSHOT: stub,
      PR_REPORT_ARTIFACT_DIR: art,
    },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.readFileSync(path.join(dir, 'docs/pr-reports/feat-demo-report.html'), 'utf8').includes('@media'), true);
  assert.equal(fs.readFileSync(path.join(dir, 'docs/pr-reports/feat-demo-report.png'), 'utf8'), 'png');
  assert.equal(fs.existsSync(path.join(art, 'pr-reports/feat-demo-report.png')), true);
  assert.match(result.stdout, /docs\/pr-reports\/feat-demo-report\.html/);
  assert.match(result.stdout, /## Visual report/);
});

test('pr-report rejects html without a media query', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pr-report-'));
  spawnSync('git', ['init', '-q'], { cwd: dir });
  const html = path.join(dir, 'in.html');
  fs.writeFileSync(html, '<p>no query</p>');
  const result = bash(report, [html], { cwd: dir });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /@media/);
});

test('pr-report rejects an external stylesheet link', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pr-report-'));
  spawnSync('git', ['init', '-q'], { cwd: dir });
  const html = path.join(dir, 'in.html');
  fs.writeFileSync(html, '<link rel="stylesheet" href="https://example.test/a.css"><style>@media (max-width:600px){}</style>');
  const result = bash(report, [html], { cwd: dir });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /offline/);
});

const metricsTable = [
  '## Metrics',
  '',
  '| Metric | Value |',
  '| --- | --- |',
  '| Wall | 12m |',
  '| Active | 9m (gaps over 5m excluded) |',
  '| Sessions | cursor 1, claude 0, opencode 0 |',
  '| Tokens | n/a |',
  '| Tool failures | 0 |',
  '| Guard blocks | 0 |',
  '| Review rounds | 0 |',
  '| Fix rounds | 0 |',
  '',
  'Status: complete',
  '',
].join('\n');

test('check warns when metrics are missing and still accepts the visual report', () => {
  const result = bash(hook, ['--check'], { input: good });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /warning: metrics missing/);
});

test('check warns on a partial metrics table without failing', () => {
  const body = `${good}\n## Metrics\n\n| Metric | Value |\n| --- | --- |\n| Wall | n/a |\n| Active | n/a |\n| Sessions | cursor 0, claude 0, opencode 0 |\n| Tokens | n/a |\n\nStatus: partial\n`;
  const result = bash(hook, ['--check'], { input: body });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /warning: metrics partial/);
});

test('check stays quiet when the metrics table is complete', () => {
  const result = bash(hook, ['--check'], { input: `${good}\n${metricsTable}` });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
});

test('a skipped visual report does not warn about metrics', () => {
  const result = bash(hook, ['--check'], { input: skipped });
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stderr, /metrics missing/);
});

test('pr-report inserts the metrics panel and prints the table', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pr-report-'));
  const git = (...args) => {
    const result = spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  };
  git('init', '-q', '-b', 'feat/demo-report');
  git('config', 'user.email', 't@t');
  git('config', 'user.name', 't');
  const html = path.join(dir, 'in.html');
  fs.writeFileSync(html, '<!doctype html><style>@media (max-width:600px){body{color:#111}}</style><main><p>demo</p></main>');
  const metrics = path.join(dir, 'in.metrics.json');
  fs.writeFileSync(metrics, JSON.stringify({
    feature: { repo: 'o/r', branch: 'feat/demo-report', pr: 4 },
    prs: [4],
    wall_ms: 60000,
    active_ms: 30000,
    idle_gap_min: 5,
    sessions: { cursor: 1, claude: 0, opencode: 0 },
    tools: [{ name: 'Read', count: 2 }],
    skills: [{ name: 'pr-visual-report', count: 1 }],
    agents: [{ name: 'main', calls: 2 }, { name: 'coder', calls: 1 }],
    tool_failures: 0,
    failure_tools: [],
    duration_ms: null,
    guard_blocks: 0,
    guards: {},
    review_rounds: 0,
    fix_rounds: 0,
    tokens: null,
    tokens_known: 0,
    events: 3,
    first_ts: '2026-10-27T10:00:00Z',
    last_ts: '2026-10-27T10:01:00Z',
    partial: false,
    prompt: 'SUPER_SECRET',
    args: '/home/secret',
  }));
  const stub = path.join(dir, 'shot.sh');
  fs.writeFileSync(stub, '#!/bin/bash\nbase=$(basename "$1" .html)\nprintf png > "$2/$base.png"\nprintf "%s\\n" "$2/$base.png"\n');
  fs.chmodSync(stub, 0o755);
  const art = path.join(dir, 'artifacts');
  fs.mkdirSync(art);
  const result = bash(report, [html, '--metrics', metrics], {
    cwd: dir,
    env: { ...process.env, AGENT_HARNESS_TEST: '1', PR_REPORT_SCREENSHOT: stub, PR_REPORT_ARTIFACT_DIR: art },
  });
  assert.equal(result.status, 0, result.stderr);
  const page = fs.readFileSync(path.join(dir, 'docs/pr-reports/feat-demo-report.html'), 'utf8');
  assert.equal(page.includes('id="kpi-metrics"'), true);
  assert.equal(page.includes('SUPER_SECRET'), false);
  assert.equal(page.includes('/home/secret'), false);
  assert.equal(/https?:/.test(page), false);
  const stored = fs.readFileSync(path.join(dir, 'docs/pr-reports/feat-demo-report.metrics.json'), 'utf8');
  assert.equal(stored.includes('SUPER_SECRET'), false);
  assert.equal(stored.includes('/home'), false);
  assert.match(result.stdout, /## Metrics/);
  assert.match(result.stdout, /\| Wall \| 1m00s \|/);
  assert.match(result.stdout, /\| Tokens \| n\/a \|/);
  assert.match(result.stdout, /Status: complete/);
});
