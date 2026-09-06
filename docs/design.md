# Design system — extracted from the built code

This is a record of what `AppShell`, `Consultation`, and the Reception
screen actually implement, read out of the CSS and components as they
exist right now. Nothing here was decided fresh for this document —
where the code itself is inconsistent, that inconsistency is written
down as an exception, not smoothed over.

Read this before building a new screen. Its tokens are the only ones a
new screen may use. A value that doesn't exist yet gets added to
`src/index.css` (and this file), never invented inline in a component's
stylesheet.

**Source files:**
- Tokens — `src/index.css`
- Shell chrome — `src/components/AppShell.tsx` + `AppShell.css`
- Staging strip — `src/components/StagingBanner.tsx` + `.css`
- Reception content — `src/pages/Reception.tsx` + `Reception.css`
- Consultation content — `src/pages/Consultation.tsx` + `Consultation.css`, `src/components/PrescriptionForm.tsx`, `src/components/PricingPanel.tsx`
- Token list / stage model — `src/components/TokenList.tsx`
- Forms — `src/components/NewPatientForm.tsx`, `src/components/SignIn.tsx`

---

## The rules

- **One family.** `-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI', Roboto, Helvetica Neue, Arial, sans-serif` — no second face is loaded anywhere. Form controls (`input`, `select`, `button`) don't inherit the body font by default in browsers, so every one of them declares `font-family: inherit` explicitly.
- **One accent.** `--accent` (and its hover/active/wash/focus-ring variants) is the only chromatic brand colour. The stage-semantic colours are a separate, deliberately multi-hue set for data encoding, not brand accent — see "Stage indicator model" below.
- **Light is primary, dark is secondary, from one token set.** All colour tokens are declared once in `:root` — that block *is* the light theme, and it is what renders unconditionally, regardless of the OS's own light/dark preference. Dark only applies via an explicit `:root[data-theme='dark']` override of the same token names; there is no `@media (prefers-color-scheme: dark)` auto-switch (removed — it was making every user whose OS defaults to dark see the app in dark mode with no way to opt out, which read as "mostly black canvas"). Nothing has a UI control to set `data-theme="dark"` yet — the override exists so a future settings toggle has a theme to switch to, not because dark is reachable today. Nothing outside `index.css` branches on theme — every component reads the same variable names regardless of which theme is active.
- **No card nesting.** A card (fill + border + radius, optionally a shadow) marks a transient, overlay-like moment — `.form-panel`, `.signin`. Content that's always on screen is grouped by spacing and a hairline `border-top`, never a second card inside a card. See "Card-free grouping" below.
- **Colour carries meaning, never decoration.** The stage-semantic set, `--danger` on an overdue wait, `--staging-bg` on the environment strip — every chromatic use maps to a real state. Nothing is coloured just to look lively.
- **No layout shift on interaction.** Every bordered control keeps the same `border-width` across default/hover/focus/disabled; state changes move to `background-color`, `border-color`, or `box-shadow` only.
- **Focus is never colour-only.** Every focus-visible state adds a `box-shadow` ring in `--focus-ring`; several also shift `border-color` to `--accent`. See the exception noted under Buttons/Inputs below — ring width isn't fully consistent.

---

## Colour tokens

