---
name: show-me
description: Help the user understand the current topic visually. Produces a self-contained HTML file by default (diagrams, infographics, short slide decks), renders PNG screenshots of it, and shows them in the host, because terminal-rendered diagrams read poorly. Use when the user says "show me", "visualize", "diagram this", "draw it", "explain visually", or when a topic is too dense for prose.
---

Help the user understand the current topic of conversation visually. Skip the preamble and keep prose brief.

## Default: write an HTML file and open it

Terminal-rendered diagrams read poorly. So unless an exception below applies, produce **one self-contained HTML file**, check it, then follow "Then screenshot and show it" below.

- Path: `/tmp/show-me-{slug}.html`, where `{slug}` is 2-4 kebab-case words naming the topic.
- `/tmp` is the default so the repo working tree stays clean. Write inside the repo only when the user asks to keep the artifact; then `docs/` or the path they name.
- When the host has an attach-files tool (e.g. `openbot.attach_files_to_response`), the app may not read `/tmp`. Write `~/OpenBot/Shared/show-me/show-me-{slug}.html` instead, running `mkdir -p` on that directory when it is missing. Detect the tool by its presence in your tool list.

### Hard constraints on the HTML

- **Zero network dependencies.** No CDN, no Mermaid script, no Google Fonts, no external CSS or JS. The file must render fully offline. A CDN-loaded diagram library renders as a blank box on a flaky network — build diagrams from plain HTML + CSS instead (flexbox/grid boxes, CSS borders, unicode arrows `▶ ▼ └ ├ ──`).
- Single file. Inline `<style>` in `<head>`; inline `<script>` only if interaction genuinely helps.
- Match the product's colors, type, spacing, and components. Real labels and real data — never `foo`/`bar` placeholders.
- Responsive: readable at desktop width and on mobile. At least one `@media` breakpoint collapsing multi-column layouts to a single stack.
- Monospace blocks for code, trees, and pseudocode; keep them visually distinct from prose.

### Pick the smallest form that makes the point

- **Diagram** — one relationship, flow, or failure chain.
- **Infographic** — several linked facts that need ranking or comparison.
- **Short slide deck** — a sequence that only makes sense in order.

## Exceptions — answer inline in chat instead

Skip the file only when:

- The user asks for inline output ("inline", "in chat", "no file", "just paste it").
- The whole answer is a copyable snippet or diff under ~10 lines.
- The user is mid-flow and asked a yes/no or one-symbol question.

When inline, a fenced Mermaid block is fine — chat renders it. Never put Mermaid inside the HTML file.

## Content vocabulary

These are the shapes to render — inside the HTML by default, or fenced in chat when an exception applies. Use one or two; using all of them is a sign the view is too big.

Logic or an algorithm as pseudocode:

```text
on(save)
  if content is unchanged
    return cached result
  write new content
  return fresh result
```

Runtime control flow as a call tree:

```text
submitForm
  createSession
    persistPrompt
    launchAgent
  navigateToSession
```

UI structure as a component tree, including state and module boundaries that matter:

```tsx
<SessionPage> (apps/example/src/routes/session.tsx)
  useSessionEvents()
  <SessionToolbar>
    <RunSkillButton> (packages/ui)
```

File responsibility or a broad refactor as a shallow file tree:

```text
src/
├── commands/       # parses user actions
├── sessions/       # owns session state
└── transport/      # sends API requests
```

Component interaction, control flow, or data flow as a flow or sequence — hand-built boxes and arrows in the HTML, Mermaid when inline:

```mermaid
sequenceDiagram
    participant User
    participant UI
    participant Daemon
    User->>UI: choose command
    UI->>Daemon: send expanded prompt
    Daemon-->>UI: stream result
```

Use a **diff** when the point is what changes and the surrounding shape already exists. Match the diff shape to the topic — component change, file layout, call tree, or control flow:

```diff
 on(save)
-  write content
+  if content is unchanged
+    return cached result
+  write new content
+  invalidate cache
```

Show the **whole block** when most of it is new, when omitted context would hide ownership or order, or when the user needs a copyable target shape:

```ts
function expandSkill(command: string): string {
  const skillName = command.slice(1);
  return `use the ${skillName} skill`;
}
```

## Guidance

Place each visual next to the short text it supports. Keep only the calls, files, props, states, and boundaries needed to answer the user's current question or to resolve the current discussion point. Cutting detail is the job — an exhaustive diagram answers nothing.

## Before opening the file

- Renders with the network off — no external `src`/`href`.
- Every label is a real name from this codebase or conversation.
- One `@media` breakpoint present; no horizontal scroll on mobile.
- Smallest form that makes the point; nothing decorative survived.

## Then screenshot and show it

Skip this section when an exception above applies.

1. Screenshot: `bash <this skill's directory>/scripts/screenshot.sh <html>`. It writes `<name>.png` (1280 wide, full page height) and `<name>-390.png` (phone, only when the layout differs) next to the HTML, then prints their paths. It tries Playwright chromium, then Chrome/Chromium, then Firefox, and never downloads a browser. Full height: a measure pass reads the page height, then a capture renders at that height, capped at 12000px.
2. If it prints no path, the reason is on stderr. Say so in one line and continue with the HTML only. Never fail the skill over a screenshot.
3. When the host has an attach-files tool, attach the PNG(s) and the HTML before the final answer so the user sees the image in the app (e.g. `openbot.attach_files_to_response`). Inside OpenBot, `openbot.html_render` may also give an inline view.
4. Open the HTML for the user with this block. It skips silently on hosts without a display:

   ```bash
   if [ "$(uname)" = Darwin ]; then
     open "<html>"
   elif [ -n "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ]; then
     xdg-open "<html>" >/dev/null 2>&1 &
   fi
   ```

5. Chat: 1-3 lines. Say what the visual shows, then the paths (HTML and PNGs). Do not paste the HTML.
