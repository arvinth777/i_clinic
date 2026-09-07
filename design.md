---
name: i-clinic
description: A professional, Linear/Stripe-adjacent operating console for a two-person clinic -- neutral black/white/grey base, one blue accent, red for danger.
colors:
  bg: "oklch(97% 0 0)"
  surface: "oklch(100% 0 0)"
  surface-2: "oklch(93% 0 0)"
  border: "oklch(87% 0 0)"
  border-strong: "oklch(72% 0 0)"
  text: "oklch(20% 0 0)"
  text-secondary: "oklch(42% 0 0)"
  text-tertiary: "oklch(50% 0 0)"
  accent: "oklch(52% 0.18 258)"
  accent-hover: "oklch(46% 0.19 258)"
  accent-active: "oklch(40% 0.19 258)"
  accent-ink: "oklch(99% 0 0)"
  accent-wash: "oklch(52% 0.18 258 / 12%)"
  focus-ring: "oklch(52% 0.18 258 / 38%)"
  danger: "oklch(42% 0.15 22)"
  danger-wash: "oklch(42% 0.15 22 / 10%)"
  success: "oklch(40% 0.09 152)"
  success-wash: "oklch(40% 0.09 152 / 12%)"
  warning: "oklch(58% 0.13 78)"
  warning-wash: "oklch(58% 0.13 78 / 12%)"
  staging-bg: "oklch(36% 0.15 25)"
  staging-ink: "oklch(98% 0 0)"
  stage-ready: "oklch(46% 0.1 320)"
  shadow-drawer: "-8px 0 32px oklch(20% 0 0 / 18%)"
typography:
  display:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica Neue, Arial, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "-0.01em"
  section-heading:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica Neue, Arial, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 700
  body:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica Neue, Arial, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica Neue, Arial, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 600
rounded:
  card: "10px"
  input: "8px"
  pill: "999px"
  stamp: "5px 3px 6px 2px"
spacing:
  2xs: "0.25rem"
  xs: "0.5rem"
  sm: "0.75rem"
  md: "1rem"
  lg: "1.5rem"
  xl: "2.5rem"
shadow:
  sm: "0 1px 2px oklch(20% 0 0 / 6%)"
  md: "0 2px 8px oklch(20% 0 0 / 8%), 0 1px 2px oklch(20% 0 0 / 6%)"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.accent-ink}"
    rounded: "{rounded.input}"
    padding: "0 1.5rem"
    shadow: "{shadow.sm}"
  button-primary-hover:
    backgroundColor: "{colors.accent-hover}"
  button-primary-active:
    backgroundColor: "{colors.accent-active}"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.input}"
    padding: "0 1.5rem"
    shadow: "{shadow.sm}"
  input-field:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.text}"
    rounded: "{rounded.input}"
    shadow: "{shadow.sm}"
  card-panel:
    backgroundColor: "{colors.surface}"
    border: "1px solid {colors.border}"
    rounded: "{rounded.card}"
    shadow: "{shadow.md}"
  section-heading:
    textColor: "{colors.text}"
    borderLeft: "3px solid {colors.border-strong}"
    typography: "{typography.section-heading}"
  stage-pill:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text-secondary}"
    rounded: "3px"
---

# Design System: i-clinic

## Overview

**v4.5 -- a professional SaaS console, not "The Case Sheet."** v1 through v4.4 pursued a paper/case-sheet metaphor (sage-paper ground, a slate-teal accent, hairline-only depth, sharp corners) across four palette/structure passes. After v4.4 (a straight colour-only swap to a neutral+blue palette, done in response to an explicit "I don't like the slate-teal, I need professional colours -- black, white, a little blue and red" request), the user's own verdict on the *result* was direct: "still ugly... everything -- the zoomed in, the components, the fonts and spacing and the dropdowns." That's a different, larger finding than a wrong hue: the case-sheet thesis's structural choices (flat hairline-only depth, tight dense-tool spacing, sharp small radii, unstyled native `<select>` elements) were themselves reading as cheap, independent of which colours sat on top of them. Named references for the target: **Linear and Stripe Dashboard.** v4.5 is the resulting full pivot, not a fourth palette tweak: neutral black/white/grey base, one blue accent, real elevation (soft shadows, not hairlines-only), softer/larger radii, a reopened spacing scale, and native form controls restyled to not read as bare browser defaults (a custom select chevron in particular). The case-sheet-specific devices (tab-flags, dashed ticket-stub token badges, an ink-stamp thesis) are retired with this pivot; the token queue's colour-blind-safe SVG-shape-per-stage device and the append-only audit-trail principles underneath the UI are unaffected -- this is a visual-language change, not a re-litigation of any product decision.

