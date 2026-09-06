---
name: i-clinic
description: The Case Sheet -- a clinic's own paper record system, digitised without translation loss.
colors:
  bg: "oklch(91% 0.02 135)"
  surface: "oklch(95% 0.015 138)"
  surface-2: "oklch(85% 0.025 132)"
  border: "oklch(70% 0.035 130)"
  border-strong: "oklch(58% 0.045 125)"
  text: "oklch(22% 0.025 140)"
  text-secondary: "oklch(40% 0.03 138)"
  text-tertiary: "oklch(44% 0.028 135)"
  accent: "oklch(45% 0.09 220)"
  accent-hover: "oklch(40% 0.095 220)"
  accent-active: "oklch(35% 0.095 220)"
  accent-ink: "oklch(99% 0 0)"
  accent-wash: "oklch(45% 0.09 220 / 12%)"
  focus-ring: "oklch(45% 0.09 220 / 38%)"
  danger: "oklch(42% 0.15 22)"
  danger-wash: "oklch(42% 0.15 22 / 10%)"
  success: "oklch(40% 0.09 152)"
  success-wash: "oklch(40% 0.09 152 / 12%)"
  warning: "oklch(58% 0.13 78)"
  warning-wash: "oklch(58% 0.13 78 / 12%)"
  staging-bg: "oklch(36% 0.15 25)"
  staging-ink: "oklch(98% 0 0)"
  stage-ready: "oklch(46% 0.1 320)"
  shadow-drawer: "-8px 0 32px oklch(20% 0.02 140 / 18%)"
typography:
  display:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica Neue, Arial, sans-serif"
    fontSize: "2rem"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "-0.01em"
  body:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica Neue, Arial, sans-serif"
    fontSize: "1.0625rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica Neue, Arial, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 700
    letterSpacing: "0.06em"
  mono:
    fontFamily: "JetBrains Mono, ui-monospace, SFMono-Regular, Menlo, monospace"
    fontWeight: 500
rounded:
  card: "6px"
  input: "4px"
  pill: "999px"
  token-chit: "3px"
  stamp: "5px 3px 6px 2px"
spacing:
  2xs: "0.25rem"
  xs: "0.5rem"
  sm: "0.75rem"
  md: "1rem"
  lg: "1.5rem"
  xl: "2.5rem"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.accent-ink}"
    rounded: "{rounded.input}"
    padding: "0 1.5rem"
  button-primary-hover:
    backgroundColor: "{colors.accent-hover}"
  button-primary-active:
    backgroundColor: "{colors.accent-active}"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.input}"
    padding: "0 1.5rem"
  input-field:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.text}"
    rounded: "{rounded.input}"
  tab-flag-heading:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.text-secondary}"
    typography: "{typography.label}"
  stage-pill:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text-secondary}"
    rounded: "3px"
---

# Design System: i-clinic -- The Case Sheet

## Overview

**Creative North Star: "The Case Sheet"**

v4.2 of the app's visual world. v3 was "Cobalt" (a tech-blue SaaS theme). v4 committed to a warm kraft/manila paper palette but measured as "muddy" in the real build and was rebased (v4.1) to a cooler sage-paper ground with a slate-teal accent -- same case-sheet thesis (tab-flags, ruled sections, an ink-stamp for paid, hairline depth), different hue family. v4.2 keeps that palette unchanged and replaces the *structure*: every prior pass (v1 through v4.1) kept the same two-pane-grid-of-bordered-panels shape and only changed color/type/radius on top of it -- a reskin, not a redesign. v4.2 replaces the queue-panel-beside-record-panel layout with one full-width dense worklist table; opening a record (Consultation) or a bill (Reception) now happens in a slide-over Drawer, not a permanent second column. See Layout below.

