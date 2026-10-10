# Clinic handoff design system

The 2026-10-10 handoff replaces the earlier card/sidebar design in root
`design.md`. The user's HTML and screenshots in
`docs/references/clinic-app-handoff/` are the visual source of truth.
Product behaviour follows `ui-handoff-decisions.md`, then `rework-brief.md`.
Copy presentation from those files, while retaining real authorization,
offline saves and data. Do not copy mock records or simulated network success.

## Tokens

`src/index.css` owns the tokens; shared components consume them. Hanken Grotesk
400/500/600/700 is bundled locally for offline use. All text uses that family;
number-heavy displays use tabular figures rather than a separate mono font.

| Tokens | Value / purpose |
| --- | --- |
| bg, surface | #FFFFFF, open working area |
| surface-2 | #F6F7F9, secondary panel / navigation selection |
| border, border-strong | #EEF0F3 / #DCE1E8 |
| text, text-secondary, text-tertiary | #141C2B / #5B6575 / #697586 (small-text contrast) |
| accent, hover, active, wash | #1A4FB5 / #16449C / #123980 / #EAF0FC |
| danger / wash | #B42318 / #FEF3F2 |
| success / wash | #1F7A4D / #ECFDF3 |
| warning / wash | #93520A / #FDF6EC |
| focus-ring | #1A4FB566 |
| text-xs / sm / base / lg / xl / 3xl | 13 / 14 / 15 / 20 / 24 / 30 px |
| space-2xs / xs / sm / md / lg / xl | 4 / 8 / 12 / 16 / 24 / 40 px |
| radius-input / card / pill | 8 / 12 / 999 px |
| header-height / control-height | 56 / 36 px |
| nav-padding / page-padding / page-top | 28 / 32 / 36 px |
| content-width / side-width / editor-width | 1184 / 420 / 760 px |
| status-dot-size | 7 px |
| paper-width / height / header / footer | 210 / 297 / 64 / 24 mm, supplied A4 artwork |
| paper-reference / patient-gap | 10 / 4 mm; repeating header fits Chromium’s 25% page limit |
| record-rail-width / mobile-list-height | 240 / 240 px |
| patient-rail-width / metric-min-width / chart-height | 280 / 160 / 160 px |
| doctor-side-width | 380 px |
| preview-width | 520 px |
| shadow-sm / md | none; page sections are flat |
| shadow-drawer | 0 8px 32px #141C2B1A; overlays only |

The existing dark theme remains supported as a token override. Reference
comparison is in light mode. Warning/status meaning always includes words.

## Layout and controls

- Horizontal clinic header with role-allowed navigation, shared token, honest
  save status, account menu and lock. No left application sidebar.
- Doctor/reception: white working area on the left, grey contextual panel on
  the right. Other pages use a centered, constrained work area.
- Prescription: editor and letterhead preview side by side on wide screens.
  Do not shrink actual printed type to fit an arbitrary medicine count.
- Use plain ruled sections and lists. No decorative metric cards or shadows.
- Fields use visible labels and bottom borders. Secondary buttons have a pale
  neutral fill; the primary action uses clinic blue. Preserve keyboard focus.
- At 390px, navigation wraps and panels stack. Long tables may scroll inside
  their own labelled region; the page itself must not scroll sideways.
- Preserve working features absent from the mockups, and never show a mock
  action as functional without its backend implementation.

## Source map

- Tokens/font: `src/index.css`, `src/main.tsx`
- Header: `src/components/AppShell.tsx` and `.css`
- Reception/forms: `src/pages/Reception.tsx` and `.css`
- Doctor/prescription: `src/pages/Consultation.tsx`, `.css`,
  `src/components/PrescriptionForm.tsx`
- Billing/print: `src/components/Billing.tsx`, `.css`, `VisitPrintout.tsx`
- Shared controls: `src/components/ui/`

## Exact typography from the supplied HTML (user reconfirmed 2026-10-10)

Hanken Grotesk is used throughout at 400/500/600/700, including controls and
numeric readouts. Body is **15px / 1.5**; form values 15px; labels/metadata
13px; navigation and normal buttons 14px. Patient search is 16px. Page titles
Inventory/Billing/Refill/Reports are 26px, patient/doctor names 30px with
1.15 line-height and −0.02em tracking. Prescription patient heading is 26px.
Sign-in welcome is 34px; settings headings 24px; supplier/lock heading 28px.
Inventory metrics are 22px, reports 26px, patient metrics 20px.

Additional named tokens: text-xxs/input/subheading/section/metric/page/record/
welcome = 12/16/17/18/22/26/28/34px; line-body/title = 1.5/1.15;
tracking-title = −0.02em. Existing text-lg/xl/3xl remain 20/24/30px.

The letterhead's HTML container units are preserved as physical A4 proportions:
print-body/reference/caption/dose/rx-size = 1.9/1.85/1.55/1.65/4% of
210mm width. The on-screen preview scales that same printable document, so
font proportions do not drift between preview and printing. Printed text has
1.4 line-height as in Minimal.dc.html. Long content flows onto a continuation
page instead of copying the prototype's clipping.
