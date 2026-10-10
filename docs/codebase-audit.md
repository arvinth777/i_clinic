What this repo does: This is a React clinic app with Supabase for patient records, the reception queue, consultations, prescriptions, billing, and stock. It also contains reports, documents, representative visits, and long-term care screens. This audit assumes one doctor and one receptionist working at the same time, thousands of patients, and occasional internet outages.

Audited 2026-10-10 against local commit `36455a9`, plus documentation changes. Ponytail audit is the primary workflow; GitNexus helped trace shared offline-write callers, and the clinic security checklist was applied to the payment and session boundaries. Findings below describe source code, not successful attacks on a live database. No application code, database schema, or patient records were changed.

## Must fix

1. **Reception can supply an amount the doctor never approved** (`supabase/migrations/20260907000100_fix_confirm_bill_missing_stock_deduction.sql:63–78`).
   - **What this is:** `confirm_bill` is the database operation reception calls to confirm payment. It normally reads the doctor's amount, but accepts an offline amount and revision from the browser.
   - **Problem:** A caller can send 100 paise with the current revision when the doctor approved 25000 paise; the function replaces the approved amount without checking that the supplied amount belongs to that revision. A read-only price on screen does not protect this database operation.
   - **Fix:** Accept only amounts backed by a server-recorded doctor approval for the supplied revision. Preserve legitimate offline approvals with saved revision history rather than trusting browser values or simply discarding every older revision.
   - **If we skip it:** Reception credentials can confirm unapproved discounts, including without a revision mismatch flag.

2. **Direct bill inserts bypass payment safeguards** (`supabase/migrations/20260905193029_visit_and_bill_authorship.sql:53–86`).
   - **What this is:** Row-level security, or RLS, controls which rows each logged-in user can write. The bill and bill-line policies still allow direct inserts by reception and doctor roles.
   - **Problem:** The reception policy permits an original bill without running stock deduction or the visit transition; it also permits adding another line to an already-paid original bill. These policies do not enforce the required single payment transaction or complete bill immutability.
   - **Fix:** Remove direct client insert access for bills and their lines; use the existing role-checked payment and correction functions as the write boundary. Test direct inserts are denied while legitimate confirmation and correction still work.
   - **If we skip it:** Clients with the normal table insert grants can create inconsistent bills or alter a paid bill's contents outside the guarded flow; effective live grants still need verification.

3. **The prescription and receipt remain hidden during printing** (`src/components/Billing.css:85–103`).
   - **What this is:** The billing screen hides its print area on screen and is meant to reveal it for browser printing.
   - **Problem:** The print rules change visibility but never undo `display: none`. Browser verification with the actual stylesheet and synthetic prescription text returned `printMedia: true`, `display: none`, and height `0`.
   - **Fix:** Show the print area inside the print media rule, then verify actual prescription text appears in the generated print output. Check the A4 layout separately against the supplied letterhead.
   - **If we skip it:** The main prescription and receipt cannot appear in the print job, with or without internet.

4. **Billing ignores the number of medicine units supplied** (`supabase/migrations/20260906130000_billing_confirm.sql:59–65`; `supabase/migrations/20260907000100_fix_confirm_bill_missing_stock_deduction.sql:92–103`).
   - **What this is:** Pricing adds the catalog price for each prescription line. Stock deduction already uses the quantity dispensed.
   - **Problem:** Ten units priced at 100 paise each charge only 100 paise while removing ten units from stock. Confirmed bill lines omit quantity and therefore use the table's default of one.
   - **Fix:** First settle whether each saved price and stock quantity means tablet, strip, bottle, or another unit; then calculate and freeze quantity × unit price in both pricing and bill lines with integer-paise regression tests. Do not silently reinterpret existing catalog prices.
   - **If we skip it:** The app does not meet the agreed quantity-based billing rule, and charges diverge from stock deductions.

5. **Reprinting a paid receipt uses today's medicine prices** (`src/components/Billing.tsx:185–193,317–325,571–577`; `supabase/migrations/20260906130000_billing_confirm.sql:302–319`).
   - **What this is:** The same billing-detail query supplies both an open bill and a paid bill's print contents.
   - **Problem:** That query joins the current medicine catalog and clinic fee. Changing a medicine price after payment changes the reprinted line price even though the saved payment amount remains unchanged.
   - **Fix:** Render paid receipt descriptions, quantities, prices, and discount from the saved bill and its frozen bill lines. Keep clinical prescription instructions separate from financial receipt snapshots.
   - **If we skip it:** A patient's later copy can disagree with the receipt originally paid and with the accounting record.

6. **Queued writes can replay under another staff login** (`src/lib/offlineQueue.ts:9–21,77–105,127–166`; `src/lib/useSession.ts:32–37`; `src/App.tsx:70`).
   - **What this is:** Pending saves live in one persistent browser queue. Reconnection replays them using whichever Supabase login is active at that time.
   - **Problem:** Entries record no owning user; a payment queued by reception A can be confirmed as reception B after a login change. An unlocked admin-only login can also see a halted entry's patient name because the banner checks lock state rather than clinical permission.
   - **Fix:** Bind entries to their originating account and clinic, replay only under that verified account, and redact clinical details for other accounts or roles. Preserve pending work on sign-out rather than deleting it.
   - **If we skip it:** Shared-device account changes can misattribute clinical or payment actions and expose patient names to staff without clinical access.

