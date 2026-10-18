import fs from 'node:fs';
import path from 'node:path';

export const HARNESSES = ['cursor', 'opencode', 'claude'];

export const OVERRIDE_REL = {
  cursor: '.cursor/skills/e2e/e2e.json',
  opencode: '.opencode/skills/e2e/e2e.json',
  claude: '.claude/skills/e2e/e2e.json',
};

const PLAYWRIGHT_CONFIGS = [
  'playwright.config.ts',
  'playwright.config.js',
  'playwright.config.mjs',
  'playwright.config.cjs',
];

const SCRIPT_ORDER = ['test:e2e', 'e2e', 'e2e:ci'];
const SKILL_NAME = /^[a-z0-9-]+$/;

export function detectHarness(env = process.env) {
  const forced = env.VERIFY_HARNESS;
  if (forced === 'cursor' || forced === 'opencode' || forced === 'claude') return forced;
  if (env.CURSOR_AGENT || env.CURSOR_PLUGIN_ROOT) return 'cursor';
  if (env.CLAUDE_CODE_ENTRYPOINT || env.CLAUDE_CODE_REMOTE || env.CLAUDE_CODE_REMOTE_SESSION_ID || env.CLAUDE_PROJECT_DIR) return 'claude';
  if (env.OPENCODE || env.OPENCODE_CLIENT) return 'opencode';
  return null;
}

function blank(extra) {
  return {
    ok: true,
    source: 'none',
    harness: null,
    file: null,
    excluded: false,
    enabled: true,
    found: false,
    start: [],
    startOwnedByRunner: false,
    ports: [],
    baseUrl: null,
    test: null,
    headed: null,
    ui: null,
    report: null,
    cwd: '.',
    runner: null,
    skills: [],
    error: null,
    ...extra,
  };
}

function readText(file) {
  return fs.readFileSync(file, 'utf8');
}

function packageManager(root) {
  if (!fs.existsSync(path.join(root, 'package.json'))) return null;
  if (fs.existsSync(path.join(root, 'bun.lock')) || fs.existsSync(path.join(root, 'bun.lockb'))) return 'bun';
  if (fs.existsSync(path.join(root, 'pnpm-lock.yaml'))) return 'pnpm';
  if (fs.existsSync(path.join(root, 'yarn.lock'))) return 'yarn';
  return 'npm';
}

function runScript(pm, name) {
  return `${pm} run ${name}`;
}

function readPackage(root) {
  const file = path.join(root, 'package.json');
  if (!fs.existsSync(file)) return null;
  try {
    const json = JSON.parse(readText(file));
    return json && typeof json === 'object' ? json : null;
  } catch {
    return null;
  }
}

