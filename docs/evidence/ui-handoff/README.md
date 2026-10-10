# UI handoff checks — 2026-10-10

These screenshots and PDFs contain synthetic staging data only. They show the
implemented frontend; they are not physical printer sign-off or proof that all
addendum backend workflows are complete.

- `doctor-1440.png`, `reception-1440.png`, `prescription-1440.png`,
  `billing-1440.png`: actual application at a 1440px viewport.
- `short.pdf`, `typical.pdf`: one-page A4 prescriptions.
- `long.pdf`: 30 medicines across four A4 pages, including the last item/advice.
- `receipt.pdf`: one-page receipt, integer-paise totals and discount.
- `combined.pdf`: four prescription pages followed by a plain receipt; the
  repeated letterhead does not bleed into the receipt.

The print fixtures are produced from the real React print components by
`scripts/print-layout-fixtures.mjs` after `npm run build`. Serve the generated
`/private/tmp/clinic-print-layout` directory locally and export with browser
printing (background graphics on, A4, no browser header/footer). Chromium's
repeating-table-header limit caused overlap during testing; the corrected header
fits inside 25% of A4. The full letterhead repeats on the final continuation page.
A real saved staging bill was also printed from the app: two pages, prescription
then receipt. Its result was inspected locally.

Browser computed styles matched the source HTML: Hanken Grotesk loaded, 15px
body, 26px Inventory/Refill/Reports and prescription heading, 30px doctor name,
13px prescription labels, 17px/48px medicine search and 15.0803px physical A4 body
text (1.9% of 210mm). The named token mapping is in `docs/design.md`.
Doctor, Reception, Billing, patient history, inventory, refills and reports were checked at 390px
without horizontal page overflow. Billing/reception were also exercised at
390px. Tables can scroll within their own container.

A reception check-in appeared on the other open doctor's screen without a
reload (observed within 10.5s; not an instrumented latency guarantee). An offline
production-build reload retained diagnosis/advice draft text. The test revealed
an initially incorrect online label; query-client initialization now uses the
browser's connectivity state, with true/false initialization asserted.

Backend checks: quantity/pharmacy, audit billing, prescription clinical-field
save/direct-write/clinic-isolation, draft and quantity-suggestion, immutable print
snapshot and expiry tests passed. Build passed. Lint reported seven existing
warnings. Hidden-editor preview scaling was guarded after the browser reported
an invalid NaN zoom value.

Still required: the unfinished addendum backend changes listed in `docs/STATUS.md`,
complete integrated regressions, security advisor and independent code review,
and short/typical/continuation prescription plus receipt on the clinic printer.
Do not release based solely on these generated PDFs.

Latest design-language revision additionally checks the mobile top sheet (see
`menu-390.png`) and doctor layout (`doctor-390.png`), keyboard focus trapping,
Escape/focus/scroll restoration, 1024px two-row navigation, and document-only
scrolling. Dose and days text presets retain custom entry; SOS has no quantity
suggestion, a half-tablet twice daily for five days suggests five, and choosing a
valid quantity keeps the row open. Paged screens render 50 cached rows plus Show
more after restoring old flat caches (`scripts/ui-query-cache-test.mjs`).

The latest PDF generation caught two regressions: hidden worklists reserving
extra print pages, and an unconditional page break after the last prescription.
Both were corrected and all five PDF page counts rechecked. Print text now uses
container-relative units with a physical fallback. The faint/placeholder colours
from the supplied palette do not meet 4.5:1 for small text; no blanket contrast
pass is claimed. Complete state coverage, workflow addendum, security advisor,
independent review and real-printer evidence remain acceptance gates.

The latest production-build offline reload attempt was blocked by denied browser
permission for network emulation. No workaround was attempted. The temporary
synthetic draft was cleared; earlier offline evidence above is not a fresh pass
for this revision.

Deployment `iclinic-7da96cjt7-arvinth777s-projects.vercel.app` (commit `0806102`)
was checked in Chrome after adding branch-specific public staging variables.
Staging doctor sign-in loaded the synthetic queue and shared navigation. Computed
body text was Hanken Grotesk / 15px, status was All saved, and the page had no
horizontal overflow at the browser's normal viewport. `deployed-preview.png`
records that rendered application. This is runtime verification of the preview,
not a production release or a complete workflow test.
