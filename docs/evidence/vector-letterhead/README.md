# Rebuilt letterhead checks — 2026-10-10

All patient names, medicines and billing data in these artifacts are synthetic.
The clinic's header/footer copy and artwork come from the user-supplied HTML.

- Chrome printed the real `PrintablePrescription` / `PrintableReceipt` components:
  short and typical: one A4 page each; 30 medicines: four pages; receipt: one;
  combined prescription and receipt: five. All 30 medicines appear exactly once.
- Visually inspected the rendered PDFs: English/Tamil header, footer, logo,
  watermark, reference/date, continuation writing area, and separate receipt.
  `print-pdf-check.py` checks A4 size, writing-area bounds, repeated reference and
  artwork, every medicine, receipt total, and absence of extra short-document pages.
- The new reference/date positions initially enlarged the repeating header.
  Restoring its original 64mm + 10mm height restored continuation-page spacing.
  Removing the source's image blend compositing restored logo/watermark printing
  on later pages. Both failures were reproduced before the final PDFs passed.
- `typical-offline.pdf` was printed after enabling offline networking for the
  already-loaded local tab. Extracted text matches the online PDF; its artwork
  and English/Tamil fonts remain embedded. This is not an offline-reload test.
- The production service-worker manifest includes all six local font files and
  both artwork PNGs. The app makes no runtime Google Fonts request.
- `preview-1440.png` and `preview-390.png` show the real `LetterheadPreview` using
  synthetic component props in a temporary Vite fixture. Page scroll widths were
  exactly 1440 and 390 respectively. This is component verification, not a fresh
  authenticated doctor/reception end-to-end run. The fixture was removed.
- Production build passed using synthetic local Supabase configuration (no live
  database connection); print render tests passed. Lint has seven pre-existing
  warnings. Build retains the existing large-JavaScript-chunk warning.
- Static security check: no raw HTML injection, remote artwork/font requests,
  new patient-data requests or logging; React escaping test still passes. No
  backend, RLS, role, pricing or offline-write-queue behavior changed.

Reproduce after building: run `node scripts/print-layout-fixtures.mjs`, serve its
output locally, and print the five fixture pages to the matching PDF filenames
with A4, CSS page size, backgrounds on, browser headers/footers off. Then run:

```sh
node scripts/printout-test.mjs
python3 scripts/print-pdf-check.py docs/evidence/vector-letterhead
```

Poppler (`pdftotext` and `pdfimages`) is required for PDF assertions.
The browser's viewport and network overrides were restored and local servers stopped.
Physical short/typical/continuation prescriptions and a receipt still require
clinic-printer sign-off before release. Nothing was deployed by this change.
