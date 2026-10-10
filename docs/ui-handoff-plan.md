# Clinic UI handoff — 2026-10-10

The user requested the new visual direction in
`docs/references/clinic-app-handoff/`, including substantial prescription-entry
changes. The original folder was supplied from Downloads and copied unchanged.
It contains 15 screenshots, 16 prototype HTML files and an A4 letterhead.
`Minimal.dc.html` is the source for `Prescription.png`.

The handoff is a design reference, not an override of clinic requirements.
The user supplied the governing [decision addendum](ui-handoff-decisions.md).
Read it before implementation: it replaces the initial restrictions on queue
ordering and partial dispensing, and resolves prescription filling. Where it is
silent, `docs/rework-brief.md` governs. The handoff's
`CODEX_BRIEF.md` includes conflicting and unimplemented behaviour; its claim to
be the source of truth for behaviour does not supersede the user's decision.

## Confirmed scope and boundaries

- Adopt the reference's restrained white/grey layout, horizontal navigation,
  compact rows, quieter controls and separate working/preview areas.
- Keep consultation at 25000 paise (₹250). Both doctor and reception may set
  confirmed catalog unit prices. Only the doctor may discount a bill.
- Keep refill sales as name-only pharmacy bills after visual verification,
  without a patient record, digital-prescription eligibility check, token or fee.
- Preserve existing features absent from the screenshots, including procedures,
  reconciliation, long-term care, rep visits and document workflows. Their
  omission from a mockup is not authorization to delete them.
- Preserve integer money, immutable paid bills, atomic/idempotent stock and
  confirmation, role boundaries, durable offline writes and DOM printing.
- Do not import demo records, fake save timers, placeholder medication warnings,
  sample PINs or simulated reception acknowledgements into the application.

## Screen mapping

| Reference | Existing implementation to reuse | Design work and boundaries |
| --- | --- | --- |
| Nav | `AppShell`, role-filtered sections in `App.tsx` | Replace collapsible sidebar with responsive top navigation; supporting tools under More. Keep every authorized destination accessible. Show actual queue and pending state, never a timer-driven “All saved”. |
| Reception | `Reception`, `TokenList`, `NewPatientForm`, existing check-in/search | Queue beside a check-in panel. Implement logged reception reordering, Not here/return, explicit no-show and Sent in acknowledgement under the addendum. Preserve rep ordering behind patients. |
| Doctor | `Consultation`, history, comments, queue and consultation clock | Current patient and useful history beside the waiting queue. Implement called/waiting-for-reception and Sent in states; preserve draft-loss protection. Finish and Call next remain separate. |
| Prescription / Minimal | `PrescriptionForm`, `prescriptionDraft`, `prescriptionPrint`, `VisitPrintout`, `PricingPanel`, `CarePanel` | Build compact expandable rows, combined medicine/set search, keyboard use and live A4 preview. Add saved diagnosis/advice and explicit quantity confirmation. Allergy warnings are excluded: the user confirmed the mockup has no real allergy source. |
| Billing | `Billing`, `UnpaidBills`, immutable saved bill lines | Bill selection, readable line items and receipt preview. Use approval-time unit-price snapshots. Allow only reduced supply within stock, with a fixed doctor discount capped at subtotal; persist shortfalls and show them in history. |
| Refill | `PharmacyBills` | Apply the visual treatment to the name-only pharmacy workflow. Omit the reference's patient-history, 90-day prescription and 30-day supply requirements. |
| Patient | Existing reception search and doctor history/comments/documents | A consolidated patient-record screen needs composition of real queries and existing permissions. Reception must not gain clinical-history access merely to match a screenshot. |
| Inventory | `Stock`, `StockList`, purchase, transfer, adjustment and count forms, medicine unit/price editor | Adopt the list/table layout while preserving unit confirmation and saved-price editing by both roles. Enforce available stock at supply confirmation. Batch expiry and cost valuation remain separate functional work. |
| Suppliers | Existing `Suppliers` and purchase forms | Restyle supported fields/actions. Credit terms, supplier balances and payment controls must not be fabricated from prototype data. |
| Reports | Daily, monthly and GST reports | Present actual revenue/payment data. Weekly comparisons, medicine rankings and cash-drawer closing require verified data and separate implementation scope. |
| Settings / More | Admin components, unpaid bills, reconciliation, merge, register and existing supporting flows | Reorganize existing destinations without dropping access. Do not add permission toggles that the backend does not support. |
| SignIn / Lock | Existing Supabase sign-in and local PIN lock | Reuse visual layout while retaining real authentication and per-role idle timeouts. Selecting a name and entering a demo PIN is not an authentication implementation. |
| States / Map | Offline queue banner and existing query/mutation states | State examples and walkthrough reference only. No new production route is needed for the mockup state switcher or walkthrough. |

