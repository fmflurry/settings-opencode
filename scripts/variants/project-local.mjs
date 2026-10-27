#!/usr/bin/env node
// Read a project's .harness-local/ and apply it onto managed harness paths.
// Never creates, edits, or deletes .harness-local itself.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const OVERLAY_DIR = '.harness-local';
const RESERVED = new Set(['exclude', 'domain-rules.json']);
const MANAGED_DIRS = ['.claude', '.opencode', '.cursor', '.agents'];
const SKILL_DIRS = ['.claude/skills', '.opencode/skills', '.agents/skills'];
const SKILL_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const DEFAULT_SCRIPT = 'scripts/check-domain-rules.sh';

function flag(argv, name) {
  const inline = argv.find((arg) => arg.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = argv.indexOf(name);
  if (index === -1) return '';
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) return '';
  return value;
}

export function skillId(line) {
  if (SKILL_ID.test(line)) return line;
  const match = /^skills\/([A-Za-z0-9][A-Za-z0-9._-]*)$/.exec(line);
  return match ? match[1] : null;
}

export function pathProblem(line) {
  const norm = line.replaceAll('\\', '/');
  if (!norm || norm.includes('\0')) return 'path is empty';
  if (path.posix.isAbsolute(norm) || path.win32.isAbsolute(line)) return 'absolute paths are not allowed';
  const parts = norm.split('/');
  if (parts.includes('..') || parts.includes('.') || parts.includes('')) return 'path must stay inside a managed root';
  if (norm === 'AGENTS.md') return '';
  const top = parts[0];
  if (!MANAGED_DIRS.includes(top) || parts.length < 2) {
    return 'path must be a skill id, skills/<id>, AGENTS.md, or a path under .claude, .opencode, .cursor, or .agents';
  }
  return '';
}

export function parseExclude(text) {
  const entries = [];
  const errors = [];
  text.split(/\r?\n/).forEach((raw, index) => {
    const line = raw.trim();
    if (!line || line.startsWith('#')) return;
    const where = `line ${index + 1}`;
    const id = skillId(line);
    if (id) {
      entries.push({ kind: 'skill', id });
      return;
    }
    const problem = pathProblem(line);
    if (problem) {
      errors.push(`${where}: ${problem}`);
      return;
    }
    entries.push({ kind: 'path', path: line.replaceAll('\\', '/') });
  });
  return { entries, errors };
}

function scriptProblem(script) {
  const norm = String(script).replaceAll('\\', '/').trim();
  if (!norm || norm.includes('\0')) return 'script must be a relative path';
  if (path.posix.isAbsolute(norm) || path.win32.isAbsolute(String(script).trim())) return 'script must be a relative path';
  const parts = norm.split('/');
  if (parts.includes('..') || parts.includes('.') || parts.includes('')) return 'script must stay inside the project';
  return '';
}

export function readDomainRulesStatus(project) {
  const file = path.join(project, OVERLAY_DIR, 'domain-rules.json');
  const located = realFileInside(project, file);
  if (located.missing) return { state: 'disabled' };
  if (located.error) return { state: 'error', message: `domain-rules.json ${located.error}` };
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(located.real, 'utf8'));
  } catch {
    return { state: 'error', message: 'domain-rules.json is not JSON' };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { state: 'error', message: 'domain-rules.json must be an object' };
  }
  if (parsed.enabled !== true) return { state: 'disabled' };
  const script = parsed.script === undefined ? DEFAULT_SCRIPT : parsed.script;
  if (typeof script !== 'string') return { state: 'error', message: 'script must be a relative path' };
  const problem = scriptProblem(script);
  if (problem) return { state: 'error', message: problem };
  return { state: 'enabled', script: script.trim() };
}

function walkFiles(dir, rel) {
  const files = [];
  const errors = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const child = `${rel}/${entry.name}`;
    const full = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) {
      errors.push(`overlay symlink not allowed: ${child}`);
      continue;
    }
    if (entry.isDirectory()) {
      const nested = walkFiles(full, child);
      files.push(...nested.files);
      errors.push(...nested.errors);
    } else if (entry.isFile()) {
      files.push(child);
    } else {
      errors.push(`overlay entry not allowed: ${child}`);
    }
  }
  return { files, errors };
}

export function inspectOverlay(project) {
  const root = path.join(project, OVERLAY_DIR);
  if (!fs.existsSync(root) && !fs.lstatSync(root, { throwIfNoEntry: false })) {
    return { exists: false, root, files: [], ignored: [], errors: [] };
  }
  const rootStat = fs.lstatSync(root);
  if (rootStat.isSymbolicLink()) {
    return { exists: true, root, files: [], ignored: [], errors: ['overlay symlink not allowed: .harness-local'] };
  }
  if (!rootStat.isDirectory()) {
    return { exists: false, root, files: [], ignored: [], errors: [] };
  }
  const files = [];
  const ignored = [];
  const errors = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (RESERVED.has(entry.name)) continue;
    if (entry.isSymbolicLink()) {
      errors.push(`overlay symlink not allowed: ${entry.name}`);
      continue;
    }
    if (entry.isFile() && entry.name === 'AGENTS.md') {
      files.push('AGENTS.md');
      continue;
    }
    if (entry.isDirectory() && MANAGED_DIRS.includes(entry.name)) {
      const nested = walkFiles(path.join(root, entry.name), entry.name);
      files.push(...nested.files);
      errors.push(...nested.errors);
      continue;
    }
    ignored.push(entry.name);
  }
  files.sort();
  ignored.sort();
  return { exists: true, root, files, ignored, errors };
}

