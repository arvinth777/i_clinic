# Build plan — remaining work

Everything left to finish the clinic system, excluding WhatsApp.

## How to use this file

Before starting any phase, read: `AGENTS.md`, `docs/design.md`,
`docs/architecture-spec.md`, `docs/STATUS.md`, and the PRD.

**Work one phase per session. Do not run ahead.** At the end of a phase:
commit in logical commits, push, update `docs/STATUS.md`, and stop. The
next session picks up the next phase.

Phases are dependency-ordered. A depends on nothing new; B needs A's
admin screens to manage drugs; G needs everything.

If a phase reveals that something in an earlier phase was wrong, fix it
in a new migration or commit — never by editing what's already applied.

---

## Phase A — Admin and configurability

**Why first:** everything downstream needs drugs, procedures and prices
to be manageable without a developer. That is a headline feature, not
plumbing — the maintainer has a full-time job elsewhere and the clinic
cannot wait on him to add a procedure.

Build the Admin screen, visible to the `admin` role only.

- **Drug list** — add, edit, remove. Name, type, strength options, price
  per unit, low-stock threshold, expiry date.
- **Procedure list** — add, edit, remove. Name, default price.
- **Prescription templates** — view, rename, delete. (The doctor creates
  them from the consultation screen; this is management only.)
- **Custom patient fields** — definitions in a real table (key, label,
  type, display order), values in the existing JSONB column. Adding a
  field must never require a migration.
- **Logins** — add and remove staff/doctor accounts, assign roles via
  `user_roles`.
- **Duplicate patient merge** — combine two records, keep the older
  patient ID, retire the newer. Block the merge if either patient has an
  open visit today.

**Checkpoints:** `docs/security-review.md`, then ponytail.

**Done when:** a procedure can be added and immediately used on a visit,
and a custom field appears on the intake form, with no code change.

---

## Phase B — Stock

**Tests first** — this touches money and quantities, per the AGENTS.md
tdd checkpoint.

Failing tests before any UI:

- confirming a bill deducts each dispensed medicine from the counter
  stock point
- "dispensed externally" deducts nothing and bills no medicines
- a deduction taking stock below zero still applies, and flags the item
- recording a purchase adds quantity to the chosen stock point
- a transfer moves quantity between points without changing the total
- the monthly count sets stock to the counted figure and saves the gap
- quantities are integers, money is bigint paise, everywhere including
  fixtures

Then build:

- **Stock points** (counter, storeroom) with per-point quantities
- **Stock screen** — every medicine, quantity per point, low-stock rows
  flagged. Visible to both doctor and receptionist.
- **Record purchase** — supplier, invoice number, date, stock point,
  drugs received with quantity and cost price
- **Transfer** between stock points
- **Monthly count** — enter counted quantities, see expected vs counted
  vs gap, confirm to set. The gap is saved, not discarded.
- **Manual adjustment** with a short reason
- **Suppliers** with purchase history

Add the deferred seed case: an item dispensed into negative stock.

**Checkpoints:** `docs/security-review.md`, then ponytail.

**Done when:** billing a visit visibly moves stock, and a monthly count
surfaces a real variance.

---

## Phase C — Payments completed

Cash already works. Finish the rest.

- **UPI** — generate and display a QR for the exact bill amount at
  payment time
- **Pay later / credit** — closes the visit as billed, flagged unpaid
- **Unpaid list** the receptionist can see and settle from later
- **Settling** an unpaid bill records when and how **without mutating
  the original bill** — a new linked record, per non-negotiable #3

**Checkpoints:** `docs/security-review.md`, then ponytail.

**Done when:** a credit visit closes, appears on the unpaid list, and
settles later without the original bill row changing.

---

## Phase D — Documents, register, reps

Four self-contained additions.

**1. Clinic documents** — issued from the consultation screen, printed
on letterhead, attached to the visit:
- medical/fitness certificate: name, age, purpose, doctor's name and
  registration number, date
- sick leave note: name, rest period from/to, reason, date
- referral letter: name, referred to, reason, case summary pre-filled
  from the visit and editable