**What's kept from every earlier pass, deliberately:** one workhorse type family (Inter) for headings/body/UI, JetBrains Mono reserved strictly for numerals, a single rationed accent colour (now blue, not teal), a single rationed confirmation colour for the paid stamp (unchanged green), and the left-rail/center-stage/jump-nav structure for Consultation and Reception that this same session built just before the colour/depth pivot (see Layout) -- that restructure is a layout decision, unaffected by this token-level pass.

This app has exactly one page family: app pages (Reception, Consultation, Billing, sign-in) for two roles who scan and act under time pressure, often with a patient in the room. No marketing surface exists anywhere in this codebase -- no hero, no testimonial, no pricing table, no footer -- and none should be introduced.

Confirmed rejections: no card-stack-of-identical-bordered-cards for Consultation's record in the sense v4 originally meant (a wall of visually-identical mini-cards with no hierarchy) -- v4.5's own card panels (rail, stage, drug-row) are a different thing, a small number of large, purposeful containers, not many small identical ones; no second display typeface (Space Grotesk was removed -- one workhorse family, Inter, carries headings, body, and UI); no invented clinic brand name or logo (the app renders whichever clinic name lives in that tenant's own database row; visual work here is not a brand identity project); no invented section-label shape (v4.2's tab-flag clip-path, tried and explicitly rejected as an AI-tell, then correctly diagnosed in this pass as having been replaced with *nothing* rather than a real hierarchy device -- see Typography). **No longer a confirmed rejection**: a permanent second column (reopened this session for Consultation/Reception, at direct user request); a flat, shadow-free surface (reopened in v4.5 -- real elevation now, see Elevation & Depth); sharp small radii (reopened in v4.5 -- softer, larger radii now, see Shapes).

**Key Characteristics:**
- Neutral black/white/grey base (zero chroma), never a tinted paper ground
- One blue accent, held rare; red for danger/errors; forest-green still reserved for confirmed/paid only
- Consultation and Reception: a persistent left rail (queue/quick access) beside a center stage (the open record or bill), both real elevated card panels -- see Layout
- A real section-heading device -- genuine type-scale step-up plus a neutral left rule (see Typography) -- not an invented shape, and not the "just bold body text" the case-sheet era shipped instead of one
- Real elevation: soft shadows on cards, buttons, and inputs, not hairline-borders-only
- Softer, larger radii (10px cards, 8px inputs/buttons) and a reopened, more generous spacing scale
- Mono reserved strictly for numerals, never for label text

## Colors

A neutral black/white/grey base carrying one rationed blue accent and one rationed red danger colour -- direct user request, replacing every prior pass's sage-paper/slate-teal palette outright. Values below use OKLCH with chroma at 0 for every neutral token, so lightness alone (not hue) drives the whole scale; this is deliberate and shouldn't be re-tinted without the same conversation happening again.

### Primary
- **Blue** (`oklch(52% 0.18 258)`, `--accent`): the one accent color in the system. Used for the active nav item, primary buttons, the focus ring, active stepper/queue-row states, and the token chit's numeral ink (on an `--accent-wash` fill, no border). Deliberately **not** used for the section-heading left rule (`--border-strong` instead, see Typography) -- an accent used as decoration on every section label on a page would stop being rare. Hover (`oklch(46% 0.19 258)`) and active (`oklch(40% 0.19 258)`) states step down in lightness only, same hue and chroma.