The thesis, unchanged: an Operate-mode two-person clinic tool should look like what the doctor and receptionist already use on paper -- a case sheet, a token chit, a rubber ink stamp -- not a generic dashboard. The build commits to a cool sage-paper ground (never a sterile white), a deep cool charcoal-green ink, one slate-teal accent reserved for the accentable moment, and a forest-green ink-stamp reserved for confirmed/paid. Depth comes from a hairline rule, never a shadow, on every static in-page surface -- paper doesn't float. The Drawer is the one deliberate exception (see Elevation & Depth).

This app has exactly one page family: app pages (Reception, Consultation, Billing, sign-in) for two roles who scan and act under time pressure, often with a patient in the room. No marketing surface exists anywhere in this codebase -- no hero, no testimonial, no pricing table, no footer -- and none should be introduced.

Confirmed rejections: no card-stack-of-identical-bordered-cards for Consultation's record (the world v4 replaced); no permanent two-pane grid (the world v4.2 replaced -- see Layout); no second display typeface (Space Grotesk was removed -- one workhorse family, Inter, carries headings, body, and UI); no invented clinic brand name or logo (the app renders whichever clinic name lives in that tenant's own database row; visual work here is not a brand identity project).

**Key Characteristics:**
- Cool sage-paper ground and charcoal-green ink, never a sterile white or warm kraft
- One slate-teal accent, held rare; forest-green reserved for confirmed/paid
- One full-width dense worklist table per page; a record or a bill opens in a Drawer overlay, never a permanent second column
- Hairline rules and tab-flag section labels instead of nested cards
- Sharp, cut-paper corners (small radii) instead of soft rounding
- Mono reserved strictly for numerals, never for label text

## Colors

A cool, low-saturation paper palette carrying one rationed accent and one rationed confirmation color; rebased once already (v4 → v4.1) after finish review measured the original warm kraft/terracotta ground as reading "muddy" in the real build, not genuine paper stock -- this is a corrected finding, not a stylistic preference, and should not be undone without re-measuring against the actual shipped screens.

### Primary
- **Slate-Teal** (`oklch(45% 0.09 220)`, `--accent`): the one accent color in the system. Used for the active nav item, primary buttons, the focus ring, and the token chit's dashed border/ink. Hover (`oklch(40% 0.095 220)`) and active (`oklch(35% 0.095 220)`) states step down in lightness only, same hue and chroma.

### Neutral
- **Sage Ground** (`oklch(91% 0.02 135)`, `--bg`): the base page background -- pale sage paper, not white.
- **Sage Surface** (`oklch(95% 0.015 138)`, `--surface`): panel and drawer backgrounds (sidebar, header, the worklist table, drawer panels).
- **Sage Surface, Deeper** (`oklch(85% 0.025 132)`, `--surface-2`): hover states, tab-flag heading chips, input field fills, odd ledger rows.
- **Sage Rule** (`oklch(70% 0.035 130)`, `--border`): the standard hairline -- panel borders, section dividers, row dividers.
- **Sage Rule, Strong** (`oklch(58% 0.045 125)`, `--border-strong`): stage-pill borders, secondary-button borders, hover-state border emphasis.
- **Charcoal-Green Ink** (`oklch(22% 0.025 140)`, `--text`): primary text -- cool, never a warm brown or a true black.
- **Charcoal-Green Ink, Secondary** (`oklch(40% 0.03 138)`, `--text-secondary`): labels, meta text, secondary body copy.
- **Charcoal-Green Ink, Tertiary** (`oklch(44% 0.028 135)`, `--text-tertiary`): placeholder text and de-emphasised labels. Measured at 5.91:1 against `--bg` and 4.89:1 against the darker `--surface-2` fields it actually sits on when used as a placeholder -- this lightness value is load-bearing for contrast, not a "looks nicer in isolation" pick; don't lighten it without re-measuring both pairings.

### Semantic
- **Confirmation Green (ink-stamp)** (`oklch(40% 0.09 152)`, `--success`): reserved exclusively for `.paid-stamp` and the "paid" stage glyph -- never used decoratively.
- **Danger** (`oklch(42% 0.15 22)`, `--danger`): validation errors, destructive hover states (sign-out).
- **Warning** (`oklch(58% 0.13 78)`, `--warning`): the "packing" stage.
- **Staging Signal** (`oklch(36% 0.15 25)`, `--staging-bg`): the environment/staging banner. Deliberately distinct from `--danger` so retuning one never silently moves the other -- a system signal, not a clinical one, but still meaningful, not decorative.

