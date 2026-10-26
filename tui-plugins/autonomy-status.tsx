/** @jsxImportSource @opentui/solid */
import { execFile, execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import { Show, createSignal } from "solid-js";

import type { TuiPlugin, TuiSlotContext } from "@opencode-ai/plugin/tui";

type GoalStatus = "active" | "escalated" | "done";

type Goal = {
  goal: string;
  status: GoalStatus;
  pr: string | null;
  fixIterations: number;
  maxFixIterations: number;
  reason: string;
};

type Snapshot = { isOn: boolean; goal: Goal | null };

const REFRESH_MS = 3000;
const GOAL_CLIP = 60;
const STATUSES: readonly GoalStatus[] = ["active", "escalated", "done"];
const EMPTY: Snapshot = { isOn: false, goal: null };

const asCount = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) ? value : 0;

const asText = (value: unknown): string => (typeof value === "string" ? value : "");

const clip = (text: string, max: number = GOAL_CLIP): string =>
  text.length <= max ? text : `${text.slice(0, max - 1)}…`;

// Field shape mirrors .claude/mods/autonomy-status/hooks/model.ts (shared state contract).
const parseGoal = (text: string): Goal | null => {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null) return null;
  const fields = raw as Record<string, unknown>;
  const status = STATUSES.find((one) => one === (fields.status === "merged" ? "done" : fields.status));
  if (status === undefined) return null;
  const pr = fields.pr;
  return {
    goal: asText(fields.goal),
    status,
    pr: typeof pr === "number" || (typeof pr === "string" && pr !== "") ? String(pr) : null,
    fixIterations: asCount(fields.fix_iterations),
    maxFixIterations: asCount(fields.max_fix_iterations),
    reason: asText(fields.reason),
  };
};

const goalsDir = (root: string): string | null => {
  try {
    const common = execFileSync("git", ["rev-parse", "--git-common-dir"], { cwd: root, encoding: "utf8" }).trim();
    return resolve(root, common, "agent-harness", "goals");
  } catch {
    return null;
  }
};

const readGoal = (dir: string | null): Goal | null => {
  if (dir === null) return null;
  try {
    const found = readdirSync(dir)
      .filter((name) => name.endsWith(".json"))
      .flatMap((name) => {
        const file = join(dir, name);
        const goal = parseGoal(readFileSync(file, "utf8"));
        return goal === null ? [] : [{ goal, mtimeMs: statSync(file).mtimeMs }];
      })
      .sort(
        (a, b) =>
          Number(a.goal.status === "done") - Number(b.goal.status === "done") || b.mtimeMs - a.mtimeMs,
      );
    return found[0]?.goal ?? null;
  } catch {
    return null;
  }
};

const readSnapshot = (root: string, dir: string | null): Snapshot => ({
  isOn: existsSync(join(root, ".claude", "state", "autonomy.on")),
  goal: readGoal(dir),
});

const prLabel = (goal: Goal): string => (goal.pr === null ? "" : ` #${goal.pr}`);

const toastsFor = (prev: Snapshot, next: Snapshot): string[] => {
  const toasts: string[] = [];
  if (prev.isOn !== next.isOn) toasts.push(`Autonomy ${next.isOn ? "ON" : "OFF"}`);
  const before = prev.goal?.status;
  const goal = next.goal;
  if (goal === null || before === goal.status) return toasts;
  if (goal.status === "escalated") toasts.push(`Ship escalated: ${goal.reason || "no reason given"}`);
  if (goal.status === "done") toasts.push(`Goal done: PR${prLabel(goal)} merged`);
  return toasts;
};

const resolveScript = (root: string): string => {
  const installed = join(homedir(), ".config", "opencode", "scripts", "agent-harness", "autonomy.sh");
  return existsSync(installed) ? installed : join(root, "scripts", "agent-harness", "autonomy.sh");
};

const tui: TuiPlugin = async (api) => {
  const root = api.state.path.worktree;
  const dir = goalsDir(root);
  const [snapshot, setSnapshot] = createSignal<Snapshot>(readSnapshot(root, dir));

  const refresh = (): void => {
    const prev = snapshot();
    const next = readSnapshot(root, dir);
    setSnapshot(next);
    for (const message of toastsFor(prev, next)) {
      api.ui.toast({ variant: next.goal?.status === "escalated" ? "error" : "info", message });
    }
  };

  const timer = setInterval(refresh, REFRESH_MS);
  api.lifecycle.onDispose(() => clearInterval(timer));

  const toggle = (): void => {
    const mode = snapshot().isOn ? "off" : "on";
    execFile(
      "bash",
      [resolveScript(root), mode],
      { cwd: root, env: { ...process.env, CLAUDE_PROJECT_DIR: root } },
      (error, _stdout, stderr) => {
        if (error) {
          api.ui.toast({ variant: "error", message: stderr.trim() || error.message });
          return;
        }
        refresh();
      },
    );
  };

  api.command.register(() => [
    {
      title: "Toggle autonomous mode",
      value: "autonomy-toggle",
      category: "harness",
      keybind: "<leader>u",
      slash: { name: "autonomy-toggle" },
      onSelect: toggle,
    },
  ]);

  api.slots.register({
    order: 10,
    slots: {
      sidebar_content: (ctx: TuiSlotContext) => {
        const theme = ctx.theme.current;
        return (
          <box flexDirection="column" paddingLeft={1} paddingRight={1}>
            <text
              fg={theme.background}
              bg={snapshot().isOn ? theme.success : theme.textMuted}
            >
              {snapshot().isOn ? " ● AUTONOMOUS " : " ○ manual "}
            </text>
            <Show when={snapshot().goal}>
              {(goal) => (
                <>
                  <text fg={theme.textMuted}>{`${clip(goal().goal)}${prLabel(goal()) === "" ? "" : ` PR${prLabel(goal())}`}`}</text>
                  <text fg={theme.textMuted}>
                    {`fix ${goal().fixIterations}/${goal().maxFixIterations}`}
                  </text>
                  <Show when={goal().status !== "active"}>
                    <text fg={goal().status === "escalated" ? theme.error : theme.textMuted}>
                      {goal().status === "escalated" && goal().reason !== ""
                        ? `escalated: ${goal().reason}`
                        : goal().status}
                    </text>
                  </Show>
                </>
              )}
            </Show>
          </box>
        );
      },
    },
  });
};

export default {
  id: "autonomy-status",
  tui,
};
