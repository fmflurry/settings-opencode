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
  cpSync,
  existsSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  readdirSync,
  rmSync,
  symlinkSync,
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
  for (const command of ["launchctl", "systemctl"]) {
    const executable = join(binDir, command);
    writeFileSync(executable, "#!/usr/bin/env bash\nexit 0\n");
    chmodSync(executable, 0o755);
  }
  const fakeNode = join(binDir, "node");
  writeFileSync(fakeNode, "#!/usr/bin/env bash\ncase \"${1:-}\" in\n  -p) printf '22.6.0\\n' ;;\n  --version) printf 'v22.6.0\\n' ;;\n  *) exit 0 ;;\nesac\n");
  chmodSync(fakeNode, 0o755);
}

function runRemoteStyleInteractiveInstaller(
  input: string,
  cwd: string,
  env: Record<string, string | undefined>,
): ReturnType<typeof spawnSync> {
  const ptyDriver = String.raw`
import errno
import os
import pty
import select
import sys

replies = [line.encode() for line in sys.argv[1].splitlines()]
reply_markers = [
    b"Choose harness",
    b"Choose install scope",
    b"write the OPENCODE_MODEL_",
    b"install the .claude mirror",
]
command = sys.argv[2:]

pid, fd = pty.fork()
if pid == 0:
    os.execvpe(command[0], command, os.environ)

status = None
sent = 0
seen = b""

def emit(data):
    sys.stdout.buffer.write(data)
    sys.stdout.buffer.flush()

while True:
    ready, _, _ = select.select([fd], [], [], 0.1)
    if ready:
        try:
            data = os.read(fd, 4096)
        except OSError as error:
            if error.errno == errno.EIO:
                break
            raise
        if not data:
            break
        emit(data)
        seen += data
        if sent < len(replies) and sent < len(reply_markers) and reply_markers[sent] in seen:
            os.write(fd, replies[sent] + b"\n")
            sent += 1
            seen = b""

    ended_pid, ended_status = os.waitpid(pid, os.WNOHANG)
    if ended_pid == pid:
        status = ended_status
        break

while True:
    try:
        data = os.read(fd, 4096)
    except OSError as error:
        if error.errno == errno.EIO:
            break
        raise
    if not data:
        break
    emit(data)

if status is None:
    _, status = os.waitpid(pid, 0)

if os.WIFEXITED(status):
    sys.exit(os.WEXITSTATUS(status))
if os.WIFSIGNALED(status):
    sys.exit(128 + os.WTERMSIG(status))
sys.exit(1)
`;

  return spawnSync(
    "python3",
    [
      "-c",
      ptyDriver,
      input,
      "bash",
      "-c",
      'exec bash "$1" </dev/tty',
      "remote-bootstrap",
      installerPath,
    ],
    {
      cwd,
      encoding: "utf8",
      env,
      timeout: 15_000,
    },
  );
}

