import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export const HARNESSES = ['cursor', 'opencode', 'claude'];

export const OVERRIDE_REL = {
  cursor: '.cursor/skills/verify-this',
  opencode: '.opencode/skills/verify-this',
  claude: '.claude/skills/verify-this',
};

// No shell. Only this shape is spawned, so a pipe or an extra argument cannot ride along.
export const RUNNABLE_COMMAND = String.raw`^(?:npm|pnpm|yarn|bun) run [A-Za-z0-9:_./-]+$|^(?:npm|pnpm|yarn|bun) test$|^dotnet (?:build|test)(?: [A-Za-z0-9_./+-]+)?$|^make [A-Za-z0-9_.-]+$`;

const runnableCommand = new RegExp(RUNNABLE_COMMAND);
const SCRIPT_NAME = /^[A-Za-z0-9:_./-]+$/;
const MAKE_TARGET = /^([A-Za-z0-9][A-Za-z0-9_.-]*)::?/;
const SKIP_DIRS = new Set(['node_modules', 'bin', 'obj', '.git', 'dist', 'out', 'coverage', '.next', '.angular']);
const COMMAND_ORDER = ['build', 'test', 'e2e', 'api'];
const UI_CONFIGS = [
  'playwright.config.ts', 'playwright.config.js', 'playwright.config.mjs', 'playwright.config.cjs',
  'cypress.config.ts', 'cypress.config.js', 'cypress.config.mjs',
];

export function isRunnableCommand(command) {
  return runnableCommand.test(command);
}

export function commandArgv(command) {
  if (!isRunnableCommand(command)) return null;
  return command.split(' ');
}

export function detectHarness(env = process.env) {
  const forced = env.VERIFY_HARNESS;
  if (forced === 'cursor' || forced === 'opencode' || forced === 'claude') return forced;
  if (env.CURSOR_AGENT || env.CURSOR_PLUGIN_ROOT) return 'cursor';
  if (env.CLAUDE_CODE_ENTRYPOINT || env.CLAUDE_CODE_REMOTE || env.CLAUDE_CODE_REMOTE_SESSION_ID || env.CLAUDE_PROJECT_DIR) return 'claude';
  if (env.OPENCODE || env.OPENCODE_CLIENT) return 'opencode';
  return null;
}

export function packageManager(root) {
  if (!fs.existsSync(path.join(root, 'package.json'))) return null;
  if (fs.existsSync(path.join(root, 'bun.lock')) || fs.existsSync(path.join(root, 'bun.lockb'))) return 'bun';
  if (fs.existsSync(path.join(root, 'pnpm-lock.yaml'))) return 'pnpm';
  if (fs.existsSync(path.join(root, 'yarn.lock'))) return 'yarn';
  return 'npm';
}

function commandFor(pm, script) {
  if (script === 'test' && pm !== 'bun') return `${pm} test`;
  return `${pm} run ${script}`;
}

function readText(file) {
  return fs.readFileSync(file, 'utf8');
}

function walkFiles(root, maxDepth, accept) {
  const found = [];
  function walk(dir, depth) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (depth < maxDepth) walk(abs, depth + 1);
      } else if (accept(entry.name, abs)) found.push(abs);
    }
  }
  walk(root, 0);
  return found.sort();
}

function makefileTargets(root) {
  const file = path.join(root, 'Makefile');
  if (!fs.existsSync(file)) return new Set();
  const targets = new Set();
  for (const line of readText(file).split('\n')) {
    if (line.startsWith('#') || line.startsWith('\t') || line.startsWith(' ')) continue;
    const match = MAKE_TARGET.exec(line);
    if (match) targets.add(match[1]);
  }
  return targets;
}

function dotnetProject(root) {
  const files = walkFiles(root, 3, (name) => name.endsWith('.sln') || name.endsWith('.csproj'));
  const sln = files.find((file) => file.endsWith('.sln'));
  const chosen = sln ?? files.find((file) => file.endsWith('.csproj'));
  return chosen ? path.relative(root, chosen).split(path.sep).join('/') : null;
}

