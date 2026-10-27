import { execFileSync } from 'node:child_process';

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

// Paths whose contents are copied into plugins/fmflurry-harness, or that decide that copy.
// check.mjs, validate.mjs, fixtures, and this file are absent: they do not ship in the plugin.
export function pluginSourcePaths(config) {
  const hooks = (config?.hooks?.include ?? []).map((name) => `.claude/hooks/${name}`);
  return [
    'plugins/fmflurry-harness/',
    'scripts/build-cursor-plugin.mjs',
    'scripts/cursor-plugin/variant.mjs',
    'scripts/sync-skills.sh',
    'variants/monolith/',
    'variants/conductor/AGENTS.md',
    'scripts/cursor-plugin/config.json',
    'scripts/cursor-plugin/lib.mjs',
    'scripts/cursor-plugin/README.template.md',
    'scripts/cursor-plugin/CHANGELOG.md',
    'scripts/cursor-plugin/cursor-adapter.sh',
    'scripts/cursor-plugin/templates/setup-harness.md',
    'scripts/cursor-plugin/assets/logo.png',
    'skills/',
    '.claude/skills/',
    '.claude/agents/',
    '.claude/commands/',
    '.claude/rules/',
    '.claude/CLAUDE.md',
    '.claude/settings.json',
    ...hooks,
    'commands/',
    'opencode.jsonc',
  ];
}

export function parseSemver(value) {
  const match = SEMVER.exec(String(value ?? '').trim());
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function compareSemver(a, b) {
  const left = parseSemver(a);
  const right = parseSemver(b);
  if (!left || !right) return null;
  for (let i = 0; i < 3; i += 1) {
    if (left[i] !== right[i]) return left[i] < right[i] ? -1 : 1;
  }
  return 0;
}

export function suggestBumps(version) {
  const parts = parseSemver(version);
  if (!parts) return null;
  const [major, minor, patch] = parts;
  return {
    patch: `${major}.${minor}.${patch + 1}`,
    minor: `${major}.${minor + 1}.0`,
    major: `${major + 1}.0.0`,
  };
}

export function isPluginSource(file, paths) {
  const norm = String(file).replaceAll('\\', '/').replace(/^\.\//, '');
  return paths.some((entry) => (entry.endsWith('/') ? norm.startsWith(entry) : norm === entry));
}

export function changelogHasVersion(text, version) {
  if (!parseSemver(version)) return false;
  const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^##\\s+\\[?${escaped}\\]?(?:\\s|$)`, 'm').test(text);
}

function bumpMessage({ currentVersion, baseVersion, relation, changedPluginPaths, baseRef }) {
  const next = suggestBumps(baseVersion);
  const lines = [
    `Plugin sources changed relative to ${baseRef}, but version ${currentVersion} is ${relation} base ${baseVersion}.`,
    `Bump scripts/cursor-plugin/config.json above ${baseVersion} and add a CHANGELOG heading for the new version.`,
  ];
  if (next) {
    lines.push(
      `Suggested bumps: patch ${next.patch} (fixes, chores, doc tweaks); minor ${next.minor} (new agents, skills, commands, rules, or behavior); major ${next.major} (breaking: renamed or removed agents/skills, tier key changes, installer contract).`,
    );
  }
  const shown = changedPluginPaths.slice(0, 20);
  if (shown.length) {
    lines.push('Changed plugin sources:');
    for (const file of shown) lines.push(`  ${file}`);
    if (changedPluginPaths.length > shown.length) {
      lines.push(`  ... ${changedPluginPaths.length - shown.length} more`);
    }
  }
  return lines.join('\n');
}

export function evaluateVersionBump({
  baseAvailable,
  currentVersion,
  baseVersion,
  baseVersionError = null,
  changedPluginPaths,
  baseRef = 'the base',
  unavailableMessage = null,
}) {
  if (!baseAvailable) {
    return {
      ok: true,
      skipped: true,
      message: unavailableMessage
        ?? 'cursor-plugin version guard skipped: no base ref available. Fetch the base branch or set CURSOR_PLUGIN_BASE to enforce the bump check.',
    };
  }
  if (changedPluginPaths.length === 0) return { ok: true, skipped: false, message: null };
  if (!parseSemver(currentVersion)) {
    return {
      ok: false,
      skipped: false,
      message: `Plugin sources changed relative to ${baseRef}, but version ${JSON.stringify(currentVersion)} is not MAJOR.MINOR.PATCH. Set scripts/cursor-plugin/config.json above ${baseVersion ?? '0.0.0'} and add a CHANGELOG heading.`,
    };
  }
  if (baseVersionError || !parseSemver(baseVersion)) {
    return {
      ok: false,
      skipped: false,
      message: baseVersionError
        ?? `Plugin sources changed relative to ${baseRef}, but base version ${JSON.stringify(baseVersion)} is not MAJOR.MINOR.PATCH.`,
    };
  }
  const order = compareSemver(currentVersion, baseVersion);
  if (order > 0) return { ok: true, skipped: false, message: null };
  return {
    ok: false,
    skipped: false,
    message: bumpMessage({
      currentVersion,
      baseVersion,
      relation: order === 0 ? 'equal to' : 'lower than',
      changedPluginPaths,
      baseRef,
    }),
  };
}

function gitOutput(repoDir, args, env) {
  try {
    return execFileSync('git', args, {
      cwd: repoDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...env, GIT_TERMINAL_PROMPT: '0' },
    });
  } catch {
    return null;
  }
}

function revParse(repoDir, ref, env) {
  const out = gitOutput(repoDir, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], env);
  return out?.trim() || null;
}

