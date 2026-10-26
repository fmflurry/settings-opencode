import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const defaultTasksDir = path.resolve(here, '../../evals/tasks');
export const defaultFixturesDir = path.resolve(here, '../../evals/fixtures');
export const defaultSkillsDir = path.resolve(here, '../../skills');
export const emitScript = path.resolve(here, '../../.claude/hooks/kpi-emit.sh');

const DEFAULT_MODEL = 'grok-4.7-medium';

export function parseTask(text) {
  const data = {};
  for (const line of String(text).split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf(':');
    if (idx < 1) continue;
    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    data[key] = value;
  }
  if (!data.id || !data.kind) throw new Error('task needs id and kind');
  return data;
}

export function loadTasks(tasksDir) {
  return fs.readdirSync(tasksDir)
    .filter((name) => name.endsWith('.yaml'))
    .sort()
    .map((name) => parseTask(fs.readFileSync(path.join(tasksDir, name), 'utf8')));
}

function norm(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

export function readSkills(dir) {
  if (!fs.existsSync(dir)) return [];
  const found = [];
  for (const name of fs.readdirSync(dir)) {
    const file = path.join(dir, name, 'SKILL.md');
    if (!fs.existsSync(file)) continue;
    const text = fs.readFileSync(file, 'utf8');
    const front = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
    if (!front) continue;
    const skillName = /^name:\s*(.+)$/m.exec(front[1]);
    const description = /^description:\s*(.+)$/m.exec(front[1]);
    if (!skillName) continue;
    found.push({ name: skillName[1].trim(), description: (description?.[1] ?? '').trim() });
  }
  return found;
}

export function matchSkill(prompt, skills) {
  const promptN = norm(prompt);
  const tokens = promptN.split(' ').filter((token) => token.length > 1);
  let best = null;
  let bestScore = -1;
  const seen = new Set();
  for (const skill of skills) {
    if (seen.has(skill.name)) continue;
    seen.add(skill.name);
    const name = norm(skill.name);
    let score = 0;
    if (name === promptN) score += 10;
    for (const token of tokens) {
      if (name.split(' ').includes(token)) score += 3;
      if (norm(skill.description).split(' ').includes(token)) score += 1;
    }
    if (score > bestScore) {
      best = skill.name;
      bestScore = score;
    }
  }
  return { skill: best, score: bestScore };
}

function checkerEnv() {
  // node:test sets NODE_TEST_CONTEXT. A nested `node --test` then skips the files and exits 0.
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key === 'NODE_CHANNEL_FD' || key.startsWith('NODE_TEST')) delete env[key];
  }
  return env;
}

function runCheck(workdir, spec) {
  const [op, ...rest] = spec.split(/\s+/);
  if (op === 'node-test') {
    const result = spawnSync(process.execPath, ['--test', ...rest], { cwd: workdir, encoding: 'utf8', env: checkerEnv() });
    return result.status === 0;
  }
  if (op === 'json-script') {
    const expected = rest.join(' ');
    const pkg = JSON.parse(fs.readFileSync(path.join(workdir, 'package.json'), 'utf8'));
    return pkg.scripts?.test === expected;
  }
  if (op === 'heading') {
    const [file, ...words] = rest;
    const text = fs.readFileSync(path.join(workdir, file), 'utf8');
    return text.split('\n').some((line) => line.startsWith('# ') && line.slice(2).trim() === words.join(' '));
  }
  if (op === 'contains') {
    const [file, ...words] = rest;
    return fs.readFileSync(path.join(workdir, file), 'utf8').includes(words.join(' '));
  }
  throw new Error(`unknown checker ${op}`);
}

function copyChildren(src, dest) {
  for (const name of fs.readdirSync(src)) {
    if (name === 'gold') continue;
    fs.cpSync(path.join(src, name), path.join(dest, name), { recursive: true });
  }
}

function copyFixture(src, dest, { gold }) {
  copyChildren(src, dest);
  if (!gold) return;
  const overlay = path.join(src, 'gold');
  if (fs.existsSync(overlay)) copyChildren(overlay, dest);
}

function git(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || `git ${args.join(' ')} failed`);
}

function record(log, home, work, variant, fields) {
  const args = [
    'eval_result',
    `task=${fields.task}`,
    `task_kind=${fields.task_kind}`,
    `pass=${fields.pass ? 'true' : 'false'}`,
    `mode=${fields.mode}`,
    `wall_ms=${fields.wall_ms}`,
  ];
  if (fields.tokens != null) args.push(`tokens=${fields.tokens}`);
  if (fields.tool_calls != null) args.push(`tool_calls=${fields.tool_calls}`);
  const result = spawnSync('bash', [emitScript, ...args], {
    cwd: work,
    encoding: 'utf8',
    env: {
      ...process.env,
      HOME: home,
      AGENT_HARNESS_KPI: '1',
      AGENT_HARNESS_KPI_LOG: log,
      AGENT_HARNESS_TEST: '1',
      AGENT_HARNESS_TOOL: 'cursor',
      AGENT_HARNESS_VARIANT: variant,
    },
  });
  if (result.status !== 0) throw new Error(result.stderr || 'kpi-emit failed');
}

function prepareHome(root, variant) {
  const home = path.join(root, `home-${variant}`);
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  fs.mkdirSync(path.join(home, '.config', 'opencode'), { recursive: true });
  fs.writeFileSync(path.join(home, '.claude', '.harness-variant'), `${variant}\n`);
  fs.writeFileSync(path.join(home, '.config', 'opencode', '.harness-variant'), `${variant}\n`);
  return home;
}