function ciFiles(root) {
  const files = [];
  const workflows = path.join(root, '.github', 'workflows');
  if (fs.existsSync(workflows)) {
    for (const name of fs.readdirSync(workflows).sort()) {
      if (name.endsWith('.yml') || name.endsWith('.yaml')) files.push(path.join(workflows, name));
    }
  }
  for (const name of ['.gitlab-ci.yml', 'azure-pipelines.yml']) {
    const abs = path.join(root, name);
    if (fs.existsSync(abs)) files.push(abs);
  }
  return files;
}

function unquote(value) {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

export function ciRunCommands(text) {
  const lines = text.split('\n');
  const commands = [];
  for (let i = 0; i < lines.length; i += 1) {
    const match = /^(?<indent>\s*)(?:-\s*)?(?:run|script):\s*(?<value>.*)$/.exec(lines[i]);
    if (!match) continue;
    const value = match.groups.value.trim();
    if (value === '|' || value === '>' || value === '|-' || value === '>-') {
      const block = [];
      const min = match.groups.indent.length + 1;
      for (let j = i + 1; j < lines.length; j += 1) {
        if (lines[j].trim() === '') continue;
        const indent = lines[j].match(/^\s*/)[0].length;
        if (indent < min) break;
        block.push(lines[j].trim());
        i = j;
      }
      if (block.length) commands.push(block.join(' && '));
    } else if (value) commands.push(unquote(value));
  }
  return commands;
}

function classify(command) {
  if (/\be2e\b|\bplaywright\b|\bcypress\b/.test(command)) return 'e2e';
  if (/\b(?:npm|pnpm|yarn|bun)\s+run\s+build\b|\bdotnet build\b|\bmake build\b/.test(command)) return 'build';
  if (/\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?test\b|\bdotnet test\b|\bmake test\b/.test(command)) return 'test';
  return null;
}

function e2eKind(root) {
  if (fs.existsSync(path.join(root, 'angular.json'))) return 'ui';
  if (UI_CONFIGS.some((name) => fs.existsSync(path.join(root, name)))) return 'ui';
  return 'e2e';
}

function launchUrl(root) {
  const files = walkFiles(
    root,
    4,
    (name, abs) => name === 'launchSettings.json' && path.basename(path.dirname(abs)) === 'Properties',
  );
  for (const file of files) {
    let json;
    try {
      json = JSON.parse(readText(file));
    } catch {
      continue;
    }
    for (const profile of Object.values(json.profiles ?? {})) {
      const raw = profile?.applicationUrl;
      if (typeof raw !== 'string') continue;
      const url = raw.split(';').map((part) => part.trim()).find((part) => /^https?:\/\/\S+$/.test(part));
      if (url) return url;
    }
  }
  return null;
}

function pickScript(scripts, keys) {
  return keys.find((key) => typeof scripts[key] === 'string' && SCRIPT_NAME.test(key));
}

export function discover(root) {
  const abs = path.resolve(root);
  const commands = [];
  const evidence = [];
  const taken = new Set();

  function add(id, kind, command, source, run = true) {
    if (taken.has(id) || (run && !isRunnableCommand(command))) {
      evidence.push({ source, command });
      return;
    }
    taken.add(id);
    commands.push({ id, kind, command, source, run });
  }

  const pm = packageManager(abs);
  if (pm) {
    let scripts = {};
    try {
      scripts = JSON.parse(readText(path.join(abs, 'package.json'))).scripts ?? {};
    } catch {
      scripts = {};
    }
    const build = pickScript(scripts, ['build']);
    const test = pickScript(scripts, ['test']);
    const e2e = pickScript(scripts, ['e2e', 'test:e2e', 'e2e:ci']);
    if (build) add('build', 'build', commandFor(pm, build), 'package.json');
    if (test) add('test', 'code', commandFor(pm, test), 'package.json');
    if (e2e) add('e2e', e2eKind(abs), commandFor(pm, e2e), 'package.json');
  }

  const make = makefileTargets(abs);
  if (make.has('build')) add('build', 'build', 'make build', 'Makefile');
  if (make.has('test')) add('test', 'code', 'make test', 'Makefile');
  if (make.has('e2e')) add('e2e', e2eKind(abs), 'make e2e', 'Makefile');

  const dotnet = dotnetProject(abs);
  if (dotnet) {
    add('build', 'build', `dotnet build ${dotnet}`, dotnet);
    add('test', 'code', `dotnet test ${dotnet}`, dotnet);
  }

  for (const file of ciFiles(abs)) {
    const rel = path.relative(abs, file).split(path.sep).join('/');
    for (const command of ciRunCommands(readText(file))) {
      const slot = classify(command);
      if (!slot) continue;
      const id = slot;
      const kind = slot === 'test' ? 'code' : slot === 'e2e' ? e2eKind(abs) : 'build';
      add(id, kind, command, rel);
    }
  }

  const api = launchUrl(abs);
  if (api) {
    commands.push({
      id: 'api',
      kind: 'api',
      command: `curl -fsS ${api}`,
      source: 'Properties/launchSettings.json',
      run: false,
    });
  }

  commands.sort((a, b) => COMMAND_ORDER.indexOf(a.id) - COMMAND_ORDER.indexOf(b.id));
  return { packageManager: pm, commands, evidence };
}

const KIND_LABEL = {
  build: 'Build',
  code: 'Code behavior',
  ui: 'UI',
  e2e: 'End-to-end',
  api: 'API',
};

function renderSkill(spec) {
  const commandLines = spec.commands.map((entry) => {
    const mode = entry.run ? 'run' : 'do not run automatically';
    return `- **${KIND_LABEL[entry.kind] ?? entry.kind}** (\`${entry.id}\`, ${mode}): \`${entry.command}\` — from \`${entry.source}\`.`;
  });
  const evidenceLines = spec.evidence.length
    ? spec.evidence.map((entry) => `- \`${entry.command}\` — seen in \`${entry.source}\`, not selected.`)
    : ['- None.'];
  return `---
name: verify-this
description: "Project override of verify-this. Use when the user asks to verify this, prove it works, did this fix it, or show me the evidence. Runs this repository's build, test, and e2e commands."
---

# Verify This (project override)

This file is the project override of the generic verify-this skill. \`create-verification-skill\` wrote it. Re-run that skill when the build or test commands change.

why-not-tooled: the generator records the commands; judging whether a claim is falsifiable is not a check a linter can make.

## Commands

Run from the repository root. \`node scripts/run.mjs\` executes every command marked run, in order, and stops on the first failure. Commands marked "do not run automatically" are for a claim that names that surface.

${commandLines.join('\n')}

## Other commands seen

${evidenceLines.join('\n')}

## Workflow

1. Restate the claim in falsifiable form: condition, metric, and threshold.
2. Pick the smallest surface above that can disprove it.
3. Capture a baseline from the old state: merge base, parent commit, or the current broken repro.
4. Capture treatment from the changed state with the same command, data, and environment.
5. Compare the raw output.
6. Return exactly one verdict: \`VERIFIED\`, \`NOT VERIFIED\`, or \`INCONCLUSIVE\`.

Baseline checkout, when writing under \`/tmp\` is acceptable:

\`\`\`bash
git archive <base-ref> | tar -x -C /tmp/verify-this/<slug>/baseline-src
\`\`\`

## Verdict

- \`VERIFIED\`: baseline and treatment differ in the predicted direction, by the claimed threshold, with no obvious confound.
- \`NOT VERIFIED\`: the behavior is unchanged, moves the wrong way, or misses the threshold.
- \`INCONCLUSIVE\`: no valid baseline, noisy signal, failed measurement, or an environment difference invalidates the comparison.

## Output

\`\`\`text
VERIFIED | NOT VERIFIED | INCONCLUSIVE
Claim: <falsifiable claim>

Evidence:
<metric/artifact>: baseline=<...>, treatment=<...>, delta=<...>, threshold=<...>

Reasoning:
<one tight paragraph naming the evidence and any confounds>
\`\`\`

A green build is required and does not make a claim VERIFIED.
`;
}

function runnerSource() {
  return `#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const runnable = new RegExp(${JSON.stringify(RUNNABLE_COMMAND)});
const skillDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const spec = JSON.parse(fs.readFileSync(path.join(skillDir, 'commands.json'), 'utf8'));
const root = path.resolve(skillDir, '../../..');
if (spec.version !== 1 || !Array.isArray(spec.commands)) {
  console.error('commands.json is not a verify-this override');
  process.exit(1);
}
for (const entry of spec.commands) {
  if (!entry.run) continue;
  if (!runnable.test(entry.command)) {
    console.error('refusing command: ' + entry.command);
    process.exit(1);
  }
  const argv = entry.command.split(' ');
  const child = spawnSync(argv[0], argv.slice(1), { cwd: root, stdio: 'inherit', env: process.env });
  if ((child.status ?? 1) !== 0) process.exit(child.status ?? 1);
}
`;
}

export function generate(root, harness) {
  if (!OVERRIDE_REL[harness]) {
    throw new Error(`unknown harness: ${harness}`);
  }
  const discovered = discover(root);
  const runnable = discovered.commands.filter((entry) => entry.run);
  if (runnable.length === 0) {
    return { written: false, spec: { ...discovered, version: 1, harness }, dir: null };
  }
  const dir = path.join(path.resolve(root), OVERRIDE_REL[harness]);
  const spec = {
    version: 1,
    harness,
    packageManager: discovered.packageManager,
    commands: discovered.commands,
    evidence: discovered.evidence,
  };
  fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'commands.json'), `${JSON.stringify(spec, null, 2)}\n`);
  fs.writeFileSync(path.join(dir, 'SKILL.md'), renderSkill(spec));
  fs.writeFileSync(path.join(dir, 'scripts', 'run.mjs'), runnerSource());
  return { written: true, spec, dir };
}