### Neutral
- **Ground** (`oklch(97% 0 0)`, `--bg`): the base page background -- a soft neutral grey, not the page's own cards' pure white, so a card visibly sits *on* the page.
- **Surface** (`oklch(100% 0 0)`, `--surface`): pure white -- card panels (the rail, the stage, the drawer), the header.
- **Surface, Deeper** (`oklch(93% 0 0)`, `--surface-2`): hover states, input field fills, odd ledger rows.
- **Rule** (`oklch(87% 0 0)`, `--border`): the standard hairline -- card borders, section dividers, row dividers.
- **Rule, Strong** (`oklch(72% 0 0)`, `--border-strong`): the section-heading left rule, stage-pill borders, secondary-button borders, hover-state border emphasis.
- **Ink** (`oklch(20% 0 0)`, `--text`): primary text -- near-black, not a true `#000`.
- **Ink, Secondary** (`oklch(42% 0 0)`, `--text-secondary`): labels, meta text, secondary body copy.
- **Ink, Tertiary** (`oklch(50% 0 0)`, `--text-tertiary`): placeholder text and de-emphasised labels. Chosen to preserve the same lightness gap the sage palette's own measured contrast pass used (5.91:1 vs `--bg`, 4.89:1 vs `--surface-2`) -- OKLCH lightness, not chroma/hue, is what drives contrast, so dropping chroma to 0 at the same L values carries the ratios over unchanged. Don't lighten it without re-measuring both pairings.

### Semantic
- **Confirmation Green (ink-stamp)** (`oklch(40% 0.09 152)`, `--success`): reserved exclusively for `.paid-stamp` and the "paid" stage glyph -- never used decoratively. Unchanged by the v4.5 pivot; not one of the colours the user asked to change.
- **Danger / Red** (`oklch(42% 0.15 22)`, `--danger`): validation errors, destructive hover states (sign-out), the second of the two named colours in "black white and then little blue and red." Unchanged in value -- it was already a legitimate red, not part of the sage-tinted set.
- **Warning** (`oklch(58% 0.13 78)`, `--warning`): the "packing" stage. Unchanged, a status colour, not part of this pivot.
- **Staging Signal** (`oklch(36% 0.15 25)`, `--staging-bg`): the environment/staging banner. Deliberately distinct from `--danger` so retuning one never silently moves the other -- a system signal, not a clinical one, but still meaningful, not decorative.

### Named Rules
**The Colour-Is-Reinforcement Rule.** Every stage in the token queue (`waiting`, `with_doctor`, `packing`, `ready_at_reception`, `paid`) carries a distinct SVG glyph shape (open ring, filled circle, filled diamond, filled triangle, checked circle) in addition to its color, and the label word is always shown alongside. Color alone never carries the signal; `.stage-pill`'s own container stays a neutral bordered chip regardless of stage so the shape and word are what actually communicate.

**The One Stamp Rule.** The forest-green ink-stamp treatment (`.paid-stamp`) appears only on an actually confirmed payment. It is never reused decoratively elsewhere in the app, so it still means something every time it appears.

## Typography

**Body/UI/Display Font:** Inter (with -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica Neue, Arial, sans-serif)
**Mono Font:** JetBrains Mono (with ui-monospace, SFMono-Regular, Menlo, monospace)

**Character:** One workhorse family carries headings, body, and UI, across every pass so far including this one -- a second display face has never been justified for a two-role Operate tool.

