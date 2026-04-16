/** @jsxImportSource @opentui/solid */
/**
 * Caveman TUI Plugin
 *
 * Shows 🗿 ULTRA 🗿 in sidebar.
 * Caveman skill is auto-invoked by caveman-server.ts on session start.
 */

import { createMemo } from "solid-js";

import type { TuiPlugin, TuiThemeCurrent } from "@opencode-ai/plugin/tui";

const CavemanSidebar = (props: {
  theme: TuiThemeCurrent;
}) => {
  const color = createMemo(() => props.theme.textMuted);

  return (
    <box width="100%" flexDirection="row" justifyContent="center">
      <text fg={color()}>🗿 ULTRA 🗿</text>
    </box>
  );
};

const tui: TuiPlugin = async (api) => {
  // Sidebar slot — always visible, skill is auto-invoked on session start
  api.slots.register({
    order: 10,
    slots: {
      sidebar_content: (ctx: { theme: { current: TuiThemeCurrent } }) => (
        <CavemanSidebar theme={ctx.theme.current} />
      ),
    },
  });
};

export default {
  id: "caveman",
  tui,
};