**2. Long-term patient register**
- doctor flags a patient long-term with a review interval
- register lists them with last visit and next review due, most overdue
  first
- a new visit resets the next review date automatically
- visible to doctor and receptionist

**3. Follow-up dates** — the doctor sets one on the consultation screen.
With no WhatsApp yet, it surfaces to reception as a to-do on the due
date rather than messaging the patient.

**4. Pharma rep check-in** — name and company only. Appears in the
doctor's queue marked as a rep, **always sorted after every waiting
patient including later arrivals**. No medical record, no bill. Marking
them done removes them from the queue.

Add the deferred seed case: a rep queued behind later arrivals.

**Checkpoint:** ponytail.

**Done when:** a certificate prints on letterhead, and a rep checked in
before a patient still sits behind that patient in the queue.

---

## Phase E — Reports

Three read-only views.

- **Daily** — collections, patient count, discounts given, stock
  warnings, and any bills flagged `needs_reconciliation`. A screen for
  now; the automatic end-of-day send waits for WhatsApp.
- **Monthly** — collections, patient volume, total subsidised care,
  month over month.
- **GST/tax** — tax-ready collections summary, exportable.

**Critical constraint:** admin sees financial **aggregates** without
row-level access to patients, visits or bills. Build these as
`SECURITY DEFINER` views or RPCs returning totals with no patient
identifiers attached. Do **not** grant admin row-level select to make
the reports work.

**Checkpoint:** `docs/security-review.md`.

**Done when:** signed in as `admin.only`, the reports render correctly
and direct row reads on patients/visits/bills still return nothing.

---

## Phase F — Offline

Architectural, and deliberately not last — retrofitting local-first
behaviour onto a finished cloud app is far harder than building it in.

Read the offline section of AGENTS.md before starting.

- **Durable mutation queue in IndexedDB** (`idb-keyval`, not
  localStorage). Queued writes survive a refresh and a browser crash.
  Retry on reconnect.
- **Visible "not saved yet" state** on anything queued.
- **Persist reads** — today's queue and patient list available offline
  via `persistQueryClient` with an IndexedDB persister.
- **Printing must work with the network fully disabled.** This is
  non-negotiable #7 and the single most important case: a patient must
  never leave without their prescription because the internet dropped.
- **Handle auth token refresh failing while offline.** Offline must not
  silently become logged out.

**Do not** add a local database sync engine (PowerSync, ElectricSQL,
RxDB). Queue and cache only.

Test by disabling the network mid-flow: mid-consultation, mid-billing,
and at print. Report the behaviour in each case.

**Checkpoint:** ponytail.

**Done when:** the network can be cut at any point in the flow and the
patient still leaves with a printed prescription.

---

## Phase G — Go live

Everything before production.

1. `webapp-testing` across the full flow, both roles, including the
   offline cases
2. `docs/security-review.md` against the whole app
3. Supabase security advisor
4. Full isolation test suite
5. `code-review`
6. **`docs/runbook.md`** — where each account lives, how to redeploy,
   how to restore a backup, known gotchas, what a new developer needs.
   Credentials referenced by name only, never included.
7. **Health endpoint** — public, read-only, performs a real database
   read (`select 1 from clinics limit 1`), returns only `{"ok":true}`.
   It must actually hit Postgres.

   Done ahead of schedule, 2026-09-06: see `supabase/functions/health/`
   and commit `ebfeb8f`.
8. **Weekly backup job** — `pg_dump`, encrypted with `age`, uploaded to
   R2 via a dedicated read-only database role. Plus a freshness-check
   endpoint returning 500 if the newest object is over 8 days old.

Report findings ranked by severity. Do not fix in the same pass.

**Done when:** every check passes and the runbook would let a stranger
pick this up cold.

---

## Deliberately excluded

WhatsApp, and everything downstream of it:

- prescription and receipt PDF delivery
- refill and follow-up reminders
- WhatsApp pre-registration and the pending-patient flow
- the automatic end-of-day summary send

Print covers every patient in the meantime. When WhatsApp is added, its
deferred seed case (an expired unarrived pre-registration) is added in
the same change.