## Prescription details to carry into implementation

The prototype puts the editing form to the left and the letterhead preview to
the right. Patient details precede complaints/diagnosis, medicine rows,
advice/investigations, review date and signature space. Presets remain editable;
the doctor reviews instructions before issuing them.

Reuse the current medicine catalog, saved templates, history, explicit quantity,
prescription save RPC, stable retry IDs and account-bound print snapshots.
Do not replace these with prototype state or duplicate the payment calculation.

The reference calculates quantity from morning/noon/night amounts and days.
Retain explicit supplied quantity in the confirmed billing/stock unit: a bottle,
strip or SOS instruction cannot safely be converted with the same tablet formula.
The clinical dosing instruction and inventory unit are different fields. Suggest
dose × days only for tablets/capsules with a determinate schedule, for explicit
doctor confirmation/editing. Never suggest for bottles, tubes or SOS, and never
cap the prescribed quantity at stock. Partial supply is a separate billing fact.

Diagnosis and advice are not dedicated fields in the current prescription save
path. Adding them requires durable storage, doctor write permissions, historical
readback and offline print snapshots; a textarea that only affects the preview
would lose clinical information. Follow-up currently uses `visits.follow_up_date`
through `CarePanel`; use that established model rather than a second review date.

The letterhead is A4 portrait, 1055 × 1491 pixels. Print the full letterhead and
text on blank paper. Use one rendering for preview and offline print, reserve
the printed header/footer, handle long content and continuation pages, and test
physical alignment separately. The prototype's absolute positions and overflow
warning are references, not proof that long prescriptions print correctly.

Finish requires at least one medicine and valid dose/SOS and duration for each.
Missing diagnosis/review date produce non-blocking reminders. Finish does not
call next. Skip/drafts remain excluded. The later user clarification excludes mock allergy warnings. The original superseded requirement was logged
Remove/Keep choices; other clinical warning classes remain deferred.

## Implementation sequence — one PR per step

Use stacked branches so each PR contains only its own step, starting above the
existing audit-fixes PR. Each description identifies its prerequisite PR, scope,
evidence and unmet acceptance gates. No automatic merge or release.

1. **Decisions and references:** preserve the handoff and addendum, reconcile
   current guidance, map code/schema gaps and record acceptance criteria.
   This is a documentation-only PR, not completion of any runtime feature.
2. **Shared UI foundation:** update named design tokens, typography, common
   controls and responsive top navigation using the existing component kit.
   Keep every currently authorized destination reachable, pending states honest
   and existing authentication/lock behaviour intact. Capture 1440/390 evidence.
3. **Prescription and approval:** compact editor, A4 preview/continuations,
   durable clinical fields/history, non-blocking reminders, bounded quantity
   suggestions and approval-time price snapshots with
   price-change audit. Carry migrations, offline data paths and backend tests
   in the same PR. Preserve existing money and stock checks.
4. **Clinic screens and workflows:** reception/doctor layouts and queue state
   migration; reordering/absence/no-show/acknowledgement; billing partial supply,
   fixed-discount calculation, immutable shortfall history and name-only refills.
   Apply inventory, reports, patient/supporting tools layouts without deleting
   existing functions or inventing prototype-only data. Include Settings for
   the no-show threshold and all relevant migrations, callers and fixtures.
