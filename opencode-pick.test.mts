import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
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

const launcherPath = join(import.meta.dirname, "bin", "opencode-pick");

interface LaunchOptions {
  ambient?: Record<string, string>;
  expectedStatus?: number;
  forbidPerl?: boolean;
  initialState?: Record<string, unknown>;
  profileName?: string;
  profilePath?: string;
}

interface LaunchCapture {
  configText: string;
  learningModel: string;
  nodeInvoked: boolean;
  opencodeInvoked: boolean;
  reasoningTiers: {
    conductor: string;
    primary: string;
    secondary: string;
    tertiary: string;
  };
  stateText?: string;
  stderr: string;
}

function profile(values: Record<string, string>): string {
  const exports = Object.entries(values).map(
    ([name, value]) => `export ${name}=${JSON.stringify(value)}`,
  );
  return ["# Regression profile", ...exports, ""].join("\n");
}

function launch(
  values: Record<string, string>,
  options: LaunchOptions = {},
): LaunchCapture {
  const root = mkdtempSync(join(tmpdir(), "settings-opencode-pick-"));
  const home = join(root, "home");
  const stateHome = join(root, "state");
  const bin = join(root, "bin");
  const profilePath = join(root, "profiles.zsh");
  const capturePath = join(root, "config.json");
  const learningCapturePath = join(root, "learning-model.txt");
  const nodeCapturePath = join(root, "node-invoked.txt");
  const reasoningCapturePath = join(root, "reasoning-tiers.txt");
  const modelPath = join(stateHome, "opencode", "model.json");

  mkdirSync(home);
  mkdirSync(bin);
  if (options.profilePath === undefined) {
    writeFileSync(profilePath, profile(values));
  }
  writeFileSync(
    join(bin, "opencode"),
    [
      "#!/usr/bin/env bash",
      "printf '%s' \"${OPENCODE_CONFIG_CONTENT-}\" > \"$OPENCODE_PICK_CAPTURE\"",
      "printf '%s' \"${OPENCODE_MODEL_LEARNING-}\" > \"$OPENCODE_PICK_LEARNING_CAPTURE\"",
      "printf '%s\\n' \"${OPENCODE_REASONING_CONDUCTOR-}\" \"${OPENCODE_REASONING_PRIMARY-}\" \"${OPENCODE_REASONING_SECONDARY-}\" \"${OPENCODE_REASONING_TERTIARY-}\" > \"$OPENCODE_PICK_REASONING_CAPTURE\"",
      "",
    ].join("\n"),
  );
  chmodSync(join(bin, "opencode"), 0o755);

  if (options.forbidPerl === true) {
    writeFileSync(join(bin, "perl"), "#!/usr/bin/env bash\nexit 127\n");
    chmodSync(join(bin, "perl"), 0o755);
    writeFileSync(
      join(bin, "node"),
      [
        "#!/usr/bin/env bash",
        "printf invoked > \"$OPENCODE_PICK_NODE_CAPTURE\"",
        `exec ${JSON.stringify(process.execPath)} "$@"`,
        "",
      ].join("\n"),
    );
    chmodSync(join(bin, "node"), 0o755);
  }

  if (options.initialState !== undefined) {
    mkdirSync(join(stateHome, "opencode"), { recursive: true });
    writeFileSync(modelPath, JSON.stringify(options.initialState));
  }

  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const name of Object.keys(env)) {
    if (name.startsWith("OPENCODE_")) {
      delete env[name];
    }
  }
  Object.assign(env, options.ambient, {
    HOME: home,
    OPENCODE_PICK_CAPTURE: capturePath,
    OPENCODE_PICK_LEARNING_CAPTURE: learningCapturePath,
    OPENCODE_PICK_NODE_CAPTURE: nodeCapturePath,
    OPENCODE_PICK_REASONING_CAPTURE: reasoningCapturePath,
    OPENCODE_PROFILE_FILE: options.profilePath ?? profilePath,
    PATH: `${bin}:/usr/bin:/bin:/usr/sbin:/sbin`,
    XDG_STATE_HOME: stateHome,
  });

  try {
    const result = spawnSync(
      "bash",
      [launcherPath, "--profile", options.profileName ?? "Regression profile"],
      { encoding: "utf8", env },
    );
    const expectedStatus = options.expectedStatus ?? 0;
    assert.equal(
      result.status,
      expectedStatus,
      `unexpected launcher status\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
    );
    const opencodeInvoked = existsSync(capturePath);
    if (expectedStatus === 0) {
      assert.equal(opencodeInvoked, true, "fake opencode was not invoked");
    }
    const reasoningTiers = existsSync(reasoningCapturePath)
      ? readFileSync(reasoningCapturePath, "utf8").split("\n")
      : [];

    return {
      configText: opencodeInvoked ? readFileSync(capturePath, "utf8") : "",
      learningModel: existsSync(learningCapturePath)
        ? readFileSync(learningCapturePath, "utf8")
        : "",
      nodeInvoked: existsSync(nodeCapturePath),
      opencodeInvoked,
      reasoningTiers: {
        conductor: reasoningTiers[0] ?? "",
        primary: reasoningTiers[1] ?? "",
        secondary: reasoningTiers[2] ?? "",
        tertiary: reasoningTiers[3] ?? "",
      },
      stateText: existsSync(modelPath)
        ? readFileSync(modelPath, "utf8")
        : undefined,
      stderr: result.stderr,
    };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function asRecord(value: unknown, description: string): Record<string, unknown> {
  assert.ok(
    typeof value === "object" && value !== null && !Array.isArray(value),
    `${description} must be an object`,
  );
  return value as Record<string, unknown>;
}

function parseRecord(text: string, description: string): Record<string, unknown> {
  return asRecord(JSON.parse(text) as unknown, description);
}

function scriptIncludesFocusedSuite(
  scripts: Record<string, unknown>,
  scriptName: string,
  visited = new Set<string>(),
): boolean {
  if (visited.has(scriptName)) {
    return false;
  }
  visited.add(scriptName);

  const command = scripts[scriptName];
  if (typeof command !== "string") {
    return false;
  }
  if (/(?:^|\s)opencode-pick\.test\.mts(?:\s|$)/.test(command)) {
    return true;
  }

  for (const match of command.matchAll(/\bnpm\s+run\s+([a-zA-Z0-9:_-]+)/g)) {
    const referencedScript = match[1];
    if (
      referencedScript !== undefined &&
      scriptIncludesFocusedSuite(scripts, referencedScript, visited)
    ) {
      return true;
    }
  }
  return false;
}

function overlayAgents(configText: string): Record<string, unknown> {
  const config = parseRecord(configText, "OPENCODE_CONFIG_CONTENT");
  return asRecord(config.agent, "OPENCODE_CONFIG_CONTENT.agent");
}

function assertEffort(
  agents: Record<string, unknown>,
  agentName: string,
  expected: string,
): void {
  const agent = asRecord(agents[agentName], `agent.${agentName}`);
  assert.equal(agent.variant, expected, `${agentName} must expose the TUI variant`);
  assert.equal(
    agent.reasoningEffort,
    expected,
    `${agentName} must send the matching provider reasoning effort`,
  );
}

test("selected effort reaches configured agents as matching variant and reasoningEffort", () => {
  const capture = launch({
    OPENCODE_MODEL_CONDUCTOR: "openai/conductor",
    OPENCODE_MODEL_SUBAGENT_MINI: "openai/mini",
    OPENCODE_MODEL_SUBAGENT_PLANNER: "openai/planner",
    OPENCODE_MODEL_SUBAGENT_WORKER: "openai/worker",
    OPENCODE_REASONING_CONDUCTOR: "medium",
    OPENCODE_REASONING_PRIMARY: "xhigh",
    OPENCODE_REASONING_SECONDARY: "high",
    OPENCODE_REASONING_TERTIARY: "low",
  });
  const agents = overlayAgents(capture.configText);

  assertEffort(agents, "conductor", "medium");
  assertEffort(agents, "e2e-runner", "high");
  assertEffort(agents, "database-reviewer", "high");
  assertEffort(agents, "scout", "low");
});

test("a profile does not inherit an ambient conductor effort when it leaves conductor unset", () => {
  const capture = launch(
    {
      OPENCODE_MODEL_CONDUCTOR: "openai/conductor",
      OPENCODE_MODEL_SUBAGENT_MINI: "openai/mini",
      OPENCODE_MODEL_SUBAGENT_PLANNER: "openai/planner",
      OPENCODE_MODEL_SUBAGENT_WORKER: "openai/worker",
      OPENCODE_REASONING_PRIMARY: "high",
      OPENCODE_REASONING_SECONDARY: "high",
      OPENCODE_REASONING_TERTIARY: "high",
    },
    { ambient: { OPENCODE_REASONING_CONDUCTOR: "xhigh" } },
  );
  const agents = overlayAgents(capture.configText);

  assert.equal(
    agents.conductor,
    undefined,
    "the selected profile, not stale ambient state, must determine conductor effort",
  );
  assertEffort(agents, "e2e-runner", "high");
});

test("unsupported medium effort is clamped consistently for variant and reasoningEffort", () => {
  const capture = launch({
    OPENCODE_MODEL_CONDUCTOR: "openai/conductor",
    OPENCODE_MODEL_SUBAGENT_MINI: "openai/mini",
    OPENCODE_MODEL_SUBAGENT_PLANNER: "openai/planner",
    OPENCODE_MODEL_SUBAGENT_WORKER: "alibabacloud/qwen3.8-max-preview",
    OPENCODE_REASONING_CONDUCTOR: "low",
    OPENCODE_REASONING_PRIMARY: "low",
    OPENCODE_REASONING_SECONDARY: "medium",
    OPENCODE_REASONING_TERTIARY: "low",
  });

  assertEffort(overlayAgents(capture.configText), "e2e-runner", "high");
});

test("empty effort is omitted instead of emitting empty variant or reasoningEffort", () => {
  const capture = launch({
    OPENCODE_MODEL_CONDUCTOR: "github-copilot/kimi-k2.7-code",
    OPENCODE_MODEL_SUBAGENT_MINI: "github-copilot/kimi-k2.7-code",
    OPENCODE_MODEL_SUBAGENT_PLANNER: "github-copilot/kimi-k2.7-code",
    OPENCODE_MODEL_SUBAGENT_WORKER: "github-copilot/kimi-k2.7-code",
    OPENCODE_REASONING_CONDUCTOR: "",
    OPENCODE_REASONING_PRIMARY: "",
    OPENCODE_REASONING_SECONDARY: "",
    OPENCODE_REASONING_TERTIARY: "",
  });

  assert.equal(
    capture.configText,
    "",
    "an empty effort must not produce an agent reasoning overlay",
  );
});

test("empty-reasoning profile removes its stale conductor variant while preserving unrelated model state", () => {
  const conductorModel = "mistral/mistral-medium-2604";
  const initialState: Record<string, unknown> = {
    recent: [{ providerID: "existing", modelID: "recent" }],
    favorite: [{ providerID: "existing", modelID: "favorite" }],
    variant: {
      [conductorModel]: "xhigh",
      "existing/model": "low",
    },
    unrelated: { keep: true },
  };
  const capture = launch(
    {},
    {
      initialState,
      profileName: "Mistral -> Medium",
      profilePath: join(import.meta.dirname, "bin", "opencode-models.zsh"),
    },
  );

  assert.notEqual(capture.stateText, undefined, "model.json must still exist");
  const state = parseRecord(capture.stateText ?? "", "model.json");
  const variants = asRecord(state.variant, "model.json.variant");
  assert.equal(
    Object.hasOwn(variants, conductorModel),
    false,
    "an empty reasoning profile must clear the selected conductor's stale variant",
  );
  assert.equal(variants["existing/model"], "low");
  assert.deepEqual(state.recent, initialState.recent);
  assert.deepEqual(state.favorite, initialState.favorite);
  assert.deepEqual(state.unrelated, initialState.unrelated);
});

test("launcher initializes the selected conductor model variant without replacing model state", () => {
  const initialState: Record<string, unknown> = {
    recent: [{ providerID: "existing", modelID: "recent" }],
    favorite: [{ providerID: "existing", modelID: "favorite" }],
    variant: { "existing/model": "low" },
    unrelated: { keep: true },
  };
  const capture = launch(
    {
      OPENCODE_MODEL_CONDUCTOR: "openai/conductor",
      OPENCODE_MODEL_SUBAGENT_MINI: "openai/mini",
      OPENCODE_MODEL_SUBAGENT_PLANNER: "openai/planner",
      OPENCODE_MODEL_SUBAGENT_WORKER: "openai/worker",
      OPENCODE_REASONING_CONDUCTOR: "high",
      OPENCODE_REASONING_PRIMARY: "xhigh",
      OPENCODE_REASONING_SECONDARY: "medium",
      OPENCODE_REASONING_TERTIARY: "low",
    },
    { initialState },
  );

  assert.notEqual(capture.stateText, undefined, "model.json must exist");
  const state = parseRecord(capture.stateText ?? "", "model.json");
  const variants = asRecord(state.variant, "model.json.variant");
  assert.equal(variants["openai/conductor"], "high");
  assert.equal(variants["existing/model"], "low");
  assert.deepEqual(state.recent, initialState.recent);
  assert.deepEqual(state.favorite, initialState.favorite);
  assert.deepEqual(state.unrelated, initialState.unrelated);
});

test("malformed ambient config aborts before model state is mutated", () => {
  const initialState: Record<string, unknown> = {
    recent: [{ providerID: "existing", modelID: "recent" }],
    variant: { "existing/model": "low" },
    unrelated: { keep: true },
  };
  const initialStateText = JSON.stringify(initialState);
  const capture = launch(
    {
      OPENCODE_MODEL_CONDUCTOR: "openai/conductor",
      OPENCODE_MODEL_SUBAGENT_MINI: "openai/mini",
      OPENCODE_MODEL_SUBAGENT_PLANNER: "openai/planner",
      OPENCODE_MODEL_SUBAGENT_WORKER: "openai/worker",
      OPENCODE_REASONING_CONDUCTOR: "high",
      OPENCODE_REASONING_PRIMARY: "xhigh",
      OPENCODE_REASONING_SECONDARY: "high",
      OPENCODE_REASONING_TERTIARY: "low",
    },
    {
      ambient: { OPENCODE_CONFIG_CONTENT: "{" },
      expectedStatus: 1,
      initialState,
    },
  );

  assert.equal(capture.opencodeInvoked, false, "invalid config must abort launch");
  assert.equal(
    capture.stateText,
    initialStateText,
    "model.json must remain byte-for-byte unchanged",
  );
});

test("diagnostic output reports only safe profile-managed variables", () => {
  const values = {
    OPENCODE_MODEL_CONDUCTOR: "openai/safe-conductor",
    OPENCODE_MODEL_SUBAGENT_MINI: "openai/safe-mini",
    OPENCODE_MODEL_SUBAGENT_PLANNER: "openai/safe-planner",
    OPENCODE_MODEL_SUBAGENT_WORKER: "openai/safe-worker",
    OPENCODE_REASONING_CONDUCTOR: "high",
    OPENCODE_REASONING_PRIMARY: "xhigh",
    OPENCODE_REASONING_SECONDARY: "high",
    OPENCODE_REASONING_TERTIARY: "low",
  };
  const configSecret = "sk-config-content-must-not-leak";
  const tokenSecret = "mistral-token-must-not-leak";
  const capture = launch(values, {
    ambient: {
      OPENCODE_ACCESS_TOKEN: tokenSecret,
      OPENCODE_CONFIG_CONTENT: JSON.stringify({
        provider: { options: { apiKey: configSecret } },
      }),
    },
  });

  assert.match(capture.stderr, /OPENCODE_MODEL_CONDUCTOR=openai\/safe-conductor/);
  assert.doesNotMatch(capture.stderr, /OPENCODE_CONFIG_CONTENT/);
  assert.doesNotMatch(capture.stderr, /OPENCODE_ACCESS_TOKEN/);
  assert.doesNotMatch(capture.stderr, new RegExp(configSecret));
  assert.doesNotMatch(capture.stderr, new RegExp(tokenSecret));

  const safeNames = new Set(Object.keys(values));
  const reportedNames = capture.stderr.match(/\bOPENCODE_[A-Z0-9_]+\b/g) ?? [];
  for (const name of reportedNames) {
    assert.equal(safeNames.has(name), true, `${name} is not safe profile output`);
  }
});

test("diagnostics omit ambient learning-model and control-bearing values", () => {
  const ambientLearningModel =
    "ambient-learning-secret\nFORGED_DIAGNOSTIC=1\r\u001b[31m";
  const capture = launch(
    {
      OPENCODE_MODEL_CONDUCTOR: "mistral/mistral-medium-2604",
      OPENCODE_MODEL_SUBAGENT_MINI: "mistral/ministral-8b-2512",
      OPENCODE_MODEL_SUBAGENT_PLANNER: "mistral/mistral-medium-2604",
      OPENCODE_MODEL_SUBAGENT_WORKER: "mistral/devstral-2-2512",
      OPENCODE_REASONING_CONDUCTOR: "",
      OPENCODE_REASONING_PRIMARY: "",
      OPENCODE_REASONING_SECONDARY: "",
      OPENCODE_REASONING_TERTIARY: "",
    },
    { ambient: { OPENCODE_MODEL_LEARNING: ambientLearningModel } },
  );

  assert.equal(
    capture.learningModel,
    ambientLearningModel,
    "ambient learning-model selection must still reach opencode",
  );
  assert.doesNotMatch(capture.stderr, /OPENCODE_MODEL_LEARNING/);
  assert.doesNotMatch(capture.stderr, /ambient-learning-secret/);
  assert.doesNotMatch(capture.stderr, /FORGED_DIAGNOSTIC/);
  assert.doesNotMatch(capture.stderr, /\u001b/);
});

test("learning-reviewer keeps its ambient pinned model across profiles", () => {
  const pinnedModel = "ollama/qwen2.5-coder:7b-instruct";
  const profileModels = [
    "openai/gpt-5.4",
    "mistral/mistral-medium-2604",
  ];

  for (const selectedModel of profileModels) {
    const capture = launch(
      {
        OPENCODE_MODEL_CONDUCTOR: selectedModel,
        OPENCODE_MODEL_SUBAGENT_MINI: selectedModel,
        OPENCODE_MODEL_SUBAGENT_PLANNER: selectedModel,
        OPENCODE_MODEL_SUBAGENT_WORKER: selectedModel,
        OPENCODE_REASONING_CONDUCTOR: "",
        OPENCODE_REASONING_PRIMARY: "",
        OPENCODE_REASONING_SECONDARY: "",
        OPENCODE_REASONING_TERTIARY: "",
      },
      { ambient: { OPENCODE_MODEL_LEARNING: pinnedModel } },
    );

    assert.equal(
      capture.learningModel,
      pinnedModel,
      `${selectedModel} must retain the learning-reviewer pin`,
    );
  }
});

test("repository Mistral profile clears every reasoning tier despite ambient values", () => {
  const capture = launch(
    {},
    {
      ambient: {
        OPENCODE_REASONING_CONDUCTOR: "xhigh",
        OPENCODE_REASONING_PRIMARY: "xhigh",
        OPENCODE_REASONING_SECONDARY: "xhigh",
        OPENCODE_REASONING_TERTIARY: "xhigh",
      },
      profileName: "Mistral -> Medium",
      profilePath: join(import.meta.dirname, "bin", "opencode-models.zsh"),
    },
  );

  assert.deepEqual(capture.reasoningTiers, {
    conductor: "",
    primary: "",
    secondary: "",
    tertiary: "",
  });
  assert.equal(capture.configText, "", "Mistral must not emit a reasoning overlay");
  assert.equal(
    capture.stateText,
    undefined,
    "Mistral must not emit a conductor state variant",
  );
});

test("ambient config is preserved while managed reasoning fields are replaced or removed", () => {
  const ambientConfig = {
    agent: {
      conductor: {
        description: "keep conductor metadata",
        reasoningEffort: "stale-low",
        variant: "stale-low",
      },
      "custom-agent": {
        label: "keep custom agent",
        reasoningEffort: "custom-effort",
        variant: "custom-variant",
      },
      "e2e-runner": {
        description: "keep runner metadata",
        reasoningEffort: "stale-xhigh",
        variant: "stale-xhigh",
      },
    },
    plugin: ["keep-plugin"],
    theme: "keep-theme",
  };
  const capture = launch(
    {
      OPENCODE_MODEL_CONDUCTOR: "openai/conductor",
      OPENCODE_MODEL_SUBAGENT_MINI: "openai/mini",
      OPENCODE_MODEL_SUBAGENT_PLANNER: "openai/planner",
      OPENCODE_MODEL_SUBAGENT_WORKER: "openai/worker",
      OPENCODE_REASONING_CONDUCTOR: "high",
      OPENCODE_REASONING_PRIMARY: "",
      OPENCODE_REASONING_SECONDARY: "",
      OPENCODE_REASONING_TERTIARY: "",
    },
    { ambient: { OPENCODE_CONFIG_CONTENT: JSON.stringify(ambientConfig) } },
  );
  const config = parseRecord(capture.configText, "merged OPENCODE_CONFIG_CONTENT");
  const agents = asRecord(config.agent, "merged OPENCODE_CONFIG_CONTENT.agent");
  const conductor = asRecord(agents.conductor, "agent.conductor");
  const runner = asRecord(agents["e2e-runner"], "agent.e2e-runner");

  assert.deepEqual(config.plugin, ambientConfig.plugin);
  assert.equal(config.theme, ambientConfig.theme);
  assert.equal(conductor.description, "keep conductor metadata");
  assert.equal(conductor.variant, "high");
  assert.equal(conductor.reasoningEffort, "high");
  assert.equal(runner.description, "keep runner metadata");
  assert.equal("variant" in runner, false);
  assert.equal("reasoningEffort" in runner, false);
  assert.deepEqual(agents["custom-agent"], ambientConfig.agent["custom-agent"]);
});

test("launcher updates state through the required Node runtime when Perl is unavailable", () => {
  const capture = launch(
    {
      OPENCODE_MODEL_CONDUCTOR: "openai/conductor",
      OPENCODE_MODEL_SUBAGENT_MINI: "openai/mini",
      OPENCODE_MODEL_SUBAGENT_PLANNER: "openai/planner",
      OPENCODE_MODEL_SUBAGENT_WORKER: "openai/worker",
      OPENCODE_REASONING_CONDUCTOR: "high",
      OPENCODE_REASONING_PRIMARY: "xhigh",
      OPENCODE_REASONING_SECONDARY: "high",
      OPENCODE_REASONING_TERTIARY: "low",
    },
    { forbidPerl: true },
  );

  assert.equal(capture.nodeInvoked, true, "launcher must use Node for state JSON");
  assert.notEqual(capture.stateText, undefined, "Node must write model.json");
});

test("default npm test script includes the focused launcher suite", () => {
  const packageJson = parseRecord(
    readFileSync(join(import.meta.dirname, "package.json"), "utf8"),
    "package.json",
  );
  const scripts = asRecord(packageJson.scripts, "package.json.scripts");
  const defaultTest = scripts.test;

  assert.equal(typeof defaultTest, "string", "package.json scripts.test must be a string");
  assert.equal(
    scriptIncludesFocusedSuite(scripts, "test"),
    true,
    "npm test must execute opencode-pick.test.mts without recursively invoking npm test",
  );
});