### Named Rules
**The Colour-Is-Reinforcement Rule.** Every stage in the token queue (`waiting`, `with_doctor`, `packing`, `ready_at_reception`, `paid`) carries a distinct SVG glyph shape (open ring, filled circle, filled diamond, filled triangle, checked circle) in addition to its color, and the label word is always shown alongside. Color alone never carries the signal; `.stage-pill`'s own container stays a neutral bordered chip regardless of stage so the shape and word are what actually communicate.

**The One Stamp Rule.** The forest-green ink-stamp treatment (`.paid-stamp`) appears only on an actually confirmed payment. It is never reused decoratively elsewhere in the app, so it still means something every time it appears.

## Typography

**Body/UI/Display Font:** Inter (with -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica Neue, Arial, sans-serif)
**Mono Font:** JetBrains Mono (with ui-monospace, SFMono-Regular, Menlo, monospace)

**Character:** One workhorse family carries headings, body, and UI -- an Operate surface doesn't need a second display face (Space Grotesk was dropped in this build); the paper identity comes from tone, rule, and stamp, not a second typeface.

### Hierarchy
- **Headline** (700, 2rem `--text-xl`, 1.2 line-height, -0.01em): page/section top-level headings (h1/h2/h3), sign-in heading.
- **Title** (700, 1.5rem `--text-lg`): form headings, the paid-stamp text, flow-stat values.
- **Body** (400, 1.0625rem `--text-base`, 1.5 line-height): default running text, field values, list items.
- **Small** (400/600, 0.9375rem `--text-sm`): meta text, secondary list captions.
- **Label** (700, 0.8125rem `--text-xs`, 0.06em, uppercase): tab-flag headings, field labels, flow-stat labels.

### Named Rules
**The Mono-Is-For-Numerals Rule.** JetBrains Mono is reserved strictly for genuinely numeric content -- token numbers, elapsed-wait minutes, rupee amounts, flow-stat values -- never for label text, even when that text sits inside a class that is mono elsewhere. `.doctor-queue-meta` is the clearest case: its first-of-type use (age/sex, e.g. "39 · M") explicitly overrides back to the body face because it is not a numeral, while its other use (elapsed time) keeps the mono face from the base rule.

## Layout

One full-width dense worklist table per page (`.worklist`, see Worklist.css), not a two-pane grid -- v4.2 replaces the queue-pane/content-pane split every prior version kept. Reception's table lists today's full queue (Token/Name/Stage/Wait, sortable); Consultation's lists this doctor's own waiting + with-doctor patients (Token/Name/Age·sex/Complaint/Wait/Stage, sortable). Clicking an actionable row -- a billable visit on Reception, the with-doctor patient on Consultation -- opens a Drawer overlay (`.drawer-panel`, see Drawer.tsx) sliding in from the right over a dimmed scrim; the table stays exactly where it was underneath. Consultation's case-sheet keeps every record section (comments, demographics, complaint, past visits, prescriptions, pricing) visible and scrollable at once *inside the drawer* -- never behind tabs, per PRODUCT.md's one-screen requirement; that requirement is about the drawer's own contents, not about a permanent second column. The shell is a single horizontal header row (clinic name, nav, theme toggle, sign-out) + scrollable content area -- no separate sidebar/topbar split. Spacing runs a 6-step scale from `--space-2xs` (0.25rem) to `--space-xl` (2.5rem). A wide table scrolls inside its own `.worklist-scroll` container on narrow viewports, never the page.

## Elevation & Depth

