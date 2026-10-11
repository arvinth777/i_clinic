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
