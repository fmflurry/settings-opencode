/**
 * Regression checks for the remote bootstrap + installer contract.
 *
 * Run with:
 *   node --test --experimental-strip-types installer-bootstrap.test.mts
 */

import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(fileURLToPath(import.meta.url));
const bootstrapPath = join(repoRoot, "bootstrap.sh");
const installerPath = join(repoRoot, "install.sh");

function readRepoFile(path: string): string {
  return readFileSync(join(repoRoot, path), "utf8");
}

function writeFakeNpm(binDir: string): void {
  const fakeNpm = join(binDir, "npm");
  writeFileSync(
    fakeNpm,
    "#!/usr/bin/env bash\ncase \"${1:-}\" in\n  --version) printf '10.0.0\\n' ;;\n  ci|install) exit 0 ;;\n  *) exit 0 ;;\nesac\n",
  );
  chmodSync(fakeNpm, 0o755);
}

test("remote bootstrap keeps install.sh interactive instead of forcing --yes", () => {
  const bootstrap = readRepoFile("bootstrap.sh");

  assert.doesNotMatch(
    bootstrap,
    /\[\s*!\s+-t\s+0\s*\][\s\S]{0,240}args\+?=\(\s*--yes\s*\)/,
    "curl | bash must not silently append --yes; install.sh must still prompt via the terminal",
  );
  assert.doesNotMatch(
    bootstrap,
    /install\.sh[^\n]*--yes/,
    "remote bootstrap must not hard-code the non-interactive default path",
  );
});

test("installer prompts for harness choice: ClaudeCode, OpenCode, or both", () => {
  const installer = readRepoFile("install.sh");
  const harnessPrompt = /(?:ask|read|select)[\s\S]{0,240}(?:harness|ClaudeCode|Claude Code|OpenCode)[\s\S]{0,360}(?:ClaudeCode|Claude Code)[\s\S]{0,360}OpenCode[\s\S]{0,360}\bboth\b|(?:ask|read|select)[\s\S]{0,240}(?:harness|ClaudeCode|Claude Code|OpenCode)[\s\S]{0,360}\bboth\b[\s\S]{0,360}(?:ClaudeCode|Claude Code)[\s\S]{0,360}OpenCode/i;

  assert.match(
    installer,
    harnessPrompt,
    "install.sh must present one interactive harness choice with ClaudeCode, OpenCode, and both options",
  );
});

test("installer prompts for install scope: global or local current directory", () => {
  const installer = readRepoFile("install.sh");
  const scopePrompt = /(?:ask|read|select)[\s\S]{0,240}(?:scope|install location|install target)[\s\S]{0,360}\bglobal\b[\s\S]{0,360}\blocal\b[\s\S]{0,360}(?:current directory|current working directory|cwd|INVOKE_DIR)|(?:ask|read|select)[\s\S]{0,240}(?:scope|install location|install target)[\s\S]{0,360}\blocal\b[\s\S]{0,360}(?:current directory|current working directory|cwd|INVOKE_DIR)[\s\S]{0,360}\bglobal\b/i;

  assert.match(
    installer,
    scopePrompt,
    "install.sh must ask whether to install globally or locally into the current directory",
  );
});

