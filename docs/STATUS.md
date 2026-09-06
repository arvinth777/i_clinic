# Status

Read this at the start of every session, alongside AGENTS.md and docs/.
Update it before ending a session or when a block of work completes.

## Where we are

Working through `docs/build-plan.md`, one phase per session, in order.

**Currently in progress: Phase A — Admin and configurability.**

## Phase checklist

- [ ] **Phase A — Admin and configurability** (in progress, this session)
  - [ ] Drug list: add/edit/remove (name, type, strength options, price, low-stock threshold, expiry date)
  - [ ] Procedure list: add/edit/remove (name, default price)
  - [ ] Prescription templates: view/rename/delete
  - [ ] Custom patient fields: definitions table + JSONB values, no migration needed to add a field
  - [ ] Logins: add/remove staff/doctor accounts, assign roles
  - [ ] Duplicate patient merge (blocked if either has an open visit today)
  - [ ] Checkpoint: `docs/security-review.md`
  - [ ] Checkpoint: ponytail
- [ ] Phase B — Stock
- [ ] Phase C — Payments completed (UPI, pay-later/credit, unpaid list, settling)
- [ ] Phase D — Documents, register, reps
- [ ] Phase E — Reports
- [ ] Phase F — Offline
- [ ] Phase G — Go live (item 7, the health endpoint, is already done — see below)

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
- **Realtime was silently non-functional** — the `supabase_realtime`
  publication had never included any table. Fixed: `visits`,
  `visit_pricing`, `bills` added to the publication, `REPLICA IDENTITY
  FULL` set on all three (needed for RLS policy evaluation on
  UPDATE/DELETE). Confirmed live: both directions now sync in under a
  second. Migration: `20260906180000_enable_realtime_publication.sql`.
- **A real correctness bug**: confirming a prescription used to move a
  visit straight to `packing` on its own, independent of "Consultation
  done" — a doctor who prescribed before touching pricing could get
  locked out of the pricing panel entirely, with no way for anyone
  (doctor or reception) to reach it again. Fixed (removed the stray
  transition) plus a database backstop (`20260906160000_ensure_final_
  amount_set_on_packing.sql`) so any path reaching `packing` with
  pricing untouched auto-confirms at whatever it already defaults to.
  20 pre-existing seed visits with the same inconsistency were backfilled.
- Polling backstop: `refetchInterval` is 30s globally
  (`refetchOnWindowFocus: true` on top) — was briefly dropped to 3s
  while Realtime was suspected broken, restored once the real fix
  landed and was confirmed sub-second.
- **Keep-alive health endpoint** (`docs/build-plan.md` Phase G item 7,
  pulled forward): `supabase/functions/health` — public, does a real
  `select` against `clinics` using the service role, returns
  `{"ok":true}`/200 or `{"ok":false}`/500. `verify_jwt=false` lives in
  `supabase/config.toml` so a future CLI redeploy can't silently
  re-enable it. Verified live via `pg_stat_user_tables` that it's a
  genuine query, not a hardcoded response.

## Context a future session needs

- **Migrations are immutable once applied.** Never edit an applied
  migration file — write a new one, even for a one-line fix. Every
  migration in this repo so far follows this; don't break the pattern.
- **Supabase MCP is read-only verification, never a way to change
  staging.** Every schema/data change is a migration file, applied via
  `supabase db push`, committed. `execute_sql` is for checking, not
  fixing.
- **The two-Supabase-privilege-grant gotcha** (bit this project twice
  already): `CREATE FUNCTION` grants EXECUTE to PUBLIC by default *and*
  Supabase's own schema-level default privileges separately grant
  EXECUTE to `anon`/`authenticated` — two distinct ACL entries. Revoking
  from `public` alone does not close the `anon`/`authenticated` gap.
  Verify with `has_function_privilege()` directly; never assume a
  `revoke ... from public` was sufficient. Any new `SECURITY DEFINER`
  function this phase needs the same explicit check.
- **Realtime publication membership is separate from RLS.** Enabling
  RLS on a table does nothing for whether it's published. If Phase A
  (or any later phase) adds a table something should subscribe to live,
  check `pg_publication_tables` — don't assume it's covered.
- **Custom patient fields**: `patients` has no JSONB column yet. Phase A
  adds one, plus a `patient_field_definitions` table (key, label, type,
  display_order) per AGENTS.md's Technical Decision #2 (JSONB only
  where the columns are genuinely unknown; definitions still live in a
  real table so Admin can render/validate them).
- **Creating a login is not a plain authenticated insert.** A new staff
  account needs a real `auth.users` row, which requires the service
  role (`auth.admin.createUser`) — client-side code can't do this
  safely. This needs a `SECURITY DEFINER`-equivalent path: a Supabase
  Edge Function (same pattern as `supabase/functions/health`), gated so
  only an authenticated admin can call it.
- **Patient merge touches every table with a `patient_id` FK** — get the
  full list from the schema before writing the merge function, not from
  memory; a table added since the schema was last read would silently
  keep pointing at the retired patient id.
- The synthetic seed data (staging only, never production) currently
  has no procedures/medicines/templates seeded specifically *for admin
  CRUD testing* — check what exists before assuming a clean slate.

## Next action

Read the current `procedures`/`medicines`/`patients`/`user_roles` schema
directly (don't assume from memory), then write Phase A's migration(s).
