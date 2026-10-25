import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const script = path.join(repo, 'skills/show-me/scripts/screenshot.sh');

const FIXTURE_HTML =
  '<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0}.box{height:900px}' +
  '@media (max-width:600px){.box{height:1800px}}</style></head><body><div class="box">show-me</div></body></html>\n';

const REQUIRED_TOOLS = ['bash', 'mktemp', 'rm', 'cat', 'grep', 'sed', 'head', 'mkdir', 'cp', 'mv', 'ln'];

const MEASURE_SIG = [
  'w=${ws%%,*}',
  'sig=wide',
  'if [ "$w" = 390 ]; then sig=${SHIM_M390:-narrow}; fi',
];

const BROWSER_COMMON = [
  'p=${url#file://}',
  'if grep -q SHOW_ME_MEASURE "$p" 2>/dev/null; then s=1; else s=0; fi',
  'echo "html h=${ws##*,} script=$s url=$url" >> "$SHIM_LOG.html"',
];

const SHIMS = {
  timeout: [
    '#!/bin/bash',
    'echo "timeout $1" >> "$SHIM_LOG"',
    'shift',
    'exec "$@"',
  ],
  chromium: [
    '#!/bin/bash',
    'echo "chromium $*" >> "$SHIM_LOG"',
    'png=',
    'ws=',
    'url=',
    'for a in "$@"; do',
    '  case "$a" in',
    '    --screenshot=*) png=${a#--screenshot=} ;;',
    '    --window-size=*) ws=${a#--window-size=} ;;',
    '    file://*) url=$a ;;',
    '  esac',
    'done',
    ...BROWSER_COMMON,
    'if [ -n "$SHIM_PLANT_AT" ]; then ln -s "$SHIM_PLANT_TO" "$SHIM_PLANT_AT" 2>/dev/null; fi',
    'if [ -z "$SHIM_CHROMIUM_NOPNG" ] && [ -n "$png" ]; then echo png > "$png"; fi',
    ...MEASURE_SIG,
    'if [ -n "$SHIM_H" ] && [ "$s" = 1 ]; then echo "SHOW_ME_MEASURE h=$SHIM_H m=$sig" >&2; fi',
    'exit 0',
  ],
  firefox: [
    '#!/bin/bash',
    'echo "firefox $*" >> "$SHIM_LOG"',
    '[ "$#" -eq 8 ] || exit 1',
    '[ "$1" = --headless ] || exit 1',
    '[ "$2" = --no-remote ] || exit 1',
    '[ "$3" = --profile ] || exit 1',
    '[ -d "$4" ] || exit 1',
    '[ "$5" = --screenshot ] || exit 1',
    'case "$7" in --window-size=*) ;; *) exit 1 ;; esac',
    'case "$8" in file://*) ;; *) exit 1 ;; esac',
    'for pref in browser.dom.window.dump.enabled devtools.console.stdout.content widget.gtk.overlay-scrollbars.enabled ui.useOverlayScrollbars; do',
    '  grep -q "$pref" "$4/user.js" 2>/dev/null || exit 1',
    'done',
    'ws=${7#--window-size=}',
    'url=$8',
    ...BROWSER_COMMON,
    'echo png > "$6"',
    ...MEASURE_SIG,
    'if [ -n "$SHIM_H" ] && [ "$s" = 1 ]; then echo "SHOW_ME_MEASURE h=$SHIM_H m=$sig"; fi',
    'exit 0',
  ],
  mv: [
    '#!/bin/bash',
    '[ "$1" = --version ] || mkdir -p -- "${@: -1}"',
    'exec "$SHIM_REAL_MV" "$@"',
  ],
  node: [
    '#!/bin/bash',
    'echo "node ${*:3}" >> "$SHIM_LOG"',
    'if [ -n "$SHIM_NODE_EXIT" ]; then exit "$SHIM_NODE_EXIT"; fi',
    'case "$3" in',
    '  measure)',
    '    sig=wide',
    '    if [ "$4" = 390 ]; then sig=${SHIM_M390:-narrow}; fi',
    '    if [ -n "$SHIM_H" ]; then echo "SHOW_ME_MEASURE h=$SHIM_H m=$sig"; fi',
    '    ;;',
    '  shot) echo png > "$6" ;;',
    'esac',
    'exit 0',
  ],
};