function runInteractiveInstallerWithMarkers(
  args: string[],
  replies: string[],
  replyMarkers: string[],
  cwd: string,
  env: Record<string, string | undefined>,
): ReturnType<typeof spawnSync> {
  const ptyDriver = String.raw`
import errno
import json
import os
import pty
import select
import sys

replies = [line.encode() for line in json.loads(sys.argv[1])]
reply_markers = [marker.encode() for marker in json.loads(sys.argv[2])]
command = sys.argv[3:]

pid, fd = pty.fork()
if pid == 0:
    os.execvpe(command[0], command, os.environ)

status = None
sent = 0
seen = b""

def emit(data):
    sys.stdout.buffer.write(data)
    sys.stdout.buffer.flush()

while True:
    ready, _, _ = select.select([fd], [], [], 0.1)
    if ready:
        try:
            data = os.read(fd, 4096)
        except OSError as error:
            if error.errno == errno.EIO:
                break
            raise
        if not data:
            break
        emit(data)
        seen += data
        if sent < len(replies) and sent < len(reply_markers) and reply_markers[sent] in seen:
            os.write(fd, replies[sent] + b"\n")
            sent += 1
            seen = b""

    ended_pid, ended_status = os.waitpid(pid, os.WNOHANG)
    if ended_pid == pid:
        status = ended_status
        break

while True:
    try:
        data = os.read(fd, 4096)
    except OSError as error:
        if error.errno == errno.EIO:
            break
        raise
    if not data:
        break
    emit(data)

if status is None:
    _, status = os.waitpid(pid, 0)

if os.WIFEXITED(status):
    sys.exit(os.WEXITSTATUS(status))
if os.WIFSIGNALED(status):
    sys.exit(128 + os.WTERMSIG(status))
sys.exit(1)
`;

  return spawnSync(
    "python3",
    [
      "-c",
      ptyDriver,
      JSON.stringify(replies),
      JSON.stringify(replyMarkers),
      "bash",
      installerPath,
      ...args,
    ],
    {
      cwd,
      encoding: "utf8",
      env,
      timeout: 15_000,
    },
  );
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

test("remote bootstrap interactive OpenCode local installs only the local OpenCode target", () => {
  const tmpRoot = mkdtempSync(join(tmpdir(), "settings-opencode-install-"));
  try {
    const projectDir = join(tmpRoot, "project");
    const homeDir = join(tmpRoot, "home");
    const fakeBin = join(tmpRoot, "bin");
    mkdirSync(projectDir);
    mkdirSync(homeDir);
    mkdirSync(fakeBin);
    writeFakeNpm(fakeBin);

    const result = runRemoteStyleInteractiveInstaller(
      "OpenCode\nlocal\nn\nn\nn\n",
      projectDir,
      {
        ...process.env,
        HOME: homeDir,
        PATH: `${fakeBin}:/usr/bin:/bin:/usr/sbin:/sbin`,
        SHELL: "/bin/zsh",
      },
    );
    const output = `${result.stdout}\n${result.stderr}`;

    assert.equal(
      result.status,
      0,
      `interactive remote-style install must succeed after answers OpenCode then local\n${output}`,
    );
    assert.equal(
      existsSync(join(projectDir, ".opencode", "opencode.jsonc")),
      true,
      `OpenCode config must be installed into the local cwd target\n${output}`,
    );
    assert.equal(
      existsSync(join(homeDir, ".config", "opencode")),
      false,
      `OpenCode local answer must not install into the global opencode target\n${output}`,
    );
    assert.equal(
      existsSync(join(projectDir, ".claude")),
      false,
      `OpenCode-only answer must not install the local Claude mirror\n${output}`,
    );
    assert.equal(
      existsSync(join(projectDir, ".opencode", ".claude")),
      false,
      `OpenCode-only local install must not copy the Claude mirror inside .opencode\n${output}`,
    );
    assert.equal(
      existsSync(join(homeDir, ".claude")),
      false,
      `OpenCode-only answer must not install the global Claude mirror\n${output}`,
    );
    assert.doesNotMatch(
      output,
      /install the \.claude mirror|copied .* -> .*\.claude|Syncing to .*\.claude\/skills/i,
      `OpenCode-only answer must not run Claude mirror install or sync Claude destinations\n${output}`,
    );
  } finally {
    rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test("global both install keeps Claude mirror separate from the OpenCode target", () => {
  const tmpRoot = mkdtempSync(join(tmpdir(), "settings-opencode-install-"));
  try {
    const projectDir = join(tmpRoot, "project");
    const homeDir = join(tmpRoot, "home");
    const fakeBin = join(tmpRoot, "bin");
    mkdirSync(projectDir);
    mkdirSync(homeDir);
    mkdirSync(fakeBin);
    writeFakeNpm(fakeBin);

    const result = spawnSync("bash", [installerPath, "--yes"], {
      cwd: projectDir,
      encoding: "utf8",
      env: {
        ...process.env,
        HOME: homeDir,
        PATH: `${fakeBin}:/usr/bin:/bin:/usr/sbin:/sbin`,
        SHELL: "/bin/zsh",
      },
    });
    const output = `${result.stdout}\n${result.stderr}`;

    assert.equal(
      result.status,
      0,
      `global default both install must succeed\n${output}`,
    );
    assert.equal(
      existsSync(join(homeDir, ".config", "opencode", "opencode.jsonc")),
      true,
      `OpenCode config must be installed into the global OpenCode target\n${output}`,
    );
    assert.equal(
      existsSync(join(homeDir, ".claude")),
      true,
      `ClaudeCode target must be installed when both harnesses are selected\n${output}`,
    );
    assert.equal(
      existsSync(join(homeDir, ".config", "opencode", ".claude")),
      false,
      `Claude mirror must be a sibling of the global OpenCode target, not nested inside it\n${output}`,
    );
  } finally {
    rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test("local both install uses sibling OpenCode and ClaudeCode targets", () => {
  const tmpRoot = mkdtempSync(join(tmpdir(), "settings-opencode-install-"));
  try {
    const projectDir = join(tmpRoot, "project");
    const homeDir = join(tmpRoot, "home");
    const fakeBin = join(tmpRoot, "bin");
    mkdirSync(projectDir);
    mkdirSync(homeDir);
    mkdirSync(fakeBin);
    writeFakeNpm(fakeBin);

    const result = spawnSync("bash", [installerPath, "--local", "--yes"], {
      cwd: projectDir,
      encoding: "utf8",
      env: {
        ...process.env,
        HOME: homeDir,
        PATH: `${fakeBin}:/usr/bin:/bin:/usr/sbin:/sbin`,
        SHELL: "/bin/zsh",
      },
    });
    const output = `${result.stdout}\n${result.stderr}`;

    assert.equal(
      result.status,
      0,
      `local default both install must succeed\n${output}`,
    );
    assert.equal(
      existsSync(join(projectDir, ".opencode", "opencode.jsonc")),
      true,
      `OpenCode config must be installed into ./.opencode\n${output}`,
    );
    assert.equal(
      existsSync(join(projectDir, ".claude")),
      true,
      `ClaudeCode target must be installed into ./.claude when both harnesses are selected\n${output}`,
    );
    assert.equal(
      existsSync(join(projectDir, ".opencode", ".claude")),
      false,
      `local ClaudeCode target must be a sibling of .opencode, not ./.opencode/.claude\n${output}`,
    );
    assert.equal(
      existsSync(join(homeDir, ".claude")),
      false,
      `local install must not install the global ClaudeCode target\n${output}`,
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

test("global OpenCode reinstall does not silently leave a nested .claude from a prior bad install", () => {
  const tmpRoot = mkdtempSync(join(tmpdir(), "settings-opencode-install-"));
  try {
    const projectDir = join(tmpRoot, "project");
    const homeDir = join(tmpRoot, "home");
    const fakeBin = join(tmpRoot, "bin");
    const existingTarget = join(homeDir, ".config", "opencode");
    const nestedClaude = join(existingTarget, ".claude");
    mkdirSync(projectDir);
    mkdirSync(homeDir);
    mkdirSync(fakeBin);
    mkdirSync(nestedClaude, { recursive: true });
    writeFakeNpm(fakeBin);
    writeFileSync(join(nestedClaude, "stale.txt"), "prior bad install\n");

    const result = spawnSync(
      "bash",
      [installerPath, "--yes", "--no-claude"],
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
      !existsSync(nestedClaude) || result.status !== 0,
      `--yes must abort/non-succeed unless TARGET_OPENCODE/.claude was actually removed; got status ${result.status}\n${output}`,
    );
  } finally {
    rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test("interactive OpenCode reinstall default-no for nested .claude does not mark the target ready", () => {
  const tmpRoot = mkdtempSync(join(tmpdir(), "settings-opencode-install-"));
  try {
    const projectDir = join(tmpRoot, "project");
    const homeDir = join(tmpRoot, "home");
    const fakeBin = join(tmpRoot, "bin");
    const existingTarget = join(homeDir, ".config", "opencode");
    const nestedClaude = join(existingTarget, ".claude");
    mkdirSync(projectDir);
    mkdirSync(homeDir);
    mkdirSync(fakeBin);
    mkdirSync(nestedClaude, { recursive: true });
    writeFakeNpm(fakeBin);
    writeFileSync(join(nestedClaude, "stale.txt"), "prior bad install\n");

    const result = runInteractiveInstallerWithMarkers(
      ["--opencode"],
      ["global", "", "n"],
      [
        "Choose install scope",
        "delete unexpected nested .claude",
        "write the OPENCODE_MODEL_",
      ],
      projectDir,
      {
        ...process.env,
        HOME: homeDir,
        PATH: `${fakeBin}:/usr/bin:/bin:/usr/sbin:/sbin`,
        SHELL: "/bin/zsh",
      },
    );
    const output = `${result.stdout}\n${result.stderr}`;

    assert.ok(
      !existsSync(nestedClaude) || result.status !== 0,
      `default-no decline must abort/non-succeed unless TARGET_OPENCODE/.claude was actually removed; got status ${result.status}\n${output}`,
    );
  } finally {
    rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test("local ClaudeCode install does not merge into an existing .claude without explicit confirmation", () => {
  const tmpRoot = mkdtempSync(join(tmpdir(), "settings-opencode-install-"));
  try {
    const projectDir = join(tmpRoot, "project");
    const homeDir = join(tmpRoot, "home");
    const fakeBin = join(tmpRoot, "bin");
    const existingTarget = join(projectDir, ".claude");
    const sentinelPath = join(existingTarget, "sentinel.txt");
    mkdirSync(projectDir);
    mkdirSync(homeDir);
    mkdirSync(fakeBin);
    mkdirSync(existingTarget);
    writeFakeNpm(fakeBin);
    writeFileSync(sentinelPath, "existing local ClaudeCode target\n");

    const result = spawnSync(
      "bash",
      [installerPath, "--local", "--yes", "--no-opencode"],
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

    assert.equal(
      readFileSync(sentinelPath, "utf8"),
      "existing local ClaudeCode target\n",
      `existing local .claude files must be left untouched without target-specific confirmation\n${output}`,
    );
    assert.equal(
      existsSync(join(existingTarget, "CLAUDE.md")),
      false,
      `repo Claude mirror must not be merged into an existing local .claude without target-specific confirmation\n${output}`,
    );
  } finally {
    rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test("installer refuses or removes .claude when the repo already lives at the OpenCode target", () => {
  const tmpRoot = mkdtempSync(join(tmpdir(), "settings-opencode-install-"));
  try {
    const homeDir = join(tmpRoot, "home");
    const projectDir = join(tmpRoot, "project");
    const fakeBin = join(tmpRoot, "bin");
    const repoAtTarget = join(homeDir, ".config", "opencode");
    mkdirSync(projectDir);
    mkdirSync(fakeBin);
    mkdirSync(dirname(repoAtTarget), { recursive: true });
    cpSync(repoRoot, repoAtTarget, {
      recursive: true,
      filter: (source: string): boolean => {
        const parts = relative(repoRoot, source).split("/");
        return !parts.includes(".git") && !parts.includes("node_modules");
      },
    });
    writeFakeNpm(fakeBin);

    const result = spawnSync(
      "bash",
      [join(repoAtTarget, "install.sh"), "--yes", "--no-claude"],
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
    const clearRefusal =
      result.status !== 0 &&
      /nested.*\.claude|\.claude.*nested|inside .*opencode|repo already lives|OpenCode target|remove.*\.claude|delete.*\.claude/i.test(
        output,
      );

    assert.ok(
      !existsSync(join(repoAtTarget, ".claude")) || clearRefusal,
      `repo-at-target install must not silently allow .claude inside the OpenCode target; got status ${result.status}\n${output}`,
    );
  } finally {
    rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test("installer does not mark legacy OpenCode repo symlink ready while it exposes .claude", () => {
  const tmpRoot = mkdtempSync(join(tmpdir(), "settings-opencode-install-"));
  try {
    const homeDir = join(tmpRoot, "home");
    const projectDir = join(tmpRoot, "project");
    const fakeBin = join(tmpRoot, "bin");
    const repoDir = join(tmpRoot, "settings-opencode");
    const targetOpenCode = join(homeDir, ".config", "opencode");
    mkdirSync(projectDir);
    mkdirSync(homeDir);
    mkdirSync(fakeBin);
    mkdirSync(dirname(targetOpenCode), { recursive: true });
    cpSync(repoRoot, repoDir, {
      recursive: true,
      filter: (source: string): boolean => {
        const parts = relative(repoRoot, source).split("/");
        return !parts.includes(".git") && !parts.includes("node_modules");
      },
    });
    mkdirSync(join(repoDir, ".claude"), { recursive: true });
    writeFileSync(join(repoDir, ".claude", "sentinel.txt"), "legacy Claude mirror\n");
    symlinkSync(repoDir, targetOpenCode, "dir");
    writeFakeNpm(fakeBin);

    const result = spawnSync(
      "bash",
      [join(repoDir, "install.sh"), "--yes", "--no-claude"],
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
    const targetExposesClaude = existsSync(join(targetOpenCode, ".claude"));
    const refusedOrNotReady =
      result.status !== 0 ||
      /OpenCode target was not modified|OpenCode target was left unchanged|skipping dependencies, env vars, and OpenCode skill sync/i.test(
        output,
      );

    assert.ok(
      !targetExposesClaude || refusedOrNotReady,
      `legacy OpenCode symlink must not be marked ready while it exposes TARGET_OPENCODE/.claude; got status ${result.status}\n${output}`,
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
    writeFakeNpm(fakeBin);

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