function httpUrls(text) {
  return [...text.matchAll(/https?:\/\/[^\s'"`),]+/g)].map((match) => match[0]);
}

function portsFromUrls(urls) {
  const ports = [];
  for (const url of urls) {
    try {
      const parsed = new URL(url);
      if (parsed.port) ports.push(Number(parsed.port));
    } catch {
      // A non-URL token in a config comment is not a port.
    }
  }
  return [...new Set(ports)];
}

function playwrightConfigPath(root) {
  for (const name of PLAYWRIGHT_CONFIGS) {
    const abs = path.join(root, name);
    if (fs.existsSync(abs)) return abs;
  }
  for (const name of PLAYWRIGHT_CONFIGS) {
    const abs = path.join(root, 'tests', 'playwright', name);
    if (fs.existsSync(abs)) return abs;
  }
  return null;
}

function hasPlaywright(root, pkg) {
  const deps = { ...pkg?.dependencies, ...pkg?.devDependencies };
  if (deps['@playwright/test'] || deps.playwright) return true;
  return playwrightConfigPath(root) !== null;
}

function hasCypress(root, pkg) {
  const deps = { ...pkg?.dependencies, ...pkg?.devDependencies };
  if (deps.cypress) return true;
  return ['cypress.config.ts', 'cypress.config.js', 'cypress.config.mjs'].some((name) => fs.existsSync(path.join(root, name)));
}

function testCwd(root) {
  const nested = path.join(root, 'tests', 'playwright');
  if (PLAYWRIGHT_CONFIGS.some((name) => fs.existsSync(path.join(nested, name)))) return 'tests/playwright';
  if (fs.existsSync(path.join(nested, 'package.json'))) return 'tests/playwright';
  return '.';
}

function makeTarget(root, name) {
  const file = path.join(root, 'Makefile');
  if (!fs.existsSync(file)) return false;
  return new RegExp(`^${name}:`, 'm').test(readText(file));
}

function discover(root, harness) {
  const pkg = readPackage(root);
  const pm = packageManager(root);
  const scripts = pkg?.scripts && typeof pkg.scripts === 'object' ? pkg.scripts : {};
  const scriptName = SCRIPT_ORDER.find((name) => typeof scripts[name] === 'string');
  const configPath = playwrightConfigPath(root);
  const configText = configPath ? readText(configPath) : '';
  const baseMatch = configText.match(/baseURL\s*:\s*['"](https?:\/\/[^'"]+)['"]/);
  const urlMatch = configText.match(/url\s*:\s*['"](https?:\/\/[^'"]+)['"]/);
  const commandMatch = configText.match(/command\s*:\s*['"]([^'"]+)['"]/);
  const baseUrl = baseMatch?.[1] ?? urlMatch?.[1] ?? null;
  const ports = portsFromUrls([baseUrl, urlMatch?.[1]].filter(Boolean).concat(httpUrls(configText)));
  const playwright = hasPlaywright(root, pkg);
  const cypress = hasCypress(root, pkg);

  let test = null;
  let runner = null;
  if (scriptName && pm) {
    test = runScript(pm, scriptName);
    runner = playwright ? 'playwright' : cypress ? 'cypress' : 'project';
  } else if (playwright) {
    test = 'npx playwright test';
    runner = 'playwright';
  } else if (cypress) {
    test = 'npx cypress run';
    runner = 'cypress';
  } else if (makeTarget(root, 'e2e')) {
    test = 'make e2e';
    runner = 'make';
  }

  const headedName = ['test:e2e:headed', 'e2e:headed'].find((name) => typeof scripts[name] === 'string');
  const uiName = ['test:e2e:ui', 'e2e:ui'].find((name) => typeof scripts[name] === 'string');
  const reportName = ['test:e2e:report', 'e2e:report'].find((name) => typeof scripts[name] === 'string');

  let start = [];
  let startOwnedByRunner = false;
  if (commandMatch) {
    start = [commandMatch[1]];
    startOwnedByRunner = true;
  } else if (pm && typeof scripts.dev === 'string') {
    start = [runScript(pm, 'dev')];
  } else if (pm && typeof scripts.start === 'string') {
    start = [runScript(pm, 'start')];
  }

  const found = Boolean(test || start.length || baseUrl);
  return blank({
    source: found ? 'discovered' : 'none',
    harness,
    found,
    start,
    startOwnedByRunner,
    ports,
    baseUrl,
    test,
    headed: headedName && pm ? runScript(pm, headedName) : null,
    ui: uiName && pm ? runScript(pm, uiName) : null,
    report: reportName && pm ? runScript(pm, reportName) : null,
    cwd: testCwd(root),
    runner,
  });
}

function asString(value, label) {
  if (typeof value !== 'string' || value.trim() === '') return { error: `${label} must be a string` };
  return { value: value.trim() };
}

function normalizeOverride(json, rel, harness) {
  if (!json || typeof json !== 'object' || Array.isArray(json)) {
    return blank({ ok: false, source: 'override', harness, file: rel, error: 'e2e.json must be an object' });
  }
  if (json.version !== 1) {
    return blank({ ok: false, source: 'override', harness, file: rel, error: 'e2e.json version must be 1' });
  }
  if (json.enabled === false) {
    return blank({
      source: 'override',
      harness,
      file: rel,
      excluded: true,
      enabled: false,
    });
  }
  if ('enabled' in json && typeof json.enabled !== 'boolean') {
    return blank({ ok: false, source: 'override', harness, file: rel, error: 'enabled must be a boolean' });
  }

  let start = [];
  if (json.start !== undefined) {
    const values = Array.isArray(json.start) ? json.start : [json.start];
    for (const value of values) {
      const parsed = asString(value, 'start');
      if (parsed.error) return blank({ ok: false, source: 'override', harness, file: rel, error: parsed.error });
      start.push(parsed.value);
    }
  }

  let ports = [];
  if (json.ports !== undefined) {
    if (!Array.isArray(json.ports)) {
      return blank({ ok: false, source: 'override', harness, file: rel, error: 'ports must be an array' });
    }
    for (const port of json.ports) {
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        return blank({ ok: false, source: 'override', harness, file: rel, error: 'ports must be integers from 1 to 65535' });
      }
      ports.push(port);
    }
  }

  let baseUrl = null;
  if (json.baseUrl !== undefined) {
    const parsed = asString(json.baseUrl, 'baseUrl');
    if (parsed.error) return blank({ ok: false, source: 'override', harness, file: rel, error: parsed.error });
    baseUrl = parsed.value;
  }

  let test = null;
  if (json.test !== undefined) {
    const parsed = asString(json.test, 'test');
    if (parsed.error) return blank({ ok: false, source: 'override', harness, file: rel, error: parsed.error });
    test = parsed.value;
  }

  let cwd = '.';
  if (json.cwd !== undefined) {
    const parsed = asString(json.cwd, 'cwd');
    if (parsed.error) return blank({ ok: false, source: 'override', harness, file: rel, error: parsed.error });
    if (path.isAbsolute(parsed.value) || parsed.value.split(/[\\/]/).includes('..')) {
      return blank({ ok: false, source: 'override', harness, file: rel, error: 'cwd must be a relative path inside the repository' });
    }
    cwd = parsed.value;
  }

  let runner = null;
  if (json.runner !== undefined) {
    const parsed = asString(json.runner, 'runner');
    if (parsed.error) return blank({ ok: false, source: 'override', harness, file: rel, error: parsed.error });
    runner = parsed.value;
  }

  let skills = [];
  if (json.skills !== undefined) {
    if (!Array.isArray(json.skills)) {
      return blank({ ok: false, source: 'override', harness, file: rel, error: 'skills must be an array' });
    }
    for (const name of json.skills) {
      if (typeof name !== 'string' || !SKILL_NAME.test(name)) {
        return blank({ ok: false, source: 'override', harness, file: rel, error: 'skills entries must be skill names' });
      }
      skills.push(name);
    }
  }

  let startOwnedByRunner = false;
  if (json.startOwnedByRunner !== undefined) {
    if (typeof json.startOwnedByRunner !== 'boolean') {
      return blank({ ok: false, source: 'override', harness, file: rel, error: 'startOwnedByRunner must be a boolean' });
    }
    startOwnedByRunner = json.startOwnedByRunner;
  }

  return blank({
    source: 'override',
    harness,
    file: rel,
    found: true,
    start,
    startOwnedByRunner,
    ports,
    baseUrl,
    test,
    cwd,
    runner,
    skills,
  });
}

function overrideOrder(harness) {
  const order = [];
  if (OVERRIDE_REL[harness]) order.push(harness);
  for (const name of HARNESSES) {
    if (!order.includes(name)) order.push(name);
  }
  return order;
}

export function resolveE2E(root, harness = null) {
  const abs = path.resolve(root);
  for (const name of overrideOrder(harness)) {
    const rel = OVERRIDE_REL[name];
    const file = path.join(abs, rel);
    if (!fs.existsSync(file)) continue;
    let json;
    try {
      json = JSON.parse(readText(file));
    } catch {
      return blank({ ok: false, source: 'override', harness: name, file: rel, error: 'e2e.json is not valid JSON' });
    }
    return normalizeOverride(json, rel, name);
  }
  return discover(abs, harness);
}