function resolveOnPath(name) {
  for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
    if (!dir) continue;
    const candidate = path.join(dir, name);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch {
      continue;
    }
  }
  throw new Error(`required tool not found on PATH: ${name}`);
}

const toolsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'show-me-tools-'));
for (const tool of REQUIRED_TOOLS) {
  fs.symlinkSync(resolveOnPath(tool), path.join(toolsDir, tool));
}

const roots = [toolsDir];
after(() => {
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
});

function fileUrl(absPath) {
  return (
    'file://' +
    absPath.replace(/%/g, '%25').replace(/ /g, '%20').replace(/#/g, '%23').replace(/\?/g, '%3F')
  );
}

function spawnScript(args, env, cwd) {
  return spawnSync('/bin/bash', [script, ...args], { encoding: 'utf8', env, cwd });
}

function makeSandbox({ shims = [], env = {}, htmlName = 'page.html' } = {}) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'show-me-')));
  roots.push(root);
  const work = path.join(root, 'work');
  const shimDir = path.join(root, 'shims');
  const tmpDir = path.join(root, 'tmp');
  for (const dir of [work, shimDir, tmpDir]) fs.mkdirSync(dir);
  for (const name of ['timeout', ...shims]) {
    const file = path.join(shimDir, name);
    fs.writeFileSync(file, SHIMS[name].join('\n') + '\n');
    fs.chmodSync(file, 0o755);
  }
  const html = path.join(work, htmlName);
  fs.writeFileSync(html, FIXTURE_HTML);
  const log = path.join(root, 'shim.log');
  const sandboxEnv = Object.fromEntries(
    Object.entries({
      PATH: `${shimDir}:${toolsDir}`,
      SHIM_LOG: log,
      TMPDIR: tmpDir,
      ...env,
    }).filter(([, value]) => value !== undefined),
  );
  const readLines = (file) =>
    fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean) : [];
  return {
    root,
    work,
    html,
    name: path.basename(html, '.html'),
    run: (args = [html]) => spawnScript(args, sandboxEnv, root),
    log: () => readLines(log),
    htmlLog: () =>
      readLines(`${log}.html`).map((line) => {
        const m = /^html h=(\d+) script=(\d) url=(\S+)$/.exec(line);
        assert.ok(m, `unparseable html log line: ${line}`);
        return { height: Number(m[1]), script: m[2] === '1', url: m[3] };
      }),
  };
}

function stdoutLines(stdout) {
  return stdout === '' ? [] : stdout.replace(/\n$/, '').split('\n');
}

function assertNotesPrefixed(stderr) {
  for (const line of stderr.split('\n').filter(Boolean)) {
    assert.ok(line.startsWith('show-me: '), `stderr line without "show-me: " prefix: ${line}`);
  }
}

function callsTo(lines, tool) {
  return lines.filter((line) => line.startsWith(`${tool} `));
}

function assertEachCallTimedOut(lines, tool) {
  const indexes = lines.map((line, i) => (line.startsWith(`${tool} `) ? i : -1)).filter((i) => i >= 0);
  assert.ok(indexes.length > 0, `expected at least one ${tool} call`);
  for (const i of indexes) {
    assert.equal(lines[i - 1], 'timeout 60', `${tool} call not preceded by "timeout 60"`);
  }
}

