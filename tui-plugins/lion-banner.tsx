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

// Panda Banner: exactly 69 columns wide per row for stable, centered terminal rendering
const BANNER_ROWS: Segment[][] = [
  // 0: Ears top
  [
    { text: "                  ", fg: COLOR_DIM },
    { text: "██████", fg: COLOR_DARK },
    { text: "                     ", fg: COLOR_DIM },
    { text: "██████", fg: COLOR_DARK },
    { text: "                  ", fg: COLOR_DIM },
  ],
  // 1: Ears body
  [
    { text: "                 ", fg: COLOR_DIM },
    { text: "████████", fg: COLOR_DARK },
    { text: "                   ", fg: COLOR_DIM },
    { text: "████████", fg: COLOR_DARK },
    { text: "                 ", fg: COLOR_DIM },
  ],
  // 2: Ears, forehead crown
  [
    { text: "                ", fg: COLOR_DIM },
    { text: "██████████", fg: COLOR_DARK },
    { text: "    ", fg: COLOR_DIM },
    { text: "░░░░░░░░░", fg: COLOR_DIM },
    { text: "    ", fg: COLOR_DIM },
    { text: "██████████", fg: COLOR_DARK },
    { text: "                ", fg: COLOR_DIM },
  ],
  // 3: Ears, forehead
  [
    { text: "                 ", fg: COLOR_DIM },
    { text: "████████", fg: COLOR_DARK },
    { text: "  ", fg: COLOR_DIM },
    { text: "░░", fg: COLOR_DIM },
    { text: "███████████", fg: COLOR_WHITE },
    { text: "░░", fg: COLOR_DIM },
    { text: "  ", fg: COLOR_DIM },
    { text: "████████", fg: COLOR_DARK },
    { text: "                 ", fg: COLOR_DIM },
  ],
  // 4: Ears base, forehead
  [
    { text: "                   ", fg: COLOR_DIM },
    { text: "▓▓▓▓", fg: COLOR_DARK },
    { text: "   ", fg: COLOR_DIM },
    { text: "░", fg: COLOR_DIM },
    { text: "███████████████", fg: COLOR_WHITE },
    { text: "░", fg: COLOR_DIM },
    { text: "   ", fg: COLOR_DIM },
    { text: "▓▓▓▓", fg: COLOR_DARK },
    { text: "                   ", fg: COLOR_DIM },
  ],
  // 5: Upper face
  [
    { text: "                        ", fg: COLOR_DIM },
    { text: "░", fg: COLOR_DIM },
    { text: "███████████████████", fg: COLOR_WHITE },
    { text: "░", fg: COLOR_DIM },
    { text: "                        ", fg: COLOR_DIM },
  ],
  // 6: Face top with eye patch upper contours
  [
    { text: "                      ", fg: COLOR_DIM },
    { text: "░", fg: COLOR_DIM },
    { text: "████", fg: COLOR_WHITE },
    { text: "████", fg: COLOR_DARK },
    { text: "███████", fg: COLOR_WHITE },
    { text: "████", fg: COLOR_DARK },
    { text: "████", fg: COLOR_WHITE },
    { text: "░", fg: COLOR_DIM },
    { text: "                      ", fg: COLOR_DIM },
  ],
  // 7: Eye patches with eye pupils, cheeks
  [
    { text: "                     ", fg: COLOR_DIM },
    { text: "░", fg: COLOR_DIM },
    { text: "████", fg: COLOR_WHITE },
    { text: "██", fg: COLOR_DARK },
    { text: "█", fg: COLOR_PUPIL },
    { text: "█", fg: COLOR_WHITE },
    { text: "██", fg: COLOR_DARK },
    { text: "█████", fg: COLOR_WHITE },
    { text: "██", fg: COLOR_DARK },
    { text: "█", fg: COLOR_WHITE },
    { text: "█", fg: COLOR_PUPIL },
    { text: "██", fg: COLOR_DARK },
    { text: "████", fg: COLOR_WHITE },
    { text: "░", fg: COLOR_DIM },
    { text: "                     ", fg: COLOR_DIM },
  ],
  // 8: Eye patches, snout bridge
  [
    { text: "                     ", fg: COLOR_DIM },
    { text: "░", fg: COLOR_DIM },
    { text: "████", fg: COLOR_WHITE },
    { text: "██████", fg: COLOR_DARK },
    { text: "█████", fg: COLOR_WHITE },
    { text: "██████", fg: COLOR_DARK },
    { text: "████", fg: COLOR_WHITE },
    { text: "░", fg: COLOR_DIM },
    { text: "                     ", fg: COLOR_DIM },
  ],
  // 9: Eye patch bottom, cheeks
  [
    { text: "                     ", fg: COLOR_DIM },
    { text: "░", fg: COLOR_DIM },
    { text: "█████", fg: COLOR_WHITE },
    { text: "████", fg: COLOR_DARK },
    { text: "███████", fg: COLOR_WHITE },
    { text: "████", fg: COLOR_DARK },
    { text: "█████", fg: COLOR_WHITE },
    { text: "░", fg: COLOR_DIM },
    { text: "                     ", fg: COLOR_DIM },
  ],
  // 10: Nose top bridge, muzzle
  [
    { text: "                      ", fg: COLOR_DIM },
    { text: "░", fg: COLOR_DIM },
    { text: "██████████", fg: COLOR_WHITE },
    { text: "▄▄▄", fg: COLOR_DARK },
    { text: "██████████", fg: COLOR_WHITE },
    { text: "░", fg: COLOR_DIM },
    { text: "                      ", fg: COLOR_DIM },
  ],
  // 11: Nose body, cheeks
  [
    { text: "                       ", fg: COLOR_DIM },
    { text: "░", fg: COLOR_DIM },
    { text: "████████", fg: COLOR_WHITE },
    { text: "▀███▀", fg: COLOR_DARK },
    { text: "████████", fg: COLOR_WHITE },
    { text: "░", fg: COLOR_DIM },
    { text: "                       ", fg: COLOR_DIM },
  ],
  // 12: Muzzle / mouth, chin
  [
    { text: "                         ", fg: COLOR_DIM },
    { text: "░", fg: COLOR_DIM },
    { text: "████████", fg: COLOR_WHITE },
    { text: "▀", fg: COLOR_DARK },
    { text: "████████", fg: COLOR_WHITE },
    { text: "░", fg: COLOR_DIM },
    { text: "                         ", fg: COLOR_DIM },
  ],
  // 13: Chin jawline
  [
    { text: "                           ", fg: COLOR_DIM },
    { text: "░░", fg: COLOR_DIM },
    { text: "███████████", fg: COLOR_WHITE },
    { text: "░░", fg: COLOR_DIM },
    { text: "                           ", fg: COLOR_DIM },
  ],
  // 14: Spacing row
  [
    { text: "                                                                     ", fg: COLOR_DIM },
  ],
  // 15: Stylized "OPENCODE" FIGlet title - line 0
  [
    { text: " ██████╗ ██████╗ ███████╗███╗   ██╗", fg: COLOR_WHITE },
    { text: " ██████╗  ██████╗ ██████╗ ███████╗", fg: COLOR_LIGHT },
  ],
  // 16: Stylized "OPENCODE" FIGlet title - line 1
  [
    { text: "██╔═══██╗██╔══██╗██╔════╝████╗  ██║", fg: COLOR_WHITE },
    { text: "██╔════╝ ██╔═══██╗██╔══██╗██╔════╝", fg: COLOR_LIGHT },
  ],
  // 17: Stylized "OPENCODE" FIGlet title - line 2
  [
    { text: "██║   ██║██████╔╝█████╗  ██╔██╗ ██║", fg: COLOR_WHITE },
    { text: " ██║      ██║   ██║██║  ██║█████╗ ", fg: COLOR_LIGHT },
  ],
  // 18: Stylized "OPENCODE" FIGlet title - line 3
  [
    { text: "██║   ██║██╔═══╝ ██╔══╝  ██║╚██╗██║", fg: COLOR_WHITE },
    { text: " ██║      ██║   ██║██║  ██║██╔══╝ ", fg: COLOR_LIGHT },
  ],
  // 19: Stylized "OPENCODE" FIGlet title - line 4
  [
    { text: "╚██████╔╝██║     ███████╗██║ ╚████║", fg: COLOR_WHITE },
    { text: "╚██████╗ ╚██████╔╝██████╔╝███████╗", fg: COLOR_LIGHT },
  ],
  // 20: Stylized "OPENCODE" FIGlet title - line 5
  [
    { text: " ╚═════╝ ╚═╝     ╚══════╝╚═╝  ╚═══╝", fg: COLOR_WHITE },
    { text: " ╚═════╝  ╚═════╝ ╚═════╝ ╚══════╝", fg: COLOR_LIGHT },
  ],
  // 21: Subtitle / tagline
  [
    { text: "               ◈    ", fg: COLOR_LIGHT },
    { text: "· p a n d a   e d i t i o n ·", fg: COLOR_DIM },
    { text: "    ◈               ", fg: COLOR_LIGHT },
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
  id: "lion-banner",
  tui,
};
