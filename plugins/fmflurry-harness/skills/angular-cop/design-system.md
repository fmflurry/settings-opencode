# angular-cop / design-system — Kourou v0 Token Enforcement

Canonical severity mapping for design-system violations in component templates, styles, and generated classes.

**Scope:** Applied to `*.component.html`, `*.component.ts`, `*.component.css`, and any file containing Tailwind classes or inline styles.

---

## Token Inventory — Severity & Detection

### BLOCK (🟢 fix-before-merge)

> Any single finding here must be fixed before the PR merges. Likely an oversight or auto-generated mistake.

| Violation | Detection | Why | Severity |
|-----------|-----------|-----|----------|
| Raw `--k-*` base-scale color in class/style | `grep -nE 'var\(--k-' *.html *.ts *.css` · `style=".*var\(--k-` | Base scale is internal; semantic aliases exist for all cases. Mixing base scale and semantic breaks consistency and dark-mode overrides. | 🟢 |
| Stock Tailwind palette literal (`lime-*` / `stone-*` / `violet-*`) | `grep -nE 'class="[^"]*\b(violet|green|lime|stone|amber)-[0-9]' *.html` | These colors are NOT in the Kourou palette. Use semantic aliases: `bg-primary` (brand green), `bg-accent` (deep brand green, AI only), `bg-foreground` (warm near-black). | 🟢 |
| Hex color literal in class/style | `grep -nE 'class="[^"]*\b#[0-9a-fA-F]{3,8}\b' \|` `style=".*#[0-9a-fA-F]' ` | All colors must flow through theme aliases. No hardcoded hex. | 🟢 |
| Accent on human/action surface | Code review: Button, tab, form control using `bg-accent`/`border-accent`/`text-accent` (must be human-facing, not AI-only). Grep: `class=".*\b(bg-accent|text-accent)\b"` in non-agent component. | `accent` is AI/intelligence only — deep brand green. Human controls use `primary`. Violet has been removed from the palette entirely. | 🟢 |
| Inline gradient with `var(--k-*)` | `grep -nE 'style=".*linear-gradient.*var\(--k-' *.html *.ts` | Base-scale vars cannot be inlined; they don't override dark mode. Create a named utility in `theme.css` instead. | 🟢 |
| `--gc-*` chrome colors on product surface | Grep `bg-gc-*` / `text-gc-*` in non-brand/non-chrome component | GC brand palette is for sidebar chrome only, never product UI. Use `bg-primary`, `bg-accent`, etc. | 🟢 |

### SHOULD (🔵 nit or ❓ q)

> Advisory. Fix when practical; do not block the PR on these alone unless AGENTS.md flags the category as mandatory.

| Violation | Detection | Why | Severity |
|-----------|-----------|-----|----------|
| Arbitrary value w/ EXACT token equivalent | `grep -nE 'class="[^"]*\b(text-\[15px\]|text-\[18px\]|text-\[24px\]|text-\[32px\]|max-w-\[1200px\]|p-\[24px\]|p-\[16px\]|h-\[36px\]|h-\[28px\]|h-\[44px\])' *.html` | Token exists and is semantic; arbitrary syntax adds noise and blocks dark-mode overrides. | 🔵 fix-in-polish |
| Off-grid spacing (no exact token) | `grep -nE 'class="[^"]*\b(px?\|m)\-\[[0-9]+px\]' *.html` where value ∉ {4,8,12,16,20,24,32,40,48,64} | One-off sizing without a token is acceptable if justified. Mark as ❓ q for reviewer decision. | ❓ q |
| Arbitrary type size (no exact token) | `text-[13.5px]`, `text-[17px]` (not in {11,12,13,14,15,18,24,32}) | Off-scale type breaks hierarchy and dark-mode sync. Likely a token should be added. | ❓ q |
| Arbitrary radius (no exact token) | `rounded-[10px]`, `rounded-[14px]` (not in {6,8,12,16}) | Radius has finite scale; off-scale is rare. Acceptable if documented. | ❓ q |

