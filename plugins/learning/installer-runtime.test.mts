import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
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
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import * as learningPlugin from "../learning-runtime.ts";
import { synchronizeLearningRuntime } from "./installer-runtime.ts";

const repositoryRoot = join(import.meta.dirname, "..", "..");
const installerPath = join(repositoryRoot, "install.sh");
const retiredManagedCommands = ["approve", "pending", "reject", "review"] as const;
const retiredManagedAssetPayload = Buffer.from("retired learning asset\n");
const retiredManagedAssets = [
  { target: "opencode", relativePath: "plugins/learning-loop.ts" },
  { target: "opencode", relativePath: "bin/learning-loop" },
  { target: "claude", relativePath: "hooks/learning-loop.sh" },
  { target: "claude", relativePath: "hooks/learning-review.sh" },
  { target: "claude", relativePath: "bin/learning-loop" },
] as const;

type RetiredManagedCommand = (typeof retiredManagedCommands)[number];

const retiredManagedCommandBytes: Readonly<Record<RetiredManagedCommand, Buffer>> = {
  approve: Buffer.from("LS0tCmRlc2NyaXB0aW9uOiBBcHByb3ZlIGEgc3RhZ2VkIGxlYXJuaW5nIGNoYW5nZSBieSBJRAphZ2VudDogY29uZHVjdG9yCi0tLQoKIyBMZWFybiBBcHByb3ZlCgpBcHByb3ZlIGFuZCBhcHBseSBhIHN0YWdlZCBsZWFybmluZyBjaGFuZ2U6ICRBUkdVTUVOVFMKCiMjIFlvdXIgVGFzawoKVGhlIGFyZ3VtZW50IGlzIGEgcGVuZGluZyBmaWxlIElEIChmaWxlbmFtZSB3aXRob3V0IGV4dGVuc2lvbikuIEZvciBleGFtcGxlOiBgMTcxMjM0NTY3OC1taXN0cmFsLXBhdHRlcm5gLgoKMS4gU2VhcmNoIGJvdGggYH4vLmNvbmZpZy9vcGVuY29kZS9wZW5kaW5nL3NraWxscy9gIGFuZCBgfi8uY29uZmlnL29wZW5jb2RlL3BlbmRpbmcvbWVtb3J5L2AgZm9yIHRoZSBmaWxlIG1hdGNoaW5nIHRoZSBJRAoyLiBSZWFkIHRoZSBKU09OIGZpbGUKMy4gQmFzZWQgb24gdGhlIGB0eXBlYCBmaWVsZDoKCiMjIyBJZiB0eXBlID09PSAic2tpbGwiCi0gQWN0aW9uICJjcmVhdGUiOiBDcmVhdGUgdGhlIHNraWxsIGF0IHRoZSBhcHByb3ByaWF0ZSBwYXRoIHVuZGVyIGB+Ly5jb25maWcvb3BlbmNvZGUvc2tpbGxzL2AgdXNpbmcgYHNraWxsX21hbmFnZWAgb3IgZmlsZSB3cml0ZQotIEFjdGlvbiAicGF0Y2giOiBBcHBseSB0aGUgY29udGVudCBkaWZmIHRvIHRoZSBleGlzdGluZyBza2lsbCBmaWxlCi0gT24gc3VjY2VzczogZGVsZXRlIHRoZSBwZW5kaW5nIGZpbGUKLSBSZXBvcnQ6ICLinIUgQXBwcm92ZWQgYW5kIGFwcGxpZWQgc2tpbGw6IDxuYW1lPiIKCiMjIyBJZiB0eXBlID09PSAibWVtb3J5IgotIEV4dHJhY3QgZWFjaCBjbGFpbSBmcm9tIHRoZSBgY2xhaW1zYCBhcnJheQotIEZvciBlYWNoIGNsYWltLCBjYWxsIGBjb2RlbWVtb3J5X2Fzc2VydF9jbGFpbWAgd2l0aCB0aGUgc3ViamVjdC9wcmVkaWNhdGUvb2JqZWN0L2NvbmZpZGVuY2UKLSBPbiBzdWNjZXNzOiBkZWxldGUgdGhlIHBlbmRpbmcgZmlsZQotIFJlcG9ydDogIuKchSBBcHByb3ZlZCBhbmQgYXBwbGllZCA8Tj4gbWVtb3J5IGNsYWltKHMpOiA8c3ViamVjdHM+IgoKSWYgdGhlIHBlbmRpbmcgZmlsZSBpcyBub3QgZm91bmQsIHJlcG9ydDogIuKdjCBObyBwZW5kaW5nIGNoYW5nZSBmb3VuZCB3aXRoIElEOiA8aWQ+IgoKIyMgSW1wb3J0YW50Ci0gRG8gTk9UIHVzZSBgY29kZW1lbW9yeV9hc3NlcnRfY2xhaW1gIGZvciBza2lsbCBwcm9wb3NhbHMg4oCUIG9ubHkgZm9yIG1lbW9yeSBjbGFpbXMKLSBEZWxldGUgdGhlIHBlbmRpbmcgZmlsZSBPTkxZIGFmdGVyIHN1Y2Nlc3NmdWwgYXBwbGljYXRpb24KLSBJZiBhcHBsaWNhdGlvbiBmYWlscywgcmVwb3J0IHRoZSBlcnJvciBhbmQgbGVhdmUgdGhlIGZpbGUgZm9yIHJldHJ5Cg==", "base64"),
  pending: Buffer.from("LS0tCmRlc2NyaXB0aW9uOiBMaXN0IGFsbCBzdGFnZWQgbGVhcm5pbmcgY2hhbmdlcyBhd2FpdGluZyBhcHByb3ZhbAphZ2VudDogY29uZHVjdG9yCi0tLQoKIyBMZWFybiBQZW5kaW5nCgpMaXN0IGFsbCBzdGFnZWQgbGVhcm5pbmcgY2hhbmdlcyBhd2FpdGluZyBhcHByb3ZhbDogJEFSR1VNRU5UUwoKIyMgWW91ciBUYXNrCgoxLiBMaXN0IGFsbCBmaWxlcyBpbiBgfi8uY29uZmlnL29wZW5jb2RlL3BlbmRpbmcvc2tpbGxzL2AgYW5kIGB+Ly5jb25maWcvb3BlbmNvZGUvcGVuZGluZy9tZW1vcnkvYAoyLiBGb3IgZWFjaCBmaWxlLCBwYXJzZSB0aGUgSlNPTiBhbmQgZGlzcGxheToKICAgLSAqKklEKio6IGZpbGVuYW1lICh3aXRob3V0IGV4dGVuc2lvbikKICAgLSAqKlR5cGUqKjogc2tpbGwgb3IgbWVtb3J5CiAgIC0gKipBY3Rpb24qKjogY3JlYXRlIG9yIHBhdGNoCiAgIC0gKipSZWFzb24qKjogdGhlIHN0YXRlZCByZWFzb24gZm9yIHRoZSBjaGFuZ2UKICAgLSAqKlRpbWVzdGFtcCoqOiB3aGVuIGl0IHdhcyBjcmVhdGVkCjMuIEF0IHRoZSBlbmQsIHNob3c6CiAgIC0gVG90YWwgcGVuZGluZyBjb3VudAogICAtIEluc3RydWN0aW9ucyBmb3IgYXBwcm92aW5nL3JlamVjdGluZwoKIyMgT3V0cHV0IEZvcm1hdAoKYGBgCiMjIFBlbmRpbmcgTGVhcm5pbmcgQ2hhbmdlcwoKIyMjIFNraWxscyAoL3BlbmRpbmcvc2tpbGxzLykKfCBJRCB8IEFjdGlvbiB8IFJlYXNvbiB8IENyZWF0ZWQgfAp8LS0tLXwtLS0tLS0tLXwtLS0tLS0tLXwtLS0tLS0tLS18CnwgMTcxMjM0NTY3OC1taXN0cmFsLXBhdHRlcm4gfCBjcmVhdGUgfCBNaXN0cmFsIG1vZGVscyBuZWVkIGV4cGxpY2l0IHRvb2wgcmVtaW5kZXJzIHwgMjAyNi0wNC0wNSAxNDozMiB8CgojIyMgTWVtb3JpZXMgKC9wZW5kaW5nL21lbW9yeS8pCnwgSUQgfCBTdWJqZWN0IHwgUHJlZGljYXRlIHwgT2JqZWN0IHwgQ3JlYXRlZCB8CnwtLS0tfC0tLS0tLS0tLXwtLS0tLS0tLS0tLXwtLS0tLS0tLXwtLS0tLS0tLS18CnwgMTcxMjM0NTY4MC1yZWFjdC0xOCB8IHByb2plY3QgfCB1c2VzIHwgUmVhY3QgMTggfCAyMDI2LTA0LTA1IDE0OjM1IHwKCioqVG90YWw6IDIgcGVuZGluZyoqCgojIyMgVXNhZ2UKLSBgL2xlYXJuLWFwcHJvdmUgPGlkPmAg4oCUIEFwcHJvdmUgYW5kIGFwcGx5IGEgcGVuZGluZyBjaGFuZ2UKLSBgL2xlYXJuLXJlamVjdCA8aWQ+YCDigJQgUmVqZWN0IGFuZCBkZWxldGUgYSBwZW5kaW5nIGNoYW5nZQotIGAvbGVhcm4tcmV2aWV3YCDigJQgTWFudWFsbHkgdHJpZ2dlciBhIGxlYXJuaW5nIHJldmlldyBvZiB0aGUgY3VycmVudCBzZXNzaW9uCmBgYAo=", "base64"),
  reject: Buffer.from("LS0tCmRlc2NyaXB0aW9uOiBSZWplY3QgYSBzdGFnZWQgbGVhcm5pbmcgY2hhbmdlIGJ5IElECmFnZW50OiBjb25kdWN0b3IKLS0tCgojIExlYXJuIFJlamVjdAoKUmVqZWN0IGFuZCBkZWxldGUgYSBzdGFnZWQgbGVhcm5pbmcgY2hhbmdlOiAkQVJHVU1FTlRTCgojIyBZb3VyIFRhc2sKClRoZSBhcmd1bWVudCBpcyBhIHBlbmRpbmcgZmlsZSBJRCAoZmlsZW5hbWUgd2l0aG91dCBleHRlbnNpb24pLiBGb3IgZXhhbXBsZTogYDE3MTIzNDU2NzgtbWlzdHJhbC1wYXR0ZXJuYC4KCjEuIFNlYXJjaCBib3RoIGB+Ly5jb25maWcvb3BlbmNvZGUvcGVuZGluZy9za2lsbHMvYCBhbmQgYH4vLmNvbmZpZy9vcGVuY29kZS9wZW5kaW5nL21lbW9yeS9gIGZvciB0aGUgZmlsZSBtYXRjaGluZyB0aGUgSUQKMi4gSWYgZm91bmQ6CiAgIC0gUmVhZCB0aGUgZmlsZSB0byBjb25maXJtIHRoZSB0eXBlIGFuZCByZWFzb24KICAgLSBEZWxldGUgdGhlIHBlbmRpbmcgZmlsZQogICAtIFJlcG9ydDogIuKdjCBSZWplY3RlZCBhbmQgZGVsZXRlZCBwZW5kaW5nIGNoYW5nZTogPGlkPiAoPHR5cGU+OiA8cmVhc29uPikiCjMuIElmIG5vdCBmb3VuZDoKICAgLSBSZXBvcnQ6ICLinYwgTm8gcGVuZGluZyBjaGFuZ2UgZm91bmQgd2l0aCBJRDogPGlkPiIK", "base64"),
  review: Buffer.from("LS0tCmRlc2NyaXB0aW9uOiBNYW51YWxseSB0cmlnZ2VyIGEgbGVhcm5pbmcgcmV2aWV3IG9mIHRoZSBjdXJyZW50IHNlc3Npb24KYWdlbnQ6IGNvbmR1Y3RvcgotLS0KCiMgTGVhcm4gUmV2aWV3CgpNYW51YWxseSB0cmlnZ2VyIGEgbGVhcm5pbmcgcmV2aWV3IG9mIHRoZSBjdXJyZW50IHNlc3Npb246ICRBUkdVTUVOVFMKCiMjIFlvdXIgVGFzawoKUGVyZm9ybSBhIG9uZS10aW1lIGxlYXJuaW5nIHJldmlldyBvZiB0aGUgY3VycmVudCBzZXNzaW9uOgoKMS4gRmV0Y2ggdGhlIGxhc3QgMTAgbWVzc2FnZXMgZnJvbSB0aGUgY3VycmVudCBzZXNzaW9uCjIuIEFuYWx5emUgdGhlIGNvbnZlcnNhdGlvbiBmb3IgZHVyYWJsZSBsZWFybmluZ3M6CgojIyMgV2hhdCB0byBsb29rIGZvcgotICoqUHJvamVjdCBwYXR0ZXJucyoqIOKAlCBBcmNoaXRlY3R1cmUgZGVjaXNpb25zLCB0ZWNoIHN0YWNrIGNob2ljZXMsIGNvZGluZyBjb252ZW50aW9ucyB0aGUgdXNlciBzdGF0ZWQgb3IgaW1wbGllZAotICoqUHJlZmVyZW5jZXMqKiDigJQgVXNlciBwcmVmZXJlbmNlcyBhYm91dCBjb2RlIHN0eWxlLCB0ZXN0aW5nIGFwcHJvYWNoLCBuYW1pbmcgY29udmVudGlvbnMKLSAqKlNlbGYtaW1wcm92ZW1lbnQqKiDigJQgUmVjdXJyaW5nIG1pc3Rha2VzLCBwYXR0ZXJucyB0aGUgYWdlbnQgaGFuZGxlcyBwb29ybHksIG9wcG9ydHVuaXRpZXMgZm9yIG5ldyBza2lsbHMKLSAqKkRvbWFpbiBrbm93bGVkZ2UqKiDigJQgRmFjdHMgYWJvdXQgdGhlIHByb2plY3QgZG9tYWluIHRoYXQgc2hvdWxkIGJlIHJlbWVtYmVyZWQKCiMjIyBPdXRwdXQgZm9ybWF0CgpGb3IgZWFjaCBsZWFybmluZyBmb3VuZCwgb3V0cHV0IGluIHRoaXMgZm9ybWF0OgoKKipNZW1vcnkgY2xhaW1zKiog4oCUIFVzZSBgY29kZW1lbW9yeV9hc3NlcnRfY2xhaW1gIGRpcmVjdGx5IHdpdGg6Ci0gc3ViamVjdCwgcHJlZGljYXRlLCBvYmplY3QsIGNvbmZpZGVuY2UKCioqU2tpbGwgcHJvcG9zYWxzKiog4oCUIFNhdmUgdG8gcGVuZGluZyBmaWxlczoKLSBXcml0ZSB0byBgfi8uY29uZmlnL29wZW5jb2RlL3BlbmRpbmcvc2tpbGxzLzx0aW1lc3RhbXA+LTxzbHVnPi5qc29uYAotIFRoZSBKU09OIHNob3VsZCBpbmNsdWRlOiB0eXBlLCBhY3Rpb24sIG5hbWUsIHJlYXNvbiwgZGVzY3JpcHRpb24sIGNvbnRlbnQgZmllbGRzCgoqKklmIG5vdGhpbmcgbGVhcm5lZCoqOiBSZXBvcnQgIk5vdGhpbmcgdG8gc2F2ZS4iCgojIyMgSW1wb3J0YW50Ci0gQmUgY29uc2VydmF0aXZlIOKAlCBvbmx5IGNhcHR1cmUgZHVyYWJsZSBwYXR0ZXJucywgbm90IG9uZS1vZmYgaW5zdHJ1Y3Rpb25zCi0gRm9yIHByb2plY3QtbGV2ZWwgZmFjdHMsIGNhbGwgYGNvZGVtZW1vcnlfYXNzZXJ0X2NsYWltYCBkaXJlY3RseQotIEZvciBzZWxmLWltcHJvdmVtZW50IChza2lsbHMpLCB3cml0ZSBwZW5kaW5nIGZpbGVzIGZvciB1c2VyIGFwcHJvdmFsCg==", "base64"),
};