### Hierarchy
- **Headline** (700, 1.5rem `--text-xl`, 1.2 line-height, -0.01em): the sign-in heading; the one explicit use of this size (bare `h1`/`h2`/`h3` elsewhere get only weight/line-height/tracking from the shared rule, not an explicit size, so they render at the browser's own relative heading size unless a component overrides it -- `.stage-head h2` is one such override-free case).
- **Section heading** (700, 1.125rem `--text-lg`): `.readout-heading` -- every record/panel section label in the app (Comments, Patient, Procedures & pricing, Itemised breakdown, Queue, Drugs, etc.), paired with a 3px `--border-strong` left rule. This is the fix for a real, named finding: an earlier pass tried a clip-path "tab-flag" chip for this, judged it an AI-tell shape, and stripped it down to plain bold body-sized text with nothing replacing the hierarchy it removed -- every section on a page read at the same visual weight as its own surrounding prose. A genuine type-scale step-up plus a rule fixes that without reintroducing an invented shape.
- **Body** (400, 0.875rem `--text-base`, 1.5 line-height): default running text, field values, list items.
- **Small** (400/600, 0.8125rem `--text-sm`): meta text, secondary list captions.
- **Label** (600, 0.8125rem `--text-sm`, sentence case): field labels (`.field-label`), flow-stat labels. Not uppercase, not letter-spaced, not weight 700 -- an earlier type-tightening pass quietly moved this from an uppercase-eyebrow treatment and the docs were never updated to match; described here as what's actually shipped.

### Named Rules
**The Mono-Is-For-Numerals Rule.** JetBrains Mono is reserved strictly for genuinely numeric content -- token numbers, elapsed-wait minutes, rupee amounts, flow-stat values -- never for label text, even when that text sits inside a class that is mono elsewhere. `.doctor-queue-meta` is the clearest case: its first-of-type use (age/sex, e.g. "39 · M") explicitly overrides back to the body face because it is not a numeral, while its other use (elapsed time) keeps the mono face from the base rule.

## Layout

Two different structures, by page, not one uniform rule:

- **Consultation and Reception**: a persistent left rail (`.consultation-rail`/`.reception-rail`) beside a center stage (`.consultation-stage`/`.reception-stage`), both real elevated card panels (white, bordered, `--shadow-sm`/`--shadow-md`, see Elevation). The rail holds the queue (read-only awareness, not a way to jump to an arbitrary patient -- only "Call next" advances it) or search/quick-actions; the stage holds the open record or bill, swapped in place, never behind a Drawer. This reopens an earlier pass's "no permanent second column" rule at direct, explicit user request, after the Drawer-based record/bill view was judged too cramped and disorganised. Consultation's stage is further organised under a four-step jump-nav stepper (`SectionStepper.tsx`: Overview / Prescription / Procedures & pricing / Documents & follow-up) -- pure navigation, nothing ever hidden or gated, preserving the "doctor doesn't lose time clicking through screens mid-exam" principle a linear wizard would have broken.
- **Every other screen** (Stock, Reports, Admin, and Reception's own short entry forms) stays a full-width `.worklist` table, or a `Drawer` for a short single-purpose form (check-in, new patient, rep check-in) -- these are quick, single-field flows, not a record worth a permanent view.

The shell is a single horizontal header row (clinic name, nav, theme toggle, sign-out) + scrollable content area -- no separate sidebar/topbar split. Spacing runs a 6-step scale from `--space-2xs` (0.25rem) to `--space-xl` (2.5rem) -- reopened wider in v4.5 after an earlier tightening pass read as cramped/"zoomed in" on a real screen. A wide table scrolls inside its own `.worklist-scroll` container on narrow viewports, never the page.

## Elevation & Depth

**Real elevation, not flat-by-default.** Every earlier pass (through v4.4) kept every static in-page surface shadow-free, hairline-border-only depth, on the theory that "paper doesn't float." The user explicitly rejected that result, naming Linear/Stripe Dashboard as the reference -- both use soft shadows for card-level grouping. v4.5's rule: `--shadow-sm` on buttons, inputs, and small controls; `--shadow-md` on card-level panels (the rail, the stage, `.drug-row`, the Drawer at its own larger `--shadow-drawer`). A hairline border still runs *alongside* the shadow on every card (never shadow-only) -- the border defines the edge crisply at any zoom level; the shadow is what separates it from the page behind it.

Two floating surfaces still get the drawer's own larger shadow token specifically: the **Drawer** (`.drawer-panel`) and the search typeahead's floating result list (`.search-results`/`.no-match`) -- something rendering *on top of* other content needs more separation than something sitting *beside* it. `.paid-stamp` keeps its own small offset `box-shadow: 1.5px 1px 0 0 var(--success-wash)` alongside uneven corner radii, reading as a slightly imperfect rubber-stamp impression rather than a true rounded rectangle -- a property of that one component, not a reusable elevation step.

### Named Rules
**The Depth-Reinforces Rule.** A card-level shadow (`--shadow-md`) marks "this is a distinct grouped surface" (the rail, the stage). A control-level shadow (`--shadow-sm`) marks "this is an interactive element" (a button, an input). The drawer's own larger shadow marks "this is temporarily on top of the whole page." None of these substitute for the hairline border that still runs alongside each -- shadow and border together, not shadow instead of border.

## Shapes

Softer, larger radii, reopened in v4.5: `--radius-card` (10px) for panels, `--radius-input` (8px) for fields and buttons, `--radius-pill` (999px) surviving for the flow-bar's progress track and pill-shaped chips. An earlier pass used sharp, small "cut-paper" radii (6px/4px) as a deliberate case-sheet motif; the user's own reference points (Linear, Stripe Dashboard) both use noticeably softer corners, so this pass matches that rather than the paper metaphor. No clip-path or other invented silhouette anywhere in the system -- the tab-flag chip an earlier pass tried for section headings, and the dashed-border "ticket stub" it tried for the token chit, were both judged AI-tell shapes and are not part of any current component; the token chit (`.readout-token`) is a plain filled circle, mono numeral, nothing else.

## Components

### Buttons
- **Shape:** 8px radius (`--radius-input`), min-height 2.5rem, `--shadow-sm`, no border-radius asymmetry.
- **Primary:** `--accent` background, `--accent-ink` text; hover steps to `--accent-hover`, active to `--accent-active`; disabled swaps to `--border-strong` background with `--text-tertiary` text (a known reuse of `--border-strong` outside its "border color" name, carried forward as a disclosed exception, not normalised).
- **Secondary:** `--surface` background, `--border-strong` border, `--text` label.
- **Focus:** `box-shadow: 0 0 0 3px var(--focus-ring)`, no visible outline (this replaces the resting `--shadow-sm` while focused, it doesn't stack with it).
- **Known limitation:** loading/error states are label-text swap only (e.g. "Confirming…") -- no spinner or error glyph. A real, pre-existing gap this redesign did not attempt to close.

### Chips
- **Section heading** (`.readout-heading`): no background, no border -- a 3px `--border-strong` left rule plus a genuine type-scale step-up (`--text-lg`, 700). See Typography.
- **Stage pill** (`.stage-pill`): a bordered ink-stamp-style chip (`--border-strong` border, `--surface` background), intentionally neutral in color regardless of stage -- the SVG shape drawn per-stage in `TokenList.tsx` is the real signal, so it survives colour-vision deficiency.
- **Token chit** (`.readout-token`): a plain filled circle (`--accent-wash` fill, `--accent` numeral ink), mono numeral, no border. Deliberately plain -- see Shapes.

### Cards / Containers
- **Corner Style:** 10px radius (`--radius-card`).
- **Background:** `--surface` (pure white).
- **Shadow Strategy:** `--shadow-sm` for compact panels (the rail), `--shadow-md` for the main content panel (the stage) -- see Elevation & Depth. Never shadow without a border alongside it.
- **Border:** 1px `--border`.
- **Internal Padding:** `--space-lg` to `--space-xl`.
- Sections *inside* a card panel (`.record-section`) stay hairline-divided, not individually re-carded -- one elevated card holding several ruled sections, not a stack of many small shadowed cards. `.drug-row` is the one exception: each prescribed drug is its own small card (border + `--radius-card` + `--shadow-sm`), matching how Linear/Stripe treat a repeated list item as a discrete unit.

### Inputs / Fields
- **Style:** `--surface-2` background, 1px `--border`, 8px radius, `--shadow-sm`. `.search-strip` is a plain ruled rectangle, not a pill -- its search icon is a real inline SVG using `currentColor`.
- **Select chevron:** every `<select>` gets `appearance: none` and a custom chevron (an inline SVG data-URI, fixed mid-grey rather than a theme token -- a background-image data URI can't pick up `currentColor`/theme changes the way an inline SVG or `mask-image` could; a disclosed simplification, not an oversight) instead of the browser/OS's own native arrow. This was one of the concrete "looks like unstyled default HTML" tells named directly by the user.
- **Focus:** background lifts to `--surface`, border shifts to `--accent`, 3px focus-ring glow (replaces the resting `--shadow-sm`, doesn't stack with it).
- **Error / Disabled:** error text in `--danger`; disabled fields at 0.5 opacity.

### Navigation
Nav lives in one horizontal header row (clinic name, nav items, theme toggle, user email, sign-out) -- not a sidebar. Nav items are borderless, 8px-radius, inline; active state uses `--accent-wash` background with `--accent` text (not a filled solid accent bar). Hover lifts to `--surface-2`.

### The Drawer (structural component)
`.drawer-panel` (see Drawer.tsx/Drawer.css) is how a short, single-purpose form opens on Reception (check-in, new patient, rep check-in) -- a fixed-position panel sliding in from the right over a dimmed scrim (`.drawer-scrim`, `oklch(15% 0 0 / 45%)`), width `min(38rem, 100vw)`, closable via an × button, a click on the scrim, or Escape. Consultation and Reception's own *record/bill* views no longer use it -- see Layout.

### The Worklist (structural component)
`.worklist` (see Worklist.css, TokenList.tsx) is the dense, full-width, sortable table every non-rail page's queue renders as. Column headers are `.worklist-sort` buttons (mono, uppercase, an ▲/▼ arrow in `--accent` on the active sort column); rows are `.worklist-row`, hairline-divided, `--surface-2` on hover; an actionable row also gets `.worklist-row-clickable`. Reuses `.readout-token` and `.stage-pill` for the token chit and stage chip inside a row. Consultation's own queue is a separate, compact rail list (`.rail-row`, see Layout), not this table -- the two share the token-chit/stage-pill components but not the table markup.

### The Paid Stamp (signature component)
`.paid-stamp` is the app's one signature/delight moment: a rotated (-6deg), bordered "PAID" mark in `--success`, shown only on an actually confirmed payment. Uneven corner radii (`5px 3px 6px 2px`) plus an offset translucent ghost box-shadow make it read as an imperfect rubber-stamp impression rather than a perfect rounded rectangle. This is currently CSS-only (no rendered/distressed asset) -- a legitimate future upgrade path, not a defect.

## Do's and Don'ts

### Do:
- **Do** use the neutral black/white/grey tokens (`--bg`/`--surface`/`--surface-2`) as-is; they're a direct, explicit user request replacing every earlier palette, not a re-measurement to second-guess.
- **Do** give every card-level panel both a hairline border and a shadow (`--shadow-sm` or `--shadow-md`) -- never shadow alone, never border alone, for a static in-page container that's meant to read as a distinct surface.
- **Do** apply `.readout-heading`'s left-rule-plus-larger-type treatment to every new section label; it is the system's real hierarchy device now, not an invented shape.
- **Do** reserve JetBrains Mono for genuine numerals (tokens, minutes, rupees) and keep label text, including text that shares a class with numeric content, on the Inter body face.
- **Do** style every new `<select>` with the same `appearance: none` + custom-chevron treatment as `.field select` -- a native browser arrow is one of the concrete "cheap" tells this pass fixed.
- **Do** open a record or a bill for Consultation/Reception in the rail/stage layout (see Layout); reserve the Drawer for short, single-purpose entry forms only.

### Don't:
- **Don't** re-tint the neutral base back toward any hue (sage, kraft, or otherwise) without the same kind of direct conversation that produced this pivot -- it was an explicit, considered request, not a default to drift back from.
- **Don't** ship a card-level container with a shadow but no border, or a border but no shadow -- see Elevation & Depth's Depth-Reinforces rule.
- **Don't** reintroduce the tab-flag clip-path chip or the dashed-border "ticket stub" token badge; both were tried, both were judged as invented/AI-tell shapes, and neither is part of this system.
- **Don't** introduce a second display typeface. One family (Inter) carries headings, body, and UI.
- **Don't** invent a clinic brand name, logo, or fixed identity anywhere in this app. It renders whichever clinic's own name is stored in its database row.
- **Don't** let `--stage-pill`'s container color vary by stage. Color reinforces; the SVG shape and label word are the actual colour-blind-safe signal.
