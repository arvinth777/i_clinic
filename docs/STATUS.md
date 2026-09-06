# Status

Read this at the start of every session, alongside AGENTS.md and docs/.
Update it before ending a session or when a block of work completes.

## Where we are

Working through `docs/build-plan.md`, one phase per session, in order.
The user has repeatedly authorized skipping the plan's default "one
phase per session" pacing within a single session — most recently to
resolve Phase A's two open decisions and then go straight into Phase C
in the same turn.

**Phase C — Payments completed: built, tested, and verified live.
Stopping here per the plan's own "one phase per session" rule.**

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
- [ ] Phase D — Documents, register, reps
- [ ] Phase E — Reports
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
  RLS, to stay correct.

## Next action

Read this file, `AGENTS.md`, `docs/design.md`, `docs/architecture-spec.md`,
and the PRD, then start Phase D (Documents, register, reps) — per
`docs/build-plan.md`.

Note on a worry from the previous entry, now resolved: settling a bill
does **not** call `confirm_bill` again — `settle_bill` is a separate RPC
against a separate table (`bill_settlements`), so it never touches
`stock_movements` and can't reintroduce the reopen/rebill double-
deduction Phase B fixed. That fix's own regression guard
(`stock-test.mjs` section 8) is only relevant if a future phase adds a
*second* call path into `confirm_bill` itself (e.g. a correction-bill
flow using `corrects_bill_id`) — Phase C did not need one.
