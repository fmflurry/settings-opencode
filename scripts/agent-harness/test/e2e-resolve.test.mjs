import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { detectHarness, resolveE2E } from '../../../skills/e2e/scripts/lib.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const resolveBin = path.join(repo, 'skills/e2e/scripts/resolve.mjs');

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-resolve-'));
}

function writeOverride(root, harness, body) {
  const rel = {
    cursor: '.cursor/skills/e2e/e2e.json',
    opencode: '.opencode/skills/e2e/e2e.json',
    claude: '.claude/skills/e2e/e2e.json',
  }[harness];
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(body));
}

test('detectHarness prefers an explicit value, then Cursor, then Claude, then OpenCode', () => {
  assert.equal(detectHarness({ VERIFY_HARNESS: 'opencode', CURSOR_AGENT: '1' }), 'opencode');
  assert.equal(detectHarness({ CURSOR_AGENT: '1', CLAUDE_PROJECT_DIR: '/x' }), 'cursor');
  assert.equal(detectHarness({ CURSOR_PLUGIN_ROOT: '/plugin' }), 'cursor');
  assert.equal(detectHarness({ CLAUDE_PROJECT_DIR: '/x' }), 'claude');
  assert.equal(detectHarness({ OPENCODE: '1' }), 'opencode');
  assert.equal(detectHarness({}), null);
});

test('the project override supplies start, ports, and the test command', () => {
  const root = tmp();
  writeOverride(root, 'cursor', {
    version: 1,
    start: 'npm run dev',
    ports: [4173],
    baseUrl: 'http://127.0.0.1:4173',
    test: 'npm run test:e2e',
    cwd: 'e2e',
    runner: 'playwright',
    skills: ['playwright-e2e-authoring'],
  });
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ scripts: { 'test:e2e': 'echo discovered' } }));
  const got = resolveE2E(root, 'cursor');
  assert.equal(got.ok, true);
  assert.equal(got.source, 'override');
  assert.equal(got.excluded, false);
  assert.deepEqual(got.start, ['npm run dev']);
  assert.deepEqual(got.ports, [4173]);
  assert.equal(got.baseUrl, 'http://127.0.0.1:4173');
  assert.equal(got.test, 'npm run test:e2e');
  assert.equal(got.cwd, 'e2e');
  assert.equal(got.runner, 'playwright');
  assert.deepEqual(got.skills, ['playwright-e2e-authoring']);
});

test('enabled false excludes e2e and ignores a discovered runner', () => {
  const root = tmp();
  writeOverride(root, 'cursor', { version: 1, enabled: false });
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ scripts: { 'test:e2e': 'echo discovered' } }));
  const got = resolveE2E(root, 'cursor');
  assert.equal(got.excluded, true);
  assert.equal(got.enabled, false);
  assert.equal(got.test, null);
  assert.deepEqual(got.ports, []);
  assert.deepEqual(got.skills, []);
});

test('the current harness override wins over the other copies', () => {
  const root = tmp();
  writeOverride(root, 'cursor', { version: 1, test: 'npm run cursor-e2e', ports: [3000] });
  writeOverride(root, 'claude', { version: 1, test: 'npm run claude-e2e', ports: [4000] });
  assert.equal(resolveE2E(root, 'claude').test, 'npm run claude-e2e');
  assert.equal(resolveE2E(root, 'cursor').test, 'npm run cursor-e2e');
  assert.equal(resolveE2E(root, null).test, 'npm run cursor-e2e');
});

test('discovery reads package.json and the playwright config', () => {
  const root = tmp();
  fs.writeFileSync(path.join(root, 'package.json'), `${JSON.stringify({
    scripts: { 'test:e2e': 'playwright test', 'test:e2e:headed': 'playwright test --headed', dev: 'vite' },
    devDependencies: { '@playwright/test': '1.0.0' },
  }, null, 2)}\n`);
  fs.writeFileSync(path.join(root, 'package-lock.json'), '{}\n');
  fs.writeFileSync(path.join(root, 'playwright.config.ts'), `
    export default {
      use: { baseURL: 'http://127.0.0.1:4173' },
      webServer: { command: 'npm run dev', url: 'http://127.0.0.1:4173' },
    };
  `);
  const got = resolveE2E(root, 'cursor');
  assert.equal(got.source, 'discovered');
  assert.equal(got.test, 'npm run test:e2e');
  assert.equal(got.headed, 'npm run test:e2e:headed');
  assert.equal(got.baseUrl, 'http://127.0.0.1:4173');
  assert.deepEqual(got.ports, [4173]);
  assert.deepEqual(got.start, ['npm run dev']);
  assert.equal(got.startOwnedByRunner, true);
  assert.equal(got.runner, 'playwright');
  assert.equal(got.cwd, '.');
  assert.equal(JSON.stringify(got).includes('4200'), false);
  assert.equal(JSON.stringify(got).includes('5100'), false);
});

test('a playwright config under tests/playwright sets the working directory', () => {
  const root = tmp();
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ scripts: { 'test:e2e': 'playwright test' } }));
  fs.mkdirSync(path.join(root, 'tests/playwright'), { recursive: true });
  fs.writeFileSync(path.join(root, 'tests/playwright/playwright.config.ts'), "export default { use: { baseURL: 'http://127.0.0.1:4173' } };\n");
  const got = resolveE2E(root, null);
  assert.equal(got.cwd, 'tests/playwright');
  assert.deepEqual(got.ports, [4173]);
});

test('bun runs the e2e script with bun run', () => {
  const root = tmp();
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ scripts: { e2e: 'playwright test' } }));
  fs.writeFileSync(path.join(root, 'bun.lock'), '{}\n');
  assert.equal(resolveE2E(root, null).test, 'bun run e2e');
});

test('a Makefile e2e target is the fallback runner', () => {
  const root = tmp();
  fs.writeFileSync(path.join(root, 'Makefile'), 'e2e:\n\techo hi\n');
  const got = resolveE2E(root, null);
  assert.equal(got.test, 'make e2e');
  assert.equal(got.runner, 'make');
});

test('an empty project does not invent a stack', () => {
  const got = resolveE2E(tmp(), null);
  assert.equal(got.source, 'none');
  assert.equal(got.found, false);
  assert.equal(got.test, null);
  assert.deepEqual(got.ports, []);
  assert.deepEqual(got.start, []);
  assert.equal(got.runner, null);
});

test('a bad override is reported and not replaced by discovery', () => {
  const root = tmp();
  writeOverride(root, 'cursor', { version: 2, test: 'npm run test:e2e' });
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ scripts: { 'test:e2e': 'echo discovered' } }));
  const got = resolveE2E(root, 'cursor');
  assert.equal(got.ok, false);
  assert.match(got.error, /version/);
  assert.equal(got.test, null);
});

test('the cli prints the resolved json', () => {
  const root = tmp();
  writeOverride(root, 'opencode', { version: 1, enabled: false });
  const child = spawnSync(process.execPath, [resolveBin, '--root', root, '--harness', 'opencode'], { encoding: 'utf8' });
  assert.equal(child.status, 0, child.stderr);
  const got = JSON.parse(child.stdout);
  assert.equal(got.excluded, true);
  assert.equal(got.harness, 'opencode');
});