function runModel(work, home, task) {
  const cmd = process.env.AGENT_HARNESS_EVAL_CMD;
  if (!cmd) {
    throw new Error('AGENT_HARNESS_EVAL_CMD is required for --run-model. Default eval only runs local checkers.');
  }
  const parts = cmd.split(/\s+/).filter(Boolean);
  const model = process.env.AGENT_HARNESS_EVAL_MODEL || DEFAULT_MODEL;
  const result = spawnSync(parts[0], parts.slice(1), {
    cwd: work,
    encoding: 'utf8',
    timeout: Number(process.env.AGENT_HARNESS_EVAL_TIMEOUT_MS || 900000),
    env: {
      ...process.env,
      HOME: home,
      AGENT_HARNESS_EVAL_PROMPT: task.prompt || '',
      AGENT_HARNESS_EVAL_MODEL: model,
      AGENT_HARNESS_VARIANT: task.variant,
    },
  });
  return { status: result.status, tokens: null, tool_calls: null };
}

export function runEval(options = {}) {
  const tasksDir = options.tasksDir || defaultTasksDir;
  const fixturesDir = options.fixturesDir || defaultFixturesDir;
  const skills = options.skills || readSkills(options.skillsDir || defaultSkillsDir);
  const variants = options.variants || ['conductor', 'monolith'];
  const mode = options.mode === 'model' ? 'model' : 'checker';
  const log = options.log;
  if (!log) throw new Error('log path is required');
  const selected = loadTasks(tasksDir).filter((task) => !options.task || task.id === options.task);
  if (selected.length === 0) throw new Error(`no tasks in ${tasksDir}`);
  const results = [];
  for (const task of selected) {
    for (const variant of variants) {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-eval-'));
      const started = Date.now();
      try {
        const home = prepareHome(root, variant);
        let pass = false;
        let tokens = null;
        let toolCalls = null;
        if (task.kind === 'skill') {
          const matched = matchSkill(task.prompt || '', skills);
          pass = matched.skill === task.expect_skill;
        } else {
          const fixture = path.join(fixturesDir, task.fixture || task.id);
          const repo = path.join(root, 'repo');
          fs.mkdirSync(repo);
          git(repo, ['init', '-q', '-b', 'master']);
          git(repo, ['config', 'user.email', 'eval@harness.local']);
          git(repo, ['config', 'user.name', 'eval']);
          fs.writeFileSync(path.join(repo, '.gitkeep'), '');
          git(repo, ['add', '.gitkeep']);
          git(repo, ['commit', '-qm', 'init']);
          const work = path.join(root, variant);
          git(repo, ['worktree', 'add', '-q', '-b', `eval-${variant}`, work]);
          copyFixture(fixture, work, { gold: false });
          const before = task.before === 'pass';
          if (runCheck(work, task.check) !== before) pass = false;
          else if (task.shape && runCheck(work, task.shape) !== false) pass = false;
          else if (mode === 'model') {
            const ran = runModel(work, home, { ...task, variant });
            tokens = ran.tokens;
            toolCalls = ran.tool_calls;
            pass = ran.status === 0 && runCheck(work, task.check) && (!task.shape || runCheck(work, task.shape));
          } else {
            copyFixture(fixture, work, { gold: true });
            pass = runCheck(work, task.check) && (!task.shape || runCheck(work, task.shape));
          }
        }
        const wall = Date.now() - started;
        record(log, home, root, variant, {
          task: task.id,
          task_kind: task.kind,
          pass,
          mode,
          wall_ms: wall,
          tokens,
          tool_calls: toolCalls,
        });
        results.push({ task: task.id, variant, pass, wall_ms: wall, mode });
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    }
  }
  return { mode, model: mode === 'model' ? (process.env.AGENT_HARNESS_EVAL_MODEL || DEFAULT_MODEL) : null, results };
}

function usage() {
  return `usage: agent-harness eval [--run-model] [--task id] [--log path]
Default mode runs evals/tasks locally in throwaway worktrees and homes. No model call, no token cost.
--run-model needs AGENT_HARNESS_EVAL_CMD (a Cursor agent command). Default model is ${DEFAULT_MODEL}.
One model session per task per variant. The shipped suite is 10 tasks x 2 variants.
Results append to the same KPI log as the hooks.
`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const argv = process.argv.slice(2);
    let mode = 'checker';
    let task = null;
    let log = process.env.AGENT_HARNESS_KPI_LOG || path.join(os.homedir(), '.agent-harness', 'kpi', 'events.jsonl');
    for (let i = 0; i < argv.length; i += 1) {
      const arg = argv[i];
      if (arg === '--run-model') mode = 'model';
      else if (arg === '--task') task = argv[++i];
      else if (arg === '--log') log = argv[++i];
      else if (arg === '--help' || arg === '-h') {
        process.stdout.write(usage());
        process.exit(0);
      } else throw new Error(`unknown argument ${arg}`);
    }
    const summary = runEval({ mode, task, log });
    const passed = summary.results.filter((item) => item.pass).length;
    process.stdout.write(`eval ${summary.mode}: ${passed}/${summary.results.length} passed\n`);
    for (const item of summary.results) {
      process.stdout.write(`${item.pass ? 'pass' : 'fail'}  ${item.variant}  ${item.task}  ${item.wall_ms}ms\n`);
    }
    process.exitCode = passed === summary.results.length ? 0 : 1;
  } catch (error) {
    process.stderr.write(`${error.message}\n${usage()}`);
    process.exitCode = 2;
  }
}
