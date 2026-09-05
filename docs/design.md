# Design system — extracted from the built code

This is a record of what `AppShell` and the Reception screen actually
implement, read out of the CSS and components as they exist right now.
Nothing here was decided fresh for this document — where the code itself
is inconsistent, that inconsistency is written down as an exception, not
smoothed over.

Read this before building a new screen. Its tokens are the only ones a
new screen may use. A value that doesn't exist yet gets added to
`src/index.css` (and this file), never invented inline in a component's
stylesheet.

**Source files:**
- Tokens — `src/index.css`
- Shell chrome — `src/components/AppShell.tsx` + `AppShell.css`
- Reception content — `src/pages/Reception.tsx` + `Reception.css`
- Token list / stage model — `src/components/TokenList.tsx`
- Forms — `src/components/NewPatientForm.tsx`, `src/components/SignIn.tsx`

---

## The rules

- **One family.** `-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI', Roboto, Helvetica Neue, Arial, sans-serif` — no second face is loaded anywhere. Form controls (`input`, `select`, `button`) don't inherit the body font by default in browsers, so every one of them declares `font-family: inherit` explicitly.
- **One accent.** `--accent` (and its hover/active/wash/focus-ring variants) is the only chromatic brand colour. The stage-semantic colours are a separate, deliberately multi-hue set for data encoding, not brand accent — see "Stage indicator model" below.
- **Adaptive light/dark from one token set.** All colour tokens are declared once in `:root` (light values). Dark is applied two ways over that same set of names: automatically via `@media (prefers-color-scheme: dark)` guarded by `:root:not([data-theme='light'])`, and forced via `:root[data-theme='dark']`. Nothing outside `index.css` branches on theme — every component reads the same variable names regardless of which theme is active.
- **No layout shift on interaction.** Every bordered control keeps the same `border-width` across default/hover/focus/disabled; state changes move to `background-color`, `border-color`, or `box-shadow` only.
- **Focus is never colour-only.** Every focus-visible state adds a `box-shadow` ring in `--focus-ring`; several also shift `border-color` to `--accent`. See the exception noted under Buttons/Inputs below — ring width isn't fully consistent.

---

## Colour tokens

| Token | Light | Dark | Used for |
|---|---|---|---|
| `--bg` | `#f5f5f7` | `#000000` | Page canvas; also the fill behind `.search-strip` and `.readout-section` — a "recessed" surface one step behind `--surface` |
| `--surface` | `#ffffff` | `#1c1c1e` | Card fill: `.form-panel`, `.signin`, `.shell-topbar`, `.shell-content`, `.readout-list` |
| `--surface-2` | `#fbfbfd` | `#17171a` | Secondary surface: `.shell-sidebar` fill; hover background on `.search-result-button` / `.field input` |
| `--border` | `rgba(0,0,0,.08)` | `rgba(255,255,255,.1)` | Default hairline: card borders, row dividers, shell dividers |
| `--border-strong` | `rgba(0,0,0,.14)` | `rgba(255,255,255,.16)` | Emphasis border: `.secondary-button`, hover border on `.search-result-button` / `.field input`. **Exception:** also reused as `.primary-button:disabled`'s *background fill*, not a border — the only place a "border" token colours a surface. |
| `--text` | `#1d1d1f` | `#f5f5f7` | Primary text |
| `--text-secondary` | `#6e6e73` | `#98989d` | Secondary text: `.readout-token`, `.stage-pill` label, form helper copy |
| `--text-tertiary` | `#86868b` | `#6e6e73` | Quietest text: placeholders, `.readout-heading`, disabled-button text. **Exception:** the search icon drawn into `.search-strip`'s `background-image` is a static SVG data-URI with `stroke='%2386868b'` hardcoded — it stays the *light-mode* tertiary value in dark mode instead of tracking the token. |
| `--accent` | `#0071e3` | `#0a84ff` | `.primary-button` fill, `.search-strip` focus border, `.shell-nav-item` text, `--stage-with-doctor` |
| `--accent-hover` | `#0077ed` | `#3396ff` | `.primary-button` hover fill |
| `--accent-active` | `#0068d1` | `#0a74e0` | `.primary-button` active/pressed fill |
| `--accent-ink` | `#ffffff` | *(not redefined)* | Text on accent fill (`.primary-button` label) — both theme's accent blues are dark enough that white still reads |
| `--accent-wash` | `rgba(0,113,227,.12)` | `rgba(10,132,255,.16)` | Tint behind the active `.shell-nav-item` |
| `--focus-ring` | `rgba(0,113,227,.35)` | `rgba(10,132,255,.45)` | The `box-shadow` ring on every `:focus-visible` state |
| `--danger` | `#ff3b30` | *(not redefined)* | `.field-error`, `.form-error` text |
| `--success` | `#34c759` | *(not redefined)* | Declared, but the only consumer is `--stage-paid` — there is no standalone success toast/banner yet |

