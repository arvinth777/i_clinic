# Status

Read this at the start of every session, alongside AGENTS.md and docs/.
Update it before ending a session or when a block of work completes.

## UI redesign initiative (post Phase G, not on the lettered A-G plan)

The user judged the shipped v4.2 visual/IA design "bland, cheap, and badly
aligned" and no longer trusts `impeccable`/`hallmark` to fix it ("maybe my
prompting was not clear") — asked for a fresh-eyes redesign instead of
another skill pass. Two real findings grounded this before any redesign
work started:

- `src/pages/Reception.css`'s `.signin` used a fixed top margin, not
  vertical centering — a genuine bug, not a taste issue.
- Commit `b28d828` (same day as v4.2) deliberately stripped the tab-flag
  section headings, the dashed "ticket-stub" token badge, and uppercase
  field labels docs/design.md still documents as current/mandatory,
  replacing them with plain bold text and a plain filled circle, reasoning
  in its own comments that the removed shapes read as "AI-tell." Nothing
  replaced them — every section is now the same font-weight/color as
  surrounding body text, which is the actual mechanism behind "bland,"
  not the palette. **design.md has been wrong about the shipped app since
  that commit; not yet corrected — see Phase UI-5 below.**

Agreed direction, via live mockups (visualize tool, not real code) before
any implementation: replace the Drawer-overlay pattern with a persistent
left rail (queue/quick-access) + a center stage (the selected record),
for both Consultation and Reception. A four-section stepper (Overview /
Prescription / Procedures & pricing / Documents) is **jump-navigation
only**, never a gated wizard — explicitly chosen to preserve the "doctor
doesn't lose time clicking through screens mid-exam" principle rather
than reintroduce the failure mode the original one-screen design existed
to prevent. Also agreed: a live consultation-duration clock (needs new
`with_doctor_at`/`consultation_ended_at` timestamp columns — checked the
schema, neither exists today, only `arrived_at`); and replacing the
three-button "use template / repeat last / search drug" prescription
entry with a single search box plus quiet suggestion chips, including a
frequency-based "usual combo" chip (majority of the patient's last 5
prescriptions, ≥2 minimum) computed client-side from data
`Consultation.tsx`'s existing `past-prescriptions` query already fetches
— no new table or RPC needed for that one.

Phase plan (dependency-ordered; this is a new track, not a lettered
phase — the A-G plan is fully audited/closed per Phase G above):

- [x] **Phase UI-1 — Layout shell.** Replaced the Drawer with a left
  rail (persistent, sticky within `.shell-content`'s own scroll, capped
  height + independent scroll) + center stage, for both screens.
  - Consultation: `TodayFlow` unchanged at the top; rail shows the queue
    (token chit + name + stage/wait, current patient highlighted,
    reps appended, per `RepQueueRows.tsx` — rewritten from `<tr>` to
    `<li>` markup since Consultation was its only consumer, confirmed by
    grep) — the rail is read-only awareness, not a way to jump to an
    arbitrary patient (strict FCFS non-negotiable preserved: only "Call
    next" advances the queue). Center stage renders the exact same
    record content that used to live inside the Drawer (Comments,
    Patient, Past visits, Past prescriptions, Write prescription,
    PricingPanel, CarePanel, DocumentsPanel, Consultation done),
    unchanged internally — this phase is shell-only, not a content
    redesign. Dropped the worklist's per-column sort (Token/Name/Wait)
    since a compact rail list has no column headers to sort by; the
    query's own `order('token_number', ...)` already gives strict
    arrival order, which is the more correct default for a FCFS queue
    anyway.
  - Reception: rail holds search + New patient/Check in rep quick
    actions + `FollowUpTodos`; center stage shows the worklist
    (`TokenList`) by default and swaps in place to `Billing` when a
    billable row is clicked (no Drawer), with a "← Back to queue" link
    added above it (`Billing.tsx` itself was untouched — its own
    Cancel/Done buttons already call the same `onClose`). The three
    small entry forms (check-in complaint, new-patient, rep check-in)
    deliberately stay as Drawers — short single-purpose forms, not a
    record worth a permanent view; not the pattern the user was
    reacting to.
  - Verified live in the browser as both `doctor.a` (sticky rail,
    current-patient highlight, all record sections render, empty state
    when no current patient) and `reception.a` (search dropdown
    positions correctly in the narrower rail, clicking a billable row
    swaps to Billing in place, "← Back to queue" returns to the
    worklist) — not just typechecked. `npx tsc --noEmit` and `npm run
    lint` both clean.
  - One real bug caught and fixed during this phase, not before: the
    rail's `@media (max-width: 900px)` mobile-collapse breakpoint was
    invented rather than reusing `AppShell.css`'s own existing 720px
    convention, and 900px turned out to be *wider* than this actual
    browser pane's rendered width (889px) — silently defeating the
    sticky rail on a perfectly ordinary desktop-width viewport. Caught
    live via `getComputedStyle` showing `position: static` when it
    should have been `sticky`, not by visual inspection alone. Fixed to
    720px, matching the PRD's own "single-column on a mobile browser"
    breakpoint already used elsewhere.
  - **Found, not touched, out of scope for this phase**: `AGENTS.md` had
    an uncommitted local change (the "## Stack" section removed) already
    present in the working tree before this session started — not made
    by this work, not committed, flagged to the user rather than
    silently carried or discarded.
- [x] **Phase UI-2 — Section jump-nav.** `SectionStepper.tsx` (new,
  reusable, currently one consumer): four steps -- Overview / Prescription
  / Procedures & pricing / Documents & follow-up -- wrapping the exact
  same Consultation content from Phase UI-1 in four `id`-anchored divs,
  extracted out of `Consultation.tsx` specifically to keep that file
  under the 500-line rule as it grew. Pure jump-nav, confirmed: no step
  is ever hidden, gated, or marked "done."
  - Two real bugs caught live, neither visible from reading the code:
    (1) the click handler's `scrollIntoView({ behavior: 'smooth' })`
    silently did nothing on a real click most of the time -- traced to
    this page's background query refetches (the doctor queue polls every
    few seconds) re-rendering mid-animation and resetting the in-progress
    smooth scroll before it completed. Direct script calls to the same
    `scrollIntoView` worked fine, which is what made this one non-obvious;
    only testing an actual click, not just the underlying browser API,
    surfaced it. Fixed by switching to `behavior: 'instant'`, which
    can't be interrupted the same way. (2) The active-step indicator,
    first built on `IntersectionObserver` watching each section against
    a fixed viewport band, got stuck on "Overview" for most of the page
    -- that one section wraps four tall sub-sections (Comments/Patient/
    Past visits/Past prescriptions) and kept overlapping the observed
    band regardless of how far past it the doctor had actually scrolled.
    Replaced with the standard scroll-spy algorithm instead (a plain
    `scroll` listener on `.shell-content` -- the app's real scroll
    container, not `window` -- picking the last section whose own
    `getBoundingClientRect().top` has crossed a fixed threshold). Also
    made clicking a step set the active index directly rather than
    waiting for a scroll event to imply it, since the click already
    knows exactly which section it targeted.
  - Verified live as `doctor.a`: every one of the four steps, clicked in
    sequence through the real React click handler (not a raw script
    call), scrolls to its section and updates the active highlight
    correctly and immediately, each time.
- [x] **Phase UI-3 — Prescription entry redesign.** The three-button row
  (Use template / Repeat last / Search drug) is gone from
  `PrescriptionForm.tsx`. In its place: the search box is now the
  primary, always-visible entry point, with a "Quick add:" chip row
  underneath it -- one chip per saved template, plus the new "usual
  combo" chip when one qualifies. Per-drug fields stayed exactly what
  they already were (real `<select>`/`<input>` controls); only the
  entry point above them changed, not the editing UI itself.
  - `usualCombo()` (new, in `prescriptionDraft.ts` alongside this
    project's existing pure-logic helpers) needed no new query: it's a
    plain function over the same `pastPrescriptions` array
    `Consultation.tsx` already fetches (full history, item-level
    detail, newest first) — `PrescriptionForm`'s prop changed from
    `lastPrescriptionItems` (one prescription) to `pastPrescriptions`
    (the whole list) accordingly. Majority of the last 5 prescriptions,
    minimum 2 to say anything is "usual" at all, each qualifying
    medicine's fields taken from its own most recent occurrence (never
    blended across visits) — chosen over plain "repeat last" specifically
    so a one-off addition from a single visit doesn't get suggested
    forever.
  - New test: `scripts/prescription-draft-test.mjs` (6/6) — a genuine
    unit test for a pure function, a first for this repo's `scripts/`
    convention (every other script drives live staging). Transpiles
    `prescriptionDraft.ts` on the fly via the already-installed
    `typescript` package's `transpileModule` rather than duplicating the
    logic in plain JS (which would drift from the real implementation)
    or adding a new dependency (tsx/ts-node) — this project's Node
    version (20) predates native TS support.
  - Verified live as `doctor.a`, not just by the unit test: found a real
    staging patient with exactly the setup needed via a **read-only**
    Supabase MCP query (`docs/STATUS.md`'s own standing rule — inspect,
    never alter), then wrote two real prescriptions for the same drug
    through the actual UI (not direct SQL — the rule is specifically
    against altering data *through MCP*, not against using the app
    normally) to reach the 2-prescriptions-minimum threshold live. The
    "Usual combo: Paracetamol" chip appeared after the second confirm,
    and clicking it added a fully pre-filled, still-editable row using
    that drug's most recent Type/Strength/Food/Frequency/Duration/
    Quantity — removed again afterward without confirming, so no
    redundant third prescription was left behind.
- [x] **Phase UI-4 — Consultation duration tracking.** Migration
  `20260907070000` adds nullable `with_doctor_at`/`consultation_ended_at`
  to `visits` (applied to staging via `supabase db push`, not through
  MCP — MCP stayed read-only per this file's own standing rule). No new
  RPC or trigger: both are stamped by the exact same client update that
  already flips `stage` in `callNext`/`consultationDone`
  (`Consultation.tsx`), since there's no wrong-role case to guard against
  here the way `follow_up_date`/`is_long_term` needed — a timestamp
  recording when an already-permitted transition happened isn't a new
  privilege boundary. Duration is never stored as its own column, only
  ever computed from the two timestamps, so it can't drift.
  `ConsultationClock.tsx` (new) ticks every second in the stage header,
  recomputing from `Date.now()` each tick rather than incrementing a
  counter. Deliberately does not render at all when `with_doctor_at` is
  null -- true for every visit that was already `with_doctor` before
  this migration landed -- rather than show a bogus/negative duration.
  - Security-review pass, live against staging: RLS still enabled on
    `visits` post-migration (`relrowsecurity=true`, confirmed via SQL,
    not assumed from "it's just an ALTER TABLE"); Supabase security
    advisor shows no new findings at all -- the exact same standing set
    already accepted elsewhere in this file (the routine per-RPC
    "authenticated can execute this" WARNs, `rls_auto_enable`, leaked-
    password protection).
  - Verified live end-to-end as `doctor.a`, DB state read directly
    afterward rather than trusted from the UI alone: finished the
    in-progress test visit from Phase UI-3 (`consultation_ended_at`
    landed, `with_doctor_at` correctly still `null` since that visit
    predated the migration), called the next patient in (a fresh
    `with_doctor_at` landed, `consultation_ended_at` correctly `null`),
    and watched the clock advance from 00:07 to 00:21 over a real ~14s
    wait.
- [x] **Phase UI-5 — Visual language reconciliation.** Took three real
  rounds of live user feedback to converge, recorded honestly rather than
  smoothed into a tidy one-shot success:
  1. **Section-heading fix** (`.readout-heading`): a genuine type-scale
     step-up (`--text-base` → `--text-lg`) plus a neutral 3px
     `--border-strong` left rule, replacing the plain-bold-text-with-
     nothing v4.2 shipped. Landed clean, not revisited.
  2. **A colour-only swap** (sage/teal → neutral black/white/grey +
     blue), done in direct response to "I don't like the slate-teal, I
     need professional colours." The user's own verdict on the result:
     "still ugly... everything -- the zoomed in, the components, the
     fonts and spacing and the dropdowns." **This attempt is superseded,
     not layered on** -- named here so a future session doesn't
     rediscover "colour-only isn't enough" the hard way.
  3. **The actual fix**: real elevation (`--shadow-sm`/`--shadow-md`
     tokens, applied to cards/buttons/inputs, border *and* shadow
     together, never one alone), a reopened spacing scale and larger
     radii (10px/8px, up from 6px/4px), a custom `<select>` chevron, the
     sign-in centering bug fixed (found at the very start of the UI
     initiative, never circled back to until now), and the "procedure
     drawer" complaint traced to a real UX bug -- `PricingPanel.tsx` was
     dumping every procedure in the clinic's catalog (100+ junk rows in
     staging) into an always-visible unfiltered list; rebuilt as the same
     search-first pattern as the drug search.
  - **Even after (3), the user's read was still short of "elite":**
     "better than before, but does not look elite and well crafted" --
     confirming the *direction* (real depth/spacing/radii) but not the
     *execution*. Explicitly authorized reaching for a real component
     library rather than more manual token guessing ("use online react
     comps if you cant make it").
  - **Tailwind + Radix UI, introduced this phase** (`@tailwindcss/vite`,
    `@radix-ui/react-select`, `@radix-ui/react-slot`,
    `class-variance-authority`, `clsx`, `tailwind-merge` -- the same
    foundation Kokonut UI itself is built on). `src/index.css`'s
    `@theme` block maps Tailwind's utility keys (`bg-accent`,
    `rounded-card`, `shadow-sm`, etc.) straight onto the existing CSS
    custom properties, so a Tailwind utility and a plain `var(--...)`
    rule always resolve to the same one token -- never two parallel
    colour systems. New primitives in `src/components/ui/`: `Button`
    (cva-based variants), `Input`, `Card`, and `Select` (a real
    Radix-rendered popover replacing the native `<select>` entirely, not
    just a styled native one -- checkmark on the selected item, proper
    hover states, a small open/close fade+scale animation added directly
    since Radix ships the popover with no motion of its own).
  - **Piloted, then fully rolled out across Consultation** (not yet
    Reception/Admin/Stock -- a deliberate, separate next step, not an
    oversight): every native `<select>`/text input/primary or secondary
    button in `PrescriptionForm.tsx`, `PricingPanel.tsx`,
    `Consultation.tsx`, `CarePanel.tsx`, and `DocumentsPanel.tsx` now
    uses the new primitives. Deliberately left native: checkboxes,
    radio buttons, the `<textarea>` (case-summary field) -- no `Textarea`
    primitive exists yet, and none of these were named as a concrete
    complaint. "Remove" links stay plain text links -- a legitimate,
    lighter-weight pattern, not everything needs to be a button.
  - Verified live after every step (typecheck + lint clean throughout,
    zero new warnings beyond the one expected shadcn-style
    fast-refresh notice on `button.tsx`): the new `Select` popover
    confirmed as a real Radix-rendered listbox (not native), procedure
    search-and-filter confirmed working, sign-in confirmed centered with
    real shadow, full Consultation flow re-checked end to end after the
    conversion.
  - **Not yet done, named explicitly rather than implied finished**:
    Reception/Admin/Stock/Billing still use the pre-Tailwind CSS
    components; a `Textarea` primitive; re-running this same pass's
    user-facing check ("does this read as elite now?") since the last
    explicit verdict recorded above predates the full Consultation
    rollout.