function fetchBaseBranch(repoDir, branch, env) {
  return gitOutput(repoDir, [
    'fetch', '--no-tags', 'origin', `refs/heads/${branch}:refs/remotes/origin/${branch}`,
  ], env) != null;
}

export function resolveVersionBase(repoDir, env = process.env) {
  const explicit = env.CURSOR_PLUGIN_BASE?.trim();
  if (explicit) {
    if (!revParse(repoDir, explicit, env)) {
      return {
        available: false,
        message: `cursor-plugin version guard skipped: no base ref available (CURSOR_PLUGIN_BASE=${explicit} does not resolve). Fetch that ref or unset CURSOR_PLUGIN_BASE to enforce the bump check.`,
      };
    }
    const tip = revParse(repoDir, explicit, env);
    const mergeBase = gitOutput(repoDir, ['merge-base', explicit, 'HEAD'], env)?.trim();
    if (!mergeBase) {
      return {
        available: false,
        message: `cursor-plugin version guard skipped: CURSOR_PLUGIN_BASE=${explicit} has no merge-base with HEAD. Fetch full history to enforce the bump check.`,
      };
    }
    return { available: true, ref: explicit, tip, mergeBase };
  }

  const ghBase = env.GITHUB_BASE_REF?.trim();
  const candidates = ghBase ? [`origin/${ghBase}`] : ['origin/master', 'master'];
  if (ghBase && env.GITHUB_ACTIONS === 'true' && !revParse(repoDir, candidates[0], env)) {
    fetchBaseBranch(repoDir, ghBase, env);
  }

  for (const ref of candidates) {
    const tip = revParse(repoDir, ref, env);
    if (!tip) continue;
    const mergeBase = gitOutput(repoDir, ['merge-base', ref, 'HEAD'], env)?.trim();
    if (!mergeBase) {
      return {
        available: false,
        message: `cursor-plugin version guard skipped: ${ref} has no merge-base with HEAD (history may be shallow). Fetch full history to enforce the bump check.`,
      };
    }
    return { available: true, ref, tip, mergeBase };
  }

  return {
    available: false,
    message: `cursor-plugin version guard skipped: no base ref available (tried ${candidates.join(', ')}). Fetch the base branch or set CURSOR_PLUGIN_BASE to enforce the bump check.`,
  };
}

function nullSeparated(repoDir, args, env) {
  const out = gitOutput(repoDir, args, env);
  if (out == null) return null;
  return out.split('\0').map((file) => file.replaceAll('\\', '/').replace(/^\.\//, '')).filter(Boolean);
}

export function changedPluginSources(repoDir, mergeBase, paths, env = process.env) {
  const tracked = nullSeparated(repoDir, ['diff', '--name-only', '-z', mergeBase], env);
  const untracked = nullSeparated(repoDir, ['ls-files', '--others', '--exclude-standard', '-z'], env);
  if (!tracked || !untracked) return null;
  return [...new Set([...tracked, ...untracked])].filter((file) => isPluginSource(file, paths)).sort();
}

// A plugin that did not exist at the base commit has no version yet, so the first publish compares against 0.0.0.
export function readConfigVersion(repoDir, rev, env = process.env) {
  let text;
  try {
    text = execFileSync('git', ['show', `${rev}:scripts/cursor-plugin/config.json`], {
      cwd: repoDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...env, GIT_TERMINAL_PROMPT: '0' },
    });
  } catch (err) {
    const stderr = `${err.stderr ?? ''}`;
    if (/does not exist|not in /.test(stderr)) return { version: '0.0.0', error: null };
    return {
      version: null,
      error: `Plugin sources changed relative to ${rev}, but scripts/cursor-plugin/config.json could not be read there.`,
    };
  }
  try {
    const version = JSON.parse(text).version;
    if (typeof version !== 'string') {
      return {
        version: null,
        error: `Plugin sources changed relative to ${rev}, but scripts/cursor-plugin/config.json has no string version.`,
      };
    }
    return { version: version.trim(), error: null };
  } catch {
    return {
      version: null,
      error: `Plugin sources changed relative to ${rev}, but scripts/cursor-plugin/config.json is not valid JSON.`,
    };
  }
}

export function assessPluginVersion({ repoDir, env = process.env, paths, currentVersion }) {
  const base = resolveVersionBase(repoDir, env);
  if (!base.available) return { errors: [], notices: [base.message] };
  const changed = changedPluginSources(repoDir, base.mergeBase, paths, env);
  if (!changed) {
    return {
      errors: [
        `cursor-plugin version guard: git diff against ${base.ref} failed, so the bump could not be checked. Fetch full history and rerun node scripts/cursor-plugin/check.mjs.`,
      ],
      notices: [],
    };
  }
  const found = readConfigVersion(repoDir, base.tip, env);
  const decision = evaluateVersionBump({
    baseAvailable: true,
    currentVersion,
    baseVersion: found.version,
    baseVersionError: found.error,
    changedPluginPaths: changed,
    baseRef: base.ref,
  });
  if (!decision.ok) return { errors: [decision.message], notices: [] };
  return { errors: [], notices: [] };
}