function realFileInside(project, file) {
  if (!fs.lstatSync(file, { throwIfNoEntry: false })) return { missing: true };
  let real;
  try {
    real = fs.realpathSync(file);
  } catch {
    return { error: 'must be a regular file inside the project' };
  }
  const projectReal = fs.realpathSync(project);
  if (real !== projectReal && !real.startsWith(projectReal + path.sep)) {
    return { error: 'must stay inside the project' };
  }
  if (!fs.statSync(real).isFile()) return { error: 'must be a regular file' };
  return { real };
}

export function readExclude(project) {
  const file = path.join(project, OVERLAY_DIR, 'exclude');
  const located = realFileInside(project, file);
  if (located.missing) return { file: null, entries: [], errors: [] };
  if (located.error) return { file, entries: [], errors: [`exclude ${located.error}`] };
  return { file, ...parseExclude(fs.readFileSync(located.real, 'utf8')) };
}

export function formatStatus(project) {
  const lines = [];
  const overlay = inspectOverlay(project);
  if (!overlay.exists) lines.push('overlay: (none)');
  else {
    lines.push(`overlay: ${overlay.root}`);
    for (const file of overlay.files) lines.push(`file ${file}`);
    for (const name of overlay.ignored) lines.push(`ignored ${name}`);
    for (const error of overlay.errors) lines.push(`overlay: error ${error}`);
  }
  const exclude = readExclude(project);
  if (!exclude.file && overlay.exists) lines.push('exclude: (none)');
  else if (!exclude.file) lines.push('exclude: (none)');
  else if (exclude.errors.length) {
    for (const error of exclude.errors) lines.push(`exclude: error ${error}`);
  } else {
    lines.push(`exclude: ${exclude.file}`);
    for (const entry of exclude.entries) {
      lines.push(entry.kind === 'skill' ? `skill ${entry.id}` : `path ${entry.path}`);
    }
  }
  const rules = readDomainRulesStatus(project);
  if (rules.state === 'error') lines.push(`domain-rules: error ${rules.message}`);
  else if (rules.state === 'enabled') lines.push(`domain-rules: enabled ${rules.script}`);
  else lines.push('domain-rules: disabled');
  const code = overlay.errors.length || exclude.errors.length || rules.state === 'error' ? 2 : 0;
  return { lines, code };
}

function parseRoots(raw) {
  const names = String(raw).split(',').map((part) => part.trim()).filter(Boolean);
  const allowed = new Set(['claude', 'opencode', 'surfaces']);
  for (const name of names) {
    if (!allowed.has(name)) throw new Error(`unknown root ${name}`);
  }
  return new Set(names);
}

function overlaySelected(rel, roots) {
  if (!roots) return true;
  if (rel === 'AGENTS.md' || rel.startsWith('.cursor/') || rel.startsWith('.agents/')) return roots.has('surfaces');
  if (rel.startsWith('.claude/')) return roots.has('claude');
  if (rel.startsWith('.opencode/')) return roots.has('opencode');
  return false;
}

function topSegment(rel) {
  return rel === 'AGENTS.md' ? '' : rel.split('/')[0];
}

function assertInside(parent, target) {
  const root = path.resolve(parent);
  const full = path.resolve(target);
  if (full !== root && !full.startsWith(root + path.sep)) {
    throw new Error(`refusing to touch ${full}: it escapes ${root}`);
  }
}

function assertManaged(project, rel) {
  const projectReal = fs.realpathSync(project);
  assertInside(project, path.join(project, rel));
  const top = topSegment(rel);
  if (!top) {
    const agents = path.join(project, 'AGENTS.md');
    if (!fs.existsSync(agents)) return;
    const stat = fs.lstatSync(agents);
    if (stat.isSymbolicLink()) return;
    const real = fs.realpathSync(agents);
    if (real !== projectReal && !real.startsWith(projectReal + path.sep)) {
      throw new Error('refusing to touch AGENTS.md: it points outside the project');
    }
    return;
  }
  const topPath = path.join(project, top);
  if (!fs.existsSync(topPath)) return;
  const stat = fs.lstatSync(topPath);
  if (!stat.isSymbolicLink()) {
    const real = fs.realpathSync(topPath);
    if (real !== projectReal && !real.startsWith(projectReal + path.sep)) {
      throw new Error(`refusing to modify ${top}: it points outside the project`);
    }
    return;
  }
  const real = fs.realpathSync(topPath);
  if (!real.startsWith(projectReal + path.sep)) {
    throw new Error(`refusing to modify ${top}: it points outside the project`);
  }
}