Flat by default: no static in-page component carries a `box-shadow`. Grouping inside the worklist and inside a drawer reads from 1px `--border` hairlines plus surface/bg contrast; there is no bordered "panel" wrapping the page content anymore -- the table is full-bleed, and everything *inside* a drawer divides by `border-top: 1px solid var(--border)` rules, never a nested card. Paper doesn't float.

Two exceptions, both genuinely floating surfaces rather than static in-page content, and both use the same `--shadow-drawer` token: the **Drawer** (`.drawer-panel`) and the search typeahead's floating result list (`.search-results`/`.no-match`) -- something rendering *on top of* other content reads as elevated by a shadow; something sitting *beside* other content reads as grouped by a border. Component-scoped, not a system shadow token beyond those two: `.paid-stamp` carries its own small offset `box-shadow: 1.5px 1px 0 0 var(--success-wash)` alongside uneven corner radii, reading as a slightly imperfect rubber-stamp impression rather than a true rounded rectangle -- a property of that one component, not a reusable elevation step.

### Named Rules
**The Floating-vs-Static Rule.** A shadow means "this is temporarily on top of the page" (a drawer, a typeahead dropdown). A border means "this is part of the page's own layout" (the worklist table, a drawer's internal sections). Never use a shadow for the second case or a border alone for the first.

## Shapes

Sharper, cut-paper radii: `--radius-card` (6px) for panels, `--radius-input` (4px) for fields and buttons, `--radius-pill` (999px) surviving only for the flow-bar's progress track (a shape that is legitimately a pill). The token chit (`.readout-token`) uses a 3px radius with a 1.5px dashed border, reading as a perforated ticket stub. The signature recurring silhouette is the tab-flag: `clip-path: polygon(0 0, calc(100% - 7px) 0, 100% 100%, 0 100%)` on a `--surface-2` chip, an angled top-right corner evoking a folder index-tab, applied via `.readout-heading` to every section label in the app (Queue, Comments, Demographics, Procedures, Pricing, etc.).

## Components

### Buttons
- **Shape:** 4px radius (`--radius-input`), min-height 3rem, no border-radius asymmetry.
- **Primary:** `--accent` background, `--accent-ink` text; hover steps to `--accent-hover`, active to `--accent-active`; disabled swaps to `--border-strong` background with `--text-tertiary` text (a known reuse of `--border-strong` outside its "border color" name, carried forward as a disclosed exception, not normalised).
- **Secondary:** `--surface` background, `--border-strong` border, `--text` label.
- **Focus:** `box-shadow: 0 0 0 3px var(--focus-ring)`, no visible outline.
- **Known limitation:** loading/error states are label-text swap only (e.g. "Confirming…") -- no spinner or error glyph. A real, pre-existing gap this redesign did not attempt to close.

### Chips
- **Tab-flag heading** (`.readout-heading`): `--surface-2` background, `--text-secondary` uppercase label text, angled clip-path corner. The system's signature device, reused for every section label.
- **Stage pill** (`.stage-pill`): a bordered ink-stamp-style chip (`--border-strong` border, `--surface` background), intentionally neutral in color regardless of stage -- the SVG shape drawn per-stage in `TokenList.tsx` is the real signal, so it survives colour-vision deficiency.
- **Token chit** (`.readout-token`): 1.5px dashed `--accent` border on `--accent-wash` fill, mono numeral -- a ticket-stub silhouette, not a plain filled circle.

### Cards / Containers
- **Corner Style:** 6px radius (`--radius-card`).
- **Background:** `--surface`.
- **Shadow Strategy:** none on static content; see Elevation & Depth for the Drawer/typeahead exception.
- **Border:** 1px `--border`.
- **Internal Padding:** `--space-lg` to `--space-xl`.
- The page itself no longer wraps in a bordered container -- the worklist table is full-bleed. A bordered, radiused surface now appears only for the Drawer panel and the floating search-results/no-match dropdown.

### Inputs / Fields
- **Style:** `--surface-2` background, 1px `--border`, 4px radius. `.search-strip` is a plain ruled rectangle, not a pill -- its search icon is a real inline SVG using `currentColor`, replacing an earlier hardcoded-hex background-image icon that couldn't react to token changes and was wrong in dark mode.
- **Focus:** background lifts to `--surface`, border shifts to `--accent`, 3px focus-ring glow.
- **Error / Disabled:** error text in `--danger`; disabled fields at 0.5 opacity.

### Navigation
Nav lives in one horizontal header row (clinic name, nav items, theme toggle, user email, sign-out) -- not a sidebar. Nav items are borderless, 4px-radius, inline; active state uses `--accent-wash` background with `--accent` text (not a filled solid accent bar). Hover lifts to `--surface-2`.

### The Drawer (structural component)
`.drawer-panel` (see Drawer.tsx/Drawer.css) is how a record or a bill opens: a fixed-position panel sliding in from the right over a dimmed scrim (`.drawer-scrim`, `oklch(15% 0.02 140 / 45%)`), width `min(38rem, 100vw)`, closable via an × button, a click on the scrim, or Escape. It is the one place in the app that reads as floating rather than in-page -- see Elevation & Depth's Floating-vs-Static rule.

### The Worklist (structural component)
`.worklist` (see Worklist.css, TokenList.tsx, Consultation.tsx) is the dense, full-width, sortable table every page's queue renders as now. Column headers are `.worklist-sort` buttons (mono, uppercase, an ▲/▼ arrow in `--accent` on the active sort column); rows are `.worklist-row`, hairline-divided, `--surface-2` on hover; an actionable row also gets `.worklist-row-clickable` and opens a Drawer on click. Reuses `.readout-token` and `.stage-pill` for the token chit and stage chip inside a row.

### The Paid Stamp (signature component)
`.paid-stamp` is the app's one signature/delight moment: a rotated (-6deg), bordered "PAID" mark in `--success`, shown only on an actually confirmed payment. Uneven corner radii (`5px 3px 6px 2px`) plus an offset translucent ghost box-shadow make it read as an imperfect rubber-stamp impression rather than a perfect rounded rectangle. This is currently CSS-only (no rendered/distressed asset) -- a legitimate future upgrade path, not a defect.

## Do's and Don'ts

### Do:
- **Do** use the sage-paper ground tokens (`--bg`/`--surface`/`--surface-2`) as-is; they were deliberately rebased from the original kraft/terracotta pass after finish review found it read muddy, and shouldn't be reverted without re-measuring.
- **Do** apply `.readout-heading`'s tab-flag clip-path to every new record-section label; it is the system's one recurring signature motif, not a one-off.
- **Do** reserve JetBrains Mono for genuine numerals (tokens, minutes, rupees) and keep label text, including text that shares a class with numeric content, on the Inter body face.
- **Do** keep every Consultation record section visible and scrollable at once inside the Drawer; PRODUCT.md's one-screen requirement is durable, not a task-local choice -- it governs the drawer's contents, not whether the queue sits permanently beside them.
- **Do** open a record or a bill in the Drawer, and route any new secondary task (a form, a confirmation) through it too, rather than adding a second permanent column or a route change.

### Don't:
- **Don't** reintroduce a permanent second column / two-pane grid. Every version through v4.1 kept that shape and just changed its skin -- that's the reskin pattern this version was built specifically to break. One full-width worklist; a Drawer for everything else.
- **Don't** add a `box-shadow` to anything that sits in the page's own layout (the worklist, a drawer's internal sections). Reserve it for the two genuinely floating surfaces (the Drawer, the search typeahead dropdown) plus `.paid-stamp`'s own welded rubber-stamp effect -- see Elevation & Depth.
- **Don't** introduce a second display typeface. One family (Inter) carries headings, body, and UI; Space Grotesk was removed in this build and should not return.
- **Don't** invent a clinic brand name, logo, or fixed identity anywhere in this app. It renders whichever clinic's own name is stored in its database row.
- **Don't** let `--stage-pill`'s container color vary by stage. Color reinforces; the SVG shape and label word are the actual colour-blind-safe signal.
