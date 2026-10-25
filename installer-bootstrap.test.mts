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
import { parseJsonc } from "./scripts/cursor-plugin/lib.mjs";

const repoRoot = dirname(fileURLToPath(import.meta.url));
const bootstrapPath = join(repoRoot, "bootstrap.sh");
const powerShellBootstrapPath = join(repoRoot, "bootstrap.ps1");
const installerPath = join(repoRoot, "install.sh");
const retiredInstallableLearningPaths = [
  "commands/evolve.md",
  "pending/skills/.gitkeep",
  "commands/learn-approve.md",
  "commands/learn-pending.md",
  "commands/learn-reject.md",
  "commands/learn-review.md",
  "plugins/learning-loop.ts",
] as const;
const pwshAvailability = spawnSync("pwsh", ["-NoProfile", "-NonInteractive", "-Command", "exit 0"], {
  encoding: "utf8",
});
const pwshSkipReason = pwshAvailability.status === 0
  ? false
  : "pwsh is unavailable; executable PowerShell AST coverage requires PowerShell 7";

function readRepoFile(path: string): string {
  return readFileSync(join(repoRoot, path), "utf8");
}

function runPowerShellAstAssertions(assertions: string): ReturnType<typeof spawnSync> {
  const verifier = String.raw`
$tokens = $null
$parseErrors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile(
    $env:SETTINGS_OPENCODE_BOOTSTRAP_UNDER_TEST,
    [ref]$tokens,
    [ref]$parseErrors
)
if ($parseErrors.Count -ne 0) {
    throw ('bootstrap.ps1 parse errors: ' + (($parseErrors | ForEach-Object Message) -join '; '))
}
${assertions}
`;

  return spawnSync("pwsh", ["-NoProfile", "-NonInteractive", "-Command", verifier], {
    encoding: "utf8",
    env: {
      ...process.env,
      SETTINGS_OPENCODE_BOOTSTRAP_UNDER_TEST: powerShellBootstrapPath,
    },
  });
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
  writeFileSync(
    fakeNode,
    "#!/usr/bin/env bash\ncase \"$*\" in\n  *apply-monolith.mjs*) printf 'fake node refused apply-monolith\\n' >&2; exit 99 ;;\nesac\ncase \"${1:-}\" in\n  -p) printf '22.6.0\\n' ;;\n  --version) printf 'v22.6.0\\n' ;;\n  *) exit 0 ;;\nesac\n",
  );
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
    b"Choose harness variant",
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
      "OpenCode\nOrchestration\nlocal\nn\nn\nn\n",
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
    assert.match(
      readFileSync(join(homeDir, ".config", "opencode", "opencode.jsonc"), "utf8"),
      /"default_agent":\s*"conductor"/,
      `default --yes install must stay on the Conductor variant\n${output}`,
    );
    assert.equal(
      existsSync(join(homeDir, ".claude", "agents", "conductor.md")),
      true,
      `default --yes install must keep the conductor agent\n${output}`,
    );
    assert.equal(
      readFileSync(join(homeDir, ".config", "opencode", ".harness-variant"), "utf8").trim(),
      "conductor",
    );
    assert.equal(
      readFileSync(join(homeDir, ".claude", ".harness-variant"), "utf8").trim(),
      "conductor",
    );
  } finally {
    rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test("unknown --variant exits before copying a target", () => {
  const tmpRoot = mkdtempSync(join(tmpdir(), "settings-opencode-install-"));
  try {
    const projectDir = join(tmpRoot, "project");
    const homeDir = join(tmpRoot, "home");
    mkdirSync(projectDir);
    mkdirSync(homeDir);

    const result = spawnSync("bash", [installerPath, "--yes", "--variant", "lean"], {
      cwd: projectDir,
      encoding: "utf8",
      env: {
        ...process.env,
        HOME: homeDir,
        PATH: "/usr/bin:/bin",
        SHELL: "/bin/zsh",
      },
    });
    const output = `${result.stdout}\n${result.stderr}`;

    assert.equal(result.status, 2, output);
    assert.match(output, /unknown variant/i);
    assert.equal(existsSync(join(homeDir, ".config", "opencode")), false);
  } finally {
    rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test("non-interactive monolith install overlays both targets and leaves conductor sources", () => {
  const tmpRoot = mkdtempSync(join(tmpdir(), "settings-opencode-install-"));
  try {
    const projectDir = join(tmpRoot, "project");
    const homeDir = join(tmpRoot, "home");
    const fakeBin = join(tmpRoot, "bin");
    mkdirSync(projectDir);
    mkdirSync(homeDir);
    mkdirSync(fakeBin);
    writeFakeNpm(fakeBin);
    writeFileSync(join(fakeBin, "node"), `#!/usr/bin/env bash\nexec ${JSON.stringify(process.execPath)} "$@"\n`);
    chmodSync(join(fakeBin, "node"), 0o755);

    const result = spawnSync(
      "bash",
      [installerPath, "--local", "--yes", "--variant", "monolith"],
      {
        cwd: projectDir,
        encoding: "utf8",
        env: {
          ...process.env,
          HOME: homeDir,
          HARNESS_VARIANT: "orchestration",
          PATH: `${fakeBin}:/usr/bin:/bin:/usr/sbin:/sbin`,
          SHELL: "/bin/zsh",
        },
      },
    );
    const output = `${result.stdout}\n${result.stderr}`;

    assert.equal(result.status, 0, output);
    const installed = JSON.parse(readFileSync(join(projectDir, ".opencode", "opencode.jsonc"), "utf8"));
    assert.equal(installed.default_agent, "main");
    assert.equal(installed.agent.conductor, undefined);
    assert.equal(installed.agent.cop?.tools?.write, false);
    assert.equal(installed.mcp.blender, undefined);
    assert.equal(installed.mcp["code-memory"] !== undefined, true);
    assert.match(readFileSync(join(projectDir, ".opencode", "mcp.deferred.example.jsonc"), "utf8"), /blender/);
    assert.equal(readFileSync(join(projectDir, ".opencode", ".harness-variant"), "utf8").trim(), "monolith");
    assert.equal(readFileSync(join(projectDir, ".claude", ".harness-variant"), "utf8").trim(), "monolith");
    assert.equal(existsSync(join(projectDir, ".claude", "agents", "conductor.md")), false);
    assert.equal(existsSync(join(projectDir, ".claude", "agents", "code-reviewer.md")), true);
    assert.equal(existsSync(join(projectDir, ".claude", "hooks", "ship-stop-gate.sh")), true);
    assert.equal(existsSync(join(projectDir, ".claude", "skills", "conductor", "SKILL.md")), true);
    assert.doesNotMatch(readFileSync(join(projectDir, ".claude", "CLAUDE.md"), "utf8"), /First-Tool Gate|cannot write/i);
    assert.match(readFileSync(join(repoRoot, "opencode.jsonc"), "utf8"), /"default_agent":\s*"conductor"/);
    assert.equal(existsSync(join(repoRoot, ".claude", "agents", "conductor.md")), true);
    assert.match(readFileSync(join(repoRoot, ".claude", "rules", "common", "orchestration.md"), "utf8"), /First-Tool Gate/);
  } finally {
    rmSync(tmpRoot, { recursive: true, force: true });
  }
});

function useRealNode(fakeBin: string): void {
  writeFileSync(join(fakeBin, "node"), `#!/usr/bin/env bash\nexec ${JSON.stringify(process.execPath)} "$@"\n`);
  chmodSync(join(fakeBin, "node"), 0o755);
}

test("status reads markers without installing", () => {
  const tmpRoot = mkdtempSync(join(tmpdir(), "settings-opencode-install-"));
  try {
    const projectDir = join(tmpRoot, "project");
    const homeDir = join(tmpRoot, "home");
    const opencodeDir = join(homeDir, ".config", "opencode");
    const claudeDir = join(homeDir, ".claude");
    mkdirSync(projectDir);
    mkdirSync(opencodeDir, { recursive: true });
    mkdirSync(claudeDir);
    writeFileSync(join(opencodeDir, ".harness-variant"), "orchestration\n");

    const status = spawnSync("bash", [installerPath, "conductor", "--status", "--no-claude", "--no-opencode"], {
      cwd: projectDir,
      encoding: "utf8",
      env: { ...process.env, HOME: homeDir, PATH: "/usr/bin:/bin", SHELL: "/bin/zsh" },
    });
    const output = `${status.stdout}\n${status.stderr}`;
    assert.equal(status.status, 0, output);
    assert.match(output, new RegExp(`opencode: ${opencodeDir} Conductor`));
    assert.match(output, new RegExp(`claude: ${claudeDir} \\(not recorded\\)`));
    assert.equal(existsSync(join(opencodeDir, "opencode.jsonc")), false);
    assert.equal(readFileSync(join(opencodeDir, ".harness-variant"), "utf8"), "orchestration\n");

    const local = spawnSync("bash", [installerPath, "--local", "--status"], {
      cwd: projectDir,
      encoding: "utf8",
      env: { ...process.env, HOME: homeDir, PATH: "/usr/bin:/bin", SHELL: "/bin/zsh" },
    });
    const localOutput = `${local.stdout}\n${local.stderr}`;
    assert.equal(local.status, 0, localOutput);
    assert.match(localOutput, /opencode: .*\/\.opencode \(not installed\)/);
    assert.equal(existsSync(join(projectDir, ".opencode")), false);
  } finally {
    rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test("variant names that disagree exit before copying a target", () => {
  const tmpRoot = mkdtempSync(join(tmpdir(), "settings-opencode-install-"));
  try {
    const projectDir = join(tmpRoot, "project");
    const homeDir = join(tmpRoot, "home");
    mkdirSync(projectDir);
    mkdirSync(homeDir);
    const result = spawnSync("bash", [installerPath, "conductor", "--variant", "monolith"], {
      cwd: projectDir,
      encoding: "utf8",
      env: { ...process.env, HOME: homeDir, PATH: "/usr/bin:/bin", SHELL: "/bin/zsh" },
    });
    const output = `${result.stdout}\n${result.stderr}`;
    assert.equal(result.status, 2, output);
    assert.match(output, /conflicts with --variant/i);
    assert.equal(existsSync(join(homeDir, ".config", "opencode")), false);
  } finally {
    rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test("positional variant switches global installs and orchestration remains an alias", () => {
  const tmpRoot = mkdtempSync(join(tmpdir(), "settings-opencode-install-"));
  try {
    const projectDir = join(tmpRoot, "project");
    const homeDir = join(tmpRoot, "home");
    const fakeBin = join(tmpRoot, "bin");
    mkdirSync(projectDir);
    mkdirSync(homeDir);
    mkdirSync(fakeBin);
    writeFakeNpm(fakeBin);
    useRealNode(fakeBin);
    const env = {
      ...process.env,
      HOME: homeDir,
      PATH: `${fakeBin}:/usr/bin:/bin:/usr/sbin:/sbin`,
      SHELL: "/bin/zsh",
    };
    const opencodeDir = join(homeDir, ".config", "opencode");
    const claudeDir = join(homeDir, ".claude");

    const toMonolith = spawnSync("bash", [installerPath, "monolith"], {
      cwd: projectDir,
      encoding: "utf8",
      env: { ...env, HARNESS_VARIANT: "conductor" },
    });
    assert.equal(toMonolith.status, 0, `${toMonolith.stdout}\n${toMonolith.stderr}`);
    const monolithConfig = JSON.parse(readFileSync(join(opencodeDir, "opencode.jsonc"), "utf8"));
    assert.equal(monolithConfig.default_agent, "main");
    assert.equal(monolithConfig.agent.conductor, undefined);
    assert.equal(existsSync(join(claudeDir, "agents", "cop.md")), true);
    assert.equal(existsSync(join(claudeDir, "agents", "conductor.md")), false);
    assert.match(readFileSync(join(claudeDir, "commands", "orchestrate.md"), "utf8"), /Those agents are not installed in Monolith/);

    const status = spawnSync("bash", [installerPath, "--status"], {
      cwd: projectDir,
      encoding: "utf8",
      env,
    });
    assert.equal(status.status, 0, `${status.stdout}\n${status.stderr}`);
    assert.match(status.stdout, new RegExp(`opencode: ${opencodeDir} Monolith`));
    assert.match(status.stdout, new RegExp(`claude: ${claudeDir} Monolith`));

    const toConductor = spawnSync("bash", [installerPath, "--yes", "--variant", "orchestration"], {
      cwd: projectDir,
      encoding: "utf8",
      env: { ...env, HARNESS_VARIANT: "monolith" },
    });
    assert.equal(toConductor.status, 0, `${toConductor.stdout}\n${toConductor.stderr}`);
    const conductorConfig = parseJsonc(readFileSync(join(opencodeDir, "opencode.jsonc"), "utf8"));
    assert.equal(conductorConfig.default_agent, "conductor");
    assert.equal(conductorConfig.agent.conductor !== undefined, true);
    assert.equal(conductorConfig.command.plan.agent, "planner");
    assert.equal(conductorConfig.mcp.blender !== undefined, true);
    assert.equal(readFileSync(join(opencodeDir, ".harness-variant"), "utf8").trim(), "conductor");
    assert.equal(readFileSync(join(claudeDir, ".harness-variant"), "utf8").trim(), "conductor");
    assert.equal(existsSync(join(opencodeDir, "prompts", "agents", "main.txt")), false);
    assert.equal(existsSync(join(opencodeDir, "prompts", "agents", "cop.txt")), false);
    assert.equal(existsSync(join(opencodeDir, "instructions", "monolith.md")), false);
    assert.equal(existsSync(join(opencodeDir, "mcp.deferred.example.jsonc")), false);
    assert.equal(existsSync(join(opencodeDir, "skills", "conductor")), false);
    assert.equal(existsSync(join(claudeDir, "agents", "cop.md")), false);
    assert.equal(existsSync(join(claudeDir, "agent-sources")), false);
    assert.equal(existsSync(join(claudeDir, "rule-sources")), false);
    assert.equal(existsSync(join(claudeDir, "skills", "conductor")), false);
    assert.equal(existsSync(join(claudeDir, "agents", "conductor.md")), true);
    assert.match(readFileSync(join(claudeDir, "rules", "common", "orchestration.md"), "utf8"), /First-Tool Gate/);
    assert.doesNotMatch(readFileSync(join(claudeDir, "commands", "orchestrate.md"), "utf8"), /Those agents are not installed in Monolith/);
    assert.match(readFileSync(join(opencodeDir, "instructions", "subagent-routing.md"), "utf8"), /First-Tool Gate/);

    const back = spawnSync("bash", [installerPath, "monolith"], {
      cwd: projectDir,
      encoding: "utf8",
      env,
    });
    assert.equal(back.status, 0, `${back.stdout}\n${back.stderr}`);
    const again = JSON.parse(readFileSync(join(opencodeDir, "opencode.jsonc"), "utf8"));
    assert.equal(again.default_agent, "main");
    assert.equal(again.agent.conductor, undefined);
    assert.equal(existsSync(join(claudeDir, "agents", "conductor.md")), false);
    assert.equal(existsSync(join(claudeDir, "agents", "cop.md")), true);
    assert.match(readFileSync(join(repoRoot, "opencode.jsonc"), "utf8"), /"default_agent":\s*"conductor"/);
  } finally {
    rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test("explicit local variant merges into an existing project directory", () => {
  const tmpRoot = mkdtempSync(join(tmpdir(), "settings-opencode-install-"));
  try {
    const projectDir = join(tmpRoot, "project");
    const homeDir = join(tmpRoot, "home");
    const fakeBin = join(tmpRoot, "bin");
    const existingTarget = join(projectDir, ".opencode");
    mkdirSync(projectDir);
    mkdirSync(homeDir);
    mkdirSync(fakeBin);
    mkdirSync(existingTarget);
    writeFakeNpm(fakeBin);
    useRealNode(fakeBin);
    writeFileSync(join(existingTarget, "opencode.jsonc"), "{\n  \"sentinel\": true\n}\n");
    const env = {
      ...process.env,
      HOME: homeDir,
      PATH: `${fakeBin}:/usr/bin:/bin:/usr/sbin:/sbin`,
      SHELL: "/bin/zsh",
    };

    const result = spawnSync("bash", [installerPath, "--local", "monolith"], {
      cwd: projectDir,
      encoding: "utf8",
      env,
    });
    const output = `${result.stdout}\n${result.stderr}`;
    assert.equal(result.status, 0, output);
    const installed = JSON.parse(readFileSync(join(existingTarget, "opencode.jsonc"), "utf8"));
    assert.equal(installed.default_agent, "main");
    assert.equal(installed.sentinel, undefined);
    assert.equal(readFileSync(join(existingTarget, ".harness-variant"), "utf8").trim(), "monolith");
    assert.equal(existsSync(join(projectDir, ".claude", "agents", "conductor.md")), false);
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
      ["Orchestration", "global", "", "n"],
      [
        "Choose harness variant",
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
      const source = withoutInstallerExcludes(collectEntries(sourcePath));
      const installed = withoutInstallerExcludes(collectEntries(join(installedRoot, payloadPath)));
      if (payloadPath === "scripts") {
        for (const extra of [
          "agent-harness/.installed",
          "agent-harness/hooks/",
          "agent-harness/hooks/autonomy-context.sh",
          "agent-harness/hooks/autonomy-git-guard.sh",
          "agent-harness/hooks/ship-stop-gate.sh",
        ]) {
          delete installed[extra];
        }
      }
      assert.deepEqual(
        installed,
        source,
        `${payloadPath} must match the repository payload exactly`,
      );
    }
    for (const hook of ["autonomy-context.sh", "autonomy-git-guard.sh", "ship-stop-gate.sh"]) {
      assert.equal(
        readFileSync(join(installedRoot, "scripts/agent-harness/hooks", hook), "utf8"),
        readFileSync(join(repoRoot, ".claude/hooks", hook), "utf8"),
      );
    }
  } finally {
    rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test("installable source payload excludes retired learning commands and plugin entrypoint", () => {
  const presentRetiredPaths = retiredInstallableLearningPaths.filter((relativePath) =>
    existsSync(join(repoRoot, relativePath)));

  assert.deepEqual(
    presentRetiredPaths,
    [],
    "retired learning assets must live only in non-installed test fixtures",
  );
});

test("installer source-equals-target paths never mutate the source checkout", () => {
  const failures: string[] = [];

  for (const targetMode of ["directory", "symlink"] as const) {
    const tmpRoot = mkdtempSync(join(tmpdir(), `settings-opencode-source-target-${targetMode}-`));
    try {
      const projectDir = join(tmpRoot, "project");
      const homeDir = join(tmpRoot, "home");
      const fakeBin = join(tmpRoot, "bin");
      const targetRoot = join(homeDir, ".config", "opencode");
      const sourceCheckout = targetMode === "directory" ? targetRoot : join(tmpRoot, "source-checkout");
      mkdirSync(projectDir, { recursive: true });
      mkdirSync(dirname(sourceCheckout), { recursive: true });
      mkdirSync(fakeBin, { recursive: true });
      cpSync(repoRoot, sourceCheckout, {
        recursive: true,
        filter: (source: string): boolean => {
          const parts = relative(repoRoot, source).split("/");
          return !parts.includes(".git") && !parts.includes("node_modules") && !parts.includes(".claude");
        },
      });
      if (targetMode === "symlink") {
        mkdirSync(dirname(targetRoot), { recursive: true });
        symlinkSync(sourceCheckout, targetRoot, "dir");
      }
      writeFakeNpm(fakeBin);
      const quotedNode = `'${process.execPath.replaceAll("'", `'"'"'`)}'`;
      writeFileSync(join(fakeBin, "node"), `#!/usr/bin/env bash\nexec ${quotedNode} "$@"\n`);
      chmodSync(join(fakeBin, "node"), 0o755);
      const before = collectEntries(sourceCheckout);

      const result = spawnSync(
        "bash",
        [join(sourceCheckout, "install.sh"), "--yes", "--no-claude"],
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
      const after = collectEntries(sourceCheckout);

      if (JSON.stringify(after) !== JSON.stringify(before)) {
        failures.push(`${targetMode} target mutated the source checkout`);
      }
      if (result.status !== 0) {
        failures.push(`${targetMode} target failed with status ${result.status}\n${output.slice(0, 1600)}`);
      }
    } finally {
      rmSync(tmpRoot, { recursive: true, force: true });
    }
  }

  assert.deepEqual(failures, [], failures.join("\n\n"));
});

test("PowerShell bootstrap guards source-equivalent OpenCode and Claude targets from mutation", {
  skip: pwshSkipReason,
}, () => {
  const result = runPowerShellAstAssertions(String.raw`
$samePathCommands = @($ast.FindAll({
    param($node)
    $node -is [System.Management.Automation.Language.CommandAst] -and
        $node.GetCommandName() -eq 'Test-SamePath'
}, $true))

function Find-SamePathCall($left, $right) {
    return @($samePathCommands | Where-Object {
        $arguments = @(($_.CommandElements | Select-Object -Skip 1) | ForEach-Object { $_.Extent.Text })
        $arguments.Count -eq 2 -and
            (($arguments[0] -eq $left -and $arguments[1] -eq $right) -or
             ($arguments[0] -eq $right -and $arguments[1] -eq $left))
    }) | Select-Object -First 1
}

function Find-ContainingIf($node) {
    $current = $node.Parent
    while ($null -ne $current -and $current -isnot [System.Management.Automation.Language.IfStatementAst]) {
        $current = $current.Parent
    }
    return $current
}

$opencodeGuard = Find-SamePathCall '$OpencodeDir' '$SrcDir'
if ($null -eq $opencodeGuard) {
    throw 'missing source-equivalence guard for the OpenCode target'
}
$opencodeBranch = Find-ContainingIf $opencodeGuard
if ($null -eq $opencodeBranch -or
    $opencodeBranch.Extent.Text -notmatch '\$skipOpencodeCopy\s*=\s*\$true' -or
    $opencodeBranch.Extent.Text -notmatch '\$opencodeTargetReady\s*=\s*\$true') {
    throw 'OpenCode source equivalence must skip additive copy while keeping the target ready for no-op synchronization'
}

$claudeGuard = Find-SamePathCall '$ClaudeDir' '$sourceClaude'
if ($null -eq $claudeGuard) {
    throw 'missing source-equivalence guard for the Claude target'
}
$claudeBranch = Find-ContainingIf $claudeGuard
if ($null -eq $claudeBranch -or
    $claudeBranch.Extent.Text -notmatch '\$skipClaudeCopy\s*=\s*\$true' -or
    $claudeBranch.Extent.Text -notmatch '\$claudeTargetReady\s*=\s*\$true') {
    throw 'Claude source equivalence must skip additive copy while keeping the target ready for no-op synchronization'
}
`);
  const output = `${result.stdout}\n${result.stderr}`;

  assert.equal(result.status, 0, `PowerShell source-equivalence guards failed\n${output}`);
});

test("PowerShell bootstrap removes only an exact root notification helper and backs up modified files or symlinks", {
  skip: pwshSkipReason,
}, () => {
  const result = runPowerShellAstAssertions(String.raw`
$migrationFunctions = @($ast.FindAll({
    param($node)
    $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and
        $node.Extent.Text -match 'plugins[\\/]notification-gate\.ts' -and
        $node.Extent.Text -match 'plugins[\\/]lib[\\/]notification-gate\.ts'
}, $true))
if ($migrationFunctions.Count -ne 1) {
    throw "expected one root notification-helper migration function, found $($migrationFunctions.Count)"
}

$migration = $migrationFunctions[0]
$body = $migration.Extent.Text
if ($body -notmatch 'PathType\s+Leaf' -or $body -notmatch 'Get-FileHash|ReadAllBytes|Compare-Object') {
    throw 'notification migration must identify an exact known regular-file payload before deletion'
}
if ($body -notmatch 'Remove-Item') {
    throw 'notification migration must remove the exact known regular-file payload'
}
if ($body -notmatch 'Test-ReparsePoint|ReparsePoint|LinkType') {
    throw 'notification migration must distinguish symlinks/reparse points without dereferencing them'
}
if ($body -notmatch '\.settings-opencode-backups' -or $body -notmatch 'Move-Item') {
    throw 'notification migration must move modified files and symlinks into a safe backup location'
}

$migrationInvocations = @($ast.FindAll({
    param($node)
    $node -is [System.Management.Automation.Language.CommandAst] -and
        $node.GetCommandName() -eq $migration.Name
}, $true) | Where-Object {
    $_.Extent.StartOffset -lt $migration.Extent.StartOffset -or
        $_.Extent.StartOffset -gt $migration.Extent.EndOffset
})
if ($migrationInvocations.Count -ne 1) {
    throw "expected one $($migration.Name) invocation, found $($migrationInvocations.Count)"
}

$opencodeCopies = @($ast.FindAll({
    param($node)
    $node -is [System.Management.Automation.Language.CommandAst] -and
        $node.GetCommandName() -eq 'Copy-Tree'
}, $true))
$lastOpenCodeCopyEnd = ($opencodeCopies | ForEach-Object { $_.Extent.EndOffset } | Measure-Object -Maximum).Maximum
if ($null -eq $lastOpenCodeCopyEnd -or $migrationInvocations[0].Extent.StartOffset -le $lastOpenCodeCopyEnd) {
    throw 'root notification-helper migration must run after OpenCode target preparation'
}
`);
  const output = `${result.stdout}\n${result.stderr}`;

  assert.equal(result.status, 0, `PowerShell notification-helper migration contract failed\n${output}`);
});

test("OpenCode reinstall removes the known managed root notification helper copy", () => {
  const tmpRoot = mkdtempSync(join(tmpdir(), "settings-opencode-notification-prune-"));
  try {
    const projectDir = join(tmpRoot, "project");
    const homeDir = join(tmpRoot, "home");
    const fakeBin = join(tmpRoot, "bin");
    const pluginDir = join(homeDir, ".config", "opencode", "plugins");
    const staleHelper = join(pluginDir, "notification-gate.ts");
    mkdirSync(projectDir);
    mkdirSync(fakeBin);
    mkdirSync(pluginDir, { recursive: true });
    writeFakeNpm(fakeBin);
    writeFileSync(staleHelper, readRepoFile("plugins/lib/notification-gate.ts"));

    const result = spawnSync("bash", [installerPath, "--yes", "--no-claude"], {
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

    assert.equal(result.status, 0, `known managed legacy cleanup must succeed\n${output}`);
    assert.equal(existsSync(staleHelper), false, "the exact managed legacy helper must be pruned");
    assert.equal(
      existsSync(join(pluginDir, "lib", "notification-gate.ts")),
      true,
      "the non-auto-discovered notification helper must remain installed",
    );
  } finally {
    rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test("OpenCode reinstall never silently prunes a modified root notification helper", () => {
  const tmpRoot = mkdtempSync(join(tmpdir(), "settings-opencode-notification-modified-"));
  try {
    const projectDir = join(tmpRoot, "project");
    const homeDir = join(tmpRoot, "home");
    const fakeBin = join(tmpRoot, "bin");
    const pluginDir = join(homeDir, ".config", "opencode", "plugins");
    const staleHelper = join(pluginDir, "notification-gate.ts");
    const modifiedContent = `${readRepoFile("plugins/lib/notification-gate.ts")}\n// user-owned customization 🛡️\n`;
    mkdirSync(projectDir);
    mkdirSync(fakeBin);
    mkdirSync(pluginDir, { recursive: true });
    writeFakeNpm(fakeBin);
    writeFileSync(staleHelper, modifiedContent);

    const result = spawnSync("bash", [installerPath, "--yes", "--no-claude"], {
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
    const preservedInPlace = existsSync(staleHelper) && readFileSync(staleHelper, "utf8") === modifiedContent;
    const reportsModifiedHelper = /notification-gate/i.test(output) && /modified|custom|refus|manual|unchanged/i.test(output);
    const migratedSafely =
      !existsSync(staleHelper) &&
      treeContainsRegularFile(pluginDir, modifiedContent) &&
      /notification-gate/i.test(output) &&
      /migrat|backup|preserv/i.test(output);
    const failedClearly = result.status !== 0 && reportsModifiedHelper;

    assert.ok(
      (preservedInPlace && failedClearly) || migratedSafely,
      `modified notification helper content must be preserved with a clear refusal or explicitly migrated; got status ${result.status}\n${output}`,
    );
  } finally {
    rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test("OpenCode reinstall never silently prunes a root notification helper symlink", () => {
  const tmpRoot = mkdtempSync(join(tmpdir(), "settings-opencode-notification-symlink-"));
  try {
    const projectDir = join(tmpRoot, "project");
    const homeDir = join(tmpRoot, "home");
    const fakeBin = join(tmpRoot, "bin");
    const pluginDir = join(homeDir, ".config", "opencode", "plugins");
    const staleHelper = join(pluginDir, "notification-gate.ts");
    const userHelper = join(tmpRoot, "user-notification-gate.ts");
    mkdirSync(projectDir);
    mkdirSync(fakeBin);
    mkdirSync(pluginDir, { recursive: true });
    writeFakeNpm(fakeBin);
    const userContent = "// user-owned symlink target 🔗\n";
    writeFileSync(userHelper, userContent);
    symlinkSync(userHelper, staleHelper);

    const result = spawnSync("bash", [installerPath, "--yes", "--no-claude"], {
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
    const preservedInPlace = existsSync(staleHelper) && lstatSync(staleHelper).isSymbolicLink() && readlinkSync(staleHelper) === userHelper;
    const reportsSymlink = /notification-gate/i.test(output) && /symlink|symbolic|refus|manual|unchanged/i.test(output);
    const migratedSafely =
      !existsSync(staleHelper) &&
      (treeContainsSymlink(pluginDir, userHelper) || treeContainsRegularFile(pluginDir, userContent)) &&
      /notification-gate/i.test(output) &&
      /migrat|backup|preserv/i.test(output) &&
      /symlink|symbolic/i.test(output);
    const failedClearly = result.status !== 0 && reportsSymlink;

    assert.equal(readFileSync(userHelper, "utf8"), userContent);
    assert.ok(
      (preservedInPlace && failedClearly) || migratedSafely,
      `notification helper symlink must be preserved with a clear refusal or explicitly migrated; got status ${result.status}\n${output}`,
    );
  } finally {
    rmSync(tmpRoot, { recursive: true, force: true });
  }
});

function treeContainsRegularFile(root: string, expectedContent: string): boolean {
  if (!existsSync(root)) {
    return false;
  }
  const metadata = lstatSync(root);
  if (metadata.isSymbolicLink()) {
    return false;
  }
  if (metadata.isFile()) {
    return readFileSync(root, "utf8") === expectedContent;
  }
  return metadata.isDirectory() && readdirSync(root).some((entry) =>
    treeContainsRegularFile(join(root, entry), expectedContent));
}

function treeContainsSymlink(root: string, expectedTarget: string): boolean {
  if (!existsSync(root)) {
    return false;
  }
  const metadata = lstatSync(root);
  if (metadata.isSymbolicLink()) {
    return readlinkSync(root) === expectedTarget;
  }
  return metadata.isDirectory() && readdirSync(root).some((entry) =>
    treeContainsSymlink(join(root, entry), expectedTarget));
}

function withoutInstallerExcludes(entries: Record<string, string>): Record<string, string> {
  const kept: Record<string, string> = {};
  for (const [key, value] of Object.entries(entries)) {
    const parts = key.replace(/\/$/, "").split("/");
    const base = parts.at(-1) ?? "";
    if (
      parts.includes("assets")
      || parts.includes("__tests__")
      || parts.includes("__mocks__")
      || base === ".DS_Store"
      || base.endsWith(".log")
      || base.includes(".bak")
      || /\.test\.[^/]+$/.test(base)
      || /\.spec\.[^/]+$/.test(base)
    ) {
      continue;
    }
    kept[key] = value;
  }
  return kept;
}

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
