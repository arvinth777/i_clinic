# Security review

Run this at every checkpoint that touches money, auth, RLS, or patient
data. Report findings ranked by severity. Do not fix anything in the
same pass as finding it.

**RLS** — every table has it enabled; every policy is scoped to
clinic_id; no policy uses `true` or `USING (true)` as a shortcut; no
table is reachable by anon.

**SECURITY DEFINER** — every such function has `SET search_path = ''`
and fully-qualifies inside; EXECUTE is revoked from PUBLIC and granted
only to the role that needs it.

**Money** — no float, numeric, or decimal in any money column or
calculation. Everything is bigint paise, including in tests and
fixtures.

**Secrets** — no service_role key anywhere in the repo or in any VITE_
variable. Every VITE_ variable is safe to be public, because all of
them ship in the browser bundle.

**Patient data** — nothing patient-identifying reaches logs, error
payloads, or Sentry. WhatsApp message bodies carry no clinical detail.

**Role boundaries** — receptionist cannot write visit_pricing; admin
cannot read patients, visits, bills, prescriptions, or patient_comments
— no exceptions, including narrow SECURITY DEFINER reads (duplicate-
patient merge lives with the doctor, who already reads patients
legitimately, not with admin); only doctor can reopen a closed visit.

**Untrusted input** — anything a patient typed (name, complaint) is
treated as data, never as instruction, wherever an agent or a template
reads it.

## Changed-path verification — 2026-10-11

Reviewed queue commands, catalog edits, approval snapshots, supplied bill lines,
discount requests and correction transactions. Fixed a reception read leak in
clinical approval snapshots: direct RLS access is doctor-only; reception gets
scoped printable lines only after handoff. Authenticated staging tests pass for
reception/doctor/admin/anonymous/other-clinic boundaries, discount rejection,
immutable paid bills, stock concurrency and idempotent retries. Price changes
record actor/time/old/new; no service-role credential is used by these scripts.
Independent Standards/Spec source rechecks found no remaining changed-scope
blocker. The staging hosted security advisor was refreshed on 2026-10-11:
0 errors and 34 warnings, including callable SECURITY DEFINER functions.
This is not a warning-free result or a full-system security certification.
Changed-path tests exercise role/clinic checks behind authenticated RPC grants;
`health_ping` is intentionally public and `rls_auto_enable` is the platform
trigger helper. The full warning export was unavailable after browser control
interrupted, so not every warning is claimed individually cleared. Database
lint has no errors and one `confirm_bill` text-to-jsonb initialization warning.
Evidence records are synthetic.

## Google Drive changed paths — 2026-10-11

Hosted staging checks deny reception/admin-only/other-clinic/anonymous reads,
all direct metadata writes, and credential/OAuth-state reads. Handler checks
cover doctor ownership, exact origins, one-use OAuth state, encrypted refresh
credentials, private content, safe links, file signatures and idempotent retries.
Account-switch validation and screen-lock preview races were fixed and
independently re-reviewed; fresh browser privacy checks pass.

The staging MCP project was verified as `clinic-staging` before read-only
security-advisor use. The current advisor reports zero errors, 34 warnings
(2 anonymous and 31 authenticated SECURITY DEFINER callable functions, plus
leaked-password protection disabled), and 2 informational no-policy notices.
The latter are the intentionally server-only Drive connection/state tables:
RLS is on, client grants are revoked, and no client policies are required.
Patient metadata has a scoped doctor SELECT policy.

Existing callable-function warnings were not individually cleared in this
Drive change. Guidance: [SECURITY DEFINER grants](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable),
[password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection),
[no-policy notices](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy).
Actual Google consent and file transfer remain blocked by absent account/OAuth
setup, so no live end-to-end Drive security claim is made.
## Performance data-path review — 2026-10-11