function removeRel(project, rel) {
  const dest = path.join(project, rel);
  if (!fs.existsSync(dest) && !fs.lstatSync(dest, { throwIfNoEntry: false })) return false;
  assertManaged(project, rel);
  const stat = fs.lstatSync(dest);
  if (stat.isSymbolicLink()) {
    fs.unlinkSync(dest);
    return true;
  }
  const projectReal = fs.realpathSync(project);
  const real = fs.realpathSync(dest);
  if (real !== projectReal && !real.startsWith(projectReal + path.sep)) {
    throw new Error(`refusing to delete ${rel}: it points outside the project`);
  }
  fs.rmSync(dest, { recursive: true, force: true });
  return true;
}

function removalRels(entries) {
  const rels = [];
  for (const entry of entries) {
    if (entry.kind === 'skill') {
      for (const dir of SKILL_DIRS) rels.push(`${dir}/${entry.id}`);
    } else rels.push(entry.path);
  }
  return rels;
}

function assertAncestorStaysInside(project, dest) {
  const projectReal = fs.realpathSync(project);
  const parent = path.dirname(path.resolve(dest));
  assertInside(project, parent);
  const rel = path.relative(path.resolve(project), parent);
  if (!rel || rel === '.') return;
  let current = projectReal;
  for (const part of rel.split(path.sep)) {
    if (!part || part === '.' || part === '..') {
      throw new Error(`refusing to write ${rel}: it escapes the project`);
    }
    const next = path.join(current, part);
    if (!fs.lstatSync(next, { throwIfNoEntry: false })) return;
    const real = fs.realpathSync(next);
    if (real !== projectReal && !real.startsWith(projectReal + path.sep)) {
      throw new Error(`refusing to write ${path.relative(path.resolve(project), dest)}: it points outside the project`);
    }
    current = real;
  }
}

function copyOverlayFile(project, overlayRoot, rel) {
  const src = path.join(overlayRoot, rel);
  const dest = path.join(project, rel);
  assertManaged(project, rel);
  const stat = fs.lstatSync(src);
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`overlay symlink not allowed: ${rel}`);
  assertAncestorStaysInside(project, dest);
  const existing = fs.lstatSync(dest, { throwIfNoEntry: false });
  if (existing?.isSymbolicLink()) fs.unlinkSync(dest);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  assertAncestorStaysInside(project, dest);
  fs.copyFileSync(src, dest);
  fs.chmodSync(dest, stat.mode & 0o777);
}

export function applyProjectLocal(project, roots) {
  const exclude = readExclude(project);
  if (exclude.errors.length) {
    const error = new Error(exclude.errors.map((line) => `exclude: error ${line}`).join('\n'));
    error.code = 2;
    throw error;
  }
  const overlay = inspectOverlay(project);
  if (overlay.errors.length) {
    const error = new Error(overlay.errors.map((line) => `overlay: error ${line}`).join('\n'));
    error.code = 2;
    throw error;
  }
  if (!overlay.exists && !exclude.file) return { pruned: 0, overlaid: 0 };
  const rels = removalRels(exclude.entries);
  for (const rel of rels) assertManaged(project, rel);
  const selected = overlay.files.filter((rel) => overlaySelected(rel, roots));
  for (const rel of selected) assertManaged(project, rel);
  let pruned = 0;
  for (const rel of rels) {
    if (removeRel(project, rel)) pruned += 1;
  }
  for (const rel of selected) copyOverlayFile(project, overlay.root, rel);
  return { pruned, overlaid: selected.length };
}

function canonicalPath(value) {
  const resolved = path.resolve(value);
  try {
    return fs.realpathSync(resolved);
  } catch {
    return resolved;
  }
}

function main() {
  const argv = process.argv.slice(2);
  const projectArg = flag(argv, '--project');
  if (!projectArg) {
    console.error('project-local: --project needs a path');
    process.exit(2);
  }
  const project = canonicalPath(projectArg);
  const apply = argv.includes('--apply');
  const status = argv.includes('--status');
  if (apply === status) {
    console.error('project-local: pass exactly one of --apply or --status');
    process.exit(2);
  }
  if (status) {
    const report = formatStatus(project);
    process.stdout.write(`${report.lines.join('\n')}\n`);
    process.exit(report.code);
  }
  let roots = null;
  try {
    const rootsFlag = argv.some((arg) => arg === '--roots' || arg.startsWith('--roots='));
    roots = rootsFlag ? parseRoots(flag(argv, '--roots')) : null;
  } catch (error) {
    console.error(`project-local: ${error.message}`);
    process.exit(2);
  }
  try {
    const result = applyProjectLocal(project, roots);
    console.log(`project-local: pruned ${result.pruned}, overlaid ${result.overlaid}`);
  } catch (error) {
    console.error(error.message);
    process.exit(error.code === 2 ? 2 : 1);
  }
}

const here = fileURLToPath(import.meta.url);
if (process.argv[1] && canonicalPath(process.argv[1]) === canonicalPath(here)) {
  main();
}