7. **A new offline prescription is not retained in the printable view** (`src/components/PrescriptionForm.tsx:168–196`; `src/components/Billing.tsx:113–115,317–351`).
   - **What this is:** Prescription confirmation queues its database inserts during an outage, then clears the editor. Printing gets medicine details from a separate server query.
   - **Problem:** Confirmation does not add the new prescription to the local read/print data. If reception has never fetched that visit's medicine details, the two-second grace timer permits a print containing “No medicines prescribed” despite queued medicine instructions.
   - **Fix:** Retain the confirmed prescription locally and use that same durable snapshot for offline viewing and printing. Distinguish unknown or pending data from a genuinely empty prescription; verify confirm → refresh → print without connectivity.
   - **If we skip it:** The patient can leave without dosage instructions during the outage this app is supposed to support.

8. **The doctor can call patients in the wrong arrival order** (`src/pages/Consultation.tsx:87–94`; `supabase/migrations/20260905164914_phase1_core_schema.sql:238–244`).
   - **What this is:** The doctor's next-patient list orders by token number. Tokens are assigned when a visit reaches the server.
   - **Problem:** A patient checked in offline at 09:00 can sync after a patient checked in online at 09:05 and receive a later token. Once both are visible, the doctor's list prioritizes the later physical arrival, contrary to the schema's stated arrival-order rule.
   - **Fix:** Order by physical `arrived_at`, with a stable tie-breaker; retain tokens as labels. Test the late-sync example across doctor and reception lists.
   - **If we skip it:** Reconnection can change who is called next and reception and doctor can show different queue orders.

## Should fix

9. **The agreed refill-only visit is still missing** (`src/pages/Reception.tsx:66–110`; `supabase/migrations/20260906130000_billing_confirm.sql:53–65`; `supabase/migrations/20260907000100_fix_confirm_bill_missing_stock_deduction.sql:68–69`).
   - **What this is:** The current reception path creates a consultation visit and its pricing. Confirmation expects a doctor-approved final amount.
   - **Problem:** A returning patient collecting only a refill has no matching path that skips the doctor's queue and consultation fee while using saved unit prices. This is an agreed requirement gap, not a feature claimed to be finished.
   - **Fix:** Add the smallest refill sale path using the shared bill/stock transaction, with reception unable to change prices or discount. Resolve which previous prescription authorizes the refill and the medicine units before implementation.
   - **If we skip it:** Reception must use an unsuitable consultation flow or continue manual refill billing.

10. **Stock does not show nearing-expiry medicines** (`src/components/stock/StockList.tsx:24–29`; `src/components/admin/DrugList.tsx`).
    - **What this is:** The stock screen loads stock quantities and low-stock thresholds. The medicine editor separately stores an expiry date.
    - **Problem:** A medicine can have a nearing expiry date while the stock screen never reads that date or warns reception. Low-stock warnings do not cover this requirement.
    - **Fix:** Agree the warning window and how different purchases with different expiry dates are represented; then show the warning in the existing stock screen. Do not treat one catalog date as a reliable substitute for multiple batches.
    - **If we skip it:** Reception still needs a separate manual expiry check.

## Nice to have

11. **Remove the unused JetBrains font dependency** (`package.json:16`; `src/main.tsx`).
    - **What this is:** The dependency list includes JetBrains Mono, while the application imports Inter and Geist fonts.
    - **Problem:** A whole-tree search found no executable import of JetBrains Mono; references outside the dependency/lock files are older comments and design documentation. It adds installation and maintenance work without supplying a font in the app.
    - **Fix:** Remove the unused package and regenerate the lock file; clean the stale font references. Keep Motion, which has actual component callers.
    - **If we skip it:** A small unnecessary dependency remains; it is not a meaningful performance or clinical risk.

## What to keep and simplify

| Keep | Simplify or defer |
|---|---|
| Supabase/PostgreSQL, existing integer money columns, patient history, query invalidation, and IndexedDB storage | Fix their existing boundaries before adding a second database or a sync framework |
| Reception check-in, doctor queue, medicine entry, and Cash/UPI payment | Centre the working screens around those tasks and the uploaded A4 prescription |
| Existing stock and bill history | Make quantity units and saved receipt contents consistent before expanding reporting |
| Existing records and secondary screens | Review representative visits, documents, long-term care, and advanced reports with the doctor before hiding or deleting them |

The supplied A4 letterhead and placement editor remain a mockup, not a production implementation. WhatsApp automation and voice summaries remain deferred under `docs/rework-brief.md`. No mass deletion or architecture rewrite is justified by this pass.

## Verification and limits

- `node scripts/prescription-draft-test.mjs`: 6 tests passed.
- `npm run lint`: exited successfully, with 7 existing warnings.
- `npm run build`: passed TypeScript and Vite build; existing large-bundle warning remains.
- Browser print-media check: reproduced finding 3 using the unchanged billing stylesheet and synthetic text. This was a stylesheet fixture, not an authenticated end-to-end visit or a physical printer test.
- GitNexus CLI indexing succeeded: 1,784 nodes, 3,497 edges, 101 flows. MCP query/context exposed shared offline-write callers; its long-running server still reported the older commit metadata, so source reads, not graph completeness, anchor the findings.
- Examined payment function replacements and bill insert policies across migration history. Did not execute exploit cases against staging or production.
- Earlier environment inspection is recorded in `docs/runbook.md`: production database provisioning, missing frontend environment variables, failed backups, and advisor warnings remain release blockers. They were not re-verified or repaired in this code audit.

Verdict: Fix the payment trust boundary and direct bill writes first, then printing and durable prescription snapshots; settle medicine units before quantity billing and refills.

Lean: -1 direct dependency declaration line, -1 dependency possible, plus regenerated lock-file entries; no justified bulk feature deletion.

Not checked: live database grants/exploit tests, a complete two-browser clinic visit, physical A4 alignment, backup restoration, every report/correction/merge branch, and expired-token offline recovery. Findings 1–8 remain unfixed; passing build and draft tests do not make the app ready for clinical use.