function readSpec(file) {
  try {
    const spec = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (spec?.version !== 1 || !Array.isArray(spec.commands)) return null;
    return spec;
  } catch {
    return null;
  }
}

export function resolveOverride(root, harness) {
  const abs = path.resolve(root);
  const order = [];
  if (OVERRIDE_REL[harness]) order.push(harness);
  for (const name of HARNESSES) {
    if (!order.includes(name)) order.push(name);
  }
  for (const name of order) {
    const dir = path.join(abs, OVERRIDE_REL[name]);
    const skill = path.join(dir, 'SKILL.md');
    const spec = readSpec(path.join(dir, 'commands.json'));
    if (fs.existsSync(skill) && spec) return { kind: 'override', harness: name, dir, skill, spec };
  }
  return { kind: 'default' };
}

export function runCommands(root, spec) {
  const results = [];
  if (!spec || spec.version !== 1 || !Array.isArray(spec.commands)) {
    return { status: 1, results, error: 'commands.json is not a verify-this override' };
  }
  for (const entry of spec.commands) {
    if (!entry.run) continue;
    const argv = commandArgv(entry.command);
    if (!argv) return { status: 1, results, error: `refusing command: ${entry.command}` };
    const child = spawnSync(argv[0], argv.slice(1), { cwd: root, encoding: 'utf8', env: process.env });
    const status = child.status ?? 1;
    results.push({
      id: entry.id,
      command: entry.command,
      status,
      stdout: child.stdout ?? '',
      stderr: child.stderr ?? '',
    });
    if (status !== 0) return { status, results };
  }
  return { status: 0, results };
}