| Token | Light (primary) | Dark (secondary, `[data-theme='dark']` only) | Used for |
|---|---|---|---|
| `--bg` | `#f7f8fa` | `#000000` | Page canvas: `.shell-content`. Also the fill behind `.search-strip` and `.readout-section` — a "recessed" surface one step behind `--surface` |
| `--surface` | `#ffffff` | `#1c1c1e` | Card fill: `.form-panel`, `.signin`, `.shell-sidebar`, `.shell-topbar`, `.readout-list` |
| `--surface-2` | `#f3f4f6` | `#17171a` | Secondary surface: hover background on `.search-result-button` / `.field input`, `.flow-bar` track |
| `--border` | `#e5e7eb` | `rgba(255,255,255,.1)` | Default hairline: card borders, row dividers, shell dividers, section dividers |
| `--border-strong` | `#d1d5db` | `rgba(255,255,255,.16)` | Emphasis border: `.secondary-button`, hover border on `.search-result-button` / `.field input`. **Exception:** also reused as `.primary-button:disabled`'s *background fill*, not a border — the only place a "border" token colours a surface. |
| `--text` | `#171a1f` | `#f5f5f7` | Primary text |
| `--text-secondary` | `#6b7280` | `#98989d` | Secondary text: `.readout-token`, `.stage-pill` label, `.flow-stat-label`, form helper copy |
| `--text-tertiary` | `#9ca3af` | `#6e6e73` | Quietest text: placeholders, `.readout-heading`, disabled-button text, `--stage-waiting`. **Exception:** the search icon drawn into `.search-strip`'s `background-image` is a static SVG data-URI with `stroke='%2386868b'` hardcoded — a stale pre-redesign tertiary value that tracks neither theme's current token. |
| `--accent` | `#2563eb` | `#0a84ff` | `.primary-button` fill, `.search-strip` focus border, `.shell-nav-item` text, `--stage-with-doctor` |
| `--accent-hover` | `#1d4ed8` | `#3396ff` | `.primary-button` hover fill |
| `--accent-active` | `#1e40af` | `#0a74e0` | `.primary-button` active/pressed fill |
| `--accent-ink` | `#ffffff` | *(not redefined)* | Text on accent fill (`.primary-button` label) — both theme's accent blues are dark enough that white still reads |
| `--accent-wash` | `rgba(37,99,235,.1)` | `rgba(10,132,255,.16)` | Tint behind the active `.shell-nav-item` |
| `--focus-ring` | `rgba(37,99,235,.35)` | `rgba(10,132,255,.45)` | The `box-shadow` ring on every `:focus-visible` state |
| `--danger` | `#dc2626` | `#ff453a` | `.field-error`, `.form-error` text, `.doctor-queue-overdue`, `.flow-overdue` — the one non-stage semantic colour, reserved for "this needs attention now" |
| `--success` | `#16a34a` | `#34c759` | `--stage-paid`, `.flow-bar-seen` |
| `--warning` | `#d97706` | `#ff9f0a` | `--stage-packing` only, today |
| `--staging-bg` / `--staging-ink` | `#b91c1c` / `#ffffff` | *(not redefined)* | The staging strip. Deliberately a separate token from `--danger` — same register (a real warning), different meaning (environment, not a form/data problem), so retuning one never silently moves the other |

Dark's specific hex values are carried over unchanged from before this redesign — they weren't part of the brief, and the point of the change was *reachability* (opt-in only, not OS-driven), not new dark-mode colours.

### Stage-semantic tokens

A separate categorical set, not redefined per theme (each is saturated enough to read on both light and dark):

| Token | Light value | Stage |
|---|---|---|
| `--stage-waiting` | `var(--text-tertiary)` | `waiting` |
| `--stage-with-doctor` | `var(--accent)` | `with_doctor` |
| `--stage-packing` | `var(--warning)` | `packing` |
| `--stage-ready` | `#7c3aed` (dark: `#af52de`) | `ready_at_reception` |
| `--stage-paid` | `var(--success)` | `paid` |

`--stage-waiting` now aliases `--text-tertiary` instead of carrying its own literal grey — the two were already visually adjacent before this redesign; this closes that gap so retuning one retunes both.

---

## Type scale

One scale, no per-screen overrides. **No `line-height` is declared anywhere in the codebase** — every element runs on the browser's default (`normal`, ≈1.15 for this font stack at these sizes). That's a gap, not a decision.

| Token | Size | In use? | Where |
|---|---|---|---|
| `--text-xs` | 0.8125rem (13px) | yes | `.field-label`, `.field-error`, `.shell-topbar-user`, `.shell-sidebar-foot`, `.readout-heading`, `.stage-pill`, `.flow-stat-label`, `.staging-banner` |
| `--text-sm` | 0.9375rem (15px) | yes | `.search-result-meta`, `.shell-clinic-name`, `.shell-nav-item`, `.doctor-queue-meta` |
| `--text-base` | 1.0625rem (17px) | yes | Body default for interactive/data text: `.search-strip`, `.search-result-button`, `.primary-button`/`.secondary-button`, `.field input`/`select`, `.no-match`, `.readout-empty`, `.readout-row`, `.shell-topbar-section`, `.pricing-row` |
| `--text-md` | 1.25rem (20px) | **no** | Declared in `index.css`, not referenced anywhere. Dead token. |
| `--text-lg` | 1.5rem (24px) | yes | `.form-heading` |
| `--text-xl` | 2rem (32px) | yes | `.signin-heading`, `.flow-stat-value` (the one earned use of the hero-metric numeral scale in Operate mode — see "Today's flow" below) |