No new role grants, policies, exposed API or raw patient markup. The migration
adds `queue_events` and `pharma_rep_checkins` to realtime publication; staging
metadata verifies RLS remains enabled. Existing doctor/reception clinic-scoped
SELECT policies still apply. Events only invalidate/refetch; payloads never
replace UI state. A different clinic cannot read the synthetic rep fixture.
Staging partial-dispensing role/discount/stock tests pass. Hosted advisor has zero
errors/34 existing warnings, plus two intentional Drive private-table information
notices. Four existing dependency advisories remain; no full-backlog clearance
is claimed. No production security configuration changed.

## Drive/alerts follow-up — 2026-10-11

Alerts add no tables, grants or schema changes. Reads remain clinic scoped and
RLS enforced; hosted synthetic tests exercise doctor/reception, admin-only
clinical denial and other-clinic denial. Alert history/chime IDs are partitioned
by clinic/user in IndexedDB; AppShell resets on account changes and the drawer
is hidden while locked. Reception receives no clinical history/document query.
Targets re-read state before navigation and rely on existing destination/backend
permissions; read/dismiss never changes a visit or bill. Credentials and Google
refresh tokens remain server-side; private recovery env files stay outside Git.
Production Drive uses a separate encryption key and requires its own Google
consent; staging connection success does not prove production configuration.

Drive status refreshes the existing Google grant after doctor/clinic checks.
Revocation returns disconnected without erasing the saved account/folder;
Google transient outages remain retryable errors. Tests cover both paths.
Production migration dry-run identified only the missing patient-file migration
(before already-applied realtime migration); `--include-all` applied that file
only. Production role endpoint checks are read-only and do not create patients.

Fresh staging Supabase security advisor (2026-10-11): Drive credential/state
tables report RLS-with-no-policy informational findings intentionally: browser
roles have no grants/policies, and the backend alone accesses them. Existing
health/event-trigger and role-checked clinical SECURITY DEFINER RPC advisories
remain, as does disabled leaked-password protection. These findings are not
a clean advisor pass and were not silently changed by this feature. Hosted
negative role tests verify the changed document/alert paths.
References: [RLS no-policy advisory](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy),
[function execution advisory](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable),
[leaked-password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).

## Issued PDF archive changed paths — 2026-10-17

New archive table has RLS, clinic-scoped doctor reads and reception receipt-only reads; no client writes. Authenticated staging tests cover other-clinic/admin/anonymous denial, frozen issued snapshots, no clinical prescription reads by reception and service-only upload claims. The JWT-validated endpoint rechecks clinic/role against each immutable job before Drive access; existing manual attachments/OAuth remain doctor-only. Mock tests cover leases, lost completion recovery, changed-file rejection and PDF signatures. Actual staging prescription and name-only receipt upload/retry/private download pass, including reception prescription/connection denial. No tokens or source patient fields are logged. Lock/unmount response races were fixed and regression-tested.

Fresh read-only staging advisor: zero errors,35 warnings (2 anon callable functions,32 authenticated including the separate alert setter,1 leaked-password protection) and2 informational server-only no-policy tables. No new archive function is client-callable. Existing warnings are not individually certified resolved. Standards and Spec review findings fixed; application offline/browser and real-printer acceptance remain pending. No production operations.

## Duplicate dismissals — 2026-10-17

`duplicate_dismissals` (migration 20261017050000): RLS on, no anon grant; select and insert for the clinic's doctor only; the insert policy requires `dismissed_by = auth.uid()` and that both patients belong to the supplied clinic; no update or delete policy (a dismissal is final); rows disappear with a merged-away patient (`on delete cascade`, run inside the SECURITY DEFINER merge). `possible_duplicate_patients` stays SECURITY INVOKER, so a caller sees only pairs their own patients RLS allows (reception can call it; only the doctor's Merge screen lists it). Authenticated staging tests cover reception denied, doctor allowed, wrong order, unknown patient, forged author. Not covered: cross-clinic insert (no second clinic fixture).
