import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test, { after, before } from "node:test";
import { fileURLToPath } from "node:url";
import type { PluginInput } from "@opencode-ai/plugin";

import { NotificationPlugin } from "./notification.ts";

const IPHONE_SCRIPT = "/tmp/notify-iphone";
const IPHONE_ALERT = `${IPHONE_SCRIPT} OpenCode Conductor stopped — input may be needed`;
const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const originalPlatform = Object.getOwnPropertyDescriptor(process, "platform");
const originalIphoneScript = process.env.OPENCODE_NOTIFY_IPHONE_SCRIPT;

interface CommandRecorder {
  commands: string[];
  shell: PluginInput["$"];
}

interface NotificationHooks {
  "chat.message"?: (input: { sessionID: string; agent?: string }) => Promise<void>;
  "tool.execute.after"?: (input: {
    tool: string;
    sessionID: string;
    callID: string;
    args: unknown;
  }) => Promise<void>;
  event?: (input: { event: unknown }) => Promise<void>;
}

function createCommandRecorder(): CommandRecorder {
  const commands: string[] = [];
  const shell = ((strings: TemplateStringsArray, ...expressions: unknown[]) => {
    const command = strings.reduce(
      (result, string, index) =>
        `${result}${string}${index < expressions.length ? String(expressions[index]) : ""}`,
      "",
    );
    commands.push(command);
    return Promise.resolve();
  }) as unknown as PluginInput["$"];

  return { commands, shell };
}

async function createHooks(recorder: CommandRecorder): Promise<NotificationHooks> {
  return await NotificationPlugin({ $: recorder.shell } as PluginInput) as NotificationHooks;
}

function desktopCommands(commands: string[]): string[] {
  return commands.filter(
    (command) => command.startsWith("osascript ") || command.startsWith("afplay "),
  );
}

function iphoneCommands(commands: string[]): string[] {
  return commands.filter((command) => command.startsWith(IPHONE_SCRIPT));
}

async function registerRootConductor(hooks: NotificationHooks): Promise<void> {
  await hooks["chat.message"]?.({ sessionID: "root-session", agent: "conductor" });
}

async function sendEvent(hooks: NotificationHooks, event: unknown): Promise<void> {
  await hooks.event?.({ event });
}

before(() => {
  Object.defineProperty(process, "platform", { configurable: true, value: "darwin" });
  process.env.OPENCODE_NOTIFY_IPHONE_SCRIPT = IPHONE_SCRIPT;
});

after(() => {
  if (originalPlatform) {
    Object.defineProperty(process, "platform", originalPlatform);
  }

  if (originalIphoneScript === undefined) {
    delete process.env.OPENCODE_NOTIFY_IPHONE_SCRIPT;
  } else {
    process.env.OPENCODE_NOTIFY_IPHONE_SCRIPT = originalIphoneScript;
  }
});