Dark mode currently carries identical values whether it's OS-triggered or `data-theme="dark"`-forced — the two blocks in `index.css` are duplicated, not divergent.

### Stage-semantic tokens

A separate categorical set, not redefined per theme (each is saturated enough to read on both light and dark):

| Token | Value | Stage |
|---|---|---|
| `--stage-waiting` | `#8e8e93` | `waiting` |
| `--stage-with-doctor` | `var(--accent)` | `with_doctor` |
| `--stage-packing` | `#ff9500` | `packing` |
| `--stage-ready` | `#af52de` | `ready_at_reception` |
| `--stage-paid` | `var(--success)` | `paid` |

`--stage-waiting` is a literal grey rather than aliasing `--text-tertiary`, even though the two values are close in both themes — worth knowing if one is ever retuned, since the other won't follow.

---

## Type scale

One scale, no per-screen overrides. **No `line-height` is declared anywhere in the codebase** — every element runs on the browser's default (`normal`, ≈1.15 for this font stack at these sizes). That's a gap, not a decision.

| Token | Size | In use? | Where |
|---|---|---|---|
| `--text-xs` | 0.8125rem (13px) | yes | `.field-label`, `.field-error`, `.form-error`'s sibling sizing n/a, `.shell-topbar-user`, `.shell-sidebar-foot`, `.readout-heading`, `.stage-pill` |
| `--text-sm` | 0.9375rem (15px) | yes | `.search-result-meta`, `.shell-clinic-name`, `.shell-nav-item` |
| `--text-base` | 1.0625rem (17px) | yes | Body default for interactive/data text: `.search-strip`, `.search-result-button`, `.primary-button`/`.secondary-button`, `.field input`/`select`, `.no-match`, `.readout-empty`, `.readout-row`, `.shell-topbar-section` |
| `--text-md` | 1.25rem (20px) | **no** | Declared in `index.css`, not referenced anywhere. Dead token. |
| `--text-lg` | 1.5rem (24px) | yes | `.form-heading` |
| `--text-xl` | 2rem (32px) | yes | `.signin-heading` only |

### Weights in use: 400, 500, 600, 700

No 300 or 800 anywhere.

| Weight | Where |
|---|---|
| 400 | `.search-result-meta` explicitly; everything else at default weight (body copy, `<p>` text) is implicitly 400 from the browser default — never set on purpose |
| 500 | `.search-result-button`, `.readout-name` |
| 600 | `.shell-nav-item`, `.shell-signout`, `.primary-button`/`.secondary-button`, `.field-label`, `.field-error`, `.form-error`, `.stage-pill` |
| 700 | `.shell-clinic-name`, `.shell-topbar-section`, `.form-heading`, `.readout-heading`, `.readout-token`, `.signin-heading` |

700 is reserved for headings/labels-that-read-as-headings and the queue's tabular token number; 600 is the general "this is interactive or a form label" weight; 500 marks the two places body-weight text needs slightly more presence (a clickable result row, a name in a data row) without going full bold.

---

## Spacing scale

4pt-ish scale, all six steps are in active use:

| Token | Value | Typical use |
|---|---|---|
| `--space-2xs` | 0.25rem (4px) | Tightest gaps: `.field` internal gap, `.stage-pill` icon-to-label gap, `.shell-signout` top margin |
| `--space-xs` | 0.5rem (8px) | `.search-results` list gap, `.shell-nav-item` padding, `.action-row` gap |
| `--space-sm` | 0.75rem (12px) | `.readout-row` gap/padding, `.field input` horizontal padding |
| `--space-md` | 1rem (16px) | The most common block gap: `.field` bottom margin, `.no-match`/`.search-results` top margin, `.shell-content` padding scale step, `.readout-section`/`.readout-list` padding |
| `--space-lg` | 1.5rem (24px) | Card padding: `.form-panel`, `.signin`, `.shell-sidebar`/`.shell-topbar` padding |
| `--space-xl` | 2.5rem (40px) | Largest gaps: `.reception-grid` column gap, `.shell-content` padding, `.signin` top margin, `.readout-section`'s sticky `top` offset |

Used consistently with `gap`/`padding`/`margin` from this scale — no raw pixel values appear in any component stylesheet outside this token set (aside from the control-height and radius values below, which are their own named tokens/exceptions).

---

## Radii, borders, shadows

| Token | Value | Used for |
|---|---|---|
| `--radius-card` | 16px | `.form-panel`, `.signin`, `.readout-section` |
| `--radius-input` | 12px | `.search-result-button`, `.primary-button`/`.secondary-button`, `.field input`/`select`, `.shell-nav-item`, `.readout-list` |
| `--radius-pill` | 999px | `.search-strip` only |

