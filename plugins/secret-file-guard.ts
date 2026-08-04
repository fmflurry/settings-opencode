/**
 * Secret File Guard — OpenCode parity port of the Claude Code
 * `.claude/hooks/pre-tool-use.sh` hard-block.
 *
 * Gap being closed: declarative permission config (`opencode.jsonc`
 * `permission.bash` patterns) only matches literal command strings, and most
 * agents have no `read` permission gate at all (OpenCode's built-in
 * permission schema only supports `edit`/`bash`/`webfetch`/`doom_loop`/
 * `external_directory` — there is no glob-pattern gate for the `read` tool).
 * That means a subagent can read a live secret via the `read` tool, or via
 * `bash cat .env` / `bash grep .env` in any form the declarative bash
 * patterns don't happen to match.
 *
 * This plugin HARD-BLOCKS (throws in `tool.execute.before`, which aborts the
 * tool call) regardless of the declarative permission config:
 *   - `read` tool: denies when args.filePath is a secret-bearing .env file.
 *   - `bash` tool: denies when args.command references a .env secret file
 *     AND passes it to a text-reading utility (cat/grep/head/tail/less/
 *     more/awk/sed/sort/xxd/od/strings/nl/cut) or python's open(), anywhere
 *     in the command string — not anchored to the leading command name, so
 *     wrapped/rewritten forms ("rtk grep .env", "xargs cat .env") are still
 *     caught.
 *
 * `.env.example` / `.env.sample` / `.env.template` are explicitly exempt —
 * never secret-bearing — and remain readable through both tools.
 */
import type { PluginInput } from "@opencode-ai/plugin";

const ALLOWED_ENV_VARIANT_RE =
  /(^|\/)\.env\.(example|sample|template)(\.[A-Za-z0-9_-]+)?$/;
const ENV_SECRET_PATH_RE = /(^|\/)\.env(\.[A-Za-z0-9_-]+)?$/;

const READ_UTIL_RE =
  /(^|[|&;\s])(cat|less|more|head|tail|grep|egrep|fgrep|awk|sed|sort|uniq|xxd|od|strings|nl|cut)([\s]|$)/;
const PY_OPEN_RE = /python[0-9.]*\s+-c|open\s*\(/;

function isAllowedEnvVariant(path: string): boolean {
  return ALLOWED_ENV_VARIANT_RE.test(path);
}

/** True if `path` is a secret-bearing .env file (bare ".env" or any
 * ".env.<suffix>") and NOT an allowed example/sample/template variant. */
function isEnvSecretPath(path: string): boolean {
  if (!path) return false;
  if (isAllowedEnvVariant(path)) return false;
  return ENV_SECRET_PATH_RE.test(path);
}

/** True if the bash command references a .env secret AND passes it to a
 * text-reading utility, anywhere in the command string (rtk-rewritten /
 * wrapped forms included). Embedded references (e.g. `open('.env')`) are
 * caught by substring sanitization rather than token splitting. */
function commandReadsEnvSecret(cmd: string): boolean {
  if (!cmd || !cmd.includes(".env")) return false;

  const sanitized = cmd
    .replaceAll(".env.example", "")
    .replaceAll(".env.sample", "")
    .replaceAll(".env.template", "");
  if (!sanitized.includes(".env")) return false;

  return READ_UTIL_RE.test(cmd) || PY_OPEN_RE.test(cmd);
}

function stringArg(args: unknown, key: string): string {
  if (!args || typeof args !== "object") return "";
  const value = (args as Record<string, unknown>)[key];
  return typeof value === "string" ? value : "";
}

export const SecretFileGuardPlugin = async (_input: PluginInput) => {
  return {
    "tool.execute.before": async (
      input: { tool: string; sessionID: string; callID: string },
      output: { args: unknown },
    ) => {
      if (input.tool === "read") {
        const filePath = stringArg(output.args, "filePath");
        if (isEnvSecretPath(filePath)) {
          throw new Error(
            `[secret-file-guard] BLOCKED: read of secret-bearing file "${filePath}" is denied ` +
              `(.env/.env.* are off-limits; .env.example/.env.sample/.env.template remain readable).`,
          );
        }
      }

      if (input.tool === "bash") {
        const command = stringArg(output.args, "command");
        if (commandReadsEnvSecret(command)) {
          throw new Error(
            `[secret-file-guard] BLOCKED: command reads a .env secret file via a text utility ` +
              `(rewritten/wrapped forms included). Command: ${command}`,
          );
        }
      }
    },
  };
};

export default SecretFileGuardPlugin;
