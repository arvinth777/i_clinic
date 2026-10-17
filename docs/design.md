# Clinic design language — 2026-10-10

The user's “Clinic app — design language (replaces the old UI)” governs every
screen, including screens absent from the mockups. This replaces the old root
`design.md` and the earlier version of this file. Reference HTML and screenshots
are in `docs/references/clinic-app-handoff/`; `Minimal.dc.html` corresponds to
`Prescription.png`. Requirements here are acceptance criteria, not claims that
all screens have passed them. Product behaviour follows `ui-handoff-decisions.md`
and `rework-brief.md`: Finish and Call next remain separate, no Skip/draft workflow,
no invented allergies, doctor-entered consultation charge (₹250 first visit,
₹200 return default), existing name-only refill exception.

## Stylesheet loading

Shared workspace layouts live in `src/Workspace.css`, imported by `App.tsx`.
Lazy screens must not rely on CSS loaded by another screen. The standalone
Google Drive callback imports its own stylesheet and follows the same font,
colour and spacing tokens, with clinic identity above a constrained result.

## Presentation

White, paper-like, ruled rows with space between sections. No cards, page sidebar,
coloured page headers, gradients, breadcrumbs, outlined secondary buttons, status
badges, zebra tables or decorative icons. Permitted icons: ×, ←, ▾, ✓, search and ℞.
Only floating layers and the paper preview have shadows. Side columns are panel
grey; the working surface is white. The new specification replaces dark mode.

One solid blue primary action per working screen. Strong secondary actions may
use ink; all other actions are text buttons. Disabled controls keep their labels,
use placeholder colour and communicate disabled state. Do not make an action
appear functional without real implementation.

## Tokens

`src/index.css` is the only colour-definition file. Existing semantic names alias
these tokens so all current screens use one palette.

| Tokens | Exact values |
| --- | --- |
| ink / ink-2 / muted / faint / placeholder | #141C2B / #364154 / #5B6575 / #7A8494 / #9AA3B0 |
| bg / panel / hover | #FFFFFF / #F6F7F9 / #F2F4F7 |
| line / line-2 / line-3 | #EEF0F3 / #E3E6EB / #DDE1E7 |
| blue / blue-ink / blue-tint / blue-row | #1A4FB5 / #123E8C / #EAF0FC / #F2F5FB |
| amber / amber-bg | #93520A / #FDF6EC |
| red / red-bg | #B42318 / #FDF1F0 |
| green / green-bg / live | #1F7A4D / #F2FAF5 / #22A55B |
| scroll-thumb / scroll-hover / toast-undo | #D5DAE1 / #B4BBC6 / #9DBBF5 (explicit exceptions from scrollbar/toast spec) |
| r-sm / md / lg / xl | 8 / 10 / 14 / 16px |
| dialog-width | 420px (the shared confirmation dialog, `ConfirmDialog.tsx`; uses the Dialogs rule below: r-xl, space-28, scrim, shadow-modal) |
| nav-count-size | 20px for the reception Billing waiting-count circle |
| call-flash-duration / opacity / layer | 600ms × three pulses / .22 / 60, with a persistent alert banner during the pulses; reduced-motion users see the banner and a steady tint |
| shadow-pop | 0 12px 36px rgba(20,28,43,.14), 0 0 0 1px var(--line) |
| shadow-modal / scrim | 0 24px 64px rgba(20,28,43,.20) / rgba(20,28,43,.32) |
| shadow-paper | 0 1px 2px rgba(20,28,43,.06), 0 10px 30px rgba(20,28,43,.08) |

