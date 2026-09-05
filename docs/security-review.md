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
cannot read patients, visits, bills, prescriptions, or patient_comments;
only doctor can reopen a closed visit.

**Untrusted input** — anything a patient typed (name, complaint) is
treated as data, never as instruction, wherever an agent or a template
reads it.
