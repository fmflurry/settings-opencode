# autonomy-status

Claude Code mod that shows the autonomous-mode and ship-goal status.

## Data

Read relative to the session's project root (`$.session.root()`):

- `.claude/agent-harness.json` or a `.claude/state/` directory marks a harness-aware repo (shows `○ manual` when autonomy is off).
- `.claude/state/autonomy.on` present means autonomy is ON.
- `.claude/state/goal.json` holds the ship goal (`status` is `active`, `escalated` or `done`).

Outside a harness-aware repo (none of the three exist) the mod shows nothing.

## Surfaces

- Status line: `● AUTO · ship #48 · fix 2/5`, or `○ manual`.
- Band above the prompt, shown while autonomy is on, or a goal is active or escalated, or a goal finished during this session: `AUTONOMOUS` badge, clipped goal, `PR #n`, status (with the reason when escalated), `fix i/max`, `stop blocks n`.
- `/autonomy-status`: multi-line summary of every field.
- Toasts on transition: escalated, done, autonomy toggled on or off.

State refreshes every 3 s, on prompt submit and after each tool call.

## Colors

Palette from the community "Cursor Dark Theme" (publisher flawlessnitin), file `themes/my-custom-theme-color-theme.json` of https://github.com/flawlessnitin/cursor-theme, theme label "Cursor Dark Theme".

| Role | Hex | Theme key |
| --- | --- | --- |
| Accent: badge background (ON), active, PR | `#4c9df3` | `button.background`, `textLink.foreground` |
| Badge text | `#141414` | `terminal.background` |
| Done | `#a3be8c` | `terminal.ansiGreen` |
| Escalated | `#bf616a` | `terminal.ansiRed`, `errorForeground` |
| Muted text | `#828282` | `sideBar.foreground` (`#cccccc99`) flattened over `#141414` |

The theme defines no `descriptionForeground`, so muted text uses the flattened `sideBar.foreground`, VS Code's own description-text fallback tier. `focusBorder` is transparent in this theme, so the accent comes from the button and link blue. The palette lives in one const, `PALETTE`, in `hooks/model.ts`.

## Checks

```
claude plugin validate .
claude plugin test .
```