function assertPngs(sb, stdout, { phone = true } = {}) {
  const desktop = path.join(sb.work, `${sb.name}.png`);
  const expected = phone ? [desktop, path.join(sb.work, `${sb.name}-390.png`)] : [desktop];
  assert.deepEqual(stdoutLines(stdout), expected);
  for (const png of expected) {
    assert.ok(path.isAbsolute(png));
    assert.ok(fs.existsSync(png), `missing ${png}`);
    assert.ok(fs.statSync(png).size > 0, `empty ${png}`);
  }
}

function assertNoBrowserNote(r, sb) {
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
  const lines = r.stderr.split('\n').filter(Boolean);
  assert.equal(lines.length, 1, `expected exactly one stderr line, got: ${r.stderr}`);
  assert.match(lines[0], /no headless browser/);
  assertNotesPrefixed(r.stderr);
  const pngs = fs.readdirSync(sb.work).filter((file) => file.endsWith('.png'));
  assert.deepEqual(pngs, []);
}

test('prints one note and exits 0 when no browser is on PATH', () => {
  const sb = makeSandbox();
  assertNoBrowserNote(sb.run(), sb);
});

test('prints one note and exits 0 with an empty PATH', () => {
  const sb = makeSandbox();
  const r = spawnScript([sb.html], { PATH: '' }, sb.root);
  assertNoBrowserNote(r, sb);
});

test('firefox-only: uses the proven flag order, a throwaway profile and timeout 60', () => {
  const sb = makeSandbox({ shims: ['firefox'], env: { SHIM_H: '2200' } });
  const r = sb.run();
  assert.equal(r.status, 0, r.stderr);
  assertPngs(sb, r.stdout);
  assertNotesPrefixed(r.stderr);
  assert.doesNotMatch(r.stderr, /capped at 12000|height unknown/);

  const log = sb.log();
  const firefox = callsTo(log, 'firefox');
  assert.ok(firefox.some((line) => line.includes('--window-size=1280,2200')));
  assert.ok(firefox.some((line) => line.includes('--window-size=390,2200')));
  assertEachCallTimedOut(log, 'firefox');
  const firefoxShot = firefox.find((line) => line.includes('--window-size=1280,2200'));
  assertWorkDirShot(sb, /--screenshot (\S+) /.exec(firefoxShot)?.[1]);

  assert.deepEqual(fs.readdirSync(path.join(sb.root, 'tmp')), []);
});

test('prefers chromium over firefox and passes the headless screenshot flags', () => {
  const sb = makeSandbox({ shims: ['chromium', 'firefox'], env: { SHIM_H: '2200' } });
  const r = sb.run();
  assert.equal(r.status, 0, r.stderr);
  assertPngs(sb, r.stdout);
  assertNotesPrefixed(r.stderr);

  const log = sb.log();
  assert.equal(callsTo(log, 'firefox').length, 0);
  const chromium = callsTo(log, 'chromium');
  const shot = chromium.find((line) => line.includes('--window-size=1280,2200'));
  assert.ok(shot, `no chromium call at 1280,2200 in:\n${chromium.join('\n')}`);
  for (const flag of ['--headless', '--hide-scrollbars', '--user-data-dir=', '--screenshot=']) {
    assert.ok(shot.includes(flag), `missing ${flag} in: ${shot}`);
  }
  assertWorkDirShot(sb, /--screenshot=(\S+)/.exec(shot)?.[1]);
  assert.equal(shot.includes('--no-sandbox'), process.getuid?.() === 0);
  assert.ok(chromium.some((line) => line.includes('--window-size=1280,800')));
  assertEachCallTimedOut(log, 'chromium');
});