### Weights in use: 400, 500, 600, 700

No 300 or 800 anywhere.

| Weight | Where |
|---|---|
| 400 | `.search-result-meta` explicitly; everything else at default weight (body copy, `<p>` text) is implicitly 400 from the browser default — never set on purpose |
| 500 | `.search-result-button`, `.readout-name` |
| 600 | `.shell-nav-item`, `.shell-signout`, `.primary-button`/`.secondary-button`, `.field-label`, `.field-error`, `.form-error`, `.stage-pill`, `.flow-stat-label`, `.doctor-queue-overdue` |
| 700 | `.shell-clinic-name`, `.shell-topbar-section`, `.form-heading`, `.readout-heading`, `.readout-token`, `.signin-heading`, `.flow-stat-value`, `.pricing-value` |

700 is reserved for headings/labels-that-read-as-headings, tabular data that needs to stand out (queue token, flow-widget numbers, a price), and the general "this is interactive or a form label" weight is 600; 500 marks the two places body-weight text needs slightly more presence without going full bold.

---

## Spacing scale

4pt-ish scale, all six steps are in active use:

| Token | Value | Typical use |
|---|---|---|
| `--space-2xs` | 0.25rem (4px) | Tightest gaps: `.field` internal gap, `.stage-pill` icon-to-label gap, `.shell-signout` top margin, `.flow-stat` internal gap |
| `--space-xs` | 0.5rem (8px) | `.search-results` list gap, `.shell-nav-item` padding, `.action-row` gap |
| `--space-sm` | 0.75rem (12px) | `.readout-row` gap/padding, `.field input` horizontal padding |
| `--space-md` | 1rem (16px) | The most common block gap: `.field` bottom margin, `.no-match`/`.search-results` top margin, `.shell-content` padding scale step, `.readout-section`/`.readout-list` padding, `.flow-stats` bottom margin |
| `--space-lg` | 1.5rem (24px) | Card padding: `.form-panel`, `.signin`, `.shell-sidebar`/`.shell-topbar` padding; `.record-section` top padding (the section-divider rhythm, see below) |
| `--space-xl` | 2.5rem (40px) | Largest gaps: `.reception-grid`/`.consultation-grid` column gap, `.shell-content` padding, `.signin` top margin, `.readout-section`'s sticky `top` offset, `.record-section` top margin |

Used consistently with `gap`/`padding`/`margin` from this scale — no raw pixel values appear in any component stylesheet outside this token set (aside from the control-height and radius values below, which are their own named tokens/exceptions).

---

## Radii, borders, shadows

| Token | Value | Used for |
|---|---|---|
| `--radius-card` | 16px | `.form-panel`, `.signin`, `.readout-section` |
| `--radius-input` | 12px | `.search-result-button`, `.primary-button`/`.secondary-button`, `.field input`/`select`, `.shell-nav-item`, `.readout-list`, `.procedure-price-input` |
| `--radius-pill` | 999px | `.search-strip`, `.flow-bar` |

**Exception:** `.shell-signout:focus-visible` sets `border-radius: 4px` as a literal value — not one of the three named radii. `AppShell`'s own chrome (`.shell`, `.shell-sidebar`, `.shell-topbar`) carries no radius at all, correctly, since it's edge-to-edge viewport chrome.

**Borders:** always 1px, always `--border` by default, `--border-strong` on hover/emphasis. Width never changes between states (see "The rules" above) — only colour does.

**Shadow:** one token, `--shadow-card` (`0 1px 2px rgba(0,0,0,.04), 0 8px 24px rgba(0,0,0,.06)` light; heavier alpha in dark). It's reserved for panels that appear/disappear as an overlay-like moment — `.form-panel` and `.signin`. `.readout-section` and `.readout-list`, which are always on screen rather than a transient state, get a border only, no shadow. The Consultation record area carries **no shadow and no card fill at all** (see below) — it isn't a transient overlay, and after this redesign it isn't a bounded panel either.

---

## Card-free grouping (Consultation record area)

