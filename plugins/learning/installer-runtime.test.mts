import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { synchronizeLearningRuntime } from "./installer-runtime.ts";

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