test('prefers playwright (node) over chromium', () => {
  const sb = makeSandbox({ shims: ['node', 'chromium'], env: { SHIM_H: '2200' } });
  const r = sb.run();
  assert.equal(r.status, 0, r.stderr);
  assertPngs(sb, r.stdout);

  const log = sb.log();
  assert.equal(callsTo(log, 'chromium').length, 0);
  const url = fileUrl(sb.html);
  const desktop = path.join(sb.work, `${sb.name}.png`);
  assert.ok(log.some((line) => /^node measure 1280 file:\/\/\S+$/.test(line)));
  assert.ok(log.some((line) => /^node shot 1280 2200 \S+\/shot-1280\.png file:\/\/\S+$/.test(line) && line.endsWith(` ${url}`)));
  assert.ok(fs.existsSync(desktop));
});

test('falls through to chromium when the playwright candidate exits 3', () => {
  const sb = makeSandbox({ shims: ['node', 'chromium'], env: { SHIM_H: '2200', SHIM_NODE_EXIT: '3' } });
  const r = sb.run();
  assert.equal(r.status, 0, r.stderr);
  assertPngs(sb, r.stdout);

  const log = sb.log();
  assert.ok(callsTo(log, 'node').length > 0);
  assert.ok(callsTo(log, 'chromium').length > 0);
});

test('falls through to firefox when chromium writes no PNG', () => {
  const sb = makeSandbox({
    shims: ['chromium', 'firefox'],
    env: { SHIM_H: '2200', SHIM_CHROMIUM_NOPNG: '1' },
  });
  const r = sb.run();
  assert.equal(r.status, 0, r.stderr);
  assertPngs(sb, r.stdout);

  const log = sb.log();
  assert.ok(callsTo(log, 'chromium').length > 0);
  assert.ok(callsTo(log, 'firefox').length > 0);
});

test('caps the window height at 12000 and says so', () => {
  const sb = makeSandbox({ shims: ['chromium'], env: { SHIM_H: '20000' } });
  const r = sb.run();
  assert.equal(r.status, 0, r.stderr);
  assertPngs(sb, r.stdout);
  assert.match(r.stderr, /capped at 12000/);
  assertNotesPrefixed(r.stderr);

  const chromium = callsTo(sb.log(), 'chromium');
  assert.ok(chromium.some((line) => line.includes('--window-size=1280,12000')));
  assert.ok(!chromium.some((line) => line.includes('--window-size=1280,20000')));
});

test('skips the phone PNG when the layout at 390px matches the desktop layout', () => {
  const sb = makeSandbox({ shims: ['chromium'], env: { SHIM_H: '2200', SHIM_M390: 'wide' } });
  const r = sb.run();
  assert.equal(r.status, 0, r.stderr);
  assertPngs(sb, r.stdout, { phone: false });
  assert.ok(!fs.existsSync(path.join(sb.work, `${sb.name}-390.png`)));
  assert.match(r.stderr, /same layout/);
  assertNotesPrefixed(r.stderr);
});

test('falls back to height 2000 and keeps both PNGs when no measure line is printed', () => {
  const sb = makeSandbox({ shims: ['chromium'] });
  const r = sb.run();
  assert.equal(r.status, 0, r.stderr);
  assertPngs(sb, r.stdout);
  assert.match(r.stderr, /height unknown/);
  assertNotesPrefixed(r.stderr);

  const chromium = callsTo(sb.log(), 'chromium');
  assert.ok(chromium.some((line) => line.includes('--window-size=1280,2000')));
  assert.ok(chromium.some((line) => line.includes('--window-size=390,2000')));
});

test('measures a temp copy carrying the measure script and shoots the untouched original', () => {
  const sb = makeSandbox({ shims: ['chromium'], env: { SHIM_H: '2200' } });
  const r = sb.run();
  assert.equal(r.status, 0, r.stderr);

  const calls = sb.htmlLog();
  const measures = calls.filter((call) => call.height === 800);
  const shots = calls.filter((call) => call.height === 2200);
  assert.ok(measures.length > 0 && shots.length > 0);
  for (const call of measures) {
    assert.equal(call.script, true);
    assert.notEqual(call.url, fileUrl(sb.html));
  }
  for (const call of shots) {
    assert.equal(call.script, false);
    assert.equal(call.url, fileUrl(sb.html));
  }
  assert.equal(fs.readFileSync(sb.html, 'utf8'), FIXTURE_HTML);
});

