import { synchronizeLearningRuntime } from "./installer-runtime.ts";

function argument(name: string): string | null {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  return typeof value === "string" ? value : null;
}

const sourceRoot = argument("--source-root");
const openCodeRoot = argument("--opencode-root");
const claudeRoot = argument("--claude-root");
const installOpenCode = process.argv.includes("--opencode");
const installClaude = process.argv.includes("--claude");

if (!sourceRoot || !openCodeRoot || !claudeRoot) {
  process.exitCode = 1;
} else {
  const result = synchronizeLearningRuntime({
    sourceRoot,
    openCodeRoot,
    claudeRoot,
    targets: { opencode: installOpenCode, claude: installClaude },
  });
  if ((installOpenCode && !result.opencodeRuntimeSynchronized) || (installClaude && (!result.claudeRuntimeSynchronized || !result.claudeSettingsMerged))) {
    process.stderr.write("proposal-learning: Claude settings were malformed, non-regular, or symlinked; no hook registration was changed\n");
    process.exitCode = 1;
  }
}
