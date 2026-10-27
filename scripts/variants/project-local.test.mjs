import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), 'project-local.mjs');

function tmpProject() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'project-local-'));
}

function write(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

function run(project, args) {
  return spawnSync(process.execPath, [script, '--project', project, ...args], { encoding: 'utf8' });
}

function fingerprint(dir) {
  const hash = createHash('sha256');
  const walk = (current, rel) => {
    for (const name of fs.readdirSync(current).sort()) {
      const full = path.join(current, name);
      const child = rel ? `${rel}/${name}` : name;
      const stat = fs.lstatSync(full);
      if (stat.isSymbolicLink()) hash.update(`link:${child}:${fs.readlinkSync(full)}`);
      else if (stat.isDirectory()) walk(full, child);
      else {
        hash.update(`file:${child}`);
        hash.update(fs.readFileSync(full));
      }
    }
  };
  walk(dir, '');
  return hash.digest('hex');
}

test('overlay wins, excludes prune skills, and a re-run stays put', () => {
  const project = tmpProject();
  try {
    write(path.join(project, 'KEEP.txt'), 'keep\n');
    write(path.join(project, 'src', 'app.ts'), 'export const n = 1;\n');
    write(path.join(project, '.claude', 'CLAUDE.md'), 'vendored claude\n');
    write(path.join(project, '.claude', 'skills', 'angular-ddd', 'SKILL.md'), 'angular\n');
    write(path.join(project, '.opencode', 'skills', 'angular-ddd', 'SKILL.md'), 'angular\n');
    write(path.join(project, '.agents', 'skills', 'dotnet-ddd', 'SKILL.md'), 'dotnet\n');
    write(path.join(project, '.opencode', 'skills', 'dotnet-ddd', 'SKILL.md'), 'dotnet\n');
    write(path.join(project, '.claude', 'skills', 'keep-skill', 'SKILL.md'), 'stay\n');
    write(path.join(project, 'AGENTS.md'), 'This install is Monolith.\n');
    write(path.join(project, '.harness-local', 'exclude'), '# merged into ddd\nangular-ddd\nskills/dotnet-ddd\n');
    write(path.join(project, '.harness-local', 'AGENTS.md'), 'Project AGENTS overlay.\n');
    write(path.join(project, '.harness-local', '.claude', 'CLAUDE.md'), 'project claude overlay\n');
    write(path.join(project, '.harness-local', '.claude', 'skills', 'ddd', 'SKILL.md'), 'project ddd\n');
    write(path.join(project, '.harness-local', '.opencode', 'skills', 'ddd', 'SKILL.md'), 'project ddd\n');
    write(path.join(project, '.harness-local', '.agents', 'skills', 'ddd', 'SKILL.md'), 'project ddd\n');
    write(path.join(project, '.harness-local', 'notes.txt'), 'not an overlay\n');
    const before = fingerprint(path.join(project, '.harness-local'));

    const first = run(project, ['--apply']);
    assert.equal(first.status, 0, `${first.stdout}\n${first.stderr}`);
    assert.equal(fs.readFileSync(path.join(project, '.claude', 'CLAUDE.md'), 'utf8'), 'project claude overlay\n');
    assert.equal(fs.readFileSync(path.join(project, 'AGENTS.md'), 'utf8'), 'Project AGENTS overlay.\n');
    assert.equal(fs.readFileSync(path.join(project, '.claude', 'skills', 'ddd', 'SKILL.md'), 'utf8'), 'project ddd\n');
    assert.equal(fs.existsSync(path.join(project, '.claude', 'skills', 'angular-ddd')), false);
    assert.equal(fs.existsSync(path.join(project, '.opencode', 'skills', 'angular-ddd')), false);
    assert.equal(fs.existsSync(path.join(project, '.agents', 'skills', 'dotnet-ddd')), false);
    assert.equal(fs.existsSync(path.join(project, '.opencode', 'skills', 'dotnet-ddd')), false);
    assert.equal(fs.readFileSync(path.join(project, '.claude', 'skills', 'keep-skill', 'SKILL.md'), 'utf8'), 'stay\n');
    assert.equal(fs.readFileSync(path.join(project, 'KEEP.txt'), 'utf8'), 'keep\n');
    assert.equal(fs.readFileSync(path.join(project, 'src', 'app.ts'), 'utf8'), 'export const n = 1;\n');
    assert.equal(fs.existsSync(path.join(project, 'notes.txt')), false);
    assert.equal(fingerprint(path.join(project, '.harness-local')), before);

    const second = run(project, ['--apply']);
    assert.equal(second.status, 0, second.stderr);
    assert.equal(fs.readFileSync(path.join(project, '.claude', 'CLAUDE.md'), 'utf8'), 'project claude overlay\n');
    assert.equal(fs.existsSync(path.join(project, '.claude', 'skills', 'angular-ddd')), false);
    assert.equal(fs.readFileSync(path.join(project, 'KEEP.txt'), 'utf8'), 'keep\n');
    assert.equal(fingerprint(path.join(project, '.harness-local')), before);
  } finally {
    fs.rmSync(project, { recursive: true, force: true });
  }
});

test('overlay wins when the same path is excluded', () => {
  const project = tmpProject();
  try {
    write(path.join(project, '.claude', 'skills', 'ddd', 'SKILL.md'), 'vendored\n');
    write(path.join(project, '.harness-local', 'exclude'), '.claude/skills/ddd\n');
    write(path.join(project, '.harness-local', '.claude', 'skills', 'ddd', 'SKILL.md'), 'overlay\n');
    const result = run(project, ['--apply']);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(fs.readFileSync(path.join(project, '.claude', 'skills', 'ddd', 'SKILL.md'), 'utf8'), 'overlay\n');
  } finally {
    fs.rmSync(project, { recursive: true, force: true });
  }
});

test('an invalid exclude deletes nothing', () => {
  const project = tmpProject();
  try {
    write(path.join(project, 'KEEP.txt'), 'keep\n');
    write(path.join(project, '.claude', 'skills', 'angular-ddd', 'SKILL.md'), 'angular\n');
    write(path.join(project, '.harness-local', 'exclude'), 'angular-ddd\n../KEEP.txt\n');
    const result = run(project, ['--apply']);
    assert.equal(result.status, 2, result.stdout);
    assert.match(result.stderr, /absolute paths are not allowed|path must stay inside a managed root/);
    assert.equal(fs.readFileSync(path.join(project, 'KEEP.txt'), 'utf8'), 'keep\n');
    assert.equal(fs.readFileSync(path.join(project, '.claude', 'skills', 'angular-ddd', 'SKILL.md'), 'utf8'), 'angular\n');
  } finally {
    fs.rmSync(project, { recursive: true, force: true });
  }
});

test('a skill symlink is removed and its outside target stays', () => {
  const project = tmpProject();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-target-'));
  try {
    write(path.join(outside, 'SKILL.md'), 'outside\n');
    fs.mkdirSync(path.join(project, '.claude', 'skills'), { recursive: true });
    fs.symlinkSync(outside, path.join(project, '.claude', 'skills', 'angular-ddd'));
    write(path.join(project, '.harness-local', 'exclude'), 'angular-ddd\n');
    const result = run(project, ['--apply']);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(fs.existsSync(path.join(project, '.claude', 'skills', 'angular-ddd')), false);
    assert.equal(fs.readFileSync(path.join(outside, 'SKILL.md'), 'utf8'), 'outside\n');
  } finally {
    fs.rmSync(project, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('a managed root that points outside the project is not modified', () => {
  const project = tmpProject();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-escape-'));
  try {
    write(path.join(outside, 'secret.txt'), 'secret\n');
    fs.symlinkSync(outside, path.join(project, '.claude'));
    write(path.join(project, '.harness-local', 'exclude'), '.claude/secret.txt\n');
    const result = run(project, ['--apply']);
    assert.equal(result.status, 1, result.stdout);
    assert.match(result.stderr, /points outside the project/);
    assert.equal(fs.readFileSync(path.join(outside, 'secret.txt'), 'utf8'), 'secret\n');
  } finally {
    fs.rmSync(project, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('--roots limits the overlay and status does not write', () => {
  const project = tmpProject();
  try {
    write(path.join(project, '.harness-local', '.claude', 'CLAUDE.md'), 'claude\n');
    write(path.join(project, '.harness-local', '.opencode', 'AGENTS.md'), 'opencode\n');
    write(path.join(project, '.harness-local', 'exclude'), 'angular-ddd\n');
    const before = fingerprint(path.join(project, '.harness-local'));
    const status = run(project, ['--status']);
    assert.equal(status.status, 0, status.stderr);
    assert.match(status.stdout, /file \.claude\/CLAUDE\.md/);
    assert.match(status.stdout, /file \.opencode\/AGENTS\.md/);
    assert.match(status.stdout, /skill angular-ddd/);
    assert.match(status.stdout, /domain-rules: disabled/);
    assert.equal(fs.existsSync(path.join(project, '.claude')), false);
    assert.equal(fs.existsSync(path.join(project, '.opencode')), false);
    assert.equal(fingerprint(path.join(project, '.harness-local')), before);

    const applied = run(project, ['--apply', '--roots', 'claude']);
    assert.equal(applied.status, 0, applied.stderr);
    assert.equal(fs.readFileSync(path.join(project, '.claude', 'CLAUDE.md'), 'utf8'), 'claude\n');
    assert.equal(fs.existsSync(path.join(project, '.opencode')), false);
  } finally {
    fs.rmSync(project, { recursive: true, force: true });
  }
});

test('status reports domain-rules without creating the project tree', () => {
  const project = tmpProject();
  try {
    write(path.join(project, '.harness-local', 'domain-rules.json'), '{"enabled": false}\n');
    const off = run(project, ['--status']);
    assert.equal(off.status, 0, off.stderr);
    assert.match(off.stdout, /domain-rules: disabled/);
    assert.match(off.stdout, /overlay: \(none\)|overlay: /);
    write(
      path.join(project, '.harness-local', 'domain-rules.json'),
      '{"enabled": true, "script": "scripts/check-domain-rules.sh"}\n',
    );
    const on = run(project, ['--status']);
    assert.equal(on.status, 0, on.stderr);
    assert.match(on.stdout, /domain-rules: enabled scripts\/check-domain-rules\.sh/);
    write(path.join(project, '.harness-local', 'domain-rules.json'), '{"enabled": true, "script": "../escape.sh"}\n');
    const bad = run(project, ['--status']);
    assert.equal(bad.status, 2);
    assert.match(bad.stdout, /domain-rules: error/);
  } finally {
    fs.rmSync(project, { recursive: true, force: true });
  }
});

test('overlay applies through a symlinked script and a symlinked project', () => {
  const project = tmpProject();
  const linkRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'project-local-link-'));
  const scriptLink = path.join(linkRoot, 'project-local.mjs');
  const projectLink = path.join(linkRoot, 'project');
  try {
    fs.symlinkSync(script, scriptLink);
    fs.symlinkSync(project, projectLink, 'dir');
    write(path.join(project, '.claude', 'CLAUDE.md'), 'vendored\n');
    write(path.join(project, '.harness-local', '.claude', 'CLAUDE.md'), 'via symlink\n');
    const result = spawnSync(process.execPath, [scriptLink, '--project', projectLink, '--apply'], { encoding: 'utf8' });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /project-local: pruned 0, overlaid 1/);
    assert.equal(fs.readFileSync(path.join(project, '.claude', 'CLAUDE.md'), 'utf8'), 'via symlink\n');
  } finally {
    fs.rmSync(project, { recursive: true, force: true });
    fs.rmSync(linkRoot, { recursive: true, force: true });
  }
});

test('an overlay does not follow a directory symlink out of the project', () => {
  const project = tmpProject();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'overlay-escape-'));
  try {
    write(path.join(outside, 'secret.txt'), 'secret\n');
    fs.mkdirSync(path.join(project, '.claude'), { recursive: true });
    fs.symlinkSync(outside, path.join(project, '.claude', 'hooks'));
    write(path.join(project, '.harness-local', '.claude', 'hooks', 'note.txt'), 'overlay\n');
    const result = run(project, ['--apply']);
    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stderr, /points outside the project/);
    assert.equal(fs.readFileSync(path.join(outside, 'secret.txt'), 'utf8'), 'secret\n');
    assert.equal(fs.existsSync(path.join(outside, 'note.txt')), false);
  } finally {
    fs.rmSync(project, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});