---

## Detection Greps (Quick Copy-Paste)

Use in code review or as linting seeds:

```bash
# Raw base-scale vars
grep -rn 'var(--k-' frontend/src/

# Stock Tailwind palette
grep -rE '\b(violet|blue|slate|indigo)-[0-9]' frontend/src/*.html frontend/src/*.ts

# Hex colors
grep -rE '#[0-9a-fA-F]{3,8}' frontend/src/*.html frontend/src/*.css

# Arbitrary type sizes with tokens
grep -rE '\btext-\[(15|18|24|32)px\]' frontend/src/

# Arbitrary spacing with tokens
grep -rE '\b(p|m)-\[(16|24)px\]' frontend/src/

# Arbitrary height with tokens
grep -rE '\bh-\[(28|36|44)px\]' frontend/src/

# Max width with token
grep -rE '\bmax-w-\[1200px\]' frontend/src/

# Inline gradients with --k-*
grep -rE 'linear-gradient.*var\(--k-' frontend/src/
```

---

## Token-to-Utility Mapping (Reference)

All equivalences from `frontend/src/styles/theme.css` + `tokens/*.css`:

### Type (Composite Utilities)

| Need | Utility | Pixels | Weight | Line | Tracking |
|------|---------|--------|--------|------|----------|
| Display | `text-display` | 32px | 600 | 40px | -0.025em |
| H1 | `text-h1` | 24px | 600 | 32px | -0.02em |
| H2 | `text-h2` | 18px | 600 | 26px | 0 |
| H3 | `text-h3` | 15px | 600 | 22px | 0 |
| Body | `text-body` | 14px | 400 | 22px | 0 |
| Body Small | `text-body-sm` | 13px | 400 | 20px | 0 |
| Caption | `text-caption` | 12px | 400 | 18px | 0 |
| Label | `text-label` | 12px | 600 | 16px | 0 |
| Overline | `text-overline` | 11px | 600 | 16px | +0.06em |
| Numeric | `text-numeric` | 14px | 400 | 20px | monospace + tnum |
| KPI | `text-kpi` | 24px | 500 | 32px | monospace + tnum |

### Colors (Semantic Aliases)

| Category | Utilities | CSS Var |
|----------|-----------|---------|
| **Surfaces** | `bg-background`, `bg-card`, `bg-popover`, `bg-surface-app`, `bg-surface-page`, `bg-surface-sunken`, `bg-surface-inverse` | `--background`, `--card`, `--surface-*` |

`bg-surface-page` is the **landing's** sand; `bg-surface-app` is the **application's** neutral page background (authenticated screens and auth cards). Do not use the sand inside the app — it reads as a yellow wash at page scale.
| **Text** | `text-foreground`, `text-foreground-inverse` | `--foreground`, `--foreground-inverse` |
| **Muted** | `bg-muted`, `text-muted-foreground`, `text-placeholder` | `--muted`, `--muted-foreground`, `--placeholder` |
| **Primary (Human)** | `bg-primary`, `text-primary-foreground`, `bg-primary-soft`, `bg-primary-hover` | `--primary`, `--primary-foreground`, `--primary-soft`, `--primary-hover` |
| **Secondary** | `bg-secondary`, `text-secondary-foreground`, `bg-secondary-hover` | `--secondary`, `--secondary-foreground`, `--secondary-hover` |
| **Accent (AI)** | `bg-accent`, `text-accent-foreground`, `bg-accent-soft`, `bg-accent-subtle`, `border-accent-border`, `bg-accent-hover`, `bg-accent-strong` | `--accent`, `--accent-foreground`, `--accent-soft`, `--accent-subtle`, `--accent-border`, `--accent-hover`, `--accent-strong` |
| **Status: Success** | `bg-success`, `text-success-foreground`, `bg-success-soft` | `--success`, `--success-foreground`, `--success-soft` |
| **Status: Warning** | `bg-warning`, `text-warning-foreground`, `bg-warning-soft`, `border-warning-border` | `--warning`, `--warning-foreground`, `--warning-soft`, `--warning-border` |
| **Status: Destructive** | `bg-destructive`, `text-destructive-foreground`, `bg-destructive-soft`, `border-destructive-border`, `bg-destructive-strong` | `--destructive`, `--destructive-foreground`, `--destructive-soft`, `--destructive-border`, `--destructive-strong` |
| **Borders** | `border-border`, `border-border-subtle`, `border-border-strong` | `--border`, `--border-subtle`, `--border-strong` |
| **Input** | `bg-input` | `--input` |
| **Ring** | `ring-ring`, `ring-offset-ring-soft` | `--ring`, `--ring-soft` |
| **Chart** | `bg-chart-1` through `bg-chart-5` | `--chart-1` through `--chart-5` |
| **Sidebar** | `bg-sidebar`, `text-sidebar-foreground`, `bg-sidebar-primary`, `text-sidebar-primary-foreground`, `bg-sidebar-accent`, `text-sidebar-accent-foreground`, `border-sidebar-border`, `ring-sidebar-ring` | `--sidebar-*` |

