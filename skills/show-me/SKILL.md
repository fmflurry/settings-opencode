---
name: show-me
description: Help the user understand the current topic visually. Produces a self-contained offline HTML file (diagram, infographic, short slide deck, or statechart), renders PNG screenshots of it, and shows them in the host, because terminal-rendered diagrams read poorly. Use when the user says "show me", "illustre", "visualize", "diagram this", "explain visually", "/statechart" in a light explanatory sense, or when a topic is too dense for prose. For formal TLA+ checking, defer to pstack's /statechart instead of this skill.
---

Help the user understand the current topic of conversation visually. Skip the preamble and keep prose brief.

**v2 change:** when the topic is states, flows, lifecycles, workflows or protocols, prefer the **Statechart** form below. Its visual vocabulary (reader-facing labels, phase colors, `breaks` / `mayBreak` / `bugPath` marks, numbered bug paths) is adapted from [@poteto](https://x.com/poteto)'s `/statechart` skill in [backnotprop/pstack](https://github.com/backnotprop/pstack) (MIT License · Copyright 2026 Lauren Tan). Keep the MIT notice in any substantial copy of that vocabulary or CSS. This skill does **not** run TLC or Pele; it only borrows the chart language so show-me stays offline.

**Look (v2.1):** default to a warm, creamy, chill page — pleasant to read, never neon-dark unless the user asks for a dark theme.

## Default: write an HTML file, screenshot it, open it

Terminal-rendered diagrams read poorly. So unless an exception below applies, produce **one self-contained HTML file**, run the "Before opening the file" checklist, then follow "Then screenshot and show it" below.

- Path: `/tmp/show-me-{slug}.html`, where `{slug}` is 2-4 kebab-case words naming the topic.
- `/tmp` is the default so the repo working tree stays clean. Write inside the repo only when the user asks to keep the artifact; then `docs/` or the path they name.
- When the host has an attach-files tool (e.g. `openbot.attach_files_to_response`), the app may not read `/tmp`. Write `~/OpenBot/Shared/show-me/show-me-{slug}.html` instead, running `mkdir -p` on that directory when it is missing. Detect the tool by its presence in your tool list.

### Hard constraints on the HTML

- **Zero network dependencies.** No CDN, no Mermaid script, no Pele, no Google Fonts, no external CSS or JS. The file must render fully offline. A CDN-loaded diagram library renders as a blank box on a flaky network — build diagrams from plain HTML + CSS instead (flexbox/grid boxes, CSS borders, unicode arrows `▶ ▼ └ ├ ──`) or inline SVG. A tiny inline `<script>` is fine for hover or highlight of a bug path.
- Single file. Inline `<style>` in `<head>`; inline `<script>` only if interaction genuinely helps.
- Match the product's colors only when the topic is that product; otherwise use the cream look below. Real labels and real data — never `foo`/`bar` placeholders.
- Responsive: at least one `@media` breakpoint collapsing multi-column layouts to a single stack; no horizontal scroll on mobile.
- Monospace blocks for code, trees and pseudocode, visually distinct from prose.
- Write in the user's language; keep technical terms in English when they are proper nouns or code.
- Slide decks: stack the slides as sections in normal flow, with no `vh` heights or JS-driven one-slide view, so the full-page screenshot shows every slide.

### Cream look (default visual language)

Aim for a page you could read with coffee — soft paper, earthy accents, room to breathe.

```css
:root {
  --bg: #FAF6EE;          /* warm cream page */
  --bg-soft: #F3EDE0;     /* slightly deeper cream for wells */
  --card: #FFFcf6;        /* near-white card */
  --text: #3A342C;        /* soft charcoal-brown */
  --muted: #7A7164;       /* warm gray for secondary text */
  --line: #D9CFC0;        /* soft borders / arrows */
  --accent: #8B6F47;      /* muted clay / oak */
  --accent-2: #6B8F71;    /* sage */
  --accent-3: #C4A35A;    /* honey */
  --accent-4: #9B6B6B;    /* dusty rose (sparingly) */
  --shadow: 0 8px 28px rgba(58, 52, 44, 0.07);
  --radius: 16px;
  --serif: "Iowan Old Style", "Palatino Linotype", Palatino, "Book Antiqua",
           Georgia, "Times New Roman", serif;
  --sans: "Avenir Next", "Segoe UI", system-ui, -apple-system, sans-serif;
  --mono: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
}
body {
  background: var(--bg);
  color: var(--text);
  font-family: var(--serif);
  line-height: 1.55;
  max-width: 42rem;          /* comfortable measure for prose */
  margin-inline: auto;
  padding: 2rem 1.25rem 3.5rem;
}
/* Wide layouts (charts, comparison grids) may open to ~1100px;
   keep body prose columns ≤ ~42rem inside cards. */
.card {
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  padding: 1.15rem 1.25rem;
}
```

Rules of thumb:

- **Background** `#FAF6EE` (or nearby cream). Avoid pure white full-bleed and avoid dark navy unless requested.
- **Cards** rounded (`14–18px`), gentle shadow, thin soft border — never hard black outlines.
- **Type**: serif or humanist for titles and body; system stack only (offline). Sans for UI chrome and labels on dense charts. Mono only for code.
- **Measure**: ~60–75 characters for reading blocks; charts can span wider.
- **Whitespace**: generous padding; prefer gap over divider lines.
- **Arrows / edges**: stroke in `--line` or a muted sage/clay, ~1.5–2px, soft arrowheads — not neon.
- **Accents**: earthy clay, sage, honey, dusty rose. One accent family per page.
- **Statechart marks** keep their meaning but soften into the cream palette (see Statechart form).

### Pick the smallest form that makes the point

- **Diagram**: one relationship, flow, or failure chain.
- **Infographic**: several linked facts that need ranking or comparison.
- **Short slide deck**: a sequence that only makes sense in order.
- **Statechart**: the system moves between observable states; see below.

## Statechart form (show-me ∪ poteto /statechart)

Use this when the question is "how does this move?", "what can go wrong on the way?", or the topic is a lifecycle, sync/ingest pipeline, protocol, checkout, or any workflow with named phases.

A worked offline page is [references/statechart-example.html](references/statechart-example.html). Copy its structure, not its labels.

### What to draw

1. **States** labeled with what the *reader* can observe or cares about ("applying snapshot", "ready to retrieve") — not function or variable names (`_pull_and_apply`, `last_sha`).
2. **Arrows** labeled with the event as the reader sees it ("you run sync", "snapshot for HEAD"). Put a condition in brackets when it matters: `9 pm [if quiet]`.
3. **Phase / group colors** — cream-adapted soft fills (still distinct; adapted from pstack `references/render.md`):
   - teal `#D7E6DF` · blue `#D9E4F0` · orange `#F0E0D0` · yellow `#F2E8CC` · purple `#E6DDF0` · tan `#E8DFD4` · pink `#F0DDE4`
   - Text on phases stays `--text` (`#3A342C`).
4. **Marks** (use CSS classes; `!important` on fill/stroke so they win over phase color) — softened for cream:
   - `breaks` — fill `#F7E4E4`, stroke `#B85C5C`, text `#8A3A3A`
   - `mayBreak` — fill `#F7ECDD`, stroke `#C4873A`, text `#8A5A20`
   - `bugPath` — border `#5B7FA6`, 2.5px (muted steel blue)
   - `repeats` — optional; dashed `#8B6FA6` border
5. **Parallel regions** when two things are true at once (dashed soft frame, quiet uppercase mono title).
6. **Aim for ~20 arrows or fewer.** Merge states that act the same; drop resets that every state has. Never merge two states that break *different* rules.
7. **Bug-path hand-off** beside the chart: for each bug, one short block with (a) the rule in the reader's words, (b) the numbered path through state labels, (c) what the model or diagram leaves out.

### How to render (stay offline)

- Prefer **inline SVG** (rects + paths + markers) or HTML/CSS boxes with soft arrows.
- Do **not** embed Mermaid, Pele, or any CDN. show-me's offline rule wins.
- Include a small legend for phase colors and marks.
- Credit line in the page footer or subtitle: `Visual vocabulary adapted from @poteto's /statechart in backnotprop/pstack (MIT · Lauren Tan).`

### When *not* to use this form

- Pure ranking / comparison → Infographic.
- One linear failure chain with no phases → Diagram.
- The user wants a **machine-checked** TLA+ model and TLC counterexamples → hand off to pstack `/statechart` (needs network once for TLC/Java via mise; renders with Pele). show-me can still draw the resulting chart offline afterward if they paste the states.

## Exceptions — answer inline in chat instead

Skip the file only when:

- The user asks for inline output ("inline", "in chat", "no file", "just paste it").
- The whole answer is a copyable snippet or diff under ~10 lines.
- The user is mid-flow and asked a yes/no or one-symbol question.

When inline, a fenced Mermaid block is fine — chat renders it. Never put Mermaid inside the HTML file.

## Content vocabulary (use one or two)

- Pseudocode for logic or an algorithm.
- Call tree for runtime control flow.
- Component tree for UI structure, with the state and module boundaries that matter.
- Shallow file tree for file responsibilities or a broad refactor.
- Flow or sequence (hand-built boxes and arrows in HTML, Mermaid inline) for interactions and data flow.
- **Statechart** (HTML/SVG offline) for lifecycles, sync/ingest, protocols, and "show me the bug as a path".
- Diff when the point is what changes; the whole block when most of it is new.

Using every shape is a sign the view is too big.

## Guidance

Place each visual next to the short text it supports. Keep only the calls, files, props, states, and boundaries needed to answer the current question. Cutting detail is the job.

## Before opening the file

- Renders with the network off — no external `src`/`href`.
- Every label is a real name from this codebase or conversation (reader-facing wording of those names).
- One `@media` breakpoint present; no horizontal scroll on mobile.
- Cream look applied (or an explicit dark theme the user asked for, or the product's colors when the topic is that product).
- Smallest form that makes the point; nothing decorative survived.
- If Statechart: legend present, ≤ ~20 arrows, credit line to poteto/pstack MIT, and any `breaks` mark has a numbered path in the side panel.

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

## License note (required when shipping Statechart CSS/marks)

```
MIT License — Copyright (c) 2026 Lauren Tan
Permission notice from https://github.com/backnotprop/pstack/blob/main/LICENSE
must accompany substantial portions of the Software (including the mark/phase
color system adapted from skills/statechart/references/render.md).
```