Before this redesign, the doctor's open patient record was a single `.record-panel` card (fill + border + radius + shadow) with *further* cards nested inside it — a boxed `.drug-row` per prescribed drug, a boxed `.pricing-block` for the pricing section. That's exactly the "nested cards" anti-pattern, and combined with the old dark-by-OS-default canvas, it read as a small card floating in a mostly empty (in dark mode, black) page.

Fixed by removing every inner card and the outer one:

- **`.record-area`** (renamed from `.record-panel`) has no `background`, `border`, `border-radius`, or `shadow` at all. It's page content directly on `--bg`, not a panel.
- **`.record-section`** groups (Comments, Demographics, Today's complaint, Past visits, Past prescriptions, Write prescription) are separated by a `border-top: 1px solid var(--border)` plus `padding-top`/`margin-top` from the spacing scale — a hairline rule and generous space, not a box.
- **`.drug-row`** (one prescribed drug's fields, in `PrescriptionForm.tsx`) lost its `background`/`border`/`border-radius` the same way — now a `border-top` + spacing between rows, first row unruled.
- **`.pricing-block`** (in `PricingPanel.tsx`) lost its `background`/`border`/`border-radius` too, replaced by a single `border-top` before "Calculated total."

A card is still used exactly where grouping earns it — `.form-panel`/`.signin` on Reception, which mark an actual transient, appear/disappear moment (search → confirm-patient → new-patient). The Consultation record area is always-on content, not a transient moment, so per "The rules" above it doesn't get one.

---

## Today's flow (Consultation queue metrics)

A small, always-real stat widget above the doctor's own queue list (`TodayFlow` in `Consultation.tsx`), added in the same redesign pass at the user's explicit request for a queue-visibility metric — the one thing this category of software is expected to surface at a glance.

**Numbers, every one derived from `visits.stage`/`visits.arrived_at` for the clinic, filtered to today, at render time — nothing stored, nothing invented:**
- **Waiting** — count where `stage = 'waiting'`.
- **Seen today** — count where `stage` is anything past `waiting`/`with_doctor` (packing, ready at reception, or paid) — from the doctor's own desk, once a visit leaves his queue it's "seen."
- **Avg wait now** — the mean of `now − arrived_at` across only the currently-`waiting` visits. This is a *live* figure (recomputed on every render, not on a ticking clock — same "no new pattern" choice as `formatElapsed` elsewhere, which only updates on a query refetch or Realtime event). It is **not** a historical "average visit duration" metric — that would need a stored stage-transition timestamp this schema doesn't have, and reporting-style historical metrics belong to the (unbuilt) Reports screen, not here.

**Visualisation:** a `.flow-bar` — one proportional pill-shaped bar with up to three segments (`waiting` / `with_doctor` / `seen today`), each coloured with the *same* stage-semantic token used everywhere else (`--stage-waiting`, `--stage-with-doctor`, `--stage-paid`) — not a new palette invented for the widget. `flexGrow` set to each count is what proportions the segments; a stage with 0 visits renders no segment at all rather than a zero-width one.

**The one deliberate use of the hero-metric numeral pattern:** `.flow-stat-value` is set at `--text-xl` (2rem), the same size as `.signin-heading` and otherwise unused elsewhere in Operate-mode UI. Reserved for exactly these three numbers — this is the brief's own explicit ask for a metrics widget earning back a pattern this document would otherwise flag as a default to avoid.

**Overdue colour:** when `Avg wait now` reaches `LONG_WAIT_MINUTES` (30, a constant in `Consultation.tsx`, not stored/configurable), its value gets `.flow-overdue` (`color: var(--danger)`). The same threshold and colour apply per-row in the queue list itself — the queue row's elapsed-time span gets `.doctor-queue-overdue` (danger colour + 700 weight) once that patient individually has waited 30+ minutes, independent of the aggregate. This is the redesign brief's "reserve colour for clinical and state meaning — stage, overdue waits" made concrete: two real signals (the aggregate and the per-patient one), same colour, same meaning, no decoration.

---

## Staging strip

Redesigned from an inline-styled, full-attention `#ff0000` bar (`background: '#ff0000'`, bold, letter-spaced, no height limit beyond its own padding) to a fixed **28px** strip (`StagingBanner.css`), using `--staging-bg`/`--staging-ink` (a token pair separate from `--danger` — see the colour-tokens table). Carries a small warning-triangle SVG (`aria-hidden`) alongside the text, matching the app's established "never colour alone" convention from the stage-indicator model, even though text is already present here too. Unmistakable by contrast and the icon, not by dominating the viewport.

---

## Stage indicator model

Defined in `TokenList.tsx`'s `STAGES` map and `StageShape`. Every one of the five values in the `visits.stage` check constraint gets a distinct **shape + colour + word** — never colour alone, so it survives any colour-vision deficiency, and the word is rendered visibly (not screen-reader-only), since nothing about this screen requires glance-only scanning:

| Stage value | Label shown | Colour token | Shape |
|---|---|---|---|
| `waiting` | "Waiting" | `--stage-waiting` | Open ring (stroked circle, no fill) |
| `with_doctor` | "With doctor" | `--stage-with-doctor` | Filled circle |
| `packing` | "Packing" | `--stage-packing` | Filled diamond (rotated square) |
| `ready_at_reception` | "Ready at reception" | `--stage-ready` | Filled triangle |
| `paid` | "Paid" | `--stage-paid` | Filled circle + a check stroke in `--surface` on top |

Each is a 20×20 inline SVG, `aria-hidden`, followed by the plain-text label in the same `.stage-pill` span — the accessible name comes from the real text node, not from an `aria-label` on the icon. An unrecognised stage value falls back to a dashed open ring in `--text-tertiary`, labelled with the raw stage string, so an unmapped value fails visibly rather than silently.

---

## Motion

Library: `motion` (`motion/react`), used for exactly two categories of animation — nothing else in the app moves, and this redesign pass didn't add a third. Operate-mode UI earns familiarity, not choreography (see `docs/security-review.md`-adjacent guidance in the impeccable skill's `operate.md`: 150–250ms, state-only, no orchestrated load sequences) — the existing restraint here was already correct and is left alone.

### 1. Panel transitions — `Reception.tsx`

Switching between the three mutually-exclusive views (search / confirm-existing-patient / new-patient form) is wrapped in `<AnimatePresence mode="wait">`, so the outgoing panel finishes exiting before the next one enters — never overlapping.

```
initial: { opacity: 0, y: 8 }
animate: { opacity: 1, y: 0 }
exit:    { opacity: 0, y: -8 }
transition: { duration: 0.22, ease: [0.16, 1, 0.3, 1] }
```

Trigger: `selected` state changing (a search result picked, "New patient" clicked, or Cancel/success resetting back to search).

### 2. Queue row entrance — `TokenList.tsx`

Each row in `.readout-list` is a `motion.div` inside `<AnimatePresence initial={false}>` (so the first render of existing rows doesn't animate — only rows that newly appear via a Realtime-triggered refetch do) with `layout` enabled (so a row sliding to a new position reflows smoothly rather than jumping):

```
initial: { opacity: 0, y: 8 }
animate: { opacity: 1, y: 0 }
exit:    { opacity: 0 }
transition: { duration: 0.22, ease: [0.16, 1, 0.3, 1] }
```

Same duration and easing curve as the panel transition, but declared as a second, separate local constant (`rowTransition` in `TokenList.tsx` vs. `panelTransition` in `Reception.tsx`) — not shared from one module. If a shared motion-tokens file is ever introduced, this is the pair to fold into it.

### 3. Tap feedback — buttons

Every button in the app is a `motion.button` with `whileTap={{ scale: 0.97 }}`, no explicit transition (Motion's default spring). The value `0.97` is redeclared inline in several files rather than imported from one place — same value everywhere, no drift, just not centralised.

**Nothing else animates.** No hover transitions run through Motion — hover/focus/disabled states are plain CSS `transition` on `background-color`/`border-color`/`box-shadow` at 150–180ms, using the CSS `--ease-out` token (`cubic-bezier(0.16, 1, 0.3, 1)` — the same curve as the two Motion transitions above, just expressed as a CSS custom property instead of a JS array in that context). The `.flow-bar` segments have no entrance animation — they're derived data, present on first paint, not a moment to choreograph.

---

## Component patterns

### Shell (`AppShell.tsx` / `.css`)

CSS grid, `220px 1fr` columns × `56px 1fr` rows, sidebar spanning both rows. Sidebar: `--surface` (white) fill, clinic name (fetched live via a `clinics.name` query, blank space reserved while loading so nothing jumps), one active nav item (icon + label, `--accent-wash` background, `--accent` text — there's currently only ever one item, so there's no established "inactive nav item" style yet), then a footer pinned to the bottom via `margin-top: auto` holding the user's email and a plain-text "Sign out" action. Top bar: `--surface` fill, section name left, user email right. Content area (`--bg` fill, the canvas) scrolls independently (`overflow-y: auto`) rather than the whole page. Collapses to a horizontal strip above the content on ≤720px.

### Search field (`.search-strip`)

A pill (`--radius-pill`), icon baked into `background-image` (not a real DOM element), `--bg` fill against the `--surface` content area behind it (so it reads as recessed, not raised). Border colour + a 4px focus-ring box-shadow on focus — the one control with a 4px ring instead of 3px (see exception below).

### Result row / table row (`.search-result-button`, `.readout-row`, `.doctor-queue-row`)

The same idea in different tags: a horizontal row of `token — name — meta` with a hairline border, no shadow. `.search-result-button` is a real `<button>` (it's a choice); `.readout-row`/`.doctor-queue-row` are non-interactive `motion.div`/`div` in a CSS grid rather than an HTML `<table>` — chosen (on Reception's `.readout-row`) so Motion can animate each row independently, which an HTML table row can't easily do.

### Panel (`.form-panel`, `.signin`)

Card: `--surface` fill, `--border` outline, `--radius-card`, `--shadow-card`. `.signin` additionally centers itself (`margin: var(--space-xl) auto 0`) since it renders with no shell around it (unauthenticated). This is the *only* card pattern left in the app after the Consultation redesign — see "Card-free grouping" above for why the record area, drug rows, and pricing block no longer use it. One thing to note in `Reception.tsx`: the new-patient view's outer `motion.div` wrapper carries **no** `.form-panel` class — only `NewPatientForm`'s own `<form>` does — specifically so the panel styling isn't applied twice.

### Buttons and inputs — state coverage

| State | Buttons (`.primary-button`/`.secondary-button`) | Inputs (`.field input`/`select`, `.search-strip`) |
|---|---|---|
| Default | fill/border per variant | `--surface-2` (form fields) or `--bg` (search-strip) fill, `--border` |
| Hover | `--accent-hover` fill (primary only; `@media (hover: hover)` guarded) / `--surface-2` (secondary) | `--border-strong` border (`@media (hover: hover)` guarded) |
| Focus-visible | 3px `--focus-ring` box-shadow | 3px `--focus-ring` box-shadow + border → `--accent`; **`.search-strip` is 4px, not 3px** |
| Active/pressed | `--accent-active` fill (primary only, plain CSS `:active`) *and* Motion's `whileTap` scale-to-0.97 on every button — both fire together | — |
| Disabled | `--border-strong` fill (see the colour-token exception above), `--text-tertiary` text | `opacity: 0.5`, `cursor: not-allowed` (`.field input:disabled` only — `.search-strip` and `.secondary-button` have no disabled path defined) |

No loading or error visual state exists on buttons — pending mutations only swap the label text ("Check in" → "Checking in…"), there's no spinner glyph.

---

## Known inconsistencies (left as exceptions, not normalised)

1. `--text-md` (1.25rem) is declared and never used.
2. `--border-strong` doubles as `.primary-button:disabled`'s background fill, outside its "border colour" name.
3. The search icon's SVG data-URI hardcodes a pre-redesign tertiary value (`#86868b`) and tracks neither theme's current `--text-tertiary`.
4. `.shell-signout:focus-visible` uses a literal `4px` border-radius instead of one of the three named radius tokens.
5. Focus-ring width is 4px on `.search-strip`, 3px everywhere else.
6. `panelTransition` (`Reception.tsx`) and `rowTransition` (`TokenList.tsx`) are identical values declared twice, not shared.
7. `whileTap={{ scale: 0.97 }}` is redeclared inline in several files instead of imported once.
8. No `line-height` is set anywhere; every element runs on the browser default for this font stack.
9. Buttons have no loading-spinner or error visual state — only a label-text swap during a pending mutation.
10. Dark mode's specific hex values were not retuned in this redesign (only its reachability changed, from OS-automatic to explicit-attribute-only) — they still carry the pre-redesign palette's relationships, not the new light palette's.

Resolved by this redesign (previously listed here, no longer true): `--stage-waiting` used to be a separate literal grey instead of aliasing `--text-tertiary` — it now does.
