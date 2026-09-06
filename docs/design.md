# Design system — extracted from the built code

This is a record of what `AppShell`, `Consultation`, `Reception`, and
`Billing` actually implement, read out of the CSS and components as
they exist right now. Nothing here was decided fresh for this document
— where the code itself is inconsistent, that inconsistency is written
down as an exception, not smoothed over.

**v2 note:** this is the second visual pass. The first pass (system
font, Apple-HIG-style restraint, zero cards anywhere) was rejected —
it read as "no design at all" and shipped with a real responsive bug
(a CSS Grid min-width blowout that broke the app below ~500px). v2
replaces the whole visual language: Inter, an indigo/slate palette,
and real elevated cards are back, but *literal* card-in-card nesting is
still avoided — each screen has exactly one outer card per logical
region (the record area, the queue panel, a form), and grouping inside
that card is a hairline `border-top`, not a second card.

Read this before building a new screen. Its tokens are the only ones a
new screen may use. A value that doesn't exist yet gets added to
`src/index.css` (and this file), never invented inline in a component's
stylesheet.

**Source files:**
- Tokens + font loading — `src/index.css`, `src/main.tsx` (`@fontsource/inter` imports)
- Shell chrome — `src/components/AppShell.tsx` + `AppShell.css`
- Staging strip — `src/components/StagingBanner.tsx` + `.css`
- Reception content — `src/pages/Reception.tsx` + `Reception.css`
- Consultation content — `src/pages/Consultation.tsx` + `Consultation.css`, `src/components/PrescriptionForm.tsx`, `src/components/PricingPanel.tsx`
- Billing content — `src/components/Billing.tsx` + `Billing.css` (reuses `.record-area`/`.record-section`/`.pricing-block` from Consultation.css — see "Shared classes across screens" below)
- Token list / stage model — `src/components/TokenList.tsx`
- Forms — `src/components/NewPatientForm.tsx`, `src/components/SignIn.tsx`

---

## The rules

- **One family: Inter.** Self-hosted via `@fontsource/inter` (400/500/600/700/800 weights imported in `main.tsx`), not a Google Fonts CDN link — this clinic's own non-negotiables require the app to keep rendering with zero connectivity, and a font that depends on a live CDN request would silently fall back the moment the network drops. `-apple-system`/system-ui stays in the `--font` stack only as a last-resort fallback if the self-hosted files somehow fail to load, not as part of the design.
- **One accent: indigo.** `--accent` (and its hover/active/wash/focus-ring variants) is the only chromatic brand colour. The stage-semantic colours are a separate, deliberately multi-hue set for data encoding, not brand accent — see "Stage indicator model" below.
- **Light is primary, dark is secondary, from one token set.** All colour tokens are declared once in `:root` — that block *is* the light theme, and it is what renders unconditionally, regardless of the OS's own light/dark preference. Dark only applies via an explicit `:root[data-theme='dark']` override of the same token names; there is no `@media (prefers-color-scheme: dark)` auto-switch. Nothing has a UI control to set `data-theme="dark"` yet — the override exists so a future settings toggle has a theme to switch to. Nothing outside `index.css` branches on theme.
- **One real card per region, never two deep.** Each screen's major regions — the queue panel, the open patient's record, a bill, a sign-in/check-in form — get exactly one elevated card (`--surface` fill, `--border` outline, `--radius-card`, `--shadow-card`/`--shadow-card-sm`). *Inside* that card, grouping is a hairline `border-top` plus spacing, never a second filled/bordered/radiused box. See "Card language" below.
- **Colour carries meaning, never decoration.** The stage-semantic set, `--danger` on an overdue wait, `--staging-bg` on the environment strip, the wash-tinted status badges — every chromatic use maps to a real state. Nothing is coloured just to look lively.
- **Grid items get `min-width: 0`.** Any CSS Grid item that contains a flex row with non-shrinking children (icons, badges, buttons) must declare `min-width: 0` on itself, or its content's min-content size silently overrides the track width the grid gave it and blows out the layout — this is exactly what broke the mobile shell before v2 (see "Known inconsistencies" #10 for the full story). Check this on any new grid-item-that-contains-a-flex-row.
- **No layout shift on interaction.** Every bordered control keeps the same `border-width` across default/hover/focus/disabled; state changes move to `background-color`, `border-color`, or `box-shadow` only.
- **Focus is never colour-only.** Every focus-visible state adds a `box-shadow` ring in `--focus-ring`; several also shift `border-color` to `--accent`.

---

## Colour tokens