test('percent-encodes %, space, # and ? in the file URL', () => {
  const sb = makeSandbox({
    shims: ['chromium'],
    env: { SHIM_H: '2200' },
    htmlName: 'a b#c%d?e.html',
  });
  const r = sb.run();
  assert.equal(r.status, 0, r.stderr);
  assertPngs(sb, r.stdout);
  assert.equal(fileUrl(sb.html), `file://${sb.work}/a%20b%23c%25d%3Fe.html`);
  assert.ok(sb.htmlLog().some((call) => call.height === 2200 && call.url === fileUrl(sb.html)));
});

test('exits 2 with a usage line when the html argument is missing, absent or not a file', () => {
  const sb = makeSandbox({ shims: ['chromium'], env: { SHIM_H: '2200' } });
  const badNames = ['back\\slash.html', 'new\nline.html'].map((file) => {
    const bad = path.join(sb.work, file);
    fs.writeFileSync(bad, FIXTURE_HTML);
    return bad;
  });
  for (const args of [[], [path.join(sb.work, 'missing.html')], [sb.work], ...badNames.map((bad) => [bad])]) {
    const r = sb.run(args);
    assert.equal(r.status, 2, `args ${JSON.stringify(args)}: ${r.stderr}`);
    assert.equal(r.stdout, '');
    assert.notEqual(r.stderr.trim(), '');
  }
  assert.equal(sb.log().length, 0);
});

test('never reports a stale PNG as fresh when the first browser writes nothing', () => {
  const sb = makeSandbox({
    shims: ['chromium', 'firefox'],
    env: { SHIM_H: '2200', SHIM_CHROMIUM_NOPNG: '1' },
  });
  const desktop = path.join(sb.work, `${sb.name}.png`);
  const phone = path.join(sb.work, `${sb.name}-390.png`);
  fs.writeFileSync(desktop, 'STALE');
  fs.writeFileSync(phone, 'STALE');
  const r = sb.run();
  assert.equal(r.status, 0, r.stderr);
  assert.ok(callsTo(sb.log(), 'firefox').length > 0);
  assertPngs(sb, r.stdout);
  for (const png of [desktop, phone]) {
    assert.ok(!fs.readFileSync(png, 'utf8').includes('STALE'), `stale content in ${png}`);
  }
  assert.deepEqual(fs.readdirSync(path.join(sb.root, 'tmp')), []);
});

test('removes a stale phone PNG when the layout at 390px matches the desktop layout', () => {
  const sb = makeSandbox({ shims: ['chromium'], env: { SHIM_H: '2200', SHIM_M390: 'wide' } });
  const phone = path.join(sb.work, `${sb.name}-390.png`);
  fs.writeFileSync(phone, 'STALE');
  const r = sb.run();
  assert.equal(r.status, 0, r.stderr);
  assertPngs(sb, r.stdout, { phone: false });
  assert.ok(!fs.existsSync(phone));
});

test('replaces a symlinked PNG target instead of writing through it', () => {
  const sb = makeSandbox({ shims: ['chromium'], env: { SHIM_H: '2200' } });
  const keep = path.join(sb.root, 'keep.txt');
  fs.writeFileSync(keep, 'KEEP');
  const desktop = path.join(sb.work, `${sb.name}.png`);
  fs.symlinkSync(keep, desktop);
  const r = sb.run();
  assert.equal(r.status, 0, r.stderr);
  assertPngs(sb, r.stdout);
  assert.equal(fs.readFileSync(keep, 'utf8'), 'KEEP');
  assert.ok(fs.lstatSync(desktop).isFile());
});