This entire phase's git history was intentionally *not* split into one
commit per round -- the intermediate colour-only attempt was superseded,
not layered on, so committing it separately would leave a step in
history that this same file says plainly not to trust.

**Fourth round, after the full-Consultation rollout above**: two more
concrete, named complaints -- "I do not like the fonts... search Google
for elite and premium tech fonts," and "I do not like the left queue
panel... it still looks like typical AI slop."
- **Fonts**: researched directly via web search rather than guessed
  (query: "best premium elite tech fonts 2026 ... SaaS product design
  typeface"). Result: Geist (Vercel's own sans, paired with Geist Mono)
  is named as the fast-rising default for developer-tool brand work, and
  the specific pairing called "the gold standard for developer tools" is
  Geist for headings with Inter kept for body-text legibility -- Söhne
  (Stripe/Linear's own paid font) was also named but requires a
  commercial licence, ruled out for that reason alone, not on taste.
  Installed `@fontsource/geist-sans` and `@fontsource/geist-mono`
  (self-hosted, matching this app's existing offline-first font
  convention -- no Google Fonts CDN link). New `--font-display` token
  (Geist Sans) applied to `h1`/`h2`/`h3` and `.readout-heading`; `--font`
  (Inter) stays on body copy; `--font-mono` switched from JetBrains Mono
  to Geist Mono, matched to Geist Sans by the same foundry rather than a
  third unrelated typeface. Confirmed live via `getComputedStyle` (not
  assumed from the CSS alone) that both faces actually load and render,
  not silently falling back to a system font.
  - Reverse-conclusion this docs section already recorded: real
    components (Phase UI-5's Tailwind/Radix pass) plus a considered font
    pairing is the actual "premium" combination -- this file already
    disclosed Söhne as a paid-only option a future session might
    reconsider if the maintainer ever wants to license it; Geist is the
    free, current, actively-maintained choice for now.
- **The queue rail**: diagnosed the "AI slop" complaint concretely
  rather than re-guessing at colours -- a coloured circular token badge
  next to two stacked lines of text (name, then stage/wait) is close to
  *the* generic list pattern every AI-assisted scaffold reaches for by
  default (a "contact card" list), and it doesn't even fit this data:
  patients have no avatar/photo, so the circle was standing in for one
  with just a number, which is exactly the "trying to look like
  something instead of being something" tell. Rebuilt as a dense,
  single-line row per Linear's own issue-list density: a small
  fixed-width mono token tag (not a badge), the name as the one flexible
  truncated element, wait time as trailing mono metadata -- no per-row
  stage text at all now, since the *only* stage distinction the rail
  actually needs (who's currently with the doctor) is already carried by
  the active row's own background tint. `RepQueueRows.tsx` rebuilt to
  match the same one-line shape, its "Mark done" button converted to the
  new small `Button` variant. Net effect confirmed live, not just
  reasoned about: roughly 15 rows now visible in the rail at once versus
  ~4-5 before, which also directly addresses part of the earlier
  "zoomed in" complaint as a side effect, not a separate fix.
- **The user's verdict on round 4**: "better than before, but that was
  worse than AI slop, now it is [an] AI slop" -- genuine forward
  progress (no longer *worse* than the generic baseline), but landing
  squarely on "competently generic," not distinctive. Asked whether to
  propose real distinctive creative directions before building further;
  the user dismissed that question without answering, then instead gave
  a direct, concrete visual reference to follow (below) rather than
  continuing the abstract "is it elite yet" conversation.

**Fifth round -- a concrete visual reference, not another abstract
adjective.** The user linked a specific "Bento Grid" pattern
(websiteprompts.com/design/bento-grid) and then a full screenshot of its
illustrative example (varied-span tiles, one saturated "hero" tile with
a decorative ring graphic, pale supporting tiles, bold numbers, no
borders -- colour alone separates tiles). Applied to `TodayFlow.tsx`
(the Waiting/Seen-today/Avg-wait strip) as the first, bounded
application of the pattern -- not yet the queue rail or the record
itself, a deliberate scope line pending reaction to this piece first.
- New standalone tile tokens (`--tile-hero`/`--tile-mint`/`--tile-amber`
  + dark-mode variants), explicitly *not* reusing `--accent`/`--success`/
  `--warning` -- reusing `--success` here specifically would have diluted
  the "only ever the paid-stamp" rule this file already documents.
- A real bug caught and fixed in the same pass, not left for later:
  deleting `TodayFlow`'s old `.flow-stat`/`.flow-stats` CSS rules
  wholesale silently broke `DailyReport.tsx` and `GstReport.tsx`, which
  also use those exact class names -- `tsc` does not catch a missing CSS
  class, so this was only caught by grepping every consumer of the
  classes being touched (the same lesson this file has already recorded
  once, for `search_patients`' anon grant, applied here to CSS instead of
  SQL). Fixed by restoring those rules alongside the new bento-specific
  ones, verified live on both Consultation (new tiles) and the Daily
  Report screen (old classes, unaffected).
- Verified live as `doctor.a`: the three-tile bento row renders with the
  intended saturated-hero + pale-supporting mix, the decorative ring
  clips correctly inside the hero tile, and the overdue-wait red text
  override still applies inside the new tile.
- **Not yet done, named explicitly**: the queue rail and the rest of the
  record are still the pre-bento Tailwind/Radix treatment from round 3;
  Reception/Admin/Stock untouched.

**Sixth round -- same reference image, re-sent with a specific complaint**:
"the colour, text size, contrast and the sizing is not as premium as
this photo." Measured against the reference directly rather than
adjusting by feel:
- Tile numbers were `--text-xl` (1.5rem); the reference's numbers run
  roughly 3.5x their own label size, not the ~2x that gave. New
  `--text-3xl` (2.5rem) token, hero-stat scale only, applied to
  `.flow-tile-value` at weight 800 with tight tracking.
- The pale mint/amber tiles had hue-tinted ink
  (`--tile-mint-ink`/`--tile-amber-ink`) -- the reference's "Completion"/
  "84%"/"Activity" text is neutral near-black throughout, not tinted to
  match each tile's own hue. Replaced both with one `--tile-pale-ink`
  (= `--text`), which is what actually gave the reference its higher-
  contrast, more serious look -- the tint, not the size, was flattening
  contrast.
- Hero tile bumped from `oklch(52% 0.16 290)` to `oklch(58% 0.2 290)`
  (dark-mode variant similarly) -- more vivid/saturated, closer to the
  reference's confident indigo rather than a muted one.
- Tile `min-height` 6rem → 9.5rem, padding and grid gap both widened,
  the decorative ring enlarged 120px → 160px -- the reference's tiles
  read as spacious/roomy, not compact.
- Verified live: numbers now dominate their tiles the way the reference's
  do, mint/amber text reads neutral dark, hero tile is visibly more
  saturated, and the overdue-wait red override (`.flow-overdue`) still
  correctly overrides the new neutral ink.

**Seventh round -- a real product question, not a visual one**: "what
even is average wait now?", then, once explained (a live average of
in-progress waits, not a historical/completed-wait metric -- and why it
was showing an absurd ~467m figure, staging's own accumulated stale
`waiting`-stage fixtures dragging the average up), the user's own
verdict: "no it won't be useful." Replaced the amber tile's metric
entirely -- a straight count of patients currently waiting past the
existing 30-minute overdue threshold (`LONG_WAIT_MINUTES`, already used
elsewhere for the same definition), not an average. "How many people am
I making wait too long right now" is actionable in a way "what's the
average" wasn't.

**Eighth round -- a different screen, the same root cause named at the
very start of this initiative**: "it looks like markdown... i want it to
look neat, like how you as Claude would give me tables." Pointed at
Stock's medicine list, but the actual cause is `.worklist` -- a bare
header rule plus hairline row dividers and nothing else, which is
genuinely what a plain unstyled HTML table (or a rendered markdown
table with no CSS at all) looks like. New `src/components/ui/table.tsx`
(`Table`/`TableHeader`/`TableBody`/`TableRow`/`TableHead`/`TableCell`):
a bordered rounded container, tinted header row, hover-highlighted
rows, numeric columns right-aligned in tabular-nums mono. Applied to
`StockList.tsx` as the pilot; every other `.worklist` consumer
(Reception's queue, Admin's drug/procedure/template lists, Reports)
is still the old bare styling -- next, not forgotten.

**Ninth round -- two requests together**: "what even is L-T register?
rename it" and "make it hidden by making a collapsible side menu bar."
- Renamed "Long-term register" -> "Long-term care" (`App.tsx`) --
  "register" was the jargon, not the feature itself (patients flagged
  for periodic review).
- Built a real collapsible left sidebar (`AppShell.tsx`/`.css`),
  replacing the single horizontal nav row `AppShell.css`'s own header
  comment had explicitly defended since v4.1 ("every account has one or
  two sections, a sidebar is dead space"). That reasoning no longer
  holds: a doctor holding admin now sees seven sections, which had
  nowhere to go in one row -- confirmed live earlier in this same
  session that nav items were overflowing off-screen at ordinary widths,
  not just extreme ones. One icon per section (falls back to a plain
  dot for anything unmapped), a manual collapse toggle persisted to
  `localStorage` (same per-device-convenience idiom as `useTheme.ts`),
  and a mobile breakpoint (720px, matching the convention already used
  elsewhere) that forces icon-only regardless of the toggle, per the
  PRD's own "single-column on a mobile browser" requirement.
  Verified live: all seven sections render with no overflow, the
  collapse toggle works (confirmed via the DOM class and `localStorage`
  directly, not just visually), and the collapsed state survives a full
  page reload.

**Tenth round -- closing UI-5's own named unfinished work**: "ok then
change them as well," after the Stock table round (above) left
Reception, Admin, Reports, and Billing as the explicitly-disclosed
remainder. Parallelized across four background agents (one per
screen, disjoint file sets, no shared state) plus a fifth doing
Reports since it was small enough to finish first: every native
`<table className="worklist">`, `.primary-button`/`.secondary-button`,
native `<select>`, and native `<input>` on those four screens now uses
the same `Table`/`Button`/`Select`/`Input` kit as Consultation and
Stock. Each agent's diff was read in full before it landed, not
trusted blind:
- Caught and fixed one real regression the agents' own instructions
  had introduced: DrugList's "Type" select lost the ability to
  explicitly clear a set type back to blank, since Radix's
  `Select.Item` can't hold `value=""` the way a native
  `<option value="">` could. Fixed with a `__unset__` sentinel item
  that maps back to `''` on write -- full parity restored, not just a
  visual match.
- Caught and fixed a second regression the same instructions caused
  in a different file: NewPatientForm's gender select used
  `value={form.gender || undefined}`, which flips the component
  between controlled and uncontrolled the moment a gender is first
  picked (a real React warning, caught live in the browser console,
  not from reading code). Radix treats a plain `''` as "nothing
  selected" for its own placeholder just fine, so the fix was simply
  to stop coercing to `undefined` at all.
- The "stamp" tap-animation convention (only a genuine commit action
  like Confirm payment or Check in keeps `motion.button` +
  `whileTap`) held up across every file with no exceptions needed.

**Eleventh round -- the same afternoon, a different complaint**: while
watching the Reception screen get exercised live in the browser pane
for the round above, the user said "why is it opening in the right
panel? i do not like it. change it like how we did for the doctor
panel" -- the right-side `Drawer` overlay, for every remaining form on
Reception/Admin/Unpaid. Asked which screens, rather than guessing
across a dozen files on a name-only reference to "the doctor panel";
answer was all three. Built and browser-verified Reception's own
conversion first (New patient / check-in / pharma-rep forms now swap
into the center stage in place of the queue table, exactly like
Billing already did, instead of sliding in from the right) as the
concrete reference, then Admin's DrugList as a second reference
(list ⟷ edit-form swap, since Admin's shape -- a table plus an
add/edit form -- differs from Reception's plain form-swap), then
parallelized the remaining four Admin panels (Procedures, Templates,
Custom fields, Logins) and Unpaid's settle form across two more
background agents against those two references. No Drawer remains on
Reception, Admin, or Unpaid; Stock and MergePatients still use it
(out of scope -- not named in this round).

**Twelfth round -- "change stock and merge as well"**: the user closed
the loop on the Eleventh round's own disclosed gap. Stock's own
`StockList.tsx` (record purchase / transfer / monthly count / adjust)
dropped its 4 Drawers for the same inline swap as everywhere else.
`Suppliers.tsx` needed more: unlike every other file this session,
it had never gotten the Tailwind/Radix kit at all (missed in the
very first Stock-table pilot round, which only touched
`StockList.tsx`) -- so its list, add-supplier form, and purchase-
history view were converted to Table/Button/Input *and* had their 2
Drawers dropped in the same pass, since the whole file's JSX was
already being rewritten. `MergePatients.tsx` only needed the
Tailwind/Radix conversion (search inputs, Merge button) -- it never
had a Drawer to begin with, being a single always-inline view.
Not done, and not asked for: `RecordPurchaseForm`/`TransferForm`/
`MonthlyCountForm`/`AdjustStockForm` (the components Stock's own
actions render) still use native `<select>`/`<input>` internally --
removing their Drawer wrapper didn't require touching their own
markup, and nobody's asked for that layer yet.

## Where we are

Working through `docs/build-plan.md`, one phase per session, in order.
The user has repeatedly authorized skipping the plan's default "one
phase per session" pacing within a single session — most recently to
resolve Phase A's two open decisions and then go straight into Phase C
in the same turn.

**Phase G — Go live: audited (items 1-5), built (items 6-8), and now
two fix passes against the audit's own ranked findings, strictly in
severity order. All 3 Critical findings, all 5 named High/Medium
findings, and one deferred item (reports double-counting, resolved per
an explicit decision) are fixed, tested, and verified — see "Phase G
fix pass" below for the Critical pass and "Phase G fix pass —
High/Medium" for the rest. Every finding actually assigned in either
pass was genuinely fixed — none needed to be dismissed as not-real.
The remaining Low/informational findings from the original audit
(a GST date-range bug, a template-applied prescription's missing
quantity, a stale isolation-test comment, leaked-password protection,
an int-vs-bigint nit) were never assigned to either pass and remain
untouched — see "What's still open" at the end of the High/Medium
section for the full, honest residual state before this is genuinely
production-ready.**

## Phase checklist

- [x] **Phase A — Admin and configurability**
  - [x] Drug list: add/edit/remove (name, type, strength options, price, low-stock threshold, expiry date)
  - [x] Procedure list: add/edit/remove (name, default price)
  - [x] Prescription templates: view/rename/delete (doctor still creates them)
  - [x] Custom patient fields: definitions table + JSONB values; confirmed live that a new field appears on the intake form with zero code change
  - [x] Logins: add (Edge Function, service role) / remove (plain RLS-permitted delete); assign roles
  - [x] Duplicate patient merge (blocked if either has an open visit today; keeps the older id; reassigns visits + patient_comments) — originally built under Admin with a narrow admin-read exception; **moved to the doctor's own nav and the exception removed**, see "Resolved this session" below
  - [x] Checkpoint: `docs/security-review.md` — run, finding **resolved this session** (see "Resolved this session" below), review's own "report, don't fix in the same pass" rule honored at the time
  - [x] Checkpoint: ponytail — caught a real gap before calling this done (see "Caught by ponytail" below)
- [x] **Phase B — Stock**
  - [x] Tests first: `scripts/stock-test.mjs`, run red against the pre-migration schema, then green (22/22)
  - [x] Stock points (Counter, Storeroom) seeded per clinic; `medicine_stock` (SELECT-only, maintained by trigger) + `stock_movements` (append-only ledger, sign-per-reason check constraint)
  - [x] Stock screen: every medicine, quantity per point, low-stock flagged (`low_stock_threshold`), negative stock flagged — visible to doctor and receptionist
  - [x] Record purchase (supplier, invoice number, date, stock point, multi-drug with quantity + cost price)
  - [x] Transfer between stock points
  - [x] Monthly count (expected vs counted vs gap shown live; confirm sets stock server-side from a live-read expected, gap saved not discarded)
  - [x] Manual adjustment with a required reason (enforced at both the RPC and the table level)
  - [x] Suppliers with purchase history
  - [x] `prescription_items.quantity_dispensed` added, required going forward in `PrescriptionForm.tsx`; `confirm_bill` deducts `coalesce(quantity_dispensed, 1)` per still-present item, non-blocking if no Counter stock point exists
  - [x] Deferred seed case: an item dispensed into negative stock (`Seed Negative Stock Medicine`, Clinic A, Counter = -10)
  - [x] Checkpoint: `docs/security-review.md` — run against the live DB (not just the migration text); two real findings, both fixed in the same phase (see below) — no policy tradeoff either time, unlike Phase A's merge finding
  - [x] Checkpoint: ponytail / live verification — see "Caught this phase" below
  - [x] Done when: verified live — billing a visit with a real prescribed quantity visibly moved stock (Counter 4 → 2 for a ×2 dispensing, not the 1-unit fallback), and a monthly count surfaced a real variance (40 expected → 35 counted, gap -5 saved)
- [x] **Phase C — Payments completed**
  - [x] Tests first: `scripts/settle-bill-test.mjs`, run red against the pre-migration schema, then green (17/17)
  - [x] UPI: already worked before this phase (real QR from `qrcode`, `clinics.upi_vpa`) — pinned down, not rebuilt
  - [x] Pay later / credit: already worked before this phase (`confirm_bill` already accepted `payment_method='pay_later'` and closed the visit as billed) — pinned down, not rebuilt
  - [x] Unpaid list: `unpaid_bills` (security_invoker view, same idiom as `bills_needing_reconciliation`) + a receptionist-only nav screen
  - [x] Settling: `bill_settlements` (append-only, `unique(bill_id)` is the only guard needed) + `settle_bill` RPC (receptionist-only, pay_later-only) — a new linked record, the original `bills` row never mutated (non-negotiable #3), verified byte-for-byte unchanged in the test
  - [x] Extra, not in the plan's bullet list but needed to make UPI actually usable for a real clinic: an Admin "Settings" tab for `clinics.upi_vpa`, via a narrow `admin_set_clinic_upi_vpa` RPC (one column, not a blanket UPDATE policy on `clinics` — that would also expose `next_token_number` to casual editing)
  - [x] Checkpoint: `docs/security-review.md` — run against the live DB; **no findings this time** (RLS, grants, and role boundaries all came out clean on the first check, unlike Phases A and B)
  - [x] Checkpoint: ponytail — no follow-up needed
  - [x] Done when: verified live and via script — a credit visit closes as paid, appears on the unpaid list, disappears once settled, and the original bill row is unchanged (compared before/after, identical)
- [x] **Phase D — Documents, register, reps**
  - [x] Tests first: `scripts/phase-d-test.mjs`, run red against the pre-migration schema, then green (38/38, including a regression added post-review: un-flagging a long-term patient and then checking them in must not violate `patients_long_term_shape` — the reset trigger reads `is_long_term` on every new visit regardless of history)
  - [x] Clinic documents: `clinic_documents` (certificate/sick_leave/referral, a check constraint enforces each type's required fields plus `rest_to >= rest_from`), doctor-only select+insert (same posture as `prescriptions`/`patient_comments` — a referral's case summary or a sick-leave reason is clinical free text, and reception's job never needs to read one, only receive the printed paper). Issued from `DocumentsPanel.tsx` inside the consultation drawer; prints without the clinic name (real letterhead already carries it) but with the doctor's name/registration number, now configurable via a narrow `admin_set_clinic_doctor_info` RPC on the same Admin "Settings" tab as the UPI VPA.
  - [x] Long-term register: `patients.is_long_term`/`long_term_review_interval_days`/`next_review_due`, doctor-gated via `set_patient_long_term`; a `security_invoker` view (`long_term_register`, same idiom as `unpaid_bills`) lists last visit + next review due; a new visit resets `next_review_due` automatically via an `after insert on visits` trigger. Visible to doctor and receptionist (`src/pages/LongTermRegister.tsx`, own nav item).
  - [x] Follow-up dates: `visits.follow_up_date`/`follow_up_done_at`, doctor sets via `set_visit_follow_up` (also clears any earlier done-mark — a revised date starts a fresh to-do), reception clears via `mark_follow_up_done`. No WhatsApp (out of scope for the whole build): surfaces as a plain to-do list on Reception (`FollowUpTodos.tsx`) for anything due today or overdue and not yet done.
  - [x] Pharma rep check-in: `pharma_rep_checkins` (name + company only, no patient/visit link, no medical record, no bill), reception checks in, doctor marks done. Always renders after every patient row in the doctor's queue (`RepQueueRows.tsx`) — this is grouping (a separate appended block, never interleaved with the sortable patient rows), not a shared sort key, so it holds regardless of arrival time or which column the doctor has the patient rows sorted by. Deferred seed case (a rep checked in two hours before a later-arriving patient) added in the same migration.
  - [x] **A real enforcement gap caught before it shipped, not just an RPC-level check**: `visits_update`/`patients_update` already grant both doctor and receptionist a blanket UPDATE (needed for other columns on those tables), so a plain client call could have set `follow_up_date` or `is_long_term` directly, bypassing the RPCs' own role checks entirely — the RPC would have been documentation, not enforcement. Closed with a `BEFORE UPDATE` trigger per table, checked per-column (`IS DISTINCT FROM`) rather than per-row, so every other existing update path (stage transitions, the automatic `next_review_due` reset) passes through unaffected. `next_review_due` itself is deliberately *not* covered by the patients guard — it must also be settable by that automatic reset, which runs under whichever role (often reception, at check-in) triggered the insert.
  - [x] Checkpoint: `docs/security-review.md` — run against the live DB, scoped to the new surfaces only (not a re-review of Phases A–C); clean, no findings. `anon` shows full raw table-level grants on both new tables in `information_schema` — confirmed this is Supabase's standing platform default (identical on `patients`/`bill_settlements`), not something this migration introduced; RLS is what actually gates every path, verified directly.
  - [x] Checkpoint: ponytail — `Consultation.tsx` had grown to 498 lines against the 500-line rule with this phase's additions; extracted `TodayFlow` (fully self-contained, only needed `elapsedMinutes`) into its own `src/components/TodayFlow.tsx` rather than leave a "watch this" note, which brought it back to 454 with real headroom.
  - [x] Done when: verified live via a throwaway Playwright script (deleted after use, per convention) — a certificate was issued and its print-area rendered the correct signature block; the seeded rep sat behind the seeded patient in the doctor's live queue.
- [x] **Phase E — Reports**
  - [x] Tests first: `scripts/phase-e-test.mjs`, written after the migration (green on first run, 23/23 — no red run against the pre-migration schema was performed this phase, unlike Phases B/C/D); every assertion is a before/after delta around a known fixture, since staging is shared, ever-growing data and an absolute total would be meaningless. A later advisor pass added a 24th assertion (see "Advisor follow-up" below); now 24/24
  - [x] `get_daily_report`, `get_monthly_report`, `get_gst_report`, `get_stock_warnings_report` — four `SECURITY DEFINER` **functions**, not views (the advisor's own flag: a view can't check the caller's role as part of its definition the way a function's body can). Each derives `clinic_id` from the caller's own `user_roles` row via `auth.uid()` and never accepts one as a parameter — confirmed by grep across the whole migration file, not just by inspection
  - [x] Collections is cash-basis (cash/upi bills confirmed same-day, plus any `pay_later` bill actually `settle_bill`'d that day) — a `pay_later` bill confirmed today but still unsettled contributes nothing, verified explicitly in the test
  - [x] Discount comes from `bill_line_items`' frozen `line_total_paise` per bill (non-negotiable #3), never live `visit_pricing` — a bill's own discount can't drift after the fact just because pricing was later revised
  - [x] `needs_reconciliation_count` reuses the same live join `bills_needing_reconciliation` already uses (current revision vs. the snapshot at confirm time, excluding anything already corrected) — a current outstanding count, not scoped to "today," same as stock warnings being current state rather than today's activity
  - [x] Stock warnings return medicine-level rows (name, total quantity, threshold), not a number — medicines aren't patient data at all, so row-level output here doesn't violate "totals only"; only medicines actually in a warning state are returned, same low-stock definition `StockList.tsx` already uses (total quantity across every stock point vs. the medicine's own threshold)
  - [x] GST report returns exactly `collections_paise`/`discount_paise`/`bill_count` for an admin-chosen date range — no GST rate or tax-due computation invented (the PRD names neither, and healthcare consultation is largely GST-exempt in India regardless); exported to CSV via a plain `Blob` download, no library, no server round trip
  - [x] Reports screen (Daily/Monthly/GST tabs) visible to admin and doctor — doctor because the PRD says so directly ("the doctor can see how much subsidised care he's actually provided"), even though his own RLS already gives him full row-level access and he could compute the same totals by hand
  - [x] Fixed `formatPaise` for negative paise (`Math.floor`/`%` on a negative dividend in JS produce independently negative "rupees" and "cents", rendering `"₹-712.-25"`) — caught live signed in as `admin.only`, since Reports' discount total is the first place a negative value can reach this formatter (every individual bill amount is non-negative by its own check constraint; only a sum across many rows, against months of accumulated dirty staging data, can land negative)
  - [x] Checkpoint: `docs/security-review.md` — run against the live DB, scoped to this phase's four new functions (no new tables/RLS surface exists to re-review); clean, no findings. Confirmed live via `pg_proc`: all four `prosecdef=true`, `search_path=""`, and (via `information_schema.routine_privileges`) `EXECUTE` granted to `authenticated` only, no `anon`
  - [x] Done when: verified live via a throwaway Playwright script (deleted after use) signed in as `admin.only` — all three report tabs render real, non-zero figures; the test script's own Section 1 independently re-confirms admin's direct row reads on `patients`/`visits`/`bills`/`prescriptions`/`patient_comments` all still return nothing, run first and separately from the report checks, per the brief's "test both halves" instruction
  - [x] **Advisor follow-up, same session**: the "test both halves" done-when check proved admin's own direct reads return nothing and reception is blocked, but never actually proved a *different clinic's* caller gets that clinic's own numbers — the outcome constraint #2 exists for, distinct from the grep-provable mechanism (no `p_clinic_id` parameter anywhere). Added a cross-clinic assertion to `phase-e-test.mjs`: signed in as `doctor.b` (clinic B), bracket the same clinic-A fixtures Section 2 already creates with a before/after read of `doctor.b`'s own `get_daily_report` — confirmed empirically that clinic A's 43000-paise collections and 3 new patients moved clinic B's report by exactly zero. Also ran the Supabase security advisor (`mcp__supabase__get_advisors`, type `security`) directly, not just the `docs/security-review.md` checklist by hand — clean for all four Phase E functions (the only findings are the standard "authenticated can execute this SECURITY DEFINER function" WARN every RPC in this app gets, expected and unavoidable for an RPC that's supposed to be callable; and two pre-existing, unrelated findings out of Phase E's scope: `rls_auto_enable()` callable by `anon` since `20260905184339_security_hardening.sql`, and project-wide leaked-password protection disabled). Fixed a genuine bug in `GstReport.tsx` found on review, not by testing: `URL.revokeObjectURL(url)` fired synchronously right after `a.click()`, a known race that can cancel the download before the browser reads the blob — moved into a `setTimeout(..., 0)`.
- [x] **Phase F — Offline**
  - [x] Tests first: `scripts/phase-f-test.mjs` (21/21) — but only the snapshot-parameter assertions (Sections 1-2) were genuinely red pre-migration (the 4-arg signature didn't exist); the idempotency assertion (Section 3, `confirm_bill`'s pre-existing `v_stage='paid'` early return) and the seed-case assertions (Section 4, `bills_needing_reconciliation`) already passed before this phase's migration, exercising mechanisms Phases B/C already shipped — said plainly here since this project corrects overstated red-run claims on sight, not glossed as a uniform red-then-green run
  - [x] `confirm_bill` grew two optional parameters (`p_snapshot_final_amount_paise`, `p_snapshot_revision_number`) implementing docs/architecture-spec.md's offline money-conflict design: the payment-confirmation mutation snapshots the amount/revision *at the moment reception clicks confirm*, not a live re-read at whatever later moment the queued call actually replays. When the snapshot's revision doesn't match the live one at replay time (the doctor's own revision synced in first), the bill is inserted at the snapshotted amount — never the live one — and lands `needs_reconciliation = true` via the existing (unmodified) `trg_set_bill_needs_reconciliation` trigger. Omitted (every pre-existing caller, including Billing.tsx's online path itself), behaviour is byte-for-byte unchanged: still a live read. **Self-inflicted bug caught by this phase's own test, not by review**: the first attempt at this migration based the new 4-arg body on the original Phase C text, silently dropping Phase B's stock-deduction block and the reopen/double-deduction fix that had been layered on since — `phase-f-test.mjs`'s own idempotency section failed with an empty `stock_movements` read. Fixed in a same-session follow-up migration restoring the full current body (verified against `20260906200300`, the actual last `CREATE OR REPLACE`) with the snapshot logic on top, per AGENTS.md's "never edit an applied migration, write a new one."
  - [x] Durable mutation queue (`src/lib/offlineQueue.ts`, `idb-keyval`, its own store separate from the read-cache persister's so it's never evicted): a client-generated uuid *is* the idempotency key for insert-shaped writes (`upsert(..., { onConflict: 'id', ignoreDuplicates: true })` — a replayed insert is a no-op, never a duplicate row or an overwrite); update/delete-shaped writes need no key at all (`bump_pricing_revision` only bumps on an actually-distinct value; a delete matching zero rows is a plain no-op). Replay is serial, oldest-first, and distinguishes a network failure (no Postgres `code`/HTTP `status` on the error — stop quietly, retry on reconnect, nothing wrong) from a genuine rejection (halt immediately, surface to a human — replaying it again would only fail the same way; the two devices' queues have no shared ordering, so reception's confirm can legitimately reach the server before the doctor's own pricing edit does). Wired into exactly ten call sites plus check-in (see below), not every write in the app — `addNewMedicine`, `saveTemplate`, and all 15 admin/stock/report write surfaces stay online-only, a deliberate scope line, not an oversight.
  - [x] `attemptOrQueue` (also in `offlineQueue.ts`): tries the write online-first, falls back to enqueue + an optimistic React Query cache patch on a network failure — the patch is what lets billing/print reflect a queued edit immediately, not just "eventually". **Every wrapped `useMutation` needs `networkMode: 'always'`** — React Query v5's default (`'online'`) pauses a mutation *before ever calling `mutationFn`* while `navigator.onLine` is false, which would have silently stopped `attemptOrQueue`'s own online/offline branch from ever running. Wired: `Consultation.tsx` (`callNext`, `addComment`, `consultationDone`), `PrescriptionForm.tsx` (`confirm`, now split as two client-id'd inserts — prescriptions row then prescription_items rows — since there's no round trip to get a server id back to reference before the second insert), `PricingPanel.tsx` (`addProcedure`/`updatePrice`/`removeProcedure`/`updateFinalAmount`, each also hand-mirroring `recompute_visit_pricing`'s own arithmetic into the optimistic patch since nothing runs that trigger offline), `Billing.tsx` (`openBill`, `confirmPayment` — this one takes the pricing snapshot described above), and `Reception.tsx` (`checkInExisting`/`checkInNew`) — check-in was **not** in the phase brief's named test scenarios, but `visits.token_number`'s own schema comment (`20260905164914_phase1_core_schema.sql`) documents it as assigned server-side *specifically* so check-in itself can be queued offline, with `arrived_at` (client-captured) as the real queue sort key; leaving it out would have contradicted a decision already made in the schema. Check-in's own list view is not optimistically patched (out of scope: it doesn't gate printing), so a queued check-in surfaces only via the global banner, not a placeholder row.
  - [x] Persisted reads (`src/lib/persistQuery.ts`, `@tanstack/react-query-persist-client` + `query-async-storage-persister` over a second, separate `idb-keyval` store, 24h `maxAge`): whatever a device already fetched while online is readable again after a reload with zero connectivity. **Documented boundary, not fixed**: this makes *already-fetched* data durable across a reload — a device that never fetched a given query while online still can't serve it offline from cold. In practice this means reception's billing screen needs one moment of connectivity to load a visit's `get_visit_billing_detail` for the first time; after that, it survives any subsequent cut and any reload. The serial-drain ordering guarantee (previous bullet) means this is rarely a real constraint: reception can't see a visit reach `ready_at_reception` at all until the doctor's own same-device queue (prescription, procedures, pricing) has already drained ahead of that stage transition, since they're enqueued in that order on the same device.
  - [x] Service worker (`vite-plugin-pwa`, `registerType: 'autoUpdate'`): precaches the built JS/CSS/HTML plus every hashed font file (`globPatterns` extended with `woff2`/`woff` — the plugin's own default omits fonts entirely, which would have meant requirement 5's "no font fetch at print time" quietly failing the moment a font wasn't already browser-cached). Confirmed directly in the generated `dist/sw.js`, not assumed from config: 43+ `.woff2` entries plus `index.html`/the JS bundle/the CSS bundle. Deliberately **no** `runtimeCaching` for Supabase's origin — a stale cached API response would be worse than the request simply failing, which `offlineQueue.ts` already handles. The dev server has no service worker (Vite's own default); this can only be verified against a real build (`npm run build && vite preview`), not `npm run dev`.
  - [x] Auth refresh failing offline: verified, not built. `@supabase/auth-js` 2.109.0's `GoTrueClient#_callRefreshToken` already classifies a network failure as `AuthRetryableFetchError` and never reaches `_removeSession()` (what fires `SIGNED_OUT`) for one, and even a genuine rejection only tears the session down once the access token has actually expired, not on every proactive refresh attempt — read directly from the installed package's source, not assumed. `useSession.ts`'s existing comment overstated this as something the hook itself tracked via a `loading` phase; corrected to name the actual guarantee and where it lives, plus the version it's pinned to (a caret-ranged bump could regress it silently — there's no test in this repo pinning the library's own behaviour, only that comment as the breadcrumb). What this phase did add to the hook: `queryClient.clear()` + the persister's `removeClient()` on a genuine `SIGNED_OUT`, since this phase is what put patient names, complaints, and prescriptions into IndexedDB on what may be a shared reception machine.
  - [x] Unmissable pending-work banner (`OfflineQueueBanner.tsx`, mounted in `App.tsx` next to `StagingBanner` so it's shell chrome, not a per-screen toast): non-dismissable for as long as the queue is non-empty, reusing the existing `--warning`/`--danger` tokens (a pending-count state and a distinct halted-needs-a-human state, per the halt/retry split above). `beforeunload` as a secondary, best-effort nudge only — it shows generic un-customisable browser text and doesn't fire on every close path (OS shutdown, killed process), so the banner being part of the permanent chrome is the actual mechanism, not the fallback.
  - [x] Two disclosed, not fixed, residual edges: (1) a reload that lands *between* a queued `confirm_bill` click and that item actually draining loses the ephemeral `confirmedBill` component state, so the payment form can reappear rather than the "paid" screen — `confirm_bill`'s own idempotency (this phase's Section 3) means a second click here is still safe (same bill returned, stock not re-deducted), so this is a UX rough edge, not a data-safety gap. (2) if a different user signs into the same device before a queued mutation drains, it replays under whichever session is active *then*, not whoever actually did the work (`created_by`/`confirmed_by` are stamped by the replaying client, same as any online write) — the queue itself is deliberately not cleared on sign-out (unlike the persisted read cache) so pending work is never silently lost, but this ordering interaction is unresolved.
  - [x] Checkpoint: `docs/security-review.md` plus the Supabase security advisor (AGENTS.md Phase 3 — money, auth, and patient data all touched this phase, despite the build-plan naming only ponytail). Advisor clean: `confirm_bill`'s new 4-arg signature shows only the standard "authenticated can execute this SECURITY DEFINER function" WARN every RPC in this app gets; confirmed directly via `information_schema.routine_privileges` (`authenticated`/`service_role`/`postgres` only, no `anon`, no `public`) and `pg_proc` (`prosecdef=true`, `search_path=""`) that the old 2-arg signature is genuinely gone and the new one is correctly locked down. New client-side exposure this phase introduces: patient names/complaints/prescriptions now live in IndexedDB (read cache + mutation queue) on whatever device was used — addressed for the read cache via the sign-out clear above; the queue itself is a smaller, load-bearing exception (previous bullet).
  - [x] Checkpoint: ponytail — `PrescriptionForm.tsx` crossed 500 lines (518) once the queue wiring landed; extracted the pure, non-React draft-shaping helpers (`newDraftItem`/`draftFromExisting`/`itemRow`/`itemIsValid` plus their types) into `src/lib/prescriptionDraft.ts`, back to 428 with headroom. Also caught and removed a genuinely unused export (`isQueued`) that had no caller anywhere in the app.
  - [x] Incidental fix, caught during this phase's full regression sweep (unrelated to offline): `phase-e-test.mjs`'s "most recent row is the current month" check computed "this month" via local-time `setDate(1)` then `toISOString()` — timezone-unsafe the same way `formatDateOnly`'s Phase D bug was, and live for roughly the first 5.5 hours of every IST day (UTC hasn't turned the calendar page yet). `get_monthly_report` itself was always correct (it uses the DB's own UTC `current_date`); only the test's comparison was wrong. Fixed to compute from UTC fields directly; 24/24 again.
  - [x] Done when: verified live via a throwaway Playwright script (deleted after use) driving the production build (`vite preview` — the service worker is disabled under `vite dev`) across two real browser contexts (doctor + reception, mirroring the two real devices): network cut mid-consultation (an offline pricing edit and "Consultation done" both queue without error, unmissable banner appears), the page reloaded *while still offline* (app shell boots from precache, banner and queue both survive from IndexedDB, confirmed by content assertion not just "didn't crash"), back online (queue drains automatically, both queued writes verified landed via direct DB reads), reception opens billing (detail already cached from being online a moment earlier — the documented boundary above, not skirted), network cut mid-billing/at print (confirming payment offline still invokes print — verified via a stubbed `window.print` call count, since a real print dialog can't run headless), and the final bill verified landed correctly and unflagged once reception's own queue drained. 14/14. The stale-amount-mismatch path itself (this phase's core money-safety property) is proven at the DB/API level in `phase-f-test.mjs`, not duplicated in the browser script.
  - [x] Post-report fix, caught by a second-opinion review before handoff: `replayOne`'s update branch checked only for a Postgres error, so an RLS denial — which returns `{ data: [], error: null }`, zero rows, no error (the same shape already documented from `phase-d-test.mjs`) — would dequeue as a false success, leaving requirement 6's banner with nothing left to warn about for a write that never actually landed. Fixed by adding `.select()` and treating an empty result as a genuine (halting) failure. Confirmed live, not just reasoned about: a receptionist-role client attempting a doctor-only `visit_pricing` update was captured returning exactly that empty-data/no-error shape against staging. `phase-f-test.mjs` re-run clean (21/21) after the change.
  - [x] Known, accepted (not fixed): `offlineQueue.ts`'s `online` listener and its 15s backstop `setInterval` are registered once at module scope with no teardown — harmless in this single-root app with no unmount path, but worth a second look if this module is ever imported somewhere that mounts/unmounts (tests, HMR-heavy work, a second root).
  - [x] Post-report fix, from a genuine `code-review` checkpoint (AGENTS.md Phase 3 names this before merging; it hadn't actually been run for this phase until after the completion report was drafted — corrected before handoff, not after): the Spec-axis sub-agent found `attemptOrQueue` decided whether to attempt online using only `navigator.onLine`, never checking whether the queue already held an item or was halted. A halted mutation is never dequeued, and the `'online'` listener's `drainQueue()` call is fire-and-forget — so a brand-new mutation fired right after reconnect could reach the server before an older queued (or halted) one finished replaying, which is precisely the "do not skip ahead" corruption requirement 3 names for `visit_pricing`'s monotonic revision. Verified directly against the code (not taken on the sub-agent's word) before fixing: traced every race window by hand. Fixed by checking `(await listQueue()).length === 0` before attempting online — a new write only ever goes straight to the server when nothing is ahead of it in the queue; otherwise it queues behind, preserving oldest-first order. Verified live: a temporary `window.__debugQueue` hook (added to `main.tsx`, removed immediately after) against the real production build confirmed both directions — an already-queued item forces a new mutation to queue too (`attempt` never called), and an empty queue still attempts directly (no regression to the online-first fast path).
  - [x] Post-report fix, same review: `OfflineQueueBanner` was only mounted in `App.tsx`'s signed-in branch, not the sign-in screen. Since the queue is deliberately not cleared on sign-out (residual edge 2, above), a receptionist who signs out at end of day with work still pending would see no warning at all at the exact moment requirement 6 cares most about — "before shutdown." Fixed by rendering the banner in the signed-out branch too; it has no auth dependency (`useOfflineQueue.ts` reads only the local IndexedDB queue).
- [ ] **Phase G — Go live** — audit run (items 1-5), findings below; build items 6-8 done. **Not complete**: the audit found real, unfixed Critical/High gaps in the app built by Phases A-F (see findings). Per this phase's own explicit instruction ("report findings ranked by severity... do not fix them in the same pass"), items 1-5 are audit-only — nothing below was fixed in this session, by design. Items 6-8 were build work and are done (with disclosed limits — see each).
  - [x] **Item 1 — `webapp-testing`, full flow both roles + offline.** Run live against the production build (`vite preview`, not `vite dev` — the service worker needs it) across three real browser sessions (doctor/reception/admin), cross-checked against direct DB reads. 42/43 automated checks passed on the final run. Findings, ranked:
    - **HIGH — three doctor-facing dropdowns (prescription templates, drug search, procedure search) are unusable by mouse/touch, in production, at any window size.** Root cause, verified directly (not taken on the auditing agent's word): `.search-results` (`Reception.css:74`) is `position: absolute; top: calc(100% + gap)`, but its wrapping elements — `.field` (`Reception.css:226`, used by `PrescriptionForm.tsx:227,254`) and `.record-section` (`Consultation.css:116`, used by `PricingPanel.tsx:208`) — never declare `position: relative`. Inside the doctor's consultation drawer the only positioned ancestor is `.drawer-panel` (`Drawer.css:17`, `position: fixed`), so the dropdown anchors to *that* instead — landing exactly at 100% of the viewport height, i.e. always one row below the visible screen, confirmed live in headless Chromium (dropdown `top` measured past `window.innerHeight`, page confirmed non-scrollable, a real coordinate-based click times out "outside of the viewport"). Reception's own patient-search dropdown does **not** have this bug — its wrapper (`.search-field`, `Reception.css:33`) *does* set `position: relative` — which is what proves the root cause rather than a browser/environment quirk. A doctor cannot apply a template or add a searched drug/procedure by clicking, at all, today. `MergePatients.tsx` has the identical missing-`position:relative` pattern but isn't rendered inside a fixed-position ancestor, so whether it's actually broken in practice is unconfirmed — check before go-live. Not fixed (audit-only) — the fix is small (`position: relative` on `.field`/`.record-section`, or switch the two drawer usages to `.search-field`) but deliberately left for a follow-up pass.
    - **HIGH — a real, reproducible cash-loss path: a visit can silently vanish from Reception's own billing queue.** `Consultation.tsx`'s doctor queue (`visits` query, ~line 98) filters only `.in('stage', ['waiting','with_doctor'])` — no date scoping at all. `TokenList.tsx` (Reception's worklist) filters `.gte('arrived_at', startOfToday())`. Confirmed directly: a stale, prior-day visit is fully reachable via "Call next," and once the doctor moves it to `packing`/`ready_at_reception`, it becomes invisible to Reception's own "Today" billing queue — reachable only via direct DB/API, with real money owed and no UI path to collect it. Reproduced live on this exact repo's staging data (visit `b80a8259-00e1-4f56-96ab-bb46a38e9b11`: arrived one day, reached `packing` the next, absent from Reception's list). Production trigger: any patient seen after midnight relative to check-in, or a backlog worked down the next day. Not fixed (audit-only).
    - **MEDIUM — a narrow timing gap in the "prints with zero connectivity" guarantee.** `Billing.tsx` (~line 230): the query supplying prescription/procedure content for print (`get_visit_billing_detail`) is separate from the one driving "Amount to collect," with nothing ensuring the former resolves before "Confirm payment" is clickable. If connectivity drops in that exact window, print falls back to nothing cached (a "No medicines prescribed" slip) rather than warning — reproduced directly in this run's offline-mid-billing scenario. Fix direction: gate payment-confirm/print on the detail query having resolved, or show a visible fallback state. Not fixed (audit-only).
    - **LOW** — `GstReport.tsx`'s own two inline date helpers mix local-time `Date` mutation with UTC `.toISOString()` extraction — the same bug class STATUS.md already records fixing twice elsewhere (`formatDateOnly`, `phase-e-test.mjs`), narrower this time (`lib/date.ts`'s `startOfToday()` is correct and unaffected). Can shift the GST report's default date range by a day for the first ~5.5 hours of each IST day.
    - **LOW** — a template-applied prescription row arrives with `quantity_dispensed` blank (no such column on `prescription_template_items`), and the disabled Review button's copy doesn't name quantity as the actual blocker.
    - **Operational, not a defect** — staging's clinic A carries 67+ stale non-terminal visits from accumulated testing; "Call next" is serialized clinic-wide on a single `with_doctor` row with no on-screen explanation when disabled (this exact shape of collision cost real time earlier in Phase F too — see that phase's entry). Left at 0 `with_doctor` rows at the end of this audit (verified).
    - Also verified clean, live, not just re-read from an earlier phase: reception check-in (new + existing), consultation → prescription/procedure/final-amount → done, billing → cash payment → print (slip content verified non-vacuous), unpaid-bill settle (immutability re-confirmed), admin reports (real non-zero figures) + admin's own row-reads still empty under RLS, and the full offline suite (mid-consultation queue + banner, reload-while-offline booting from precache with the queued mutation surviving in IndexedDB, mid-billing offline confirm+print, reconnect drain landing both writes correctly and unflagged).
  - [x] **Item 2 — `docs/security-review.md` against the whole app.** Verified live against staging (`pg_policies`, `pg_proc`, `information_schema.routine_privileges`/`table_privileges`, `pg_default_acl`, direct `set role anon` probes), not migration text. Findings:
    - **MEDIUM — `search_patients` has a live, unintended `anon` EXECUTE grant**, contradicting its own migration's explicit revoke (`20260905194019_search_patients.sql`). Root cause is the same "two-Supabase-privilege-grant gotcha" this file already documents as recurring — this one instance was missed. Confirmed independently via a direct query (`grantee=anon` present). Empirically **not currently exploitable**: `has_clinic_role`/`has_any_clinic_role` are independently anon-revoked, so the RLS policy it feeds denies before any row reads — but it's a defense-in-depth gap that should be closed directly (`revoke execute on function public.search_patients(uuid, text) from anon;`) rather than relying on a second, unrelated protection continuing to hold. Not fixed (audit-only).
    - **MEDIUM — a patient's real name can render on the pre-authentication sign-in screen.** `OfflineQueueBanner.tsx`'s halted state renders `mutation.description` verbatim, and several wired call sites embed the patient's actual name into that description (`Consultation.tsx`, `Billing.tsx`, `Reception.tsx`). The banner is deliberately mounted on the signed-out branch too (this session's own earlier code-review follow-up, for the correct reason — the queue survives sign-out and the warning must too) — but combined with a genuinely halted mutation, this means anyone with physical access to a signed-out device can see a real patient's name with zero authentication, the same threat model architecture-spec.md's lock-screen principle exists to prevent, on a different screen than the one it named. Confirmed directly by reading both files. Not fixed (audit-only) — fix direction: don't render `description` (or scrub it to non-identifying text) while unauthenticated.
    - **LOW** (already known, re-confirmed) — `rls_auto_enable()` still shows anon/PUBLIC EXECUTE in the advisor; confirmed still inert (`RETURNS event_trigger`, un-invokable outside real trigger context regardless of grants) and not authored by this project.
    - **LOW** — Supabase Auth leaked-password-protection is disabled (dashboard toggle, no code change) — worth enabling before go-live.
    - **Informational** — `consultation_fee_paise` is declared `int` rather than `bigint` in a few function signatures (e.g. `20260906130000_billing_confirm.sql`), vs. the table column itself which is `bigint`. Still an exact integer, no float/precision risk — flagging only because the non-negotiable's wording is literally "bigint."
    - Checked and confirmed clean: RLS enabled + fail-closed-for-anon on all 27 tables (empirically probed, not just read); all SECURITY DEFINER functions correctly `search_path=''` except the pre-existing platform function above; money is bigint everywhere; no secrets in the repo; zero patient-identifying data in any log/error path (no `console.error` calls anywhere in `src/`, no error-tracking SDK installed at all); role boundaries (receptionist can't write `visit_pricing`, admin has zero row-level access anywhere including inside every report function's return shape, only doctor can reopen a paid visit — all confirmed at the RLS/function level, not the UI).
  - [x] **Item 3 — Supabase security advisor.** Matches item 2's findings exactly (`search_patients`, `rls_auto_enable`, leaked-password-protection) — no new items. Performance advisor: all findings are INFO/WARN-level query-planner efficiency notes (unindexed FKs, RLS re-evaluation cost, redundant permissive policies) — no ERROR-level findings, nothing go-live-blocking.
  - [x] **Item 4 — full isolation test suite.** `isolation-test.mjs`, 19/19 passed. One coverage gap found and confirmed directly (not just taken on the codereview-spec sub-agent's word): the script's own Edge Function check hard-codes "not applicable — no edge functions are deployed on this project yet," but two are deployed (`health`, `admin-create-login`, plus this session's new `backup-freshness`). Traced `admin-create-login`'s authorization path by hand: it checks the caller's own JWT-bound `user_roles` row before trusting the client-supplied `clinic_id`, so it's actually safe — but architecture-spec.md's explicit requirement to verify this **adversarially, not by inspection** was never honored by this script, and its own claim about what's deployed is simply wrong. Fix direction: update the script to actually probe `admin-create-login` cross-clinic, not just correct its stale comment. Not fixed (audit-only).
  - [x] **Item 5 — `code-review` against the whole app** (fixed point: the true root commit, `9aca0ad` — this repo has never had a whole-app code-review before, only Phase F's own diff). Standards axis: no hard AGENTS.md/ponytail violations found. Real findings: **an undocumented gap in the offline mutation queue** — five mutations (`Reception.tsx`'s `checkInRep`, `RepQueueRows.tsx`/`FollowUpTodos.tsx`'s `markDone`, `CarePanel.tsx`'s `saveLongTerm`/`saveFollowUp`, `DocumentsPanel.tsx`'s `issue`) fire plain online-only Supabase calls with no `attemptOrQueue`/`networkMode:'always'`, and none is in this file's own explicit online-only exclusion list from Phase F — confirmed directly for two of the five (`checkInRep`, `RepQueueRows`'s `markDone`); a write made offline through any of these five is silently lost on refresh, with no "not saved yet" warning. Also found: TypeScript `strict` mode is not actually enabled in either `tsconfig` despite the codebase's pervasive null-safety discipline assuming it is (worth confirming intent); a duplicated `formatDate` reintroduced in `Consultation.tsx` despite `lib/date.ts` existing for exactly that reason. Cross-cutting: `confirm_bill`'s full body has been retyped across 5 separate migrations (Shotgun Surgery, structurally near-unavoidable for Postgres functions) — already the source of one real regression this build caught itself (Phase F); SECURITY DEFINER grant/revoke hygiene took ~8 reactive fix-migrations to converge before stabilizing from Phase C onward, with zero slips since — worth writing the checklist into AGENTS.md now that it's proven stable. Spec axis (against the PRD, build-plan, architecture-spec, and AGENTS.md's non-negotiables): **3 Critical** findings, independently verified directly, not taken on the sub-agent's word — (1) the offline money-conflict *resolution* half doesn't exist: mismatches are correctly detected and flagged (`bills_needing_reconciliation`, surfaced on the Daily Report), but no RPC or UI screen anywhere lets a doctor actually write the correction row the architecture decision requires — confirmed by grep, the only place `corrects_bill_id` is ever set is the synthetic seed migration's raw SQL; (2) the idle-lock/PIN system (5 user stories, a full architecture-spec section: per-station timeout, manual lock, blank lock screen, draft-preserving unlock) is entirely unimplemented — confirmed by grep, zero hits for "idle", "lock", "pin_hash"; (3) the consultation fee has no admin setter anywhere despite the PRD explicitly requiring one — confirmed directly in `ClinicSettings.tsx`, which has RPCs for UPI VPA and doctor info but nothing for the fee, itself hardcoded at the table default since Phase 1. High: `confirm_bill`'s audit timestamp/confirmed_by reflect queue-drain time and whichever session is active then, not the actual click (`final_amount`/`revision_number` themselves ARE correctly snapshotted at click time, online or offline — only the timestamp/author fields are wrong); and (now resolved by this same session's own build work, not a live gap any more) Phase G's build items were materially incomplete at the time this finding was written — see items 6-8 below. Medium/low: the Long-Term Register screen implements neither of its two PRD-specified interactions (no row click-through, no overdue-only filter); `bump_pricing_revision` bumps on a condition broader than architecture-spec's literal wording (any pricing change, not just a final-amount edit) — confirmed directly in the trigger body, low risk since it only produces *extra* reconciliation flags, never a missed one; seed data is missing the one enumerated "overdue long-term patient" case. Also confirmed solid and explicitly stated so: RLS on all 27 tables, `bills` has no UPDATE/DELETE policy at all (immutability enforced at the RLS layer, not just convention), stock+billing correctly idempotent in one transaction, role-based clinical visibility matches spec exactly, multi-clinic scoping complete, locum doctor accounts work, no scope creep anywhere (no WhatsApp/SMS/booking code).
  - [x] **Item 6 — `docs/runbook.md`.** Rewritten from a 9-line deploy-sequencing note into a full account inventory (by name/location only, no values), deploy + migration procedures, step-by-step restore-from-backup, an "it's not loading at 11am" triage checklist, a known-gotchas digest pulled from this file's own history, and what a new developer needs to read first. Explicitly lists every remaining human-only setup step (below).
  - [x] **Item 7 — health endpoint.** Fixed to use the anon key, not service_role, per this phase's explicit instruction. Directly querying `clinics` as anon turned out to fail closed with a real Postgres permission error (`permission denied for function has_any_clinic_role`) rather than a clean empty result — `has_any_clinic_role`'s anon EXECUTE was deliberately revoked in an earlier phase (`20260905184543_fix_default_privileges.sql`), and re-granting it just to make this one endpoint cleaner would have reopened exactly the surface that migration closed, for every other RLS-gated table, not just this one. Resolved instead with a new, narrow, single-purpose SECURITY DEFINER function (`public.health_ping()`, migration `20260907010000`) that does nothing but confirm `clinics` is queryable and return a bare boolean, granted to `anon` alone. Verified live: `scripts/health-endpoint-test.mjs` passes (2/2, exact `{"ok":true}`, no Authorization header needed), and the anon-only grant confirmed via `information_schema.routine_privileges`. `vercel.json`'s SPA rewrite (`/((?!api/).*)`) correctly excludes any future `/api/*` path from the catch-all — confirmed by inspection; currently unexercised since this endpoint lives on Supabase, not Vercel, matching architecture-spec.md's own explicit choice of an Edge Function over a Vercel route.
  - [x] **Item 8 — weekly backup job.** Built: `.github/workflows/backup.yml` (GitHub Actions, weekly, not Vercel cron — Hobby cron is once-daily and can't shell out to `pg_dump`/`age`/`aws`), `scripts/backup.sh` (`pg_dump` --schema=public via the new `backup_reader` role → gzip → `age`-encrypt with the committed public key → upload to R2), migration `20260907020000_backup_reader_role.sql` (a dedicated, password-less-until-a-human-sets-it, read-only role — applied to **staging only**; production needs the same migration as a deliberate, separately-timed step, not done automatically by this session — see runbook), and `supabase/functions/backup-freshness` (lists the R2 bucket, 200/500 on <8/>8 days old, deployed to staging, fails safe with `{"ok":false}`/500 until its R2 secrets exist). An `age` keypair was generated for this: the **public** key is committed (`backup/age-public-key.txt`); the **private** key was handed off out-of-band (not pasted into any chat log or committed file) for the user to move into their password manager immediately — this is the single most important pending step, since without it a restore is impossible regardless of how well the rest of the pipeline runs. **Disclosed limits, not fixed**: the encryption round-trip was verified byte-for-byte using real migration SQL as a stand-in payload (`age`/`pg_dump`/`aws` binaries confirmed correct via `bash -n`/`shellcheck`/`actionlint`, and `backup.sh`'s own logic smoke-tested with shimmed `pg_dump`/`aws` calls) — but the actual `backup_reader` credential path, the real R2 upload, and a real `psql` restore were **not** exercised end-to-end, because I have no DB superuser/Dashboard access to set the role's password, no Cloudflare account, and no `gh` CLI/repo-secrets access. Every one of those is a genuine human-only step, listed explicitly in the runbook's "Pending setup" section — this is a built, reasoned, partially-verified pipeline, not yet a working one.
  - [ ] **Not done, and not attempted this session** (surfaced only as audit findings, per items 1/2/5 above): the three Critical spec gaps (offline-reconciliation resolution UI, idle-lock/PIN, consultation-fee admin setter), the two High app bugs found live (the drawer dropdown CSS bug, the doctor-queue date-scoping cash-loss bug), the two Medium security findings (`search_patients` anon grant, patient name in the signed-out halted banner), and the offline-print timing gap. These need a follow-up phase/session with fixes actually applied and re-verified — this session's mandate was audit-only for items 1-5.

## Resolved this session (Phase A's two open decisions)

1. **Merge moved from admin to doctor, `admin_search_patients_for_merge`
   deleted.** User's call: deciding two records are the same person is a
   clinical judgment about a patient, not configuration. The doctor
   already has a legitimate `patients_select` read; admin does not, and
   now has no exception at all — `docs/security-review.md`'s "admin
   cannot read patients" line was clarified to say so explicitly.
   `merge_patients`' authorization check moved from `has_clinic_role(...,
   'admin')` to `'doctor'`; the narrow admin-only search RPC was dropped
   outright (migration `20260906210000`) since the doctor's own
   `search_patients` RPC (already used by Reception's check-in screen)
   covers the same search under real RLS. The UI moved from an Admin tab
   to a standalone doctor-only nav section (`src/pages/MergePatients.tsx`).
   Verified live and via `admin-phase-test.mjs` (23/23): admin and
   reception both rejected with "only a doctor can merge patients";
   admin_search_patients_for_merge no longer exists at all.
2. **Orphaned test login**: the user is deleting
   `should-not-exist-<timestamp>@staging.test` directly in the Supabase
   dashboard themselves. Explicit instruction: do not add service-role
   access to any script to make this easier — that key stays off the
   machine. Nothing to do here on the code side.
   Same session, the user also asked for a related real case to be
   covered: a login created with no role assigned (the role forgotten).
   `noroles@staging.test` was created via the *existing*
   `admin-create-login` Edge Function (its already-deployed service role
   stays server-side; nothing new was added to any script), then its
   `user_roles` row removed via a plain, already-RLS-permitted delete —
   the same mechanism the Logins tab's own "Remove" already uses.
   Caught and fixed two real 406 console errors in the process
   (`useClinicId`'s `.single()` throws on the now-legitimate zero-role
   case; switched to `.maybeSingle()`) and gave `AppShell` an explicit
   message instead of a vague fallback. New committed test:
   `scripts/no-role-account-test.mjs` (4/4) — the one script in this
   repo that drives a real browser, since this is a rendered-UI
   behavior no API-level check can verify.

## Caught this phase (Phase B)

Two real findings from running `docs/security-review.md` against the
live database (not just re-reading the migration text) — both fixed in
the same phase, unlike Phase A's merge finding, because neither carried
a policy tradeoff for the user to weigh:

1. **A doctor reopening a paid visit and reception re-confirming the
   bill double-deducted stock.** `confirm_bill`'s early-return only
   fires when the visit's *current* stage is `paid`; reopening (a real,
   allowed flow — this doc's own "only doctor can reopen a closed
   visit") flips it away from `paid`, so re-confirming ran the whole
   function again, including the new stock deduction, against the same
   `prescription_items`. Reproduced live before fixing: reopening and
   rebilling a test visit doubled its `stock_movements` for the same
   medicine. Fixed by keying the dispensed movement to the
   `prescription_item` itself (`reference_id = prescription_items.id`,
   not the bill id) and only inserting when that specific item has no
   prior dispensed movement — a rebill of unchanged items is now a
   no-op for stock; a medicine added after reopening still deducts.
   Regression test added: `stock-test.mjs` section 8.
2. **Two `SECURITY DEFINER` trigger functions still had the implicit
   PUBLIC EXECUTE grant** every `CREATE FUNCTION` gets by default —
   `apply_stock_movement` (new this phase, only revoked from
   anon/authenticated, never PUBLIC itself) and
   `ensure_final_amount_set_on_packing` (pre-existing, from an earlier
   phase, never revoked at all). Not a live exploit — Postgres refuses
   to invoke a `returns trigger` function outside real trigger context
   regardless of grants — but fixed for consistency with every other
   function in the project. Confirmed via
   `information_schema.routine_privileges` before and after.

Also fixed as an obvious, zero-downside one-liner while it was noticed:
`DrugList.tsx`'s remove-error copy said "already used in a prescription
or bill," which is now sometimes wrong — a `medicine_stock` or
`stock_movements` row blocks the same `NO ACTION` FK delete too. Updated
to mention stock records.

**Recorded but not fixed** (low risk, no test currently exercises it):
`record_stock_count` reads `medicine_stock.quantity` as `expected` without
`select ... for update`, then writes a signed delta rather than setting
an absolute value. A bill confirming for the same medicine mid-count
could leave the final quantity slightly off from what was actually
counted. Real, but low-probability at two concurrent users, and this
project already has a locking precedent (`confirm_bill`,
`assign_token_number`) if it's ever worth closing.

## Caught by ponytail (fixed before calling Phase A done)

Custom patient fields and the "procedure immediately usable" half of
Phase A's own "done when" line were **not** originally wired end to end
— the backend/RLS/Admin-UI side was built and tested, but nothing made a
new field actually render on the intake form. Caught during the ponytail
pass, not by a user report. Fixed: `NewPatientForm.tsx` now queries
`patient_field_definitions` and renders one input per definition
(text/number/date/boolean), coerced to the right JSON type before being
written into `patients.custom_fields`. Verified live end to end: added a
field in Admin, it appeared on the intake form with no further code
change, and the value round-tripped into the database correctly.

## Done already (predates the lettered plan)

- The money loop: check-in, search, live queue, doctor's consultation
  screen, carried-forward comments, prescription writing (templates/
  repeat-last/search), procedures, doctor-set final amount + derived
  discount, cash billing, browser print (prescription + receipt, zero
  connectivity).
- Tenant/role isolation (`isolation-test.mjs`, 19/19).
- Billing/pricing arithmetic correctness (`billing-test.mjs` 16/16,
  `pricing-test.mjs` 15/15).
- A structural frontend redesign: dense sortable worklist + Drawer
  overlay, replacing the two-pane grid every earlier visual pass kept.
- Realtime was silently non-functional (the `supabase_realtime`
  publication had never included any table) — fixed; both directions
  now sync in under a second.
- A real correctness bug: confirming a prescription used to move a
  visit straight to `packing` on its own, locking a doctor out of
  pricing with no way back for anyone — fixed, plus a database backstop.
- Polling backstop: `refetchInterval` is 30s globally
  (`refetchOnWindowFocus: true` on top).
- Keep-alive health endpoint (`supabase/functions/health`) — public,
  does a real read against `clinics` via the service role, verified live
  via `pg_stat_user_tables` that it's a genuine query.

## Context a future session needs

- **Migrations are immutable once applied.** Never edit an applied
  migration file — write a new one, even for a one-line fix.
- **Supabase MCP is read-only verification, never a way to change
  staging.** Every schema/data change is a migration file, applied via
  `supabase db push`, committed.
- **The two-Supabase-privilege-grant gotcha keeps recurring** — this
  phase alone hit it once more (`merge_patients` had EXECUTE granted to
  `anon` despite `revoke ... from public`) and caught it proactively via
  `information_schema.routine_privileges` before it shipped. Check this
  for every new `SECURITY DEFINER` function, every phase, no exceptions.
- **A user can legitimately hold more than one role at a clinic** —
  the doctor holds `{doctor, admin}` alongside a dedicated admin-only
  account (confirmed live: `doctor.a` and `admin.only` both hold
  `admin` for Clinic A). Any query assuming "at most one admin row per
  clinic" (e.g. `.maybeSingle()` without `.limit(1)`) will break the
  moment it runs as a caller who satisfies both. Hit this once already
  in `admin-create-login`'s own admin-check query — fixed with
  `.limit(1)` before `.maybeSingle()`.
- **`auth.users` is not reachable from a plain client query** — it's
  outside the `public` schema PostgREST exposes. Any UI needing an
  email (not just a `user_id`) needs a SECURITY DEFINER RPC
  (`list_clinic_logins` is the precedent) or an Edge Function.
- **Creating a login needs the service role** (`auth.admin.createUser`)
  — `supabase/functions/admin-create-login` is the pattern: bind a
  caller-JWT client to check authorization first, then switch to a
  service-role client to perform the actual privileged write. Rolls
  back the orphaned auth account if the follow-up `user_roles` insert
  fails.
- **Removing a login's role does NOT delete the underlying `auth.users`
  row** — deliberate: revoking clinic access is not erasing an identity
  that may hold a role at a second clinic once one exists. There is
  currently no in-app way to hard-delete a login entirely; the one
  stray test account from this phase (see above) needs the dashboard.
- **Every FK from `bill_line_items`/`prescription_items`/
  `visit_procedures`/`prescription_template_items` into
  `medicines`/`procedures`/`prescription_templates` is `NO ACTION`**
  (confirmed via `information_schema.referential_constraints` before
  writing Phase A's migration) — a real "remove" on a drug/procedure
  that's ever been used will fail at the database level. The Admin UI
  catches this and shows a plain message rather than crashing; there is
  no soft-delete/archive flag, by design (not asked for).
  `prescription_template_items.template_id` was changed to `ON DELETE
  CASCADE` specifically (its own migration), since a template's items
  have no independent historical meaning once the template is gone —
  medicines/procedures were deliberately left `NO ACTION`.
- **Merge only ever needed to reassign two tables** — `visits` and
  `patient_comments` are the only tables with a `patient_id` FK
  (checked directly via `information_schema.columns`, not assumed).
  `visit_pricing`/`bills` key off `visit_id` and follow automatically.
  If a future phase adds a new table with `patient_id`, `merge_patients`
  needs updating in a new migration — it will not pick it up on its own.
- The synthetic seed data (staging only, never production) now includes
  a scattering of Phase-A test fixtures (drugs, procedures, templates,
  custom field definitions, patients) with obvious names
  (`UI Test Drug ...`, `Admin Test Med ...`, `Merge Test ...`) — harmless,
  consistent with everything else already in staging from earlier
  phases. Phase B added the same kind of scattering (`Stock Test Med
  ...`, `Stock E2E Patient ...`) plus several extra `bills` rows on one
  test visit from live-reproducing the reopen/rebill bug above — same
  posture, staging-only, harmless.
- **Money stays untouched by quantity.** `recompute_visit_pricing`'s own
  header already documented that a prescribed medicine bills as one flat
  unit regardless of dispensed quantity (a deliberate, pre-existing
  scope boundary, not something Phase B revisits) — confirmed before
  adding `quantity_dispensed`, specifically so it stays a stock-only
  concept and `bill_line_items.quantity` (default 1) is never touched by
  this phase.
- **`stock_movements.reference_id` is deliberately untyped (no FK)** —
  it points at different tables depending on `reason` (a purchase id, a
  prescription_item id for `dispensed`, a generated id shared by a
  transfer's paired rows, a stock_count id for `count_correction`). A
  future phase adding a new `reason` should decide what it correlates to
  before reusing this column.
- **Every new Phase B table is doctor/receptionist only, no admin
  access** — deliberate continuation of Phase A's own framing (admin is
  catalog/config, not day-to-day operations). If a future phase wants
  admin visibility into stock (e.g. for reporting), that's a new,
  explicitly-scoped read, not a blanket RLS relaxation. Note this idiom
  no longer has a live example in this codebase: the one prior instance
  (`admin_search_patients_for_merge`) was deleted this session precisely
  because a narrow read still turned out to be the wrong call once the
  user weighed it — read "Resolved this session" before reaching for
  this pattern again.
- **Settling is a new linked record, not a correction.**
  `corrects_bill_id` is for amount corrections after pricing drifted (a
  different concern, unaffected by Phase C); settling a pay_later bill
  is `bill_settlements`, a separate table with no relationship to
  `corrects_bill_id` at all. If a future phase needs to settle a bill
  that also needs a price correction, that's two independent linked
  records against the same original bill, not one mechanism reused for
  both.
- **`unpaid_bills` and `bills_needing_reconciliation` are both
  `security_invoker` views over `bills`** — the established idiom for
  "a derived read across tables that must inherit the querying user's
  own RLS, not the view owner's." Reach for this before a new RPC
  whenever the only reason for an RPC would be joining a few tables for
  display, not elevating privilege. Neither view filters by `clinic_id`
  itself — both rely entirely on the caller's RLS on `bills`/`visits`/
  `patients` to scope rows to their own clinic. Harmless today (RLS
  already restricts every caller to their own clinic's rows regardless
  of what the view returns), but a future multi-clinic-per-user role
  would need the view's own `where clinic_id = ...` predicate, not just
  RLS, to stay correct. **`long_term_register` (Phase D) joins this same
  pattern** — also no own `clinic_id` predicate, also relies on the
  caller's RLS on `patients` plus the frontend's own `.eq('clinic_id',
  ...)` filter.
- **A blanket doctor+receptionist UPDATE policy on a shared table
  (`visits`, `patients`) is not enough to enforce "only role X sets
  column Y."** An RPC's own internal role check only holds if nothing
  else can reach the same column — on a table both roles can already
  update for other reasons, a direct client call bypasses the RPC
  entirely. Phase D's `follow_up_date`/`is_long_term` fields are the
  first case of this in the app; closed with a `BEFORE UPDATE` trigger
  per table, gating specific columns via `IS DISTINCT FROM` rather than
  gating the whole row, so every other existing write path through that
  table keeps working unexamined. Reach for this — not just an RPC role
  check — the next time a doctor-only or reception-only field lands on
  `visits` or `patients` specifically (both already have blanket update
  policies); a brand-new table with no client update policy at all
  doesn't need it, per the `bill_settlements`/`clinic_documents` idiom.
- **A `SECURITY DEFINER` view can't check the caller's role; a
  `SECURITY DEFINER` function can.** Every earlier admin-safe aggregate
  in this project (`unpaid_bills`, `bills_needing_reconciliation`,
  `long_term_register`) used `security_invoker = true` views, which
  work precisely *because* they inherit the caller's own RLS —
  admin gets nothing from them for the same reason admin gets nothing
  from the underlying table directly. Phase E's reports are the
  opposite case: admin needs aggregates *despite* having no RLS access
  at all, which means the function must bypass RLS (`SECURITY
  DEFINER`) and enforce the role check itself, in its own body — not
  something a view's definition can express. Reach for a view when the
  caller's own RLS is what should decide access; reach for a function
  when RLS would give the caller nothing and the whole point is
  handing them a safe, aggregated slice anyway.
- **Every reports function derives `clinic_id` from `auth.uid()` via
  `user_roles`, never accepts it as a parameter.** This is the one
  invariant that keeps a `SECURITY DEFINER` report function from
  becoming a cross-clinic read for any authenticated user — confirmed
  by grepping the whole migration file for `p_clinic_id`, not just by
  inspecting each function individually. Apply the same grep-level
  check to any future admin-aggregate function before it ships.
- **Collections is cash-basis, not accrual** — a `pay_later` bill
  confirmed today contributes nothing to today's collections until it
  is actually `settle_bill`'d, possibly on a different day. If a future
  report needs a *billed* figure (as opposed to *collected*), that's a
  different query, not a variant of this one — don't quietly conflate
  the two.

## Context a future session needs (Phase F)

- **A device only works offline for what it already fetched while
  online.** Persisted reads (`persistQuery.ts`) make an already-successful
  query durable across a reload; they don't invent offline access to a
  query that never ran. Combined with the serial, same-device queue drain
  order, this rarely bites in the real product flow (see the Phase F
  checklist entry above) but is a real boundary for any future screen —
  don't assume a query "just works" offline without checking it was ever
  fetched first.
- **`networkMode: 'always'` is mandatory on any `useMutation` wrapped in
  `attemptOrQueue`.** React Query v5's default (`'online'`) pauses a
  mutation before `mutationFn` ever runs while offline — silently
  defeating the online/offline branch inside `attemptOrQueue` itself, not
  erroring loudly. Forgetting this on a future call site would look like
  "the button just spins forever offline," not a clear failure.
  Discovered exactly this way while first wiring `Billing.tsx`.
  Queries keep the default (`'online'`) deliberately — a paused query
  quietly serving stale cached data offline is correct; a paused mutation
  silently not doing anything is not.
- **The mutation queue is scoped to 12 call sites, not every write in the
  app** (`Consultation.tsx`, `PrescriptionForm.tsx`, `PricingPanel.tsx`,
  `Billing.tsx`, `Reception.tsx`'s two check-in mutations) — see the Phase
  F checklist entry for the full list and the reasoning. A future screen
  that needs offline support isn't automatically covered; it needs its own
  `attemptOrQueue` wiring plus an optimistic cache patch, following one of
  the existing call sites as the pattern.
- **A client-generated uuid is the whole idempotency mechanism for
  inserts** — no separate idempotency-key column exists or is needed.
  `upsert(row, { onConflict: 'id', ignoreDuplicates: true })` makes a
  replayed insert a safe no-op. A future insert-shaped offline write
  should follow this, not invent a new mechanism.
- **`confirm_bill` now takes 4 args**
  (`p_visit_id, p_payment_method, p_snapshot_final_amount_paise,
  p_snapshot_revision_number`), the last two optional and `null` by
  default. Any future migration touching this function again must extend
  it the same way `20260907000100` did — drop-then-create, never a bare
  `CREATE OR REPLACE` with new required params (breaks every existing
  2-arg caller with "function is not unique"), and re-run
  `information_schema.routine_privileges` afterward without exception,
  since grants never carry across a signature change.

## Phase G fix pass — Critical findings (all 3 fixed)

Worked strictly in severity order, one finding per commit, each with its
own red-then-green test and a full regression-suite re-run before moving
to the next. Nothing in High/Medium was touched — stopping here per this
pass's own explicit instruction.

- [x] **Critical #3 — consultation fee had no admin setter.** Fixed:
  `admin_set_clinic_fee` (migration `20260907030000`), same narrow
  admin-gated idiom as `admin_set_clinic_upi_vpa`; wired into
  `ClinicSettings.tsx` using the existing `formatPaiseForInput`/
  `parseRupeesToPaise` money helpers. TDD: `scripts/phase-g-fixes-test.mjs`
  Section 1, red (function didn't exist) then green, 4/4. One test bug
  caught and fixed before considering this done: an assumed "doctor
  blocked" assertion doesn't hold, since `doctor.a` also holds `admin`
  (docs/STATUS.md's own documented roster) — removed rather than left
  wrong, matching how `admin_set_clinic_upi_vpa`'s own test already
  handles this. Changing the fee doesn't retroactively touch an open
  visit's `calculated_total_paise` — only new visits and any open visit
  whose own procedures/prescription_items change afterward, per
  `recompute_visit_pricing`'s pre-existing, already-documented behaviour.
  Full regression suite clean. Re-ran the exact grep that surfaced this
  finding — confirmed closed.
- [x] **Critical #1 — the offline money-conflict *resolution* mechanism
  didn't exist.** Detection (`bills_needing_reconciliation`) and
  surfacing (the Daily Report's count) already worked; nothing let a
  doctor write the correction row. Fixed: `correct_bill(p_bill_id)`
  (migration `20260907040000`) — doctor-only, re-snapshots whatever
  `visit_pricing` says *right now* (no typed-in amount, so no new way to
  get the figure wrong) — plus a new doctor-only screen
  (`src/pages/Reconciliation.tsx`) listing flagged bills side by side
  with what was billed vs. the actual amount. `bills_needing_reconciliation`
  extended (columns only ever appended, never reordered/removed) with
  `patient_name`/`token_number`/`arrived_at`/live pricing — the context a
  doctor needs to act, following the exact join `unpaid_bills` already
  uses. Doctor-only, not admin: deciding the correct amount is tied to
  the doctor's own pricing decision (non-negotiable #2), same reasoning
  `merge_patients` already established for a similar judgment call.
  TDD: `scripts/phase-g-fixes-test.mjs` Section 2, red (function/view
  columns didn't exist) then green, 12/12 — including two of my own test
  bugs caught before calling it done: a wrong view column name
  (`bill_id` vs. the view's actual `id`) that silently swallowed a real
  query error through an unchecked `.maybeSingle()`, which made a
  downstream assertion pass for the wrong reason (a query error, not the
  thing it claimed to verify) until traced down and fixed. Live UI
  smoke-tested against a fresh fixture (row shows both amounts, Correct
  button removes it, DB confirms the correction landed). Full regression
  suite clean. Re-ran the exact grep that surfaced this finding —
  confirmed closed.
  **Deferred, not fixed** (discovered as a side effect of this fix,
  out of scope for it): `get_daily_report`'s collections sum doesn't
  exclude a corrected bill's original row, so a same-day correction
  would double-count that visit's money in the daily figure. Purely
  theoretical before this fix (corrections only ever existed via a
  frozen seed row); newly exercisable now that a real correction path
  exists. Needs a product decision (does a correction represent new cash
  changing hands, or a pure bookkeeping adjustment?) before it's an
  engineering fix — revisit before this screen sees real use, not before.
- [x] **Critical #2 — idle-lock/PIN was entirely unimplemented.** Built
  from scratch: a local PIN (`src/lib/pinLock.ts`, Web Crypto SHA-256,
  verified fully offline, stored in `localStorage` — not the offline
  queue's own IndexedDB store, since this is a device-local security
  artifact, not patient data or a queued write); a reusable idle-timeout
  hook (`src/lib/useIdleTimer.ts`); a full-viewport lock overlay
  (`src/components/LockScreen.tsx`, deliberately not a `Drawer` — a
  `Drawer` closes on Escape/scrim-click, which a lock screen must never
  do) rendering nothing but a PIN field, no patient name/queue/token/
  amount; a Set/Change-PIN control and a manual one-click Lock button in
  `AppShell.tsx`. Per-station timeout derived from role (doctor: 15
  minutes; everyone else: 2), not a physical station setting, since this
  is a login session not a kiosk — a doctor who also holds admin still
  gets the doctor's longer window. The app underneath stays mounted the
  entire time locked (the overlay renders `null` when unlocked rather
  than being conditionally mounted by its caller), so locking never
  discards an in-progress draft. TDD: `scripts/idle-lock-test.mjs`, a
  live Playwright script (pure client-side behaviour — no DB round trip
  — same convention as `no-role-account-test.mjs`, the one other script
  in this repo that drives a real browser for exactly this reason).
  Confirmed genuinely red first by stashing the fix and re-running
  against the reverted code (times out looking for a control that
  doesn't exist yet), then restored and green, 9/9 — manual lock, wrong/
  correct PIN, draft-preservation across a lock/unlock cycle, the lock
  screen actually covering the header (checked via
  `document.elementFromPoint`, not just "the element exists somewhere in
  the DOM"), and the doctor's 15-minute idle timeout firing automatically
  via Playwright's clock API (installed before a page reload so the
  timer is scheduled under the fake clock from the start — installing
  mid-session left an already-real-clock-scheduled timer unreachable by
  the fast-forward). Full regression suite clean. Re-ran the exact grep
  that surfaced this finding — confirmed closed.

## Phase G fix pass — High/Medium findings (all 5 fixed) plus one deferred item

Same rules as the Critical pass: one finding per commit, fix only what
the finding said, a regression test per behavioural fix, full suite
after each, re-ran the originating check to confirm closure. Worked in
severity/risk order by explicit instruction, not the order the audit
originally listed them in — money first.

- [x] **1 (money first) — a visit crossing midnight unbilled could
  vanish from Reception's own billing queue.** Established first, per
  this pass's own instruction: there is no end-of-day/expiry concept
  anywhere in this app for an open visit — nothing else ever says
  "yesterday's unbilled visit stops being billable" — confirming this
  is a query-scope bug, not a missing product state. `TokenList.tsx`
  filtered strictly on `arrived_at >= today`, no exception for a visit
  that hasn't been paid yet. Fixed: kept the existing "today" scope for
  anything already paid (no reason to flood the worklist with settled
  history), added `stage != 'paid'` as an escape hatch — mirroring the
  doctor's own queue, which never date-scopes at all. TDD: both the old
  and fixed query shapes run directly against a fresh stale-visit
  fixture — the old shape genuinely misses it (confirms the bug, not
  assumed), the fixed shape surfaces it while still excluding an old
  *paid* visit. Re-confirmed against the exact visit id the original
  audit reproduced (`b80a8259-...`) — now correctly included.
- [x] **2 — a patient's name leaked outside an authenticated, unlocked
  session.** `OfflineQueueBanner`'s halted state rendered
  `mutation.description` (embeds real patient names at several call
  sites) verbatim, on the signed-out screen and — since it's a sibling
  of `AppShell`, not a child — through yesterday's new lock screen too,
  which had no way to know the screen was locked. Fixed by lifting
  `locked` state out of `AppShell.tsx` into `App.tsx` (the shared
  ancestor) and threading a `redact` prop into the banner — true when
  signed out or locked. Swept for the general case per the brief:
  grepped every other always-mounted top-level surface
  (`StagingBanner`, `SignIn`, `document.title`) for dynamic/patient-
  derived text; none found — this banner was the only surface with the
  problem. TDD: a dev-only `window.__debugQueue` hook (guarded by
  `import.meta.env.DEV`, confirmed stripped from the production
  build — 0 occurrences in the built bundle) forces a genuinely halted
  mutation deterministically. Confirmed red (patient name visible both
  locked and signed out), green after (7/7).
- [x] **3 — `search_patients`' unintended anon EXECUTE grant, revoked.**
  Its own migration only ever did `revoke ... from public; grant ... to
  authenticated`, never explicitly revoking from anon — the two-
  Supabase-privilege-grant gotcha this file already flags as recurring.
  Not currently exploitable (SECURITY INVOKER means an anon caller
  still hits `patients_select`'s RLS and gets nothing), but closed
  directly rather than left to rely on that second, unrelated
  protection. Confirmed via `information_schema.routine_privileges`
  that no other function carries an unintended anon grant — `health_ping`
  (deliberately anon, the public health endpoint) and `rls_auto_enable`
  (a pre-existing platform function, already accepted) are the only
  other two. TDD caught its own mistake before calling it done: a bare
  "permission denied" assertion passed even before the fix, since RLS's
  own `has_clinic_role` helper denies anon first regardless — tightened
  to check the error message specifically names `search_patients`
  itself (denied at the grant, before ever reaching RLS).
- [x] **4 — the offline-print timing gap, closed with an explicit grace
  window.** `Billing.tsx`'s `detail` query (the prescription/procedure
  rows `PrintableSlip` renders) had nothing ensuring it resolved before
  "Confirm payment" was clickable — a connectivity drop in that exact
  window printed an empty prescription table, not a warning. Reproduced
  the exact timing deterministically before fixing it (a Playwright
  route interception delaying the RPC). First fix attempt
  (`networkMode: 'always'` + a single retry, gating on
  `fetchStatus === 'fetching'`) was wrong: tested against a real
  simulated outage, Confirm stayed stuck for 30+ seconds because a fetch
  against a dead connection doesn't reliably fail fast — retry backoff
  assumes a failure signal arrives quickly, which isn't guaranteed.
  Fixed instead with a plain, fixed-duration `setTimeout` grace window
  (2s), independent of React Query's own retry/fetchStatus machinery —
  a bound this project controls directly. Two scenarios verified live:
  a brief connectivity blip (Confirm blocks, then the real prescription
  prints once the blip passes) and a genuine sustained outage (Confirm
  still unblocks within the bounded window — measured ~2000ms, not
  indefinite — and print still fires per non-negotiable #7, honestly
  with no prescription data cached, matching Phase F's already-
  documented "never fetched while online" boundary, not a new failure).
- [x] **5 (last, per instruction — judged first, moved up only in the
  sense that it turned out to block a task, so it's listed here rather
  than deferred) — the drawer-dropdown CSS bug.** Confirmed it blocks a
  core, everyday task (a doctor cannot select a template, add a
  searched drug, or add a procedure by mouse/touch at all), not merely
  a visual defect. `.search-results` (`position: absolute`) needs a
  positioned ancestor; `.field`/`.record-section` — its wrapper at
  every affected site — never declared `position: relative`; inside the
  consultation drawer (`position: fixed`), the dropdown anchored to the
  drawer itself, landing exactly at 100% of the viewport height, always
  one row below the visible screen. Fixed with a new, narrowly-scoped
  class (`.search-results-anchor`) applied only at the four affected
  JSX sites, rather than changing `.field`/`.record-section` directly —
  those two classes are used in dozens of unrelated places, and a
  global change risks moving the positioning context for some other
  absolutely-positioned element entirely unrelated to this bug. Covers
  all three sites the audit confirmed (templates, drug search,
  procedures) plus `MergePatients.tsx`, which the audit flagged as
  carrying the identical pattern but left "severity unconfirmed" —
  confirmed live here: it was also broken. TDD: real
  `getBoundingClientRect()` measurements plus a real mouse click
  dispatched at the dropdown's own on-screen coordinates
  (`document.elementFromPoint`), matching exactly how the audit found
  this — not a code reading. Confirmed red at all four sites, green
  after (8/8). One test bug caught before calling it done: the
  procedures check initially picked the *last* of 100+ procedures
  staging has accumulated across earlier phases — naturally far down a
  long list on its own, unrelated to this bug; fixed to check the first
  row. A second, independent test flake found and fixed afterward (own
  commit): the Templates check's own fixture template accumulated
  unbounded across runs with no cleanup, and a drawer-entrance-animation
  race — both real, reproducible, now fixed; stable across 3 consecutive
  runs.
- [x] **Also in this pass, decided: `get_daily_report` double-counted
  same-day corrections** (the item deferred during Critical #1's own
  fix). Count only the terminal bill in each correction chain, never
  the sum, plus a separate reported line for corrections today (count
  and net amount) — collections must equal the drawer. Fixed with the
  same "not exists a later correction" idiom already used elsewhere: a
  bill that's been superseded is excluded from any day's collections;
  only the chain's terminal bill counts, on whichever day *it* was
  confirmed. Applied to all three report functions' collections
  computation for consistency (the same SQL is literally duplicated
  three times), not just the one named — discount and patient-count
  computations untouched, out of scope for this fix.
  `get_daily_report` gains two new columns
  (`corrections_today_count`/`corrections_today_net_paise`), surfaced
  on the Daily Report screen as a new stat tile plus an explanatory
  note. TDD: before/after deltas around a fresh fixture. Confirmed red
  (collections delta was 35000 — both bills summed — before the fix;
  the two new columns didn't exist at all), green after (delta 15000,
  the corrected amount only). Live-checked the new stat tile renders
  real data (9 corrections today, -₹340.00 net, on staging's own
  accumulated data).

**Nothing was dismissed as not-real in this pass** — all 5 named
findings plus the deferred reports item were genuinely fixed, each with
its own red-then-green test, live verification beyond the DB layer
where the finding was itself a live/UI bug, and a clean full-suite
re-run after every single commit.

**What's still open**: the Low/informational findings from the
original audit that were never assigned to either fix pass —
`GstReport.tsx`'s own timezone-unsafe date-range default (the same bug
class fixed twice elsewhere, not yet fixed a third time here); a
template-applied prescription row arriving with a blank
`quantity_dispensed` and unhelpful validation copy; `isolation-test.mjs`'s
stale "no edge functions deployed" comment (three now exist); Supabase
Auth's leaked-password protection, still disabled (a dashboard toggle,
no code change); `consultation_fee_paise`'s `int`-vs-`bigint` type
inconsistency in a few function signatures (still an exact integer, no
real risk). None of these were named in either fix pass's instructions;
none were touched. A future session should pick these up explicitly,
or confirm they're each still worth deferring.

## Context a future session needs (Phase G)

- **Every finding from Phase G's audit (items 1-5) has now been fixed,
  tested, and verified**, across two fix passes: 3 Critical (offline-
  reconciliation resolution UI, idle-lock/PIN, consultation-fee admin
  setter) and 5 High/Medium (the doctor-queue date-scoping cash-loss
  bug, the patient-name-in-banner leak, `search_patients`' anon grant,
  the offline-print timing gap, the drawer-dropdown CSS bug), plus one
  deferred item decided and fixed in the same pass (reports double-
  counting same-day corrections). Every fix has its own red-then-green
  test, a live/UI verification where the finding itself was a live
  bug, and a clean full-suite re-run after every commit — see both
  "Phase G fix pass" sections above for the complete detail. Nothing
  was dismissed as not-real; nothing was silently dropped.
- **What's genuinely still open**: the Low/informational findings from
  the original audit that were never assigned to either fix pass (listed
  at the end of the High/Medium section above) — a GST date-range
  timezone bug, a template-prescription blank-quantity UX rough edge, a
  stale isolation-test comment, leaked-password protection still
  disabled, an int-vs-bigint nit. None of these block a real patient;
  all are worth a future pass. Beyond that, this app is materially
  closer to production-ready than at any prior point in this build —
  but the Phase G build items (6-8) still have real, human-only setup
  steps outstanding (below) before the backup pipeline specifically is
  *working*, not just built.
- **Every Phase G build item (6-8) has a human-only step still open**
  before it's a *working* backup pipeline, not just a built one: the age
  private key needs to actually land in the password manager (already
  handed off, out-of-band, this session); `backup_reader`'s password
  needs setting on both staging and production (no migration can do
  this — see docs/runbook.md); the R2 bucket/API tokens don't exist yet;
  nothing is wired to an external uptime monitor yet. `docs/runbook.md`'s
  "Pending setup" section is the authoritative list — do the restore
  drill only after all of it is done, per architecture-spec.md's own
  "an untested backup is a hope, not a backup."
- **`backup_reader`'s migration (`20260907020000`) was applied to staging
  only.** Production needs the same migration as its own deliberate,
  separately-timed step (see "Applying a migration" in the runbook) — it
  was not pushed to production automatically in this session, since
  touching production wasn't something this session's instructions
  explicitly authorized.
- **The isolation test's Edge Function check is stale** (`isolation-test.mjs`
  hard-codes "no edge functions deployed" — three now exist:
  `health`, `admin-create-login`, `backup-freshness`). Low urgency
  (`admin-create-login`'s cross-clinic safety was traced by hand and
  looks correct) but should be updated to actually probe it, not just
  have its comment corrected, the next time this script is touched.

## Next action

Two independent tracks are open now, not one:

1. **The UI redesign initiative** (new section at the top of this file):
   all five planned phases (UI-1 through UI-5) are done, and UI-5's own
   named unfinished work is now closed too -- every screen (Reception,
   Admin, Reports, Billing, Stock, Suppliers, MergePatients) has the
   Tailwind/Radix component kit, and Reception/Admin/Unpaid/Stock have
   all dropped the right-side Drawer for inline stage/list swaps (the
   Tenth through Twelfth rounds, above). What's left, undone because
   nobody's asked yet: the sub-form components Stock's own actions
   render (`RecordPurchaseForm`/`TransferForm`/`MonthlyCountForm`/
   `AdjustStockForm`) still use native `<select>`/`<input>` internally.
   The user's own "is this elite yet" verdict still needs re-checking
   against the fuller rollout, not assumed from where the last round
   of feedback left off.
2. **Phase G's own residual items** (below): every audited finding is
   fixed and verified; what's left is the human-only setup for the
   backup pipeline (`docs/runbook.md`'s "Pending setup" — age private
   key into the password manager, `backup_reader`'s password, the R2
   bucket/tokens, wiring the two health endpoints to an external uptime
   monitor) and, at the maintainer's discretion, the Low/informational
   findings nobody's assigned to a pass yet.

Read this file (both "Phase G fix pass" sections and the new UI-redesign
section above), `AGENTS.md`, `docs/architecture-spec.md`, and the PRD
before picking either back up.