**Exception:** `.shell-signout:focus-visible` sets `border-radius: 4px` as a literal value — not one of the three named radii. `AppShell`'s own chrome (`.shell`, `.shell-sidebar`, `.shell-topbar`) carries no radius at all, correctly, since it's edge-to-edge viewport chrome.

**Borders:** always 1px, always `--border` by default, `--border-strong` on hover/emphasis. Width never changes between states (see "The rules" above) — only colour does.

**Shadow:** one token, `--shadow-card` (`0 1px 2px rgba(0,0,0,.04), 0 8px 24px rgba(0,0,0,.06)` light; heavier alpha in dark). It's reserved for panels that appear/disappear as an overlay-like moment — `.form-panel` and `.signin`. `.readout-section` and `.readout-list`, which are always on screen rather than a transient state, get a border only, no shadow. That split reads as intentional (elevation marks "just appeared," not "is a card"), so it's recorded as a rule, not an inconsistency.

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

Library: `motion` (`motion/react`), used for exactly two categories of animation — nothing else in the app moves.

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

Every button in the app (`Reception.tsx`, `NewPatientForm.tsx`, `SignIn.tsx`) is a `motion.button` with `whileTap={{ scale: 0.97 }}`, no explicit transition (Motion's default spring). The value `0.97` is redeclared inline in three separate files rather than imported from one place — same value everywhere, no drift, just not centralised.

**Nothing else animates.** No hover transitions run through Motion — hover/focus/disabled states are plain CSS `transition` on `background-color`/`border-color`/`box-shadow` at 150–180ms, using the CSS `--ease-out` token (`cubic-bezier(0.16, 1, 0.3, 1)` — the same curve as the two Motion transitions above, just expressed as a CSS custom property instead of a JS array in that context).

---

## Component patterns

### Shell (`AppShell.tsx` / `.css`)

CSS grid, `220px 1fr` columns × `56px 1fr` rows, sidebar spanning both rows. Sidebar: clinic name (fetched live via a `clinics.name` query, blank space reserved while loading so nothing jumps), one active nav item (icon + label, `--accent-wash` background, `--accent` text — there's currently only ever one item, so there's no established "inactive nav item" style yet), then a footer pinned to the bottom via `margin-top: auto` holding the user's email and a plain-text "Sign out" action. Top bar: section name left, user email right. Content area scrolls independently (`overflow-y: auto`) rather than the whole page. Collapses to a horizontal strip above the content on ≤720px.

### Search field (`.search-strip`)

A pill (`--radius-pill`), icon baked into `background-image` (not a real DOM element), `--bg` fill against the `--surface` content area behind it (so it reads as recessed, not raised). Border colour + a 4px focus-ring box-shadow on focus — the one control with a 4px ring instead of 3px (see exception below).

### Result row / table row (`.search-result-button`, `.readout-row`)

Both are the same idea in two different tags: a horizontal row of `token — name — meta` with a hairline border, no shadow. `.search-result-button` is a real `<button>` (it's a choice); `.readout-row` is a non-interactive `motion.div` in a CSS grid (`2.5rem 1fr auto`) rather than an HTML `<table>` — chosen so Motion can animate each row independently, which an HTML table row can't easily do.

### Panel (`.form-panel`, `.signin`)

Card: `--surface` fill, `--border` outline, `--radius-card`, `--shadow-card`. `.signin` additionally centers itself (`margin: var(--space-xl) auto 0`) since it renders with no shell around it (unauthenticated). One thing to note in `Reception.tsx`: the new-patient view's outer `motion.div` wrapper carries **no** `.form-panel` class — only `NewPatientForm`'s own `<form>` does — specifically so the panel styling isn't applied twice (a card-in-a-card was the original bug here; it's fixed, but a future edit could reintroduce it by adding a class back to that wrapper).

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
3. The search icon's SVG data-URI hardcodes light-mode's `--text-tertiary` value (`#86868b`) and doesn't adapt in dark mode.
4. `.shell-signout:focus-visible` uses a literal `4px` border-radius instead of one of the three named radius tokens.
5. `--stage-waiting` (`#8e8e93`) is a separate literal from `--text-tertiary` rather than aliasing it, despite being visually close in both themes.
6. Focus-ring width is 4px on `.search-strip`, 3px everywhere else.
7. `panelTransition` (`Reception.tsx`) and `rowTransition` (`TokenList.tsx`) are identical values declared twice, not shared.
8. `whileTap={{ scale: 0.97 }}` is redeclared inline in three files instead of imported once.
9. No `line-height` is set anywhere; every element runs on the browser default for this font stack.
10. Buttons have no loading-spinner or error visual state — only a label-text swap during a pending mutation.