function managedCommandContents(command: RetiredManagedCommand): Buffer {
  return retiredManagedCommandBytes[command];
}

function treeContainsRegularFile(root: string, expectedContents: Buffer): boolean {
  if (!existsSync(root)) return false;
  const metadata = lstatSync(root);
  if (metadata.isSymbolicLink()) return false;
  if (metadata.isFile()) return readFileSync(root).equals(expectedContents);
  return metadata.isDirectory() && readdirSync(root).some((entry) =>
    treeContainsRegularFile(join(root, entry), expectedContents));
}

function treeContainsSymlink(root: string, expectedTarget: string): boolean {
  if (!existsSync(root)) return false;
  const metadata = lstatSync(root);
  if (metadata.isSymbolicLink()) return readlinkSync(root) === expectedTarget;
  return metadata.isDirectory() && readdirSync(root).some((entry) =>
    treeContainsSymlink(join(root, entry), expectedTarget));
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function writeInstallerExecutables(binRoot: string, rejectRuntimeSync = false): void {
  mkdirSync(binRoot, { recursive: true });
  const npmPath = join(binRoot, "npm");
  writeFileSync(npmPath, "#!/usr/bin/env bash\nexit 0\n");
  chmodSync(npmPath, 0o755);

  for (const executableName of ["launchctl", "systemctl"]) {
    const executablePath = join(binRoot, executableName);
    writeFileSync(executablePath, "#!/usr/bin/env bash\nexit 0\n");
    chmodSync(executablePath, 0o755);
  }

  const runtimeFailure = rejectRuntimeSync
    ? String.raw`
for argument in "$@"; do
  case "$argument" in
    */plugins/learning/installer-cli.ts)
      if [ -f "$HOME/.config/opencode/opencode.jsonc" ] && [ -f "$HOME/.claude/CLAUDE.md" ]; then
        printf 'after-copy-and-mirror\n' > "$SYNC_OBSERVATION"
      else
        printf 'before-copy-or-mirror\n' > "$SYNC_OBSERVATION"
      fi
      exit 73
      ;;
  esac
done
`
    : "";
  const nodePath = join(binRoot, "node");
  writeFileSync(
    nodePath,
    `#!/usr/bin/env bash\n${runtimeFailure}exec ${shellQuote(process.execPath)} "$@"\n`,
  );
  chmodSync(nodePath, 0o755);
}

test("OpenCode learning entrypoint exports only plugin factories", () => {
  assert.deepEqual(Object.keys(learningPlugin), ["default"]);
});

test("canonical OpenCode config does not reference retired learning assets", () => {
  const config = readFileSync(join(import.meta.dirname, "..", "..", "opencode.jsonc"), "utf8");

  assert.doesNotMatch(config, /commands\/learn-[a-z0-9-]+\.md/);
  assert.doesNotMatch(config, /plugins\/learning-loop\.ts/);
});

test("installer synchronizes proposal-only runtime, merges the Claude hook idempotently, and prunes legacy learning", () => {
  const root = mkdtempSync(join(tmpdir(), "settings-opencode-learning-install-"));
  const sourceRoot = join(root, "source");
  const openCodeRoot = join(root, "home", ".config", "opencode");
  const claudeRoot = join(root, "home", ".claude");
  const settingsPath = join(claudeRoot, "settings.json");

  try {
    mkdirSync(join(sourceRoot, "opencode"), { recursive: true });
    mkdirSync(join(sourceRoot, "claude", "hooks"), { recursive: true });
    mkdirSync(join(openCodeRoot, "plugins"), { recursive: true });
    mkdirSync(claudeRoot, { recursive: true });
    writeFileSync(join(sourceRoot, "opencode", "learning-runtime.ts"), "runtime");
    writeFileSync(
      join(sourceRoot, "claude", "hooks", "learning-user-prompt-submit.sh"),
      "#!/usr/bin/env bash\n",
    );
    writeFileSync(join(openCodeRoot, "plugins", "learning-loop.ts"), "legacy runtime");
    writeFileSync(
      settingsPath,
      JSON.stringify({
        hooks: {
          UserPromptSubmit: [
            {
              matcher: "*",
              hooks: [{ type: "command", command: "~/.claude/hooks/custom.sh" }],
            },
          ],
        },
      }),
    );

    synchronizeLearningRuntime({ sourceRoot, openCodeRoot, claudeRoot });
    synchronizeLearningRuntime({ sourceRoot, openCodeRoot, claudeRoot });

    assert.equal(
      readFileSync(join(openCodeRoot, "plugins", "learning-runtime.ts"), "utf8"),
      "runtime",
    );
    assert.equal(
      existsSync(join(openCodeRoot, "plugins", "learning-loop.ts")),
      false,
    );
    assert.equal(
      existsSync(join(claudeRoot, "hooks", "learning-user-prompt-submit.sh")),
      true,
    );

    const settings = readFileSync(settingsPath, "utf8");
    assert.match(settings, /custom\.sh/);
    assert.equal(
      settings.match(/learning-user-prompt-submit\.sh/g)?.length,
      1,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("learning synchronization preserves arbitrary user-owned learn commands unchanged", () => {
  const root = mkdtempSync(join(tmpdir(), "settings-opencode-learning-custom-command-"));
  const sourceRoot = join(root, "source");
  const openCodeRoot = join(root, "opencode");
  const claudeRoot = join(root, "claude");
  const customContents = "---\ndescription: My private workflow 🚀\n---\n\nNever delete this command.\n";

  try {
    for (const targetRoot of [openCodeRoot, claudeRoot]) {
      const commandPath = join(targetRoot, "commands", "learn-my-workflow.md");
      mkdirSync(join(targetRoot, "commands"), { recursive: true });
      writeFileSync(commandPath, customContents);
    }

    synchronizeLearningRuntime({ sourceRoot, openCodeRoot, claudeRoot });

    for (const targetRoot of [openCodeRoot, claudeRoot]) {
      const commandPath = join(targetRoot, "commands", "learn-my-workflow.md");
      assert.equal(existsSync(commandPath), true, `${commandPath} must survive synchronization`);
      assert.equal(readFileSync(commandPath, "utf8"), customContents);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("learning synchronization preserves user-modified content at every retired managed command path", () => {
  const root = mkdtempSync(join(tmpdir(), "settings-opencode-learning-modified-command-"));
  const sourceRoot = join(root, "source");
  const openCodeRoot = join(root, "opencode");
  const claudeRoot = join(root, "claude");
  const expectedContents = new Map<string, Buffer>();

  try {
    for (const targetRoot of [openCodeRoot, claudeRoot]) {
      mkdirSync(join(targetRoot, "commands"), { recursive: true });
      for (const command of retiredManagedCommands) {
        const commandPath = join(targetRoot, "commands", `learn-${command}.md`);
        const contents = Buffer.concat([
          managedCommandContents(command),
          Buffer.from(`\nUser-owned customization for ${command}: 🛡️\n`),
        ]);
        writeFileSync(commandPath, contents);
        expectedContents.set(commandPath, contents);
      }
    }

    synchronizeLearningRuntime({ sourceRoot, openCodeRoot, claudeRoot });

    for (const [commandPath, contents] of expectedContents) {
      assert.equal(existsSync(commandPath), true, `${commandPath} must not be silently deleted`);
      assert.deepEqual(readFileSync(commandPath), contents);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("learning synchronization preserves symlinks at every retired managed command path without dereferencing them", () => {
  const root = mkdtempSync(join(tmpdir(), "settings-opencode-learning-symlink-command-"));
  const sourceRoot = join(root, "source");
  const openCodeRoot = join(root, "opencode");
  const claudeRoot = join(root, "claude");
  const symlinkTargets = new Map<string, { readonly backingPath: string; readonly contents: string }>();

  try {
    for (const [targetIndex, targetRoot] of [openCodeRoot, claudeRoot].entries()) {
      mkdirSync(join(targetRoot, "commands"), { recursive: true });
      for (const command of retiredManagedCommands) {
        const backingPath = join(root, "user-owned", `${targetIndex}-${command}.md`);
        const commandPath = join(targetRoot, "commands", `learn-${command}.md`);
        const contents = `user-owned symlink target for ${command}\n`;
        mkdirSync(join(root, "user-owned"), { recursive: true });
        writeFileSync(backingPath, contents);
        symlinkSync(backingPath, commandPath);
        symlinkTargets.set(commandPath, { backingPath, contents });
      }
    }

    synchronizeLearningRuntime({ sourceRoot, openCodeRoot, claudeRoot });

    for (const [commandPath, { backingPath, contents }] of symlinkTargets) {
      assert.equal(existsSync(commandPath), true, `${commandPath} symlink must not be silently deleted`);
      assert.equal(lstatSync(commandPath).isSymbolicLink(), true, `${commandPath} must remain a symlink`);
      assert.equal(readlinkSync(commandPath), backingPath);
      assert.equal(readFileSync(backingPath, "utf8"), contents);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("learning synchronization removes exact copies of every known managed retired command", () => {
  const root = mkdtempSync(join(tmpdir(), "settings-opencode-learning-managed-command-"));
  const sourceRoot = join(root, "source");
  const openCodeRoot = join(root, "opencode");
  const claudeRoot = join(root, "claude");

  try {
    for (const targetRoot of [openCodeRoot, claudeRoot]) {
      mkdirSync(join(targetRoot, "commands"), { recursive: true });
      for (const command of retiredManagedCommands) {
        writeFileSync(
          join(targetRoot, "commands", `learn-${command}.md`),
          managedCommandContents(command),
        );
      }
    }

    synchronizeLearningRuntime({ sourceRoot, openCodeRoot, claudeRoot });

    for (const targetRoot of [openCodeRoot, claudeRoot]) {
      for (const command of retiredManagedCommands) {
        const commandPath = join(targetRoot, "commands", `learn-${command}.md`);
        assert.equal(existsSync(commandPath), false, `${commandPath} exact managed copy must be removed`);
      }
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("learning synchronization removes exact regular-file payloads for every retired plugin, hook, and bin asset", () => {
  const root = mkdtempSync(join(tmpdir(), "settings-opencode-learning-managed-assets-"));
  const sourceRoot = join(root, "source");
  const openCodeRoot = join(root, "opencode");
  const claudeRoot = join(root, "claude");
  const targetRoots = { opencode: openCodeRoot, claude: claudeRoot } as const;

  try {
    for (const asset of retiredManagedAssets) {
      const assetPath = join(targetRoots[asset.target], asset.relativePath);
      mkdirSync(join(assetPath, ".."), { recursive: true });
      writeFileSync(assetPath, retiredManagedAssetPayload);
    }

    synchronizeLearningRuntime({ sourceRoot, openCodeRoot, claudeRoot });

    for (const asset of retiredManagedAssets) {
      const assetPath = join(targetRoots[asset.target], asset.relativePath);
      assert.equal(existsSync(assetPath), false, `${asset.target}:${asset.relativePath} exact managed payload must be removed`);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("learning synchronization preserves or safely backs up modified retired plugin, hook, and bin assets", () => {
  const root = mkdtempSync(join(tmpdir(), "settings-opencode-learning-modified-assets-"));
  const sourceRoot = join(root, "source");
  const openCodeRoot = join(root, "opencode");
  const claudeRoot = join(root, "claude");
  const targetRoots = { opencode: openCodeRoot, claude: claudeRoot } as const;
  const expectedContents = new Map<string, Buffer>();

  try {
    for (const asset of retiredManagedAssets) {
      const targetRoot = targetRoots[asset.target];
      const assetPath = join(targetRoot, asset.relativePath);
      const contents = Buffer.concat([
        retiredManagedAssetPayload,
        Buffer.from(`user-owned customization for ${asset.relativePath}: 🛡️\n`),
      ]);
      mkdirSync(join(assetPath, ".."), { recursive: true });
      writeFileSync(assetPath, contents);
      expectedContents.set(`${asset.target}:${asset.relativePath}`, contents);
    }

    synchronizeLearningRuntime({ sourceRoot, openCodeRoot, claudeRoot });

    for (const asset of retiredManagedAssets) {
      const targetRoot = targetRoots[asset.target];
      const key = `${asset.target}:${asset.relativePath}`;
      const contents = expectedContents.get(key);
      assert.ok(contents, `missing test fixture for ${key}`);
      assert.equal(
        treeContainsRegularFile(targetRoot, contents),
        true,
        `${key} modified bytes must remain in place or in a safe backup under the target`,
      );
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("learning synchronization preserves or safely backs up retired asset symlinks without dereferencing them", () => {
  const root = mkdtempSync(join(tmpdir(), "settings-opencode-learning-symlink-assets-"));
  const sourceRoot = join(root, "source");
  const openCodeRoot = join(root, "opencode");
  const claudeRoot = join(root, "claude");
  const targetRoots = { opencode: openCodeRoot, claude: claudeRoot } as const;
  const expectedLinks = new Map<string, { readonly backingPath: string; readonly contents: Buffer }>();

  try {
    for (const [index, asset] of retiredManagedAssets.entries()) {
      const targetRoot = targetRoots[asset.target];
      const assetPath = join(targetRoot, asset.relativePath);
      const backingPath = join(root, "user-owned", `${index}-retired-asset`);
      const contents = Buffer.from(`user-owned symlink target for ${asset.relativePath}: 🔗\n`);
      mkdirSync(join(assetPath, ".."), { recursive: true });
      mkdirSync(join(backingPath, ".."), { recursive: true });
      writeFileSync(backingPath, contents);
      symlinkSync(backingPath, assetPath);
      expectedLinks.set(`${asset.target}:${asset.relativePath}`, { backingPath, contents });
    }

    synchronizeLearningRuntime({ sourceRoot, openCodeRoot, claudeRoot });

    for (const asset of retiredManagedAssets) {
      const targetRoot = targetRoots[asset.target];
      const key = `${asset.target}:${asset.relativePath}`;
      const expected = expectedLinks.get(key);
      assert.ok(expected, `missing test fixture for ${key}`);
      assert.deepEqual(readFileSync(expected.backingPath), expected.contents, `${key} backing data must remain unchanged`);
      assert.equal(
        treeContainsSymlink(targetRoot, expected.backingPath),
        true,
        `${key} symlink must remain in place or be moved intact to a safe backup`,
      );
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("supported OpenCode reinstall removes exact canonical retired commands after the additive copy", () => {
  const root = mkdtempSync(join(tmpdir(), "settings-opencode-learning-reinstall-"));
  const projectRoot = join(root, "project");
  const homeRoot = join(root, "home");
  const binRoot = join(root, "bin");
  const openCodeRoot = join(homeRoot, ".config", "opencode");

  try {
    mkdirSync(projectRoot, { recursive: true });
    mkdirSync(join(openCodeRoot, "plugins"), { recursive: true });
    mkdirSync(join(openCodeRoot, "commands"), { recursive: true });
    writeInstallerExecutables(binRoot);
    writeFileSync(join(openCodeRoot, "plugins", "learning-loop.ts"), "legacy auto-discovered plugin\n");
    for (const command of retiredManagedCommands) {
      writeFileSync(
        join(openCodeRoot, "commands", `learn-${command}.md`),
        managedCommandContents(command),
      );
    }

    const result = spawnSync("bash", [installerPath, "--yes", "--no-claude"], {
      cwd: projectRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        HOME: homeRoot,
        PATH: `${binRoot}:/usr/bin:/bin:/usr/sbin:/sbin`,
        SHELL: "/bin/zsh",
      },
    });
    const output = `${result.stdout}\n${result.stderr}`;

    assert.equal(result.status, 0, `supported OpenCode reinstall must succeed\n${output}`);
    assert.equal(
      readFileSync(join(openCodeRoot, "plugins", "learning-runtime.ts"), "utf8"),
      readFileSync(join(repositoryRoot, "plugins", "learning-runtime.ts"), "utf8"),
      "the supported runtime entrypoint must remain installed",
    );
    assert.equal(
      existsSync(join(openCodeRoot, "plugins", "learning-loop.ts")),
      false,
      "runtime synchronization must remove the retired auto-discovered learning plugin",
    );
    for (const command of retiredManagedCommands) {
      assert.equal(
        existsSync(join(openCodeRoot, "commands", `learn-${command}.md`)),
        false,
        `runtime synchronization must remove retired learn-${command}.md`,
      );
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("supported OpenCode reinstall preserves modified and symlinked retired paths plus custom learn commands", () => {
  const root = mkdtempSync(join(tmpdir(), "settings-opencode-learning-safe-reinstall-"));
  const projectRoot = join(root, "project");
  const homeRoot = join(root, "home");
  const binRoot = join(root, "bin");
  const openCodeRoot = join(homeRoot, ".config", "opencode");
  const commandsRoot = join(openCodeRoot, "commands");
  const modifiedCommands = ["approve", "pending"] as const;
  const symlinkedCommands = ["reject", "review"] as const;
  const modifiedContents = new Map<string, Buffer>();
  const symlinkTargets = new Map<string, { readonly backingPath: string; readonly contents: Buffer }>();
  const customCommandPath = join(commandsRoot, "learn-team-🛡️.md");
  const customContents = Buffer.from("---\ndescription: Team-owned learning workflow 🚀\n---\n\nKeep this command.\n");

  try {
    mkdirSync(projectRoot, { recursive: true });
    mkdirSync(commandsRoot, { recursive: true });
    writeInstallerExecutables(binRoot);

    for (const command of modifiedCommands) {
      const commandPath = join(commandsRoot, `learn-${command}.md`);
      const contents = Buffer.concat([
        managedCommandContents(command),
        Buffer.from(`\nUser-owned installer customization for ${command}: 🛡️\n`),
      ]);
      writeFileSync(commandPath, contents);
      modifiedContents.set(commandPath, contents);
    }
    for (const command of symlinkedCommands) {
      const commandPath = join(commandsRoot, `learn-${command}.md`);
      const backingPath = join(root, `user-owned-${command}.md`);
      const contents = Buffer.from(`User-owned symlink target for ${command}: 🔗\n`);
      writeFileSync(backingPath, contents);
      symlinkSync(backingPath, commandPath);
      symlinkTargets.set(commandPath, { backingPath, contents });
    }
    writeFileSync(customCommandPath, customContents);

    const result = spawnSync("bash", [installerPath, "--yes", "--no-claude"], {
      cwd: projectRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        HOME: homeRoot,
        PATH: `${binRoot}:/usr/bin:/bin:/usr/sbin:/sbin`,
        SHELL: "/bin/zsh",
      },
    });
    const output = `${result.stdout}\n${result.stderr}`;

    assert.equal(result.status, 0, `supported OpenCode reinstall must succeed\n${output}`);
    assert.deepEqual(readFileSync(customCommandPath), customContents, "arbitrary learn-*.md must survive unchanged");
    for (const [commandPath, contents] of modifiedContents) {
      assert.equal(existsSync(commandPath), true, `${commandPath} must survive the full installer`);
      assert.deepEqual(readFileSync(commandPath), contents, `${commandPath} bytes must remain unchanged`);
    }
    for (const [commandPath, { backingPath, contents }] of symlinkTargets) {
      assert.equal(existsSync(commandPath), true, `${commandPath} symlink must survive the full installer`);
      assert.equal(lstatSync(commandPath).isSymbolicLink(), true, `${commandPath} must remain a symlink`);
      assert.equal(readlinkSync(commandPath), backingPath, `${commandPath} target must remain unchanged`);
      assert.deepEqual(readFileSync(backingPath), contents, `${backingPath} bytes must remain unchanged`);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("installer invokes learning synchronization after both targets are copied and treats failure as fatal", () => {
  const root = mkdtempSync(join(tmpdir(), "settings-opencode-learning-sync-failure-"));
  const projectRoot = join(root, "project");
  const homeRoot = join(root, "home");
  const binRoot = join(root, "bin");
  const observationPath = join(root, "sync-observation.txt");

  try {
    mkdirSync(projectRoot, { recursive: true });
    mkdirSync(homeRoot, { recursive: true });
    writeInstallerExecutables(binRoot, true);

    const result = spawnSync("bash", [installerPath, "--yes"], {
      cwd: projectRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        HOME: homeRoot,
        PATH: `${binRoot}:/usr/bin:/bin:/usr/sbin:/sbin`,
        SHELL: "/bin/zsh",
        SYNC_OBSERVATION: observationPath,
      },
    });
    const output = `${result.stdout}\n${result.stderr}`;

    assert.equal(
      existsSync(observationPath) ? readFileSync(observationPath, "utf8").trim() : "not-invoked",
      "after-copy-and-mirror",
      `sync_learning_runtime must run only after the OpenCode copy and Claude mirror are present\n${output}`,
    );
    assert.notEqual(result.status, 0, `learning synchronization failure must be fatal\n${output}`);
    assert.match(
      output,
      /proposal-learning runtime sync failed/i,
      `fatal synchronization failure must identify the failed learning runtime step\n${output}`,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