### Spacing (Grid + Named)

| Category | Utilities |
|----------|-----------|
| **4px Grid** | `p-1`, `p-2`, `p-3`, `p-4`, `p-5`, `p-6`, `p-8`, `p-10`, `p-12`, `p-16` (4px, 8px, 12px, 16px, 20px, 24px, 32px, 40px, 48px, 64px) |
| **Named Padding** | `p-card` (24px), `p-card-sm` (16px) |
| **Control Heights** | `h-control` (36px), `h-control-sm` (28px), `h-control-lg` (44px) |
| **Content Width** | `max-w-content` (1200px) |
| **App Chrome** | `h-topbar` (56px), `w-sidebar` (220px), `w-copilot` (320px) |

### Radius

| Utility | Value |
|---------|-------|
| `rounded-sm` | 6px |
| `rounded-md` | 8px |
| `rounded-lg` | 12px |
| `rounded-xl` | 16px |

### Shadow (Elevation)

| Utility | Purpose |
|---------|---------|
| `shadow-1` | Field / subtle |
| `shadow-2` | Card / standard |
| `shadow-3` | Popover / emphasis |
| `shadow-4` | Modal / maximum |
| `shadow-focus` | Focus ring (0 0 0 2px of ring-soft) |

---

## Reviewing Components

**Pipeline:**

1. Open template file (`*.component.html`).
2. Scan for class attributes containing arbitrary brackets or raw `--k-*` refs.
3. Check component `.ts` for inline `style` or `ngStyle` with color/spacing.
4. Verify any AI-facing surfaces use `accent` (deep brand green); all human controls use `primary` (brand green).
5. Look for off-grid spacing/type. If no token maps exactly, decide: fix (🟢) or note as deliberate (❓ q).

**Example findings:**

```html
<!-- 🟢 BLOCK: stock Tailwind palette -->
<button class="bg-lime-500">Submit</button>  <!-- → bg-primary -->

<!-- 🟢 BLOCK: raw base scale -->
<div style="background: var(--k-sand-50)">Card</div>  <!-- → bg-surface-page -->

<!-- 🟢 BLOCK: hex color -->
<span class="text-[#86B81C]">Label</span>  <!-- → text-primary or semantic alias -->

<!-- 🔵 NITS: exact token equivalents (fix in polish) -->
<h1 class="text-[32px]">Title</h1>  <!-- → text-display -->
<div class="p-[24px]">Card</div>  <!-- → p-card -->

<!-- ❓ Q: off-grid, no equiv (author decides) -->
<div class="p-[18px]">Maybe special case?</div>  <!-- nit; doc if intentional -->
<span class="rounded-[10px]">Border?</span>  <!-- nit; likely rounded-md (8px) intended -->
```
