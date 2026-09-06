# Status

Read this at the start of every session, alongside AGENTS.md and docs/.
Update it before ending a session or when a block of work completes.

## Where we are

Working through `docs/build-plan.md`, one phase per session, in order.
The user has repeatedly authorized skipping the plan's default "one
phase per session" pacing within a single session — most recently to
resolve Phase A's two open decisions and then go straight into Phase C
in the same turn.

**Phase G — Go live: run as an audit (items 1-5, findings only, nothing
fixed — by explicit instruction) plus a build (items 6-8: runbook,
health endpoint, backup job). The audit surfaced 3 Critical, multiple
High, and several Medium/Low findings against the app built in Phases
A-F — this app is NOT production-ready as-is. See the Phase G entry
below for the full, ranked punch list; that list is this session's
actual deliverable.**

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

## Context a future session needs (Phase G)

- **This app is not production-ready.** Phase G's audit (items 1-5) found
  3 Critical and multiple High/Medium findings against Phases A-F's own
  work, all independently verified (not taken on any sub-agent's word),
  none fixed by design (this phase's own explicit "report, don't fix"
  instruction). The full ranked list is in this phase's checklist entry
  above — read it before assuming this app is ready to onboard a real
  patient. The three Critical gaps (offline-reconciliation resolution UI,
  idle-lock/PIN, consultation-fee admin setter) and the drawer-dropdown
  CSS bug are each a full, scoped piece of work, not a one-line fix.
- **The drawer-dropdown bug (position:relative) blocks a core, everyday
  doctor workflow today** — not an edge case. Fix is small (`position:
  relative` on `.field`/`.record-section`, or reuse `.search-field`) but
  touches three live call sites (`PrescriptionForm.tsx` x2,
  `PricingPanel.tsx`) plus an unconfirmed fourth (`MergePatients.tsx`) —
  verify all four together, not just the three found broken.
- **The doctor's queue (`Consultation.tsx`) has no `arrived_at` date
  filter; Reception's (`TokenList.tsx`) does.** This is why a visit can
  cross midnight and vanish from Reception's billing queue with money
  still owed. Fixing this needs to decide what the doctor's queue
  *should* show for a multi-day backlog (today only, like Reception? some
  explicit "older" grouping?) — a real product decision, not just adding
  the same `.gte(startOfToday())` filter reflexively, since a patient
  seen very late one night shouldn't silently disappear from the
  *doctor's* queue either.
- **`search_patients`' anon EXECUTE grant and the halted-banner patient-
  name leak are both narrow, mechanical fixes** (a `revoke` statement; not
  rendering/scrubbing `mutation.description` while signed out) — lower
  effort than either of the above two, worth doing first.
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

Read this file (especially the Phase G checklist entry and the section
above), `AGENTS.md`, `docs/architecture-spec.md`, and the PRD. Phase G's
audit is done; **its findings are not** — the next session's job is
fixing this phase's punch list (ranked above), re-verifying each fix live,
and only then treating this app as ready for a real patient. `docs/build-
plan.md`'s own phases A-G are all now *attempted*, but "attempted" and
"done" have diverged for the first time in this project's history — don't
let the checkbox above read as more finished than it is.