function assertWorkDirShot(sb, loggedPath) {
  assert.ok(loggedPath, 'no screenshot path in the browser call');
  assert.ok(
    loggedPath.startsWith(path.join(sb.root, 'tmp') + path.sep),
    `screenshot not rendered inside the sandbox TMPDIR: ${loggedPath}`,
  );
  assert.ok(loggedPath.endsWith('shot-1280.png'), `unexpected screenshot name: ${loggedPath}`);
}

function assertDestinationRefused(sb, r, blockedDir) {
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, '');
  const lines = r.stderr.split('\n').filter(Boolean);
  assert.equal(lines.length, 1, `expected exactly one stderr line, got: ${r.stderr}`);
  assert.match(lines[0], /cannot write/);
  assertNotesPrefixed(r.stderr);
  assert.deepEqual(fs.readdirSync(blockedDir).filter((file) => /^shot-.*\.png$/.test(file)), []);
  assert.deepEqual(fs.readdirSync(path.join(sb.root, 'tmp')), []);
}

test('refuses a PNG path that is a directory and writes nothing into it', () => {
  const sb = makeSandbox({ shims: ['chromium'], env: { SHIM_H: '2200' } });
  const blocked = path.join(sb.work, `${sb.name}.png`);
  fs.mkdirSync(blocked);
  const r = sb.run();
  assertDestinationRefused(sb, r, blocked);
  assert.ok(fs.lstatSync(blocked).isDirectory());
  assert.equal(sb.log().length, 0);
});

const gnuMv = spawnSync('mv', ['--version']).status === 0;

test('never moves the shot into a directory created after the pre-check', { skip: !gnuMv && 'needs GNU mv -T (BSD/macOS mv has no -T)' }, () => {
  const sb = makeSandbox({
    shims: ['chromium', 'mv'],
    env: { SHIM_H: '2200', SHIM_REAL_MV: resolveOnPath('mv') },
  });
  const blocked = path.join(sb.work, `${sb.name}.png`);
  const r = sb.run();
  assertDestinationRefused(sb, r, blocked);
  assert.ok(fs.lstatSync(blocked).isDirectory());
  assert.deepEqual(fs.readdirSync(blocked), []);
});

test('refuses a PNG path that becomes a symlink to a directory and writes nothing through it', () => {
  const target = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'show-me-target-')), 'dir');
  roots.push(path.dirname(target));
  fs.mkdirSync(target);
  const sb = makeSandbox({
    shims: ['chromium'],
    env: { SHIM_H: '2200', SHIM_PLANT_AT: 'work/page.png', SHIM_PLANT_TO: target },
  });
  const blocked = path.join(sb.work, `${sb.name}.png`);
  const r = sb.run();
  assertDestinationRefused(sb, r, target);
  assert.ok(fs.lstatSync(blocked).isSymbolicLink());
});

test('exits 2 when the out-dir argument contains a newline', () => {
  const sb = makeSandbox({ shims: ['chromium'], env: { SHIM_H: '2200' } });
  const r = sb.run([sb.html, path.join(sb.root, 'out\nline')]);
  assert.equal(r.status, 2, r.stderr);
  assert.equal(r.stdout, '');
  assert.notEqual(r.stderr.trim(), '');
  assert.equal(sb.log().length, 0);
});

test('writes the PNGs into the out-dir argument', () => {
  const sb = makeSandbox({ shims: ['chromium'], env: { SHIM_H: '2200' } });
  const outDir = path.join(sb.root, 'out');
  fs.mkdirSync(outDir);
  const r = sb.run([sb.html, outDir]);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(stdoutLines(r.stdout), [
    path.join(outDir, `${sb.name}.png`),
    path.join(outDir, `${sb.name}-390.png`),
  ]);
  assert.deepEqual(fs.readdirSync(outDir).sort(), [`${sb.name}-390.png`, `${sb.name}.png`]);
  assert.deepEqual(fs.readdirSync(sb.work).filter((file) => file.endsWith('.png')), []);
});
