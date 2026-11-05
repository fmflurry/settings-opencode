#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const self = fileURLToPath(import.meta.url);
const hooks = ['applypatch-msg', 'pre-applypatch', 'post-applypatch', 'pre-commit', 'prepare-commit-msg', 'commit-msg', 'post-commit', 'pre-merge-commit', 'pre-rebase', 'post-checkout', 'post-merge', 'pre-push', 'pre-receive', 'update', 'proc-receive', 'post-receive', 'post-update', 'reference-transaction', 'push-to-checkout', 'pre-auto-gc', 'post-rewrite', 'sendemail-validate', 'fsmonitor-watchman', 'p4-changelist', 'p4-prepare-changelist', 'p4-post-changelist', 'p4-pre-submit', 'post-index-change'];
const fail = (message) => { console.error(`commit-provenance: ${message}`); process.exit(1); };

const metadataName = '.harness-provenance.json';
const assetRoots = ['hooks', 'plugins', 'skills', 'agents', 'rules', 'commands', 'scripts/agent-harness', 'settings.json', 'settings.local.json', 'opencode.jsonc', 'CLAUDE.md', 'AGENTS.md', 'instructions', 'prompts', 'tools', 'mods', 'policy-limits.json', 'scripts/notify-log.sh', 'scripts/notify-gate.sh', '.claude/hooks', '.claude/skills', '.claude/agents', '.claude/rules', '.claude/commands', '.claude/CLAUDE.md', '.claude/settings.json', '.claude/settings.local.json', '.claude/mods', '.claude/plugins', '.claude/policy-limits.json', 'variants', 'contexts', 'profiles', 'tui-plugins', 'tui.json', 'dcp.jsonc'];
function fingerprint(root) {
  const hash = createHash('sha256');
  const visit = (relative, ancestors = new Set()) => {
    const full = path.join(root, relative);
    let info;
    try { info = fs.lstatSync(full); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
    if (info.isSymbolicLink()) {
      hash.update(`link:${relative}:${fs.readlinkSync(full)}\n`);
      try {
        const resolved = fs.realpathSync(full);
        const target = fs.statSync(full);
        if (target.isFile()) { hash.update(`mode:${target.mode & 0o111}:`); hash.update(fs.readFileSync(full)); }
        else if (target.isDirectory() && !ancestors.has(resolved)) {
          const next = new Set(ancestors).add(resolved);
          for (const child of fs.readdirSync(full).sort()) visit(path.join(relative, child), next);
        }
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
      return;
    }
    if (info.isDirectory()) {
      const resolved = fs.realpathSync(full);
      if (ancestors.has(resolved)) return;
      const next = new Set(ancestors).add(resolved);
      for (const child of fs.readdirSync(full).sort()) visit(path.join(relative, child), next);
    } else if (info.isFile() && path.basename(relative) !== metadataName && path.basename(relative) !== '.installed') {
      hash.update(`file:${relative}:${info.mode & 0o111}:`);
      hash.update(fs.readFileSync(full));
      hash.update('\n');
    }
  };
  for (const item of assetRoots) visit(item);
  return hash.digest('hex');
}

function resolveMetadata(target) {
  const metadata = JSON.parse(fs.readFileSync(path.join(target, metadataName), 'utf8'));
  const dirty = metadata.sourceDirty || fingerprint(metadata.assetRoot || target) !== metadata.fingerprint;
  return { version: metadata.version, sha: metadata.sha + (dirty ? '-dirty' : '') };
}

if (process.argv[2] === 'setup') {
  const dir = path.join(process.argv[3], 'scripts/agent-harness/git-hooks');
  fs.mkdirSync(dir, { recursive: true });
  for (const hook of hooks) {
    const dest = path.join(dir, hook);
    try { fs.symlinkSync(self, dest); } catch (error) {
      if (error.code !== 'EEXIST' || fs.readlinkSync(dest) !== self) throw error;
    }
  }
} else if (process.argv[2] === 'capture') {
  const [, , , repo, target, version, assetRoot = target, customized = '0'] = process.argv;
  const root = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd: repo, encoding: 'utf8' });
  if (root.status !== 0 || fs.realpathSync(root.stdout.trim()) !== fs.realpathSync(repo)) fail('source is not a Git checkout root');
  const sha = spawnSync('git', ['rev-parse', '--verify', 'HEAD'], { cwd: repo, encoding: 'utf8' });
  const status = spawnSync('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: repo, encoding: 'utf8' });
  const ignored = spawnSync('git', ['ls-files', '--others', '--ignored', '--exclude-standard', '-z', '--', ...assetRoots], { cwd: repo, encoding: 'utf8' });
  if (sha.status !== 0 || status.status !== 0 || ignored.status !== 0) fail('cannot identify source checkout');
  const metadata = { version, sha: sha.stdout.trim(), sourceDirty: Boolean(status.stdout.trim() || ignored.stdout) || customized === '1', assetRoot, fingerprint: fingerprint(assetRoot) };
  fs.writeFileSync(path.join(target, metadataName), `${JSON.stringify(metadata)}\n`);
} else if (process.argv[2] === 'resolve') {
  console.log(JSON.stringify(resolveMetadata(process.argv[3])));
} else if (process.argv[2] === 'run') {
  const [, , , session, version, sha, command] = process.argv;
  if (!/^[A-Za-z0-9._:-]{1,200}$/.test(session || '') || typeof command !== 'string' || (version === '@target' ? !path.isAbsolute(sha || '') : (!/^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][A-Za-z0-9.-]+)?$/.test(version || '') || !/^[a-f0-9]{40,64}(?:-dirty)?$/.test(sha || '')))) fail('invalid provenance');
  const count = Number(process.env.GIT_CONFIG_COUNT || 0);
  if (!Number.isSafeInteger(count) || count < 0) fail('invalid GIT_CONFIG_COUNT');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-hooks-'));
  try {
    for (const hook of hooks) fs.symlinkSync(self, path.join(dir, hook));
    const env = { ...process.env, GIT_CONFIG_COUNT: String(count + 1), [`GIT_CONFIG_KEY_${count}`]: 'core.hooksPath', [`GIT_CONFIG_VALUE_${count}`]: dir, HARNESS_HOOK_CONFIG_INDEX: String(count), HARNESS_SESSION_ID: session, HARNESS_VERSION: version, HARNESS_SHA: sha };
    const result = spawnSync('bash', ['-c', command], { stdio: 'inherit', env });
    process.exitCode = result.status ?? 1;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
} else {
  const hook = path.basename(process.argv[1]);
  if (!hooks.includes(hook)) fail('invalid hook');
  const index = Number(process.env.HARNESS_HOOK_CONFIG_INDEX);
  if (!Number.isSafeInteger(index) || index < 0) fail('missing hook configuration');
  const env = { ...process.env, GIT_CONFIG_COUNT: String(index) };
  delete env[`GIT_CONFIG_KEY_${index}`];
  delete env[`GIT_CONFIG_VALUE_${index}`];
  const query = spawnSync('git', ['config', '--path', '--get', 'core.hooksPath'], { encoding: 'utf8', env });
  if (query.error || (query.status !== 0 && query.status !== 1)) fail('cannot resolve existing hooks');
  let originalDir = query.status === 0 ? query.stdout.replace(/\r?\n$/, '') : '';
  if (query.status === 1) {
    const gitPath = spawnSync('git', ['rev-parse', '--git-path', 'hooks'], { encoding: 'utf8', env });
    if (gitPath.status !== 0) fail('cannot resolve repository hooks');
    originalDir = gitPath.stdout.replace(/\r?\n$/, '');
  }
  if (originalDir) {
    const original = path.resolve(originalDir, hook);
    try {
      fs.accessSync(original, fs.constants.X_OK);
      const result = spawnSync(original, process.argv.slice(2), { stdio: 'inherit', env: process.env });
      if (result.error || result.status !== 0) process.exit(result.status || 1);
    } catch (error) {
      if (error.code !== 'ENOENT' && error.code !== 'EACCES') throw error;
    }
  }
  if (hook === 'prepare-commit-msg' || hook === 'commit-msg') {
    let { HARNESS_VERSION: version, HARNESS_SHA: sha } = process.env;
    if (version === '@target') {
      try { ({ version, sha } = resolveMetadata(sha)); } catch { fail('installed provenance is missing or unreadable; reinstall the harness'); }
    }
    if (!/^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][A-Za-z0-9.-]+)?$/.test(version || '') || !/^[a-f0-9]{40,64}(?:-dirty)?$/.test(sha || '')) fail('invalid installed provenance');
    const file = process.argv[2];
    if (!file) fail('missing commit message');
    const parsed = spawnSync('git', ['interpret-trailers', '--parse', file], { encoding: 'utf8', env });
    if (parsed.status !== 0) fail('cannot parse existing trailers');
    const reserved = /^(Harness|Harness-SHA|Session-Id):[ \t]*(.*?)[ \t]*$/i;
    const counts = new Map();
    for (const line of parsed.stdout.split('\n')) {
      const match = line.match(reserved);
      if (match) { const key = `${match[1].toLowerCase()}:${match[2]}`; counts.set(key, (counts.get(key) || 0) + 1); }
    }
    const lines = fs.readFileSync(file, 'utf8').split(/(?<=\n)/);
    for (let i = lines.length - 1; i >= 0; i--) {
      const match = lines[i].replace(/\r?\n$/, '').match(reserved);
      if (!match) continue;
      const key = `${match[1].toLowerCase()}:${match[2]}`;
      const count = counts.get(key) || 0;
      if (count) { lines[i] = ''; counts.set(key, count - 1); }
    }
    fs.writeFileSync(file, lines.join(''));
    const result = spawnSync('git', ['interpret-trailers', '--in-place', '--if-exists', 'add', '--trailer', `Harness: fmflurry-harness@${version}`, '--trailer', `Harness-SHA: ${sha}`, '--trailer', `Session-Id: ${process.env.HARNESS_SESSION_ID}`, file], { stdio: 'inherit', env });
    if (result.status !== 0) process.exit(result.status || 1);
  }
}