5. **Integrated verification and release evidence:** fix integration issues,
   exercise both roles, disconnected reload/print/replay, concurrency and omitted
   feature regressions. Record security and code review, browser screenshots,
   generated print fixtures and clinic-printer evidence/sign-off. This PR stays
   open while required physical evidence or other release gates remain unmet.

Each implementation PR carries the relevant tests and review evidence itself;
step 5 is not permission to postpone money, security or offline checks. The
full definition of done and physical gate are in the addendum.

## Source-backed implementation gaps

- Current unit prices are frozen by `snapshot_prescription_unit` when a
  prescription item is inserted. The new requirement freezes bill prices at
  doctor approval instead. Extend the trusted approval snapshot to retain
  item identity, unit, approved quantity, price and fixed discount; preserve
  older approvals and paid bills. Test edits before versus after approval.
- `pricing_approvals` currently records the revision and final total, not a
  complete approved line snapshot. Partial supply must refer to a genuine
  immutable approval, not values supplied by the browser.
- Source inspection found configurable patient fields (`patients.custom_fields`
  and `patient_field_definitions`), but no dedicated allergy model or NSAID
  classification in source/migrations. Verify the actual existing allergy field
  definition before any future warning. The user has since confirmed there is no real source, so no warning is implemented. Do not infer “no allergies” from
  absent data or classify medicines using the prototype's sample list.
- The old `packing`/`ready_at_reception` stages are used by queue queries, billing,
  metrics, reports and offline replay. Migrate active visits deliberately, retain
  historical meaning and cover pending old-client operations. New no-shows must
  not accidentally appear as unpaid consultation bills.
- Preserve an absent patient's queue position independently of immutable token
  and arrival time. Check concurrent moves, return-to-position and new arrivals;
  only one patient may be active/called at once. Replayed commands need stable
  IDs to avoid duplicate logs or a second queue move.

## Required acceptance examples

- Catalog price changes before approval affect the new approved bill; later
  changes cannot alter it. Both roles can edit catalog prices; all changes have
  actor/time/old/new values. Reception cannot forge discounts or approvals.
- With a ₹250 consultation, 10 approved tablets at ₹10 each and a ₹50 discount,
  dispensing 3 tablets charges **28000 − 5000 = 23000 paise**. Record shortfall
  7, deduct stock by 3 once, and preserve prescribed quantity 10 in history.
  If the fixed discount exceeds the new subtotal, payable is zero and the
  effective discount is capped; retain the originally approved discount too.
- Reject oversupply and supply above stock transactionally, including two
  concurrent bills for the last units. Repeating confirmation cannot dispense
  twice; changed retry payloads cannot mutate the confirmed bill.
- No-show prompts respect the configured time, survive reload and never remove
  a visit automatically. Returning/checked-in-again patients retain the earlier
  visit and receive the correct queue position/new token respectively.
- Fractional tablet schedules cannot create fractional stock counts silently;
  retain an explicit doctor-confirmed whole supplied quantity. Dose changes must
  not overwrite a quantity the doctor already edited. SOS/unknown schedules and
  unsupported units do not produce a guessed quantity.
- Prescriptions without diagnosis/review can finish after reminders; missing
  medicine/dose/duration cannot. Logged allergy choices survive offline retry;
  a changed medicine or allergy cannot reuse an unrelated acknowledgement.
- Capture all affected screens at 1440 and 390 px. Verify offline reload with
  pending state, long content, keyboard navigation and preserved supporting
  operations. Real printer evidence is still required for print completion.

## Technical limitations and current state

The `.dc.html` files use `DCLogic`, custom directives and imports supplied by
`support.js`, which is absent. They are not standalone HTML pages or React
components that can be copied into production. Rebuild the supported UI using
the current React stack; no replacement backend or routing dependency is implied.

The States prototype promises communication over clinic Wi-Fi during an internet
outage. The current IndexedDB queue preserves work on each computer; it does not
provide device-to-device LAN sync. Display pending/not-delivered state until the
existing backend connection returns. Offline payment records are staff-entered
Cash/UPI records, not verification of a bank transfer.

Step 1 records the approved decisions and source-backed gaps. Application code,
design tokens, databases, deployment and authentication are unchanged by that PR.
