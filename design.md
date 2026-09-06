# Design system — i-clinic

Locked source of truth for this app's visual layer, per Hallmark's multi-page
`redesign` flow. Read this before touching any component's CSS. `docs/design.md`
is a pointer here, not a second copy.

Two prior passes shipped and were found wanting: v1 stripped every card and
read as "no design"; v2 brought cards back with drop-shadows and an indigo
accent but shipped a CSS Grid overflow bug and, per the user, still looked
templated. This is v3 — a deliberate theme pick (Hallmark's catalog "Cobalt"),
trimmed down to what an internal clinical ops tool actually needs.

## Genre

**Modern-minimal.** A daily-use operational tool for two roles (doctor,
receptionist) who scan and act, not read prose. No marketing surface exists
in this app — no hero, no testimonial, no pricing table, no footer. Hallmark's
21 macrostructures and nav/footer archetypes are built for marketing/content
pages and none apply here.

## Macrostructure — app pages

This app has exactly one page family: **app pages** (Reception, Consultation,
Billing, sign-in). The existing shell — a fixed sidebar nav rail + a working
content canvas, collapsing to a single header row on mobile — already *is*
this app's workbench structure. It is kept as-is; only its visual skin (color,
radius, depth, type) changes below. Hallmark's own rule for `design.md`-managed
projects: app pages must **not** use enrichment (hero art, demo video,
abstract background) — function carries the page. Per-page layout (two-pane
grid on Reception/Consultation, single-column form on sign-in) may differ;
the shell frame, token set, and type system may not.

## Theme — Cobalt, trimmed

Full catalog entry: `references/themes/cobalt.md` (modern-minimal rotation,
alongside Coral). Adopted wholesale: cool near-white paper (never pure white),
cool charcoal ink (never pure black), one electric-cobalt accent held under
5% of any screen, tight "ruler-drawn" radii, depth from a hairline border
rather than blur, and mono uppercase treatment for meta/numeric labels.

Rejected from the catalog entry, because they're marketing-page furniture
with no equivalent in an authenticated ops tool: the ⌘K command palette, the
live-code-demo hero, the full-bleed dark "graphite band," and status chips
styled like an API response (`200 OK`).

Also rejected: Cobalt's mandated Google Fonts CDN `<link>`. This app has a
standing zero-connectivity requirement (a clinic's network drops, the app
must keep rendering) — the reason `@fontsource/inter` was self-hosted in an
earlier pass. Space Grotesk and JetBrains Mono are self-hosted the same way
instead of linked from `fonts.googleapis.com`.

### Tokens (OKLCH)

```css
:root {
  --bg: oklch(98.2% 0.004 250);
  --surface: oklch(99.5% 0.002 250);
  --surface-2: oklch(95.5% 0.006 250);
  --border: oklch(90% 0.008 250);
  --border-strong: oklch(82% 0.012 250);

  --text: oklch(21% 0.02 260);
  --text-secondary: oklch(52% 0.02 260);
  --text-tertiary: oklch(68% 0.015 260);

  --accent: oklch(58% 0.20 256);       /* electric cobalt */
  --accent-hover: oklch(52% 0.21 256);
  --accent-active: oklch(45% 0.21 256);
  --accent-ink: oklch(99% 0 0);
  --accent-wash: oklch(58% 0.20 256 / 10%);
  --focus-ring: oklch(58% 0.20 256 / 35%);

  --danger: oklch(55% 0.22 25);
  --success: oklch(55% 0.14 155);
  --warning: oklch(65% 0.16 60);
  --staging-bg: oklch(45% 0.19 25);    /* distinct from --danger on purpose */

  --radius-card: 10px;   /* was 20px in v2 */
  --radius-input: 6px;   /* was 12px in v2 */
  --radius-pill: 999px;
}
```

