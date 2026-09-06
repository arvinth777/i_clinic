# Status

Read this at the start of every session, alongside AGENTS.md and docs/.
Update it before ending a session or when a block of work completes.

## Where we are

Working through `docs/build-plan.md`, one phase per session, in order.
The user has repeatedly authorized skipping the plan's default "one
phase per session" pacing within a single session — most recently to
resolve Phase A's two open decisions and then go straight into Phase C
in the same turn.

**Phase E — Reports: built, tested, and verified live. Stopping here per
the plan's own "one phase per session" rule.**

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
- [ ] Phase F — Offline
- [ ] Phase G — Go live (item 7, the health endpoint, is already done — see below)

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

## Next action

Read this file, `AGENTS.md`, `docs/design.md`, `docs/architecture-spec.md`,
and the PRD, then start Phase F (Offline) — per `docs/build-plan.md`.

Read the offline section of AGENTS.md before starting; this is the
architectural phase, deliberately not last, and the one place where
retrofitting later would have been far harder than building it in.
