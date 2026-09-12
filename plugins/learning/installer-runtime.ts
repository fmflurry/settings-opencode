import { chmodSync, closeSync, cpSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { dirname, join, parse, resolve } from "node:path";

const LEGACY_OPENCODE_FILES = ["plugins/learning-loop.ts", "bin/learning-loop"] as const;
const LEGACY_CLAUDE_FILES = ["hooks/learning-loop.sh", "hooks/learning-review.sh", "bin/learning-loop"] as const;
const LEGACY_HOOK_COMMANDS = new Set(["learning-loop.sh", "learning-review.sh", "learning-loop", "learning-review"]);
const RETIRED_MANAGED_COMMAND_DIGESTS = {
  "learn-approve.md": "852328ee88f1dd141cc1622bce8427810e41343f2d285e317a6dc7e8a7c3b100",
  "learn-pending.md": "467f4245c304500ae7fe369ed75a28be4127b4b0ed27c8f5dc3a162d715f55c7",
  "learn-reject.md": "7340444f4543ce02861cf5037ce210ad9a0d0b08e8d8c9e65dad69a9b537287d",
  "learn-review.md": "524bdfaf328a123b04d18786cd4f7846e59adc37cd0438e7e9c4612a9ef5dd31",
} as const;
const RETIRED_MANAGED_ASSET_DIGESTS: Readonly<Record<string, ReadonlySet<string>>> = {
  "plugins/learning-loop.ts": new Set([
    "5b343814b26aab10a3cbf7dec1fb99e0797dc75915ed6db8c0594f98c756e1ae",
    "f115fa070a45a2eb192fae5ae061fed1e0bc69c08f5889c7f2a7e1fdc5a8041f",
    "9a35b25f5f7a3c28aaa564407d8ae1e51120b6e3908ba43e83892995445802a1",
    "38ba29a7146244306584afefa0583e0b173908d56f03ec2ffa9bead23bea10bc",
    "76a2d9e77626e97f3c38e6fdd5a1ab9ccac10e140692bbf21b58cd74432bd9ac",
    "a6aebffab780bb7b265a98d3d0f3351a87461e37790954fb3614f9df8e4c65d1",
  ]),
  "bin/learning-loop": new Set(["5b343814b26aab10a3cbf7dec1fb99e0797dc75915ed6db8c0594f98c756e1ae"]),
  "hooks/learning-loop.sh": new Set(["5b343814b26aab10a3cbf7dec1fb99e0797dc75915ed6db8c0594f98c756e1ae"]),
  "hooks/learning-review.sh": new Set(["5b343814b26aab10a3cbf7dec1fb99e0797dc75915ed6db8c0594f98c756e1ae"]),
};

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonObject | readonly JsonValue[];
interface JsonObject { [key: string]: JsonValue; }

export interface SynchronizationResult {
  readonly claudeSettingsMerged: boolean;
  readonly opencodeRuntimeSynchronized: boolean;
  readonly claudeRuntimeSynchronized: boolean;
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readSettings(path: string): JsonObject | null {
  if (!existsSync(path)) return {};
  const metadata = lstatSync(path);
  if (metadata.isSymbolicLink() || !metadata.isFile()) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    return isJsonObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function sourceDigest(path: string): string {
  const metadata = lstatSync(path);
  if (metadata.isSymbolicLink()) throw new Error("learning runtime source cannot contain a symbolic link");
  if (metadata.isFile()) return createHash("sha256").update(readFileSync(path)).digest("hex");
  if (!metadata.isDirectory()) throw new Error("learning runtime source must be a regular file or directory");
  const digest = createHash("sha256");
  for (const entry of readdirSync(path).sort()) digest.update(entry).update(sourceDigest(join(path, entry)));
  return digest.digest("hex");
}

function rejectSymlinkTarget(path: string): void {
  const resolved = resolve(path);
  const components: string[] = [];
  let current = resolved;
  while (current !== parse(current).root) {
    components.unshift(current);
    current = dirname(current);
  }
  components.unshift(current);
  for (const component of components) {
    // Darwin exposes its system temporary directory through /var -> /private/var.
    // It is an OS-owned namespace alias, not a caller-controlled target component.
    if (process.platform === "darwin" && component === "/var") continue;
    if (existsSync(component) && lstatSync(component).isSymbolicLink()) throw new Error(`learning runtime destination cannot contain a symbolic link: ${component}`);
  }
}

function copyIfPresent(source: string, destination: string): void {
  if (!existsSync(source)) return;
  if (existsSync(destination) && realpathSync(source) === realpathSync(destination)) return;
  rejectSymlinkTarget(destination);
  rejectSymlinkTarget(dirname(destination));
  mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
  cpSync(source, destination, { force: true, preserveTimestamps: true, recursive: true });
  if (destination.endsWith(".sh")) chmodSync(destination, 0o700);
  if (!existsSync(destination) || sourceDigest(source) !== sourceDigest(destination)) throw new Error("learning runtime copy failed parity check");
}

function sourcePath(sourceRoot: string, harness: "opencode" | "claude", relativePath: string): string {
  const fixturePath = join(sourceRoot, harness, relativePath);
  if (existsSync(fixturePath)) return fixturePath;
  return harness === "opencode" ? join(sourceRoot, "plugins", relativePath) : join(sourceRoot, ".claude", relativePath);
}

function fsyncDirectory(path: string): void {
  const descriptor = openSync(path, "r");
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function atomicSettingsWrite(path: string, contents: string): void {
  const directory = dirname(path);
  rejectSymlinkTarget(directory);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const backupPath = `${path}.bak`;
  rejectSymlinkTarget(path);
  rejectSymlinkTarget(backupPath);
  if (existsSync(path)) {
    const backupTemporary = join(directory, `.${randomUUID()}.bak.tmp`);
    const source = readFileSync(path);
    writeFileSync(backupTemporary, source, { mode: 0o600, flag: "wx" });
    const backupDescriptor = openSync(backupTemporary, "r");
    try {
      fsyncSync(backupDescriptor);
    } finally {
      closeSync(backupDescriptor);
    }
    renameSync(backupTemporary, backupPath);
    fsyncDirectory(directory);
  }
  const temporary = join(directory, `.${randomUUID()}.tmp`);
  writeFileSync(temporary, contents, { encoding: "utf8", mode: 0o600, flag: "wx" });
  const descriptor = openSync(temporary, "r");
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  renameSync(temporary, path);
  fsyncDirectory(directory);
}

function isManagedLearningCommand(value: JsonValue, command: string): boolean {
  if (!isJsonObject(value) || value.type !== "command" || typeof value.command !== "string") return false;
  const candidate = value.command.trim();
  const executable = candidate.replace(/^['"]|['"]$/g, "").split("/").at(-1)?.replace(/['"]$/, "") ?? "";
  return candidate === command || executable === "learning-user-prompt-submit.sh" || LEGACY_HOOK_COMMANDS.has(executable) || /^learn-(?:approve|pending|reject|review|show|accept|export)$/i.test(executable);
}

function removeLegacyLearningCommands(root: string): void {
  const commands = join(root, "commands");
  rejectSymlinkTarget(commands);
  if (!existsSync(commands)) return;
  for (const [entry, managedDigest] of Object.entries(RETIRED_MANAGED_COMMAND_DIGESTS)) {
    const destination = join(commands, entry);
    const metadata = lstatSync(destination, { throwIfNoEntry: false });
    if (!metadata) continue;
    if (metadata.isSymbolicLink()) {
      console.warn(`[learning-runtime] Preserving retired command ${destination}: symbolic links are not managed.`);
      continue;
    }
    if (!metadata.isFile()) {
      console.warn(`[learning-runtime] Preserving retired command ${destination}: path is not a regular managed file.`);
      continue;
    }
    const destinationDigest = createHash("sha256").update(readFileSync(destination)).digest("hex");
    if (destinationDigest !== managedDigest) {
      console.warn(`[learning-runtime] Preserving retired command ${destination}: content differs from the known managed legacy payload.`);
      continue;
    }
    rmSync(destination, { force: true });
  }
}

function removeLegacyLearningAssets(root: string, assets: readonly string[]): void {
  removeLegacyLearningCommands(root);
  for (const relativePath of assets) {
    const destination = join(root, relativePath);
    rejectSymlinkTarget(dirname(destination));
    const metadata = lstatSync(destination, { throwIfNoEntry: false });
    if (!metadata) continue;
    if (metadata.isSymbolicLink()) {
      console.warn(`[learning-runtime] Preserving retired asset ${destination}: symbolic links are not managed.`);
      continue;
    }
    if (!metadata.isFile()) {
      console.warn(`[learning-runtime] Preserving retired asset ${destination}: path is not a regular managed file.`);
      continue;
    }
    const destinationDigest = createHash("sha256").update(readFileSync(destination)).digest("hex");
    if (!RETIRED_MANAGED_ASSET_DIGESTS[relativePath]?.has(destinationDigest)) {
      console.warn(`[learning-runtime] Preserving retired asset ${destination}: content differs from every known managed legacy payload.`);
      continue;
    }
    rmSync(destination, { force: true });
  }
}

function shellQuote(value: string): string { return `'${value.replaceAll("'", `'"'"'`)}'`; }

function withoutManagedHooks(entry: JsonValue, command: string): JsonValue | null {
  if (!isJsonObject(entry) || !Array.isArray(entry.hooks)) return entry;
  const hooks = entry.hooks.filter((hook) => !isManagedLearningCommand(hook, command));
  if (hooks.length === 0) return null;
  return { ...entry, hooks };
}

function mergeClaudeHook(settingsPath: string, claudeRoot: string): boolean {
  const settings = readSettings(settingsPath);
  if (!settings) return false;
  const command = shellQuote(join(claudeRoot, "hooks", "learning-user-prompt-submit.sh"));
  const settingsHooks = settings.hooks;
  if (settingsHooks !== undefined && !isJsonObject(settingsHooks)) return false;
  const hooks: JsonObject = { ...(settingsHooks ?? {}) };
  const current = hooks.UserPromptSubmit;
  if (current !== undefined && !Array.isArray(current)) return false;
  const retained = (current ?? []).map((entry) => withoutManagedHooks(entry, command)).filter((entry): entry is JsonValue => entry !== null);
  hooks.UserPromptSubmit = [...retained, { matcher: "*", hooks: [{ type: "command", command }] }];
  atomicSettingsWrite(settingsPath, `${JSON.stringify({ ...settings, hooks }, null, 2)}\n`);
  return true;
}

function writeManifest(root: string, harness: "opencode" | "claude"): void {
  const path = harness === "opencode" ? join(root, "plugins", "learning-runtime-manifest.json") : join(root, "learning-runtime-manifest.json");
  rejectSymlinkTarget(path);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, `${JSON.stringify({ runtime: "proposal-learning", version: 1, harness, sourceHash: createHash("sha256").update(harness).digest("hex")})}\n`, { encoding: "utf8", mode: 0o600 });
}

export function synchronizeLearningRuntime(options: { readonly sourceRoot: string; readonly openCodeRoot: string; readonly claudeRoot: string; readonly targets?: { readonly opencode: boolean; readonly claude: boolean } }): SynchronizationResult {
  const targets = options.targets ?? { opencode: true, claude: true };
  let claudeSettingsMerged = true;
  let opencodeRuntimeSynchronized = !targets.opencode;
  let claudeRuntimeSynchronized = !targets.claude;
  if (targets.opencode) {
    const runtimeSource = sourcePath(options.sourceRoot, "opencode", "learning-runtime.ts");
    const runtimeDestination = join(options.openCodeRoot, "plugins", "learning-runtime.ts");
    if (existsSync(runtimeSource) && existsSync(runtimeDestination) && realpathSync(runtimeSource) === realpathSync(runtimeDestination)) {
      opencodeRuntimeSynchronized = existsSync(join(options.openCodeRoot, "bin", "proposal-learning"));
    } else {
      rejectSymlinkTarget(options.openCodeRoot);
      copyIfPresent(runtimeSource, runtimeDestination);
      copyIfPresent(join(options.sourceRoot, "bin", "proposal-learning"), join(options.openCodeRoot, "bin", "proposal-learning"));
      copyIfPresent(join(options.sourceRoot, "bin", "proposal-learning.cmd"), join(options.openCodeRoot, "bin", "proposal-learning.cmd"));
      removeLegacyLearningAssets(options.openCodeRoot, LEGACY_OPENCODE_FILES);
      writeManifest(options.openCodeRoot, "opencode");
      opencodeRuntimeSynchronized = existsSync(runtimeDestination) && existsSync(join(options.openCodeRoot, "bin", "proposal-learning"));
    }
  }
  if (targets.claude) {
    const claudeSource = join(options.sourceRoot, ".claude");
    if (existsSync(claudeSource) && existsSync(options.claudeRoot) && realpathSync(claudeSource) === realpathSync(options.claudeRoot)) {
      claudeRuntimeSynchronized = existsSync(join(options.claudeRoot, "hooks", "learning-user-prompt-submit.sh"));
    } else {
      rejectSymlinkTarget(options.claudeRoot);
      copyIfPresent(sourcePath(options.sourceRoot, "claude", "hooks/learning-user-prompt-submit.sh"), join(options.claudeRoot, "hooks", "learning-user-prompt-submit.sh"));
      copyIfPresent(join(options.sourceRoot, "plugins", "learning"), join(options.claudeRoot, "hooks", "learning"));
      copyIfPresent(join(options.sourceRoot, "bin", "proposal-learning"), join(options.claudeRoot, "bin", "proposal-learning"));
      copyIfPresent(join(options.sourceRoot, "bin", "proposal-learning.cmd"), join(options.claudeRoot, "bin", "proposal-learning.cmd"));
      removeLegacyLearningAssets(options.claudeRoot, LEGACY_CLAUDE_FILES);
      claudeSettingsMerged = mergeClaudeHook(join(options.claudeRoot, "settings.json"), options.claudeRoot);
      if (claudeSettingsMerged) writeManifest(options.claudeRoot, "claude");
      claudeRuntimeSynchronized = existsSync(join(options.claudeRoot, "hooks", "learning-user-prompt-submit.sh")) && existsSync(join(options.claudeRoot, "hooks", "learning", "claude-runtime.ts")) && claudeSettingsMerged;
    }
  }
  return { claudeSettingsMerged, opencodeRuntimeSynchronized, claudeRuntimeSynchronized };
}