test("installer aborts without --yes when stdin is not a terminal", () => {
  const tmpRoot = mkdtempSync(join(tmpdir(), "settings-opencode-install-"));
  try {
    const projectDir = join(tmpRoot, "project");
    const homeDir = join(tmpRoot, "home");
    const fakeBin = join(tmpRoot, "bin");
    mkdirSync(projectDir);
    mkdirSync(homeDir);
    mkdirSync(fakeBin);
    writeFakeNpm(fakeBin);

    const result = spawnSync("bash", [installerPath, "--no-claude"], {
      cwd: projectDir,
      input: "",
      encoding: "utf8",
      env: {
        ...process.env,
        HOME: homeDir,
        PATH: `${fakeBin}:/usr/bin:/bin:/usr/sbin:/sbin`,
        SHELL: "/bin/zsh",
      },
    });
    const output = `${result.stdout}\n${result.stderr}`;

    assert.ok(
      result.status !== 0 && /non-interactive|controlling TTY|cannot prompt|--yes|no tty/i.test(output),
      `install.sh must abort and explain that prompts require a terminal unless --yes is passed; got status ${result.status}\n${output.slice(0, 1600)}`,
    );
  } finally {
    rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test("WSL Windows username prompt reads through the terminal-aware helper", () => {
  const installer = readRepoFile("install.sh");
  const promptStart = installer.indexOf("Enter your Windows username");
  const promptWindow = promptStart === -1 ? "" : installer.slice(promptStart, promptStart + 240);

  assert.match(
    promptWindow,
    /\bread_reply\s+winuser\b/,
    "the WSL Windows username prompt must use read_reply so input comes from the terminal",
  );
  assert.doesNotMatch(
    promptWindow,
    /\bread\s+-r\s+winuser\b/,
    "the WSL Windows username prompt must not read raw stdin",
  );
});

test("installer rejects disabling both targets before prompting for scope", () => {
  const tmpRoot = mkdtempSync(join(tmpdir(), "settings-opencode-install-"));
  try {
    const projectDir = join(tmpRoot, "project");
    const homeDir = join(tmpRoot, "home");
    mkdirSync(projectDir);
    mkdirSync(homeDir);

    const result = spawnSync(
      "bash",
      [installerPath, "--no-opencode", "--no-claude"],
      {
        cwd: projectDir,
        input: "",
        encoding: "utf8",
        env: {
          ...process.env,
          HOME: homeDir,
          SHELL: "/bin/zsh",
        },
      },
    );
    const output = `${result.stdout}\n${result.stderr}`;

    assert.ok(
      result.status !== 0 && !/Choose install scope/i.test(output),
      `install.sh must fail the empty target set before asking for install scope; got status ${result.status}\n${output}`,
    );
  } finally {
    rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test("local OpenCode install does not merge into an existing .opencode without explicit confirmation", () => {
  const tmpRoot = mkdtempSync(join(tmpdir(), "settings-opencode-install-"));
  try {
    const projectDir = join(tmpRoot, "project");
    const homeDir = join(tmpRoot, "home");
    const fakeBin = join(tmpRoot, "bin");
    const existingTarget = join(projectDir, ".opencode");
    const existingConfig = join(existingTarget, "opencode.jsonc");
    mkdirSync(projectDir);
    mkdirSync(homeDir);
    mkdirSync(fakeBin);
    mkdirSync(existingTarget);
    writeFakeNpm(fakeBin);
    const existingConfigContent = "{\n  // existing project config\n  \"sentinel\": true\n}\n";
    writeFileSync(existingConfig, existingConfigContent);

    const result = spawnSync(
      "bash",
      [installerPath, "--local", "--yes", "--no-claude"],
      {
        cwd: projectDir,
        encoding: "utf8",
        env: {
          ...process.env,
          HOME: homeDir,
          PATH: `${fakeBin}:/usr/bin:/bin:/usr/sbin:/sbin`,
          SHELL: "/bin/zsh",
        },
      },
    );
    const output = `${result.stdout}\n${result.stderr}`;

    assert.ok(
      readFileSync(existingConfig, "utf8") === existingConfigContent,
      `existing local .opencode config must be left untouched without target-specific confirmation\n${output}`,
    );
    assert.equal(
      existsSync(join(existingTarget, "CLAUDE.md")),
      false,
      `repo payload must not be merged into an existing local .opencode without target-specific confirmation\n${output}`,
    );
  } finally {
    rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test("OpenCode local install syncs the repository config payload exactly", () => {
  const tmpRoot = mkdtempSync(join(tmpdir(), "settings-opencode-install-"));
  try {
    const projectDir = join(tmpRoot, "project");
    const homeDir = join(tmpRoot, "home");
    const fakeBin = join(tmpRoot, "bin");
    mkdirSync(projectDir);
    mkdirSync(homeDir);
    mkdirSync(fakeBin);
    const fakeNpm = join(fakeBin, "npm");
    writeFileSync(
      fakeNpm,
      "#!/usr/bin/env bash\ncase \"${1:-}\" in\n  --version) printf '10.0.0\\n' ;;\n  ci|install) exit 0 ;;\n  *) exit 0 ;;\nesac\n",
    );
    chmodSync(fakeNpm, 0o755);

    const result = spawnSync(
      "bash",
      [installerPath, "--local", "--yes", "--no-claude"],
      {
        cwd: projectDir,
        encoding: "utf8",
        env: {
          ...process.env,
          HOME: homeDir,
          PATH: `${fakeBin}:/usr/bin:/bin:/usr/sbin:/sbin`,
          SHELL: "/bin/zsh",
        },
      },
    );

    assert.equal(
      result.status,
      0,
      `${result.stdout}\n${result.stderr}`,
    );

    const installedRoot = join(projectDir, ".opencode");
    const payloadPaths = [
      "CLAUDE.md",
      "bun.lock",
      "commands",
      "contexts",
      "dcp.jsonc",
      "instructions",
      "opencode.jsonc",
      "package-lock.json",
      "package.json",
      "plugins",
      "profiles",
      "prompts",
      "scripts",
      "skills",
      "tools",
      "tui-plugins",
      "tui.json",
    ];

    for (const payloadPath of payloadPaths) {
      const sourcePath = join(repoRoot, payloadPath);
      if (!existsSync(sourcePath)) {
        continue;
      }
      assert.deepEqual(
        collectEntries(join(installedRoot, payloadPath)),
        collectEntries(sourcePath),
        `${payloadPath} must match the repository payload exactly`,
      );
    }
  } finally {
    rmSync(tmpRoot, { recursive: true, force: true });
  }
});

function collectEntries(root: string): Record<string, string> {
  const entries: Record<string, string> = {};
  collectEntry(root, root, entries);
  return entries;
}

function collectEntry(
  root: string,
  path: string,
  entries: Record<string, string>,
): void {
  const relativePath = relative(root, path) || ".";
  const stats = lstatSync(path);

  if (stats.isDirectory()) {
    entries[`${relativePath}/`] = "directory";
    for (const child of readdirSync(path).sort()) {
      collectEntry(root, join(path, child), entries);
    }
    return;
  }

  if (stats.isSymbolicLink()) {
    entries[relativePath] = `symlink:${readlinkSync(path)}`;
    return;
  }

  entries[relativePath] = `file:${createHash("sha256").update(readFileSync(path)).digest("hex")}`;
}
