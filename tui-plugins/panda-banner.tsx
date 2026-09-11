/** @jsxImportSource @opentui/solid */
import { For } from "solid-js";
import type { TuiPlugin, TuiSlotContext, TuiThemeCurrent } from "@opencode-ai/plugin/tui";

interface Segment {
  text: string;
  fg: string;
}

// Cursor IDE dark palette (from cursor.vim)
const COLOR_WHITE = "#ffffff";     // Crisp white fur
const COLOR_LIGHT = "#cccccc";     // Soft white / highlight
const COLOR_DIM = "#6e7681";       // Shading (░, ▒) and borders
const COLOR_DARK = "#2b2b2b";      // Dark ears, eye patches, and nose
const COLOR_PUPIL = "#9cdcfe";     // Glowing pupil accent

// Panda Banner: exactly 71 columns wide per row for stable, centered terminal rendering
const BANNER_ROWS: Segment[][] = [
  // 0: Panda Braille art - line 0
  [
    { text: "⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⠿⠿⠛⠿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⠿⠟⠿⠿⢿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿", fg: COLOR_WHITE },
  ],
  // 1: Panda Braille art - line 1
  [
    { text: "⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⠟⠁⠀⠀⠀⠀⠀⠀⠹⣿⡿⠿⠿⠛⠛⠛⠙⠙⠛⠛⠻⠿⠿⣿⡟⠁⠀⠀⠀⠀⠀⠈⠙⢿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿", fg: COLOR_WHITE },
  ],
  // 2: Panda Braille art - line 2
  [
    { text: "⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⠏⠀⠀⠀⠀⠀⠀⠀⠀⢀⣠⣤⣶⣿⣿⣿⣿⣿⣿⣿⣿⣿⣷⣦⣤⣀⠀⠀⠀⠀⠀⠀⠀⠀⠈⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿", fg: COLOR_WHITE },
  ],
  // 3: Panda Braille art - line 3
  [
    { text: "⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⠀⠀⠀⠀⠀⠀⠀⣠⣾⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣷⣦⡀⠀⠀⠀⠀⠀⠀⢸⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿", fg: COLOR_WHITE },
  ],
  // 4: Panda Braille art - line 4
  [
    { text: "⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⡄⠀⠀⠀⠀⢠⣾⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣦⠀⠀⠀⠀⠀⣾⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿", fg: COLOR_WHITE },
  ],
  // 5: Panda Braille art - line 5
  [
    { text: "⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣷⣄⡀⠀⣠⣿⣿⣿⣿⣿⠿⠛⠛⠛⢿⣿⣿⣿⣿⣿⡿⠛⠛⠛⠻⢿⣿⣿⣿⣿⣧⠀⢀⣀⣼⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿", fg: COLOR_WHITE },
  ],
  // 6: Panda Braille art - line 6
  [
    { text: "⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⡟⢠⣿⣿⣿⣿⠟⠁⠀⠀⠠⠀⢸⣿⣿⣿⣿⣿⡇⠀⠀⠄⠀⠀⠙⣿⣿⣿⣿⣇⠘⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿", fg: COLOR_WHITE },
  ],
  // 7: Panda Braille art - line 7
  [
    { text: "⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⠃⣾⣿⣿⣿⣿⠀⠀⠀⠀⠀⢠⡟⠉⠁⠀⠀⠈⠛⡂⠀⠀⠀⠀⠀⢸⣿⣿⠿⠛⠀⠈⠋⠉⠙⠿⢿⣿⣿⣿⣿⣿⣿⣿", fg: COLOR_WHITE },
  ],
  // 8: Panda Braille art - line 8
  [
    { text: "⣿⣿⣿⣿⣿⣿⣿⣿⡿⠟⠛⠛⠟⠸⣿⣿⣿⣿⣿⠀⠀⠀⠀⠀⣿⣧⣄⠀⠀⠀⢀⣴⣿⡆⠀⠀⠀⠀⢸⣿⠀⠀⠀⢰⡆⠀⣶⠀⠀⠀⠈⣿⣿⣿⣿⣿⣿", fg: COLOR_WHITE },
  ],
  // 9: Panda Braille art - line 9
  [
    { text: "⣿⣿⣿⣿⣿⣿⡟⠁⠀⠀⠀⠀⠀⠀⠀⠉⠻⣿⣿⣆⠀⠀⣀⣴⣿⡛⠿⡿⠃⢻⣿⠟⣿⣷⣄⠀⠀⣠⣿⡇⠀⠸⠂⠀⣀⣀⣀⠀⠺⠂⠀⢸⣿⣿⣿⣿⣿", fg: COLOR_WHITE },
  ],
  // 10: Panda Braille art - line 10
  [
    { text: "⣿⣿⣿⣿⣿⣿⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠹⣿⣿⣿⣿⣿⣿⣿⣿⣷⣶⣾⣶⣶⣿⣿⣿⣿⣿⣿⣿⣿⣷⠀⠀⠠⣾⣿⣿⣿⣷⠀⠀⠀⢸⣿⣿⣿⣿⡿", fg: COLOR_WHITE },
  ],
  // 11: Panda Braille art - line 11
  [
    { text: "⣤⣤⣤⣤⣤⣤⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣤⣤⣤⣤⣤⣤⣤⣤⣤⣤⣤⣤⣤⣤⣤⣤⣤⣤⣤⣤⣤⣤⣤⣤⣤⣤⣤⣤⣤⣤⣤⣤⣤⣤⣤⣤⣤⣤", fg: COLOR_WHITE },
  ],
  // 12: Panda Braille art - line 12
  [
    { text: "⣿⣿⣿⣿⣿⣿⣧⣤⣄⡀⠀⠀⠀⠀⠀⣠⣤⣾⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿", fg: COLOR_WHITE },
  ],
  // 13: Panda Braille art - line 13
  [
    { text: "⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣷⣿⣷⣶⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿", fg: COLOR_WHITE },
  ],
  // 14: Spacing row
  [
    { text: "                                                                       ", fg: COLOR_DIM },
  ],
  // 15: Stylized "OPENCODE" FIGlet title - line 0
  [
    { text: "  ██████╗ ██████╗ ███████╗███╗   ██╗", fg: COLOR_WHITE },
    { text: " ██████╗  ██████╗ ██████╗ ███████╗ ", fg: COLOR_LIGHT },
  ],
  // 16: Stylized "OPENCODE" FIGlet title - line 1
  [
    { text: " ██╔═══██╗██╔══██╗██╔════╝████╗  ██║", fg: COLOR_WHITE },
    { text: "██╔════╝ ██╔═══██╗██╔══██╗██╔════╝ ", fg: COLOR_LIGHT },
  ],
  // 17: Stylized "OPENCODE" FIGlet title - line 2
  [
    { text: " ██║   ██║██████╔╝█████╗  ██╔██╗ ██║", fg: COLOR_WHITE },
    { text: " ██║      ██║   ██║██║  ██║█████╗  ", fg: COLOR_LIGHT },
  ],
  // 18: Stylized "OPENCODE" FIGlet title - line 3
  [
    { text: " ██║   ██║██╔═══╝ ██╔══╝  ██║╚██╗██║", fg: COLOR_WHITE },
    { text: " ██║      ██║   ██║██║  ██║██╔══╝  ", fg: COLOR_LIGHT },
  ],
  // 19: Stylized "OPENCODE" FIGlet title - line 4
  [
    { text: " ╚██████╔╝██║     ███████╗██║ ╚████║", fg: COLOR_WHITE },
    { text: "╚██████╗ ╚██████╔╝██████╔╝███████╗ ", fg: COLOR_LIGHT },
  ],
  // 20: Stylized "OPENCODE" FIGlet title - line 5
  [
    { text: "  ╚═════╝ ╚═╝     ╚══════╝╚═╝  ╚═══╝", fg: COLOR_WHITE },
    { text: " ╚═════╝  ╚═════╝ ╚═════╝ ╚══════╝ ", fg: COLOR_LIGHT },
  ],
  // 21: Subtitle / tagline
  [
    { text: "                ◈    ", fg: COLOR_LIGHT },
    { text: "· p a n d a   e d i t i o n ·", fg: COLOR_DIM },
    { text: "    ◈                ", fg: COLOR_LIGHT },
  ],
];

const PandaHomeBanner = (_props: { theme: TuiThemeCurrent }) => {
  return (
    <box width="100%" flexDirection="column" alignItems="center">
      <For each={BANNER_ROWS}>
        {(row) => (
          <box flexDirection="row">
            <For each={row}>
              {(seg) => <text fg={seg.fg}>{seg.text}</text>}
            </For>
          </box>
        )}
      </For>
    </box>
  );
};

const tui: TuiPlugin = async (api) => {
  api.slots.register({
    order: 1,
    slots: {
      home_logo: (ctx: TuiSlotContext) => <PandaHomeBanner theme={ctx.theme.current} />,
    },
  });
};

export default {
  id: "panda-banner",
  tui,
};