test("project configuration leaves the notification plugin to auto-discovery", () => {
  const config = readFileSync(join(repositoryRoot, "opencode.jsonc"), "utf8");

  assert.equal(existsSync(join(repositoryRoot, "plugins", "notification.ts")), true);
  assert.doesNotMatch(config, /["']\.\/plugins\/notification\.(?:ts|js)["']/);
});

test("a root Conductor question notifies desktop and sends only the fixed iPhone alert", async () => {
  const recorder = createCommandRecorder();
  const hooks = await createHooks(recorder);
  const sensitiveQuestion = "Should I paste the production token: secret-token-123?";

  await registerRootConductor(hooks);
  await sendEvent(hooks, {
    type: "question.asked",
    properties: {
      id: "root-question",
      sessionID: "root-session",
      questions: [{ question: sensitiveQuestion, header: "Credentials", options: [] }],
    },
  });

  assert.equal(desktopCommands(recorder.commands).length, 2);
  assert.match(desktopCommands(recorder.commands)[0] ?? "", /secret-token-123/);
  assert.deepEqual(iphoneCommands(recorder.commands), [IPHONE_ALERT]);
});

test("a root Conductor permission request notifies desktop and sends only the fixed iPhone alert", async () => {
  const recorder = createCommandRecorder();
  const hooks = await createHooks(recorder);
  const sensitiveDetail = "Run curl with Authorization: Bearer secret-token-456";

  await registerRootConductor(hooks);
  await sendEvent(hooks, {
    type: "permission.asked",
    properties: {
      id: "root-permission",
      sessionID: "root-session",
      title: "Network access",
      detail: sensitiveDetail,
    },
  });

  assert.equal(desktopCommands(recorder.commands).length, 2);
  assert.match(desktopCommands(recorder.commands)[0] ?? "", /secret-token-456/);
  assert.deepEqual(iphoneCommands(recorder.commands), [IPHONE_ALERT]);
});

test("a subagent question notifies desktop without sending an iPhone alert", async () => {
  const recorder = createCommandRecorder();
  const hooks = await createHooks(recorder);

  await registerRootConductor(hooks);
  await sendEvent(hooks, {
    type: "question.v2.asked",
    properties: {
      id: "subagent-question",
      sessionID: "subagent-session",
      questions: [{ question: "Need an answer", header: "Question", options: [] }],
    },
  });

  assert.equal(desktopCommands(recorder.commands).length, 2);
  assert.deepEqual(iphoneCommands(recorder.commands), []);
});

test("a subagent permission request notifies desktop without sending an iPhone alert", async () => {
  const recorder = createCommandRecorder();
  const hooks = await createHooks(recorder);

  await registerRootConductor(hooks);
  await sendEvent(hooks, {
    type: "permission.v2.asked",
    properties: {
      id: "subagent-permission",
      sessionID: "subagent-session",
      title: "Write file",
      detail: "Needs access to a temporary file",
    },
  });

  assert.equal(desktopCommands(recorder.commands).length, 2);
  assert.deepEqual(iphoneCommands(recorder.commands), []);
});

test("a non-Conductor completion sends no iPhone alert", async () => {
  const recorder = createCommandRecorder();
  const hooks = await createHooks(recorder);

  await registerRootConductor(hooks);
  await hooks["tool.execute.after"]?.({
    tool: "read",
    sessionID: "subagent-session",
    callID: "subagent-work",
    args: {},
  });
  await sendEvent(hooks, {
    type: "message.updated",
    properties: {
      info: {
        id: "subagent-completion",
        sessionID: "subagent-session",
        role: "assistant",
        agent: "coder",
        finish: "stop",
      },
    },
  });

  assert.deepEqual(iphoneCommands(recorder.commands), []);
});

test("a root Conductor completion uses info.sessionID and sends desktop plus an iPhone alert", async () => {
  const recorder = createCommandRecorder();
  const hooks = await createHooks(recorder);

  await registerRootConductor(hooks);
  await hooks["tool.execute.after"]?.({
    tool: "read",
    sessionID: "root-session",
    callID: "root-work",
    args: {},
  });
  await sendEvent(hooks, {
    type: "message.updated",
    properties: {
      info: {
        id: "root-completion",
        sessionID: "root-session",
        role: "assistant",
        mode: "conductor",
        finish: "stop",
        summary: { title: "Root work completed" },
      },
    },
  });

  assert.equal(desktopCommands(recorder.commands).length, 2);
  assert.deepEqual(iphoneCommands(recorder.commands), [IPHONE_ALERT]);
});

test("a completion whose info.sessionID is a subagent cannot inherit root authorization", async () => {
  const recorder = createCommandRecorder();
  const hooks = await createHooks(recorder);

  await registerRootConductor(hooks);
  await hooks["tool.execute.after"]?.({
    tool: "read",
    sessionID: "root-session",
    callID: "root-work",
    args: {},
  });
  await sendEvent(hooks, {
    type: "message.updated",
    properties: {
      sessionID: "root-session",
      info: {
        id: "subagent-completion",
        sessionID: "subagent-session",
        role: "assistant",
        finish: "stop",
      },
    },
  });

  assert.deepEqual(iphoneCommands(recorder.commands), []);
});