Install icon and page title: the manifest, `theme-color` meta and PNG icons in `public/` use `blue` (#1A4FB5)
and `bg` (#FFFFFF); the mark is the white lowercase "i" of `public/favicon.svg` (see the favicon note above), and
the PNG icons are rendered from the same geometry (circle at 32,18 r5 and bar 27..37 x 28..51 on a 64 grid).
Replace the mark by swapping `favicon.svg` and the four PNGs. The tab title is "<section> · iClinic", set in `AppShell.tsx`.

Blue means action/selection/live, amber attention, red error/danger/offline, green
saved/paid. Status is coloured text with a word; the live dot belongs only in the
queue readout. Placeholder colour is never real content. The supplied faint and
placeholder colours do **not** meet 4.5:1 for small text on white; the specification's
blanket contrast statement must not be reported as a verified accessibility pass.

## Typography and measurements

Browser/app favicon: a white lowercase i on the existing clinic-blue rounded
square, stored as standalone vector geometry in `public/favicon.svg` so it
renders without loading a font. The SVG uses the blue/bg palette and r-lg radius.

Self-host Hanken Grotesk woff2, weights 400/500/600/700. Fallback:
`system-ui, -apple-system, "Segoe UI", sans-serif`. Use tabular numbers on body.
No secondary font, monospace, runtime Google Fonts, or uppercase UI labels.
Sentence case; inline metadata separated with ` · `.

| Role | Size / line-height / weight |
| --- | --- |
| Body / row primary | 15px / 1.5 / 400 or 600 |
| Page title | 26px / 1.2 / 700, tracking −.02em |
| Consult/prescription patient | 26–30px / 1.15 / 700, tracking −.02em |
| Section/dialog title | 20–22px / 1.3 / 700, tracking −.01em |
| Label | 13px / normal / 400, faint, 6px above field |
| Metadata | 13–14px / normal / 400, muted or faint |
| Button | 14–15px / normal / 600 |
| Main search | 17px, 48px high |
| Big figures | 20–26px / normal / 700 |

Spacing scale: 4/6/8/12/16/20/24/28/32/36/48px. Named dimensions in
`src/index.css`: header-height 56px, primary-height 44px, control-height 36px,
search-height 48px, dropdown-height 360px, drawer-width 420px, table-min-width
760px; nav-padding 28px, page-padding 32px, page-top 36px, content-width 1180px,
editor-width 760px, side-width 420px, preview-width 520px, doctor-side-width 380px,
record-rail-width/patient-rail-width 280px. Header current height is measured so
sticky content accommodates a wrapped header. Paper dimensions are below.

## Menu and navigation

Sticky top bar, z-index 30, at least 56px, white with bottom hairline; 8px 28px
padding. Clinic name 15px/700 links to the login's home. One short bar per login, no
More menu (revised 2026-10-18 at the owner's direction; the doctor is the administrator, there is no separate admin login):

| Login | Bar |
| --- | --- |
| Receptionist | Queue, Billing, Patients, Stock |
| Doctor | Consultation, Billing, Patients, Stock, Reports |

Related tools are tabs inside their page, never separate bar items: Billing > To collect, Medicine sale, Unpaid bills
(receptionist); Patients > Everyone, Long-term care, Possible duplicates (doctor); Reports > Summary, Needs review
(doctor); Stock holds Medicines, Medicine units and prices, Suppliers. Tabs are a 36px text row under the bar with a
2px blue underline on the current one. The doctor has no Reception tab (the waiting list is in Consultation).
Billing carries the ready-to-bill count; the doctor's Patients carries the possible-duplicate count (both the
`nav-count-size` circle).

The right side holds the search box, an optional save warning, and the profile circle. There is no queue pill:
the waiting count is a badge on the login's first tab (Queue for reception, Consultation for the doctor), like the
Billing and Patients counts. The search box ("Search…  ( / )", `/` focuses it) finds patients (name, phone, token),
medicines and pages by the words people use ("supplier", "merge", "unpaid"), plus Lock screen and Sign out; arrow keys and
Enter work. The profile circle (control-height, blue-tint, the first letter of the sign-in email) opens the account menu:
Alerts and sound, Settings (doctor), Lock screen, Change lock PIN, Sign out. Settings, Alerts and Lock are not bar items.
The save indicator is silent when everything is saved and appears only for "Save needs attention",
"Offline · N changes waiting" or "N not saved yet" (real mutation/IndexedDB state, never a timer).
Optional event text must be a real cross-role event, visible about ten seconds. Reception gets administrative
patient records, no clinical history view (its Timeline tab shows visits and payments only). Keep backend
permissions and clinic scoping; hiding a control is not a security boundary.

Links are 36px high, 14px, 10px horizontal padding. Active is ink/600 on hover grey,
with aria-current=page. Grey side columns (queue list, record rails, settings list) run the full height of the
working area, top bar to bottom of the window, not just the height of their content.

At ≥1100px one row. At 768–1099px two rows: identity/status then horizontally
scrolling nav with hidden scrollbar and right fade. Below 768px show clinic name,
queue, Menu ▾; full-height top sheet contains navigation, save status and the account items.
Prescription sub-bar is sticky below the measured header, with workspace link
and real patient/token context. No fake Called/Sent-in state before that workflow
is implemented.

Wording: plain words a doctor would use. Queue filters are Now, Finished, Everyone today, Earlier days. No
"token" jargon in status text (no "No active token" style status text).

## Controls, overlays and states

- Inputs: transparent, bottom border line-2 only, 8px bottom padding, zero radius.
  Focus blue underline plus 1px shadow, no box ring. Main search has persistent
  1.5px blue underline. Textareas grow with content, no resize handle.
- Text choices: 34px, 14px/500, 12px horizontal padding, gap 2px, −12px left offset;
  selected blue on blue-tint. Custom dose/duration entry remains available.
- Rows: 12–16px vertical padding, bottom line only. Primary 15px/600; metadata
  13px. Expanded medicine fields stay inline. Hover fill only on clickable rows.
- Tables: faint 13px header with line-2, no header fill; line-separated rows,
  right-aligned numeric cells. Wide tables have a 760px minimum inside their
  own horizontal scroll wrapper, never widening the page.
- Inline validation: 12px red/600 directly under field and red underline. No alert
  popup for validation. Meaning notices: 16–20px padding, radius 14px, tinted bg.
- Dialogs: max 520px (simple confirm 420px), padding 28px, radius 16px, modal
  shadow/scrim. Secondary actions before primary at right. Trap focus, Esc/scrim
  closes, ask before discarding unsaved input, restore focus and body scrolling.
- Drawers: right edge, 380–420px, full height, white, 24–28px padding; phone full
  width. Close text control. Top mobile menu follows the same focus/scroll rules.
- Dropdowns: white, 12px radius, pop shadow, 6px padding, max 360px; rows 10px 12px,
  highlighted blue-row, 8px radius. Keyboard accessible.
- Toasts, when used: bottom centre 24px, ink/white, 14px, height 44px/radius 12px,
  modal shadow; maximum two. Confirmations hide in 4–7s, errors stay until dismissed.
- Loading: row-shaped line-colour skeletons. Empty: bold line, explanation and
  relevant action. Error: red-tinted notice with retry; retain last good data at
  55% opacity and label its saved time. Offline: full-width red-tinted strip below
  menu saying what works and that changes await sync, with retry.
- Focus-visible: blue 2px outline/2px offset on buttons/links, field underline.
  Reading-order tab sequence; no inaccessible icon-only actions.

## Layout and scrolling

Window is the only main vertical scroll container. No viewport-height inner
main boxes. Menu/sub-bar stick at top, prescription action bar at bottom; side
preview/check-in contents stick within their column. Allowed internal scroll:
dropdowns, dialogs/drawers, wide tables, tablet nav. Lock html scroll for overlays.
Adding/opening a medicine must not jump; scrollIntoView nearest only if needed.
Long lists display batches of 50 with explicit Show more, no infinite scrolling.
Patient directory/bill lists fetch pages; live queue/stock retain their complete
cached snapshots for existing sort, totals and offline behaviour while revealing
50 rows at a time. Server pagination for these aggregate snapshots needs separate
query work; do not change totals to count only a displayed page.

Two-column work: main flexible 600px basis/720–860px content, 32–36px padding;
right 420–540px basis/max 480–700px on panel grey, below about 1000px stack. List/detail
pages use 260–340px left panel. Inventory/Reports centered max 1120–1180px.
Thin global scrollbars use the explicit tokens above; hide only tablet nav.
Respect reduced motion.

## Printing and acceptance

One canonical component renders preview and print. A4 210×297mm, supplied artwork
aspect 1055/1491, white with paper shadow on panel grey. Print hides chrome/panel
background/shadows. Screen typography scales with sheet width. Header 64mm,
reference 10mm, patient-gap 4mm, footer 24mm reserve the letterhead's writing areas.
For the revised prescription, body/reference/caption/dose sizes are 2.2/2.1/1.8/1.95cqw (with equivalent physical A4 fallbacks); Rx remains 4cqw. The preview scales that same document rather than independently reflowing print. Clinical Tamil uses the locally hosted Noto Sans Tamil fallback. The letterhead's printed dotted date label is removed; the actual date is aligned in the reference row below the header.

Medicine receipts use the clinic's 9.5 × 11 inch continuous stationery on the TVS MSP 250 Star. The receipt/Drive PDF page size is 684 × 792pt, with quarter-inch content padding, sparse rules and bilingual English/Tamil medication warning. The actual printer's alignment and glyph output still require a new physical check before release.

The user's rebuilt HTML letterhead (2026-10-10) is preserved in
`docs/references/clinic-letterhead/rebuilt-letterhead.html`. Its header/footer
use live SVG text, with only the original logo and watermark as PNG artwork.
`PrescriptionLetterhead` retains its 1055×1491 coordinates and text lengths.
This printed artwork is an explicit exception to the app's Hanken-only rule:
Arimo, Noto Serif and Noto Sans/Serif Tamil are self-hosted under
`public/letterhead` with OFL licenses and cached by the service worker.
Clinical body text stays Hanken. Print-only colour tokens `letterhead-ink`
(#000000), `letterhead-brand` (#0050BE), and `letterhead-rule` (#0060D4)
preserve the supplied artwork. `letterhead-unit` is paper width / 1055.
The reference row below the header uses flex alignment for the reference at
left and the undotted issue date at right; preview and print share that row.
These tokens do not change the app palette.

Compare every reference at 1440px; at 390px no page overflow. Check font/size,
underline fields, text choices, one primary, no cards/sidebar/status pills or
out-of-token colours, sticky live queue and honest saves, only window scroll,
states and keyboard. Backend role checks, integer money, offline reload, regressions,
security and code review remain required. Release additionally requires physical
short/typical/continuation prescriptions and a receipt on the clinic printer, with
photo/PDF evidence and user sign-off. Browser PDFs cannot satisfy that hardware gate.

## Corrected doctor workspace — 2026-10-10

`Doctor-corrected.html` is the later user-supplied doctor reference. Use its
620px main flex basis, 760px content maximum, 380px queue basis / 520px maximum,
110px history date column, 36/32/48px main padding and 30px patient name. These
are named `--doctor-*` and `--space-32/36/40` tokens. Initially show seven waiting
rows, then Show more in pages of 50. Today’s queue excludes older open visits;
show their real count separately. Long waits are amber after 45 minutes.
A consultation clock is minutes, suppressed beyond 10 hours. Arrival and sent
status come from persisted queue actions, not the mock timer. No mock allergy
or vital values are imported. Use the existing self-hosted Hanken font.

## Patient documents

Patient profile attachments use the shared Hanken Grotesk, underline fields,
text category choices and ruled rows. The preview is a native modal dialog
with a browser PDF viewer or image, and text download/Drive links. New tokens:
`scrim` = rgba(20,28,43,.32), `control-toggle-height` = 34px, and
`document-preview-height` = 65dvh. Backend/connection setup is documented in
`patient-documents-setup.md`.
## Lightweight press feedback

Button press feedback uses CSS, not an animation runtime: `--press-tap-scale`
(.97), `--press-stamp-scale` (.96) and `--press-stamp-rotation` (-1deg). Disabled
buttons and reduced-motion preferences do not transform.

## Alerts drawer — 2026-10-11

Use the shared Drawer, Hanken Grotesk and existing row, status, text-button
and spacing tokens. Active/recent filters are text toggles. Alert targets use
`--blue-row` highlighting and the existing focus outline. The reception sound
control lives in Alerts at desktop and mobile widths; enabling lasts only
this signed-in browser session. No card containers, extra primary buttons or
new colours are introduced.
