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
13px prescription labels, 15px medicine input and 15.0803px physical A4 body
text (1.9% of 210mm). The named token mapping is in `docs/design.md`.
Doctor, patient history, inventory, refills and reports were checked at 390px
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