Dark is a secondary theme reachable only via explicit `data-theme="dark"`
(no OS-preference auto-switch — that was the root cause of the very first
"black canvas" complaint this app ever got). Same token names, same hue
angles, lifted lightness curve.

**Depth: borders, not blur.** No card in this app carries a `box-shadow`.
Grouping reads from a 1px `--border` plus the surface/bg contrast alone.

## Typography

- **Display** (`--font-display`): Space Grotesk — headings only (`h1/h2/h3`,
  `.form-heading`, `.signin-heading`).
- **Body** (`--font`): Inter — everything else. Unchanged from v2.
- **Mono** (`--font-mono`): JetBrains Mono — reserved for two things only:
  tabular numeric displays (token numbers, elapsed-wait minutes, money) and
  uppercase eyebrow labels (`.readout-heading`, `.flow-stat-label`). Nothing
  else gets the mono face — it's a signal, not a decoration.
- Headings stay roman. No italics anywhere in headings or display type.

## Spacing / Motion

Unchanged from v2: the existing `--space-2xs` … `--space-xl` scale, and the
existing `motion/react` usage in `TokenList.tsx` (row enter/exit on the live
queue). No new motion library — `motion` is already installed and is the
correct choice per this project's own library precedence rules. No new
animation is added anywhere else; this is an ops tool, not a landing page.

## Microinteractions stance

Motion-on, but restrained: the live queue's row insert/remove transition is
the only animated surface in the app. Buttons, inputs, and nav get instant
state changes (background/border color, no transform/scale flourish) — matches
Cobalt's "utility over flourish" stance for controls.

## CTA voice

Not applicable in the marketing sense — there are no calls to action, only
task buttons. Existing copy (`Check in`, `Confirm payment`, `Sign out`) stays:
specific verb, no marketing tone, unchanged by this pass.

## Per-page allowances

| Page | May differ | Must share |
|---|---|---|
| Reception | two-pane grid content | shell frame, tokens, type, radii, no-shadow rule |
| Consultation | two-pane grid content, flow-stat strip | same |
| Billing | single-column content, print stylesheet (unthemed, print media only) | same |
| Sign-in | single centered card | same |

## What MUST share vs MAY differ (app-wide)

**Must share:** the shell (sidebar/topbar/content), every color/radius/type
token, the border-only depth rule, mono-for-numbers-and-eyebrows rule, no
italics, no invented metrics.

**May differ per page:** grid shape, which stat widgets appear, print output.

## Exports

This app has no Tailwind config and no shadcn/ui — the tokens above, declared
directly in `src/index.css`, are the real, only copy in production. The
blocks below are portable translations for reference/interop, not additional
files this app loads.

**Tailwind v4 `@theme` (reference only):**

```css
@theme {
  --color-bg: oklch(98.2% 0.004 250);
  --color-surface: oklch(99.5% 0.002 250);
  --color-accent: oklch(58% 0.20 256);
  --color-text: oklch(21% 0.02 260);
  --radius-card: 10px;
  --radius-input: 6px;
  --font-display: "Space Grotesk", sans-serif;
  --font-sans: "Inter", sans-serif;
  --font-mono: "JetBrains Mono", monospace;
}
```

**DTCG `tokens.json` (reference only):**

```json
{
  "color": {
    "bg": { "$value": "oklch(98.2% 0.004 250)", "$type": "color" },
    "surface": { "$value": "oklch(99.5% 0.002 250)", "$type": "color" },
    "accent": { "$value": "oklch(58% 0.20 256)", "$type": "color" },
    "text": { "$value": "oklch(21% 0.02 260)", "$type": "color" }
  },
  "radius": {
    "card": { "$value": "10px", "$type": "dimension" },
    "input": { "$value": "6px", "$type": "dimension" }
  }
}
```

**shadcn/ui CSS variables (reference only):** same names as this app's own
`--bg`/`--surface`/`--accent`/`--border` etc. — shadcn's convention and this
project's pre-existing convention already coincide.
