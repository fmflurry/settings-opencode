/** @jsxImportSource @opentui/solid */
import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

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
  const status = STATUSES.find((one) => one === fields.status);
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

const readSnapshot = (root: string): Snapshot => {
  const stateDir = join(root, ".claude", "state");
  let goal: Goal | null = null;
  try {
    goal = parseGoal(readFileSync(join(stateDir, "goal.json"), "utf8"));
  } catch {
    goal = null;
  }
  return { isOn: existsSync(join(stateDir, "autonomy.on")), goal };
};

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
  const [snapshot, setSnapshot] = createSignal<Snapshot>(readSnapshot(root));

  const refresh = (): void => {
    const prev = snapshot();
    const next = readSnapshot(root);
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
            <text fg={snapshot().isOn ? theme.success : theme.textMuted}>
              {snapshot().isOn ? "● AUTO" : "○ manual"}
            </text>
            <Show when={snapshot().goal}>
              {(goal) => (
                <>
                  <text fg={theme.textMuted}>{clip(goal().goal)}</text>
                  <text fg={theme.textMuted}>
                    {`${goal().status === "active" ? "ship" : goal().status}${prLabel(goal())} · fix ${goal().fixIterations}/${goal().maxFixIterations}`}
                  </text>
                  <Show when={goal().status === "escalated" && goal().reason !== ""}>
                    <text fg={theme.error}>{goal().reason}</text>
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