| Token | Light (primary) | Dark (secondary, `[data-theme='dark']` only) | Used for |
|---|---|---|---|
| `--bg` | `#f8fafc` | `#0b1120` | Page canvas: `.shell-content`. Also the fill behind `.search-strip` and `.flow-bar` track |
| `--surface` | `#ffffff` | `#161f34` | Card fill: `.form-panel`, `.signin`, `.readout-section`, `.record-area`, `.shell-sidebar`, `.shell-topbar` |
| `--surface-2` | `#f1f5f9` | `#1c2740` | Secondary surface: hover background on `.search-result-button` / `.field input`, `.stage-pill` fill |
| `--border` | `#e2e8f0` | `rgba(255,255,255,.1)` | Default hairline: card borders, row dividers, shell dividers, section dividers |
| `--border-strong` | `#cbd5e1` | `rgba(255,255,255,.18)` | Emphasis border: `.secondary-button`, hover border on `.search-result-button` / `.field input`. **Exception:** also reused as `.primary-button:disabled`'s *background fill*. |
| `--text` | `#0f172a` | `#f1f5f9` | Primary text |
| `--text-secondary` | `#64748b` | `#94a3b8` | Secondary text: `.readout-token` (pre-v2; token badge is now accent-coloured, see Stage indicator model), `.stage-pill` label, `.flow-stat-label`, form helper copy |
| `--text-tertiary` | `#94a3b8` | `#64748b` | Quietest text: placeholders, `.readout-heading`, disabled-button text, `--stage-waiting`. **Exception:** the search icon drawn into `.search-strip`'s `background-image` is a static SVG data-URI with a hardcoded stroke colour — updated to the current light value at each redesign pass so far, but still not a live token reference, and still wrong in dark mode. |
| `--accent` | `#4f46e5` (indigo-600) | `#818cf8` | `.primary-button` fill, `.search-strip` focus border, `.shell-nav-item` active text, `--stage-with-doctor`, `.readout-token` badge |
| `--accent-hover` | `#4338ca` | `#a5b4fc` | `.primary-button` hover fill |
| `--accent-active` | `#3730a3` | `#6366f1` | `.primary-button` active/pressed fill |
| `--accent-ink` | `#ffffff` | *(not redefined)* | Text on accent fill |
| `--accent-wash` | `rgba(79,70,229,.1)` | `rgba(129,140,248,.18)` | Tint behind the active `.shell-nav-item`, `.readout-token` badge background |
| `--focus-ring` | `rgba(79,70,229,.35)` | `rgba(129,140,248,.45)` | The `box-shadow` ring on every `:focus-visible` state |
| `--danger` / `--danger-wash` | `#dc2626` / `rgba(220,38,38,.1)` | `#f87171` / `rgba(248,113,113,.16)` | `.field-error`, `.form-error`, `.doctor-queue-overdue`, `.flow-overdue`, `.shell-signout:hover` |
| `--success` / `--success-wash` | `#059669` / `rgba(5,150,105,.1)` | `#34d399` / `rgba(52,211,153,.16)` | `--stage-paid`, `.flow-bar-seen`, the "Paid" badge |
| `--warning` / `--warning-wash` | `#d97706` / `rgba(217,119,6,.1)` | `#fbbf24` / `rgba(251,191,36,.16)` | `--stage-packing` |
| `--staging-bg` / `--staging-ink` | `#b91c1c` / `#ffffff` | *(not redefined)* | The staging strip — a deliberately separate token pair from `--danger`, same register (a real warning), different meaning (environment, not a form/data problem) |

### Stage-semantic tokens

| Token | Light value | Stage |
|---|---|---|
| `--stage-waiting` | `var(--text-tertiary)` | `waiting` |
| `--stage-with-doctor` | `var(--accent)` | `with_doctor` |
| `--stage-packing` | `var(--warning)` | `packing` |
| `--stage-ready` | `#8b5cf6` (violet-500; dark: `#a78bfa`) | `ready_at_reception` |
| `--stage-paid` | `var(--success)` | `paid` |

---

## Type scale, weights, spacing, radii — unchanged shapes, new values

The scale *structure* from the previous pass carries over (same token names, same typical uses — see the previous version of this doc in git history for the full per-selector table if needed); only the underlying values changed:

- **Radii:** `--radius-card` 16px → **20px** (cards read more confidently rounded); `--radius-input` unchanged at 12px; `--radius-pill` unchanged.
- **Shadow:** `--shadow-card` is now visibly present (`0 1px 3px rgba(15,23,42,.08), 0 12px 32px rgba(15,23,42,.1)` light) rather than the previous barely-there version — cards should read as *lifted*, not just outlined. A second, lighter `--shadow-card-sm` (`0 1px 2px rgba(15,23,42,.06), 0 4px 12px rgba(15,23,42,.06)`) exists for cards that sit permanently on screen (`.readout-section`, `.record-area`) as opposed to `.form-panel`/`.signin`'s appear/disappear moment, which keeps the stronger `--shadow-card`.
- **Weight 800** is new (Inter's extra-bold) — used only for `.shell-clinic-name`, giving the one piece of brand identity in the sidebar more presence than the general 700 heading weight.
- **Headings (`h1`/`h2`/`h3`)** get `letter-spacing: -0.02em` globally (in `index.css`) — Inter benefits from slightly tighter tracking at display sizes; body text is untouched.

---

## Card language

Every screen's outer regions are real cards now (`--surface` fill, `--border` outline, `--radius-card`, a shadow token). What each one is, and why it's the one level that earns a card:

| Card | Component | Shadow |
|---|---|---|
| Queue panel | `.readout-section` (`Reception.tsx`, and reused directly by `Consultation.tsx`'s left column) | `--shadow-card-sm` (always on screen) |
| Open patient record | `.record-area` (`Consultation.tsx`) | `--shadow-card-sm` |
| A bill | `.record-area` (`Billing.tsx` — same class, same card) | `--shadow-card-sm` |
| Search → confirm/new-patient panel | `.form-panel` (`Reception.tsx`) | `--shadow-card` (a transient, appear/disappear moment — the one place the stronger shadow is used) |
| Sign-in | `.signin` | `--shadow-card` |

**What does *not* get its own card, deliberately, because the region above already has one:**
- `.record-section` groupings inside `.record-area`/`.readout-section` (Comments, Demographics, Today's complaint, etc.) — a `border-top` + spacing.
- `.drug-row` (one prescribed drug's fields, in `PrescriptionForm.tsx`) — a `border-top` + spacing, first row unruled.
- `.pricing-block` (in `PricingPanel.tsx`/`Billing.tsx`) — a `border-top` before "Calculated total."
- `.readout-list` (the row list inside the queue card) — full-bleed (negative margin back out to the card's edge), rows get their own `border-bottom`, no separate box.

This is the one discipline carried over from the first pass, even though nearly everything else about it was reversed: **the outer card earns its keep (grouping a whole region genuinely helps); a second card immediately inside it does not (it's the same grouping, restated).**

### Shared classes across screens

`Billing.tsx` reuses `.record-area`/`.record-section`/`.pricing-block`/`.pricing-row`/`.pricing-value` directly from `Consultation.css` rather than duplicating them — this works because Vite bundles all statically-imported component CSS globally (there are no CSS Modules in this project), so `Consultation.css` is live on every screen regardless of which one is actually rendered. A change to these shared classes intentionally flows through to every screen that uses them; that's the point of the token/class system, not a leak to route around.

---

## Badges and status colour

- **`.stage-pill`** (queue rows, `TokenList.tsx`'s `STAGES` map) is now a filled badge — `--surface-2` background, `--radius-pill`, padded — not just coloured text. Still shape + colour + word (never colour alone), per the stage indicator model below.
- **`.readout-token`** (the queue-position number) is a small circular badge — `--accent-wash` fill, `--accent` text — instead of plain bold text. This is the one place `--accent` marks *position in a list* rather than an interactive action; it reads fine because nothing else on these rows is accent-coloured.
- **Overdue wait** — `.doctor-queue-overdue` / `.flow-overdue` set `color: var(--danger)` (700 weight) once a patient's wait crosses `LONG_WAIT_MINUTES` (30, a constant in `Consultation.tsx`). Real signal, not decoration — see "Today's flow" below.

---

## Today's flow (Consultation queue metrics)

Unchanged in substance from the first pass — still three real numbers derived from `visits.stage`/`arrived_at` at render time (waiting count, seen-today count, live average wait among currently-waiting visits) plus a proportional `.flow-bar` in the existing stage colours. Nothing fabricated, no new table, no new screen. It now lives inside `.readout-section`'s card instead of sitting on bare canvas above a hairline rule — same numbers, same bar, just inside the queue card rather than floating above it.

---

## Staging strip

28px strip, `--staging-bg`/`--staging-ink` tokens, a small warning-triangle SVG alongside the text — unchanged from the first pass. Still not a card (it's viewport-edge chrome, same footing as the shell itself).

---

## Stage indicator model

Defined in `TokenList.tsx`'s `STAGES` map and `StageShape`. Every one of the five values in the `visits.stage` check constraint gets a distinct **shape + colour + word** — never colour alone:

| Stage value | Label shown | Colour token | Shape |
|---|---|---|---|
| `waiting` | "Waiting" | `--stage-waiting` | Open ring (stroked circle, no fill) |
| `with_doctor` | "With doctor" | `--stage-with-doctor` | Filled circle |
| `packing` | "Packing" | `--stage-packing` | Filled diamond (rotated square) |
| `ready_at_reception` | "Ready at reception" | `--stage-ready` | Filled triangle |
| `paid` | "Paid" | `--stage-paid` | Filled circle + a check stroke in `--surface` on top |

Each is a 20×20 inline SVG, `aria-hidden`, followed by the plain-text label inside `.stage-pill` (now a filled badge, see above) — the accessible name comes from the real text node.

---

## Responsive / mobile

This is new discipline, not carried over from the first pass (which had no real mobile testing behind it and shipped a horizontal-overflow bug as a result). Verified at 390×844 (a real phone width) in addition to 1440×900 desktop:

- **`html, body { overflow-x: clip }`** — a hard backstop in `index.css` against any future horizontal-overflow regression, on top of fixing the actual causes below.
- **The AppShell min-width blowout (the actual bug reported):** `.shell-sidebar` is a CSS Grid item that also lays out as a flex row on mobile (clinic name + nav pill + sign-out). Grid items default to a content-based `min-width: auto` floor — without an explicit `min-width: 0`, the flex row's non-shrinking children (the nav pill, the sign-out button) forced the grid track wider than the `1fr` it was given, blowing the whole page out ~30px past the viewport. Fixed by adding `min-width: 0` to `.shell-sidebar`/`.shell-topbar`/`.shell-content`. **Any future grid item containing a flex row with icons/badges/buttons needs the same treatment** — check for this specifically, it won't show up at desktop widths.
- **The old mobile shell showed the user's email twice** (once in the sidebar footer, once in a separate `.shell-topbar` row) and crammed clinic name + nav + email + sign-out into one unreadable strip. Fixed: `.shell-topbar` is `display: none` on mobile (its job — showing the section name — is already covered by the active nav pill); the sidebar's mobile row is just clinic name (truncates) + nav pill(s) + an icon-only sign-out button (label hidden via `.shell-signout-label { display: none }`, icon-only fits in the space).
- **`.doctor-queue-row`** (5 fixed-ish grid columns: token / name / age-sex / complaint / elapsed) reflows to a 2-row `grid-template-areas` layout below 480px (token+name+elapsed on top, meta+complaint below, complaint wraps instead of truncating) rather than overflowing.
- **`.record-area`/`.readout-section`** get reduced horizontal padding below 480px (`--space-md` instead of `--space-xl`) so card content doesn't fight the viewport for room.
- **`.reception-grid`/`.consultation-grid`** already collapsed to one column at 900px from the first pass — that part was correct; the queue card's `position: sticky` is turned off below 900px (`position: static`) since a stacked single-column layout has no second pane for it to stay level with.

---

## Motion

Unchanged from the first pass: `motion`/`motion/react`, exactly three categories (panel transitions on Reception, queue-row entrance, button tap feedback), nothing else moves. See the previous version of this document (git history) for the exact keyframe values if needed — v2 didn't touch motion, only colour/type/card/layout.

---

## Known inconsistencies (left as exceptions, not normalised)

1. `--text-md` (1.25rem) is declared and never used.
2. `--border-strong` doubles as `.primary-button:disabled`'s background fill, outside its "border colour" name.
3. The search icon's SVG data-URI hardcodes a literal tertiary-grey stroke value and doesn't track `--text-tertiary` as a live variable (can't — it's a static data URI) — updated to the current light value at each pass, but still wrong in dark mode.
4. `.shell-signout:focus-visible` uses a plain `outline` (no radius token) rather than the `box-shadow`-ring pattern used elsewhere.
5. Focus-ring width is 4px on `.search-strip`, 3px everywhere else.
6. `panelTransition` (`Reception.tsx`) and `rowTransition` (`TokenList.tsx`) are identical values declared twice, not shared.
7. `whileTap={{ scale: 0.97 }}` is redeclared inline in several files instead of imported once.
8. No `line-height` is set anywhere; every element runs on the browser default for this font stack.
9. Buttons have no loading-spinner or error visual state — only a label-text swap during a pending mutation.
10. **v1→v2 history, not a live bug:** the first redesign pass removed all cards and switched dark-mode reachability from OS-automatic to explicit-attribute-only, but shipped without testing any viewport narrower than 1440px, which is how the AppShell min-width blowout (see "Responsive / mobile" above) went out undetected. v2 fixes the blowout and reverses the no-cards decision; the "test at a real mobile width before calling a visual pass done" lesson is the thing worth not repeating, more than any specific value here.
