import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { matchSkill, readSkills, runEval } from '../eval-run.mjs';
import { buildHooks } from '../../cursor-plugin/lib.mjs';
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
  assert.equal(lines[0].harness_version, '0.4.23');
  assert.match(lines[0].ts, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(JSON.stringify(lines[0]).includes('super-secret-token'), false);
  assert.equal(JSON.stringify(lines[0]).includes('tool_input'), false);
});

test('kpi-emit records Claude token totals and leaves Cursor tokens null', () => {
  const home = tmpdir();
  const log = path.join(home, 'events.jsonl');
  const payload = JSON.stringify({
    hook_event_name: 'SessionStart',
    session_id: 'sess-2',
    source: 'startup',
    usage: { input_tokens: 3, output_tokens: 4 },
  });
  const claude = spawnSync('bash', [emit], {
    encoding: 'utf8',
    input: payload,
    env: { ...emitEnv(home, log), AGENT_HARNESS_TOOL: 'claude' },
  });
  assert.equal(claude.status, 0, claude.stderr);
  const event = JSON.parse(fs.readFileSync(log, 'utf8'));
  assert.equal(event.kind, 'session_start');
  assert.equal(event.tool, 'claude');
  assert.equal(event.tokens, 7);
  assert.equal(event.source, 'startup');

  const cursorLog = path.join(home, 'cursor.jsonl');
  const cursor = spawnSync('bash', [emit], {
    encoding: 'utf8',
    input: payload,
    env: emitEnv(home, cursorLog),
  });
  assert.equal(cursor.status, 0, cursor.stderr);
  assert.equal(JSON.parse(fs.readFileSync(cursorLog, 'utf8')).tokens, null);

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
  assert.equal(config.version, '0.4.23');
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

function linesOf(log) {
  return fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

function runEmit(home, log, payload, extra = {}) {
  return spawnSync('bash', [emit], {
    encoding: 'utf8',
    input: typeof payload === 'string' ? payload : JSON.stringify(payload),
    env: { ...emitEnv(home, log), ...extra },
  });
}

test('skill and task calls record sanitised names and drop prompts', () => {
  const home = tmpdir();
  const log = path.join(home, 'events.jsonl');
  const pre = path.join(repo, '.claude/hooks/pre-tool-use.sh');
  const skill = spawnSync('bash', [pre], {
    encoding: 'utf8',
    input: JSON.stringify({
      hook_event_name: 'PreToolUse',
      session_id: 'sess-skill',
      tool_name: 'Skill',
      tool_input: { skill: 'Fix-CI', args: 'SUPER_SECRET_PROMPT /var/secret/abs' },
    }),
    env: emitEnv(home, log),
  });
  assert.equal(skill.status, 0, skill.stderr);
  const skillLines = linesOf(log);
  assert.equal(skillLines.length, 1);
  assert.equal(skillLines[0].kind, 'tool_call');
  assert.equal(skillLines[0].tool_name, 'Skill');
  assert.equal(skillLines[0].skill, 'fix-ci');
  assert.equal(JSON.stringify(skillLines[0]).includes('SUPER_SECRET_PROMPT'), false);
  assert.equal(JSON.stringify(skillLines[0]).includes('/var/secret'), false);

  const taskLog = path.join(home, 'task.jsonl');
  const task = spawnSync('bash', [pre], {
    encoding: 'utf8',
    input: JSON.stringify({
      hook_event_name: 'PreToolUse',
      session_id: 'sess-task',
      tool_name: 'Task',
      tool_input: { subagent_type: 'code-reviewer', prompt: 'SUPER_SECRET_PROMPT', description: '/var/secret/abs' },
    }),
    env: emitEnv(home, taskLog),
  });
  assert.equal(task.status, 0, task.stderr);
  const taskLines = linesOf(taskLog);
  assert.deepEqual(taskLines.map((line) => line.kind), ['tool_call', 'subagent_spawn']);
  assert.equal(taskLines.every((line) => line.agent === 'code-reviewer' && line.tool_name === 'Task'), true);
  assert.equal(JSON.stringify(taskLines).includes('SUPER_SECRET_PROMPT'), false);
  assert.equal(JSON.stringify(taskLines).includes('/var/secret'), false);

  const bad = runEmit(home, path.join(home, 'bad.jsonl'), {
    hook_event_name: 'PreToolUse',
    session_id: 'sess-bad',
    tool_name: 'Skill',
    tool_input: { skill: '../etc/passwd', command: 'SUPER_SECRET_PROMPT' },
  }, { AGENT_HARNESS_TOOL: 'claude' });
  assert.equal(bad.status, 0, bad.stderr);
  const badEvent = linesOf(path.join(home, 'bad.jsonl'))[0];
  assert.equal(badEvent.skill, undefined);
  assert.equal(JSON.stringify(badEvent).includes('passwd'), false);
  assert.equal(JSON.stringify(badEvent).includes('SUPER_SECRET_PROMPT'), false);
});

test('post tool use records tool_result and never blocks', () => {
  const home = tmpdir();
  const log = path.join(home, 'events.jsonl');
  const started = Date.now();
  const ran = runEmit(home, log, {
    hook_event_name: 'PostToolUse',
    session_id: 'sess-r',
    tool_name: 'Bash',
    duration_ms: 18.9,
    tool_input: { command: 'cat /var/secret/abs' },
    tool_response: { stdout: 'SUPER_SECRET_OUTPUT', is_error: false },
  }, { AGENT_HARNESS_TOOL: 'claude' });
  assert.equal(ran.status, 0, ran.stderr);
  assert.ok(Date.now() - started < 2000);
  const event = linesOf(log)[0];
  assert.equal(event.kind, 'tool_result');
  assert.equal(event.tool_name, 'Bash');
  assert.equal(event.duration_ms, 18);
  assert.equal(event.ok, true);
  assert.equal(JSON.stringify(event).includes('SUPER_SECRET_OUTPUT'), false);
  assert.equal(JSON.stringify(event).includes('/var/secret'), false);

  const failed = runEmit(home, path.join(home, 'fail.jsonl'), {
    hook_event_name: 'PostToolUse',
    session_id: 'sess-f',
    tool_name: 'Bash',
    tool_response: { is_error: true, output: 'SUPER_SECRET_OUTPUT' },
    error: 'do not log this failure',
  }, { AGENT_HARNESS_TOOL: 'claude' });
  assert.equal(failed.status, 0, failed.stderr);
  const failEvent = linesOf(path.join(home, 'fail.jsonl'))[0];
  assert.equal(failEvent.ok, false);
  assert.equal(failEvent.duration_ms, null);
  assert.equal(JSON.stringify(failEvent).includes('SUPER_SECRET_OUTPUT'), false);
  assert.equal(JSON.stringify(failEvent).includes('do not log'), false);
});

test('Claude stop sums the transcript and SubagentStop derives the agent', () => {
  const home = tmpdir();
  const transcript = path.join(home, 'transcript.jsonl');
  fs.writeFileSync(transcript, [
    JSON.stringify({ type: 'user', message: { content: 'SUPER_SECRET_PROMPT' } }),
    JSON.stringify({
      type: 'assistant',
      message: {
        content: [{ type: 'tool_use', name: 'Agent', input: { subagent_type: 'coder', prompt: 'SUPER_SECRET_PROMPT' } }],
        usage: { input_tokens: 2, output_tokens: 3 },
      },
    }),
    JSON.stringify({ type: 'assistant', message: { usage: { input_tokens: 4, output_tokens: 1 } } }),
  ].join('\n'));
  const log = path.join(home, 'stop.jsonl');
  const stop = runEmit(home, log, {
    hook_event_name: 'Stop',
    session_id: 'sess-stop',
    transcript_path: transcript,
    usage: { input_tokens: 99, output_tokens: 1 },
    cwd: '/var/secret/abs',
  }, { AGENT_HARNESS_TOOL: 'claude' });
  assert.equal(stop.status, 0, stop.stderr);
  const ended = linesOf(log)[0];
  assert.equal(ended.kind, 'session_end');
  assert.equal(ended.tokens, 10);
  assert.equal(JSON.stringify(ended).includes('SUPER_SECRET_PROMPT'), false);
  assert.equal(JSON.stringify(ended).includes(transcript), false);
  assert.equal(JSON.stringify(ended).includes('/var/secret'), false);

  const subLog = path.join(home, 'sub.jsonl');
  const sub = runEmit(home, subLog, {
    hook_event_name: 'SubagentStop',
    session_id: 'sess-sub',
    transcript_path: transcript,
  }, { AGENT_HARNESS_TOOL: 'claude' });
  assert.equal(sub.status, 0, sub.stderr);
  const stopped = linesOf(subLog)[0];
  assert.equal(stopped.kind, 'subagent_stop');
  assert.equal(stopped.agent, 'coder');
  assert.equal(stopped.tokens, null);
  assert.equal(JSON.stringify(stopped).includes('SUPER_SECRET_PROMPT'), false);
  assert.equal(JSON.stringify(stopped).includes(transcript), false);

  const cursorLog = path.join(home, 'cursor-stop.jsonl');
  const cursor = runEmit(home, cursorLog, {
    hook_event_name: 'Stop',
    session_id: 'sess-cursor',
    transcript_path: transcript,
    usage: { input_tokens: 8, output_tokens: 8 },
  });
  assert.equal(cursor.status, 0, cursor.stderr);
  assert.equal(linesOf(cursorLog)[0].tokens, null);
  assert.equal(JSON.stringify(linesOf(cursorLog)[0]).includes(transcript), false);
});

test('an oversized transcript is skipped and a missing jq stays silent', () => {
  const home = tmpdir();
  const file = path.join(home, 'big.jsonl');
  const fd = fs.openSync(file, 'w');
  fs.writeSync(fd, Buffer.alloc(9 * 1024 * 1024, 0x0a));
  fs.writeSync(fd, Buffer.from('{"message":{"usage":{"input_tokens":5,"output_tokens":5}}}\n'));
  fs.closeSync(fd);
  const log = path.join(home, 'events.jsonl');
  const started = Date.now();
  const ran = runEmit(home, log, {
    hook_event_name: 'Stop',
    session_id: 'sess-big',
    transcript_path: file,
  }, { AGENT_HARNESS_TOOL: 'claude' });
  assert.equal(ran.status, 0, ran.stderr);
  assert.ok(Date.now() - started < 2000);
  assert.equal(linesOf(log)[0].tokens, null);
  assert.equal(JSON.stringify(linesOf(log)[0]).includes(file), false);

  const quiet = path.join(home, 'no-jq.jsonl');
  const bin = path.join(home, 'bin');
  fs.mkdirSync(bin);
  fs.symlinkSync('/bin/bash', path.join(bin, 'bash'));
  const hidden = spawnSync(path.join(bin, 'bash'), [emit], {
    encoding: 'utf8',
    input: JSON.stringify({ hook_event_name: 'PostToolUse', tool_name: 'Read', session_id: 's' }),
    env: { ...emitEnv(home, quiet), PATH: bin },
  });
  assert.equal(hidden.status, 0);
  assert.equal(fs.existsSync(quiet), false);

  const off = path.join(home, 'off.jsonl');
  const disabled = runEmit(home, off, { hook_event_name: 'PostToolUse', tool_name: 'Read', session_id: 's' }, {
    AGENT_HARNESS_KPI: '0',
  });
  assert.equal(disabled.status, 0);
  assert.equal(fs.existsSync(off), false);
});

test('cursor adapter records postToolUse and subagent type without secrets', () => {
  const home = tmpdir();
  const log = path.join(home, 'events.jsonl');
  const adapter = path.join(repo, 'scripts/cursor-plugin/cursor-adapter.sh');
  const ran = spawnSync('bash', [adapter, emit, 'postToolUse'], {
    encoding: 'utf8',
    input: JSON.stringify({
      tool_name: 'Skill',
      tool_input: { skill: 'pr-visual-report', args: 'SUPER_SECRET_PROMPT' },
      tool_output: 'SUPER_SECRET_OUTPUT',
      duration_ms: 20,
      conversation_id: 'conv-9',
      hook_event_name: 'postToolUse',
      transcript_path: '/var/secret/abs.jsonl',
      error: null,
    }),
    env: emitEnv(home, log),
  });
  assert.equal(ran.status, 0, ran.stderr);
  assert.deepEqual(JSON.parse(ran.stdout), {});
  const event = linesOf(log)[0];
  assert.equal(event.kind, 'tool_result');
  assert.equal(event.tool, 'cursor');
  assert.equal(event.tool_name, 'Skill');
  assert.equal(event.skill, 'pr-visual-report');
  assert.equal(event.duration_ms, 20);
  assert.equal(event.ok, true);
  assert.equal(event.tokens, null);
  assert.equal(JSON.stringify(event).includes('SUPER_SECRET'), false);
  assert.equal(JSON.stringify(event).includes('/var/secret'), false);

  const failLog = path.join(home, 'fail.jsonl');
  const failed = spawnSync('bash', [adapter, emit, 'postToolUse'], {
    encoding: 'utf8',
    input: JSON.stringify({
      tool_name: 'Shell',
      tool_input: { command: 'SUPER_SECRET_PROMPT' },
      tool_output: 'SUPER_SECRET_OUTPUT',
      error: 'secret failure text',
      duration: 4,
      conversation_id: 'conv-9',
    }),
    env: emitEnv(home, failLog),
  });
  assert.equal(failed.status, 0, failed.stderr);
  assert.deepEqual(JSON.parse(failed.stdout), {});
  const failEvent = linesOf(failLog)[0];
  assert.equal(failEvent.tool_name, 'Bash');
  assert.equal(failEvent.ok, false);
  assert.equal(failEvent.duration_ms, 4);
  assert.equal(JSON.stringify(failEvent).includes('SUPER_SECRET'), false);
  assert.equal(JSON.stringify(failEvent).includes('secret failure'), false);

  const subLog = path.join(home, 'sub.jsonl');
  const fixture = JSON.parse(fs.readFileSync(path.join(repo, 'scripts/cursor-plugin/fixtures/subagent-stop.json'), 'utf8'));
  const sub = spawnSync('bash', [adapter, path.join(repo, '.claude/hooks/subagent-stop.sh'), 'subagentStop'], {
    encoding: 'utf8',
    input: JSON.stringify(fixture),
    env: emitEnv(home, subLog),
  });
  assert.equal(sub.status, 0, sub.stderr);
  assert.deepEqual(JSON.parse(sub.stdout), {});
  const stopped = linesOf(subLog)[0];
  assert.equal(stopped.kind, 'subagent_stop');
  assert.equal(stopped.agent, 'generalPurpose');
  assert.equal(stopped.tokens, null);
  assert.equal(JSON.stringify(stopped).includes('Explore the authentication'), false);
  assert.equal(JSON.stringify(stopped).includes('/path/to/subagent'), false);
});

test('hooks are registered for Claude, Cursor, OpenCode, and project installs', () => {
  const settings = JSON.parse(fs.readFileSync(path.join(repo, '.claude/settings.json'), 'utf8'));
  const post = settings.hooks.PostToolUse.flatMap((entry) => entry.hooks.map((hook) => hook.command));
  assert.equal(post.includes('bash ~/.claude/hooks/kpi-emit.sh'), true);
  const install = fs.readFileSync(path.join(repo, 'install.sh'), 'utf8');
  assert.match(install, /addhook\("PostToolUse"; ""; "bash " \+ \$h \+ "\/kpi-emit\.sh"\)/);
  const config = JSON.parse(fs.readFileSync(path.join(repo, 'scripts/cursor-plugin/config.json'), 'utf8'));
  const built = buildHooks(settings, config.hooks.include);
  const commands = JSON.stringify(built.json.hooks);
  assert.match(commands, /kpi-emit\.sh postToolUse/);
  assert.match(commands, /kpi-emit\.sh sessionEnd/);
  assert.match(commands, /kpi-emit\.sh sessionStart/);
  const plugin = fs.readFileSync(path.join(repo, 'plugins/kpi.ts'), 'utf8');
  assert.match(plugin, /tool\.execute\.before/);
  assert.match(plugin, /tool\.execute\.after/);
  assert.match(plugin, /message\.updated/);
});

test('report tolerates skill, agent, and tool_result fields', () => {
  const base = {
    variant: 'conductor', tool: 'cursor', repo: 'o/r', branch: 'feat', tokens: null, harness_version: '0.4.23',
  };
  const events = [
    { ...base, ts: '2026-10-20T00:00:00Z', kind: 'session_start', session_id: 's', skill: 'fix-ci' },
    { ...base, ts: '2026-10-20T00:00:01Z', kind: 'tool_call', session_id: 's', tool_name: 'Skill', skill: 'fix-ci' },
    { ...base, ts: '2026-10-20T00:00:02Z', kind: 'tool_result', session_id: 's', tool_name: 'Skill', skill: 'fix-ci', duration_ms: 12, ok: true },
    { ...base, ts: '2026-10-20T00:00:03Z', kind: 'tool_call', session_id: 's', tool_name: 'Task', agent: 'coder' },
    { ...base, ts: '2026-10-20T00:00:04Z', kind: 'subagent_spawn', session_id: 's', agent: 'coder' },
    { ...base, ts: '2026-10-20T00:00:05Z', kind: 'subagent_stop', session_id: 'child', agent: 'coder', tokens: 9 },
    { ...base, ts: '2026-10-20T00:00:06Z', kind: 'tool_result', session_id: 's', tool_name: 'Bash', duration_ms: null, ok: false },
    { ...base, ts: '2026-10-20T00:01:00Z', kind: 'session_end', session_id: 's', tokens: 4 },
  ];
  const report = aggregate(events);
  assert.equal(report.variants.conductor.tasks, 1);
  assert.equal(report.variants.conductor.tool_calls_per_task, 2);
  assert.equal(report.variants.conductor.tokens_per_task, 4);
  assert.equal(readEvents(`${JSON.stringify(events[2])}\nnot json\n`).length, 1);
  assert.match(formatText(report), /conductor/);
  assert.match(formatHtml(report), /conductor/);
});
