# Clinical app rework brief

Captured from the user's explanation on 2026-10-10. This records the
intended product and open questions; it is not an implementation spec or
authorization to delete existing features or records.

## Purpose

A personal clinical tool for the doctor and receptionist. The primary
job is fast digital prescription writing, with patient details filled
from reception and useful history available when a patient returns.
Queue coordination, billing, and inventory support that daily workflow.

The user cannot reliably describe what the AI-built app currently does.
Rework must start from inspected behaviour and this intended workflow,
not assume the old phase checklist proves the product is useful.

## Required baseline

1. Reception searches for an existing patient or registers a new one,
   captures name, age, height, weight, and relevant details, and issues
   a token. Repeat visits use the same patient file.
2. Doctor and reception see a shared queue and current token. The doctor
   sees the waiting count and calls the next patient. Reception sees
   that change promptly and knows whom to send in.
3. The selected patient's details fill the prescription. The doctor
   types/searches medicines, chooses strength, frequency, duration and
   instructions, and uses suggestions or reusable combinations to save
   time. The doctor reviews all suggested content before issuing it.
4. The user uploads the existing prescription design to the web app.
   Print the whole design plus populated patient details, medicines,
   frequency, and instructions on blank paper. This is a reusable
   template requirement, not text-only printing on preprinted sheets.
   A4 portrait is confirmed and both reference images are preserved in
   `docs/references/`. Field placement and editable controls are proposed
   in `docs/prescription-layout-proposal.md`; visual/print validation is
   still needed before implementation.
5. A patient file keeps past problems, notes, prescriptions, and linked
   bills/payments, so the doctor can recall the previous encounter.
6. Reception bills consultation and supplied medicines, records Cash
   or UPI, and prints an itemised receipt. Payment confirmation deducts
   the actual supplied quantity from stock exactly once.
   A consultation visit includes the 25000-paise (₹250) fee; a refill-only
   sale skips the doctor's queue and has no consultation fee. Each
   medicine line charges quantity supplied × saved unit price.
7. Inventory shows stock counts, low-stock alerts, and approaching
   expiry. Received stock and physical count corrections must also be
   possible to keep the count meaningful.
8. Recorded payments support a simple revenue view, including Cash/UPI
   totals and the link back to the patient and visit.

The existing integer-money, doctor-controlled consultation final amount, immutable
paid bills, transactional/idempotent stock deduction, RLS, offline
printing, and durable queued-write requirements remain in force.
The only agreed consultation-fee exception is a refill-only sale.
Reception may confirm a refill total at saved unit prices without doctor
approval, entering supplied quantities but never editing unit prices or
giving discounts. Only the doctor can discount a refill.
Prompt cross-device sync requires connectivity; queued offline work
must be visibly pending rather than appearing delivered to the other
station.

## Outside the immediate baseline

- WhatsApp receipts and medicine-end reminders are optional future
  ideas. The user does not currently expect to obtain the Business API;
  this rework must not depend on it. No current API-price claim was
  researched or agreed in this discussion.
- The user is interested in recording consultations and using an
  external summariser such as Granola, then putting the summary into
  the patient file. No recording, summarisation, or integration design
  is agreed. Recommendation: establish a useful doctor-reviewed notes
  workflow first, then evaluate capture separately.
- The user has not requested removal of existing procedures, rep
  check-in, long-term care, certificates, credit/settlements, or detailed
  reporting. These need a keep/simplify/defer decision; their existence
  does not make them automatic priorities for the rework.

## What source inspection establishes

These are code-level observations, not a new live-browser or database
audit. Existing historical test results do not verify the reworked flow.

| Area | Current source | Difference to resolve |
| --- | --- | --- |
| Queue and sync | Reception check-in, doctor Call next, token displays, waiting counts, and Supabase subscriptions exist | Verify the two-station flow and simplify its presentation around the current token |
| Prescription entry | Medicine search, templates, a patient-specific usual-combo suggestion, and per-medicine instructions exist | Evaluate speed and usefulness with the user's real medicines; this is not generative clinical prescribing |
| Prescription print | `Billing.tsx` renders a prescription and separate receipt from the browser DOM | Generic letterhead, not the user's scanned prescription; layout and patient fields need review |
| Patient memory | Consultation loads previous complaints, prescriptions, and dated patient comments | A complete patient file including bill/payment history and useful visit notes is not established by these sections alone |
| Height/weight | New-patient form supports configurable custom fields | No dedicated height/weight capture in the inspected form; whether configured definitions exist was not checked |
| Billing | Cash, UPI, and Pay later/Credit exist; billing is linked to visits | New baseline names Cash/UPI only; a refill-only route without the doctor's queue/consultation fee is required but not implemented |
| Medicine pricing | Latest pricing recompute sums one catalog price per prescription item; quantity dispensed drives stock deduction | Confirmed requirement is quantity supplied × unit price; current code needs a tested change, with explicit stock/billing units |
| Inventory | Stock movements, purchase entry, counts, adjustments, and low-stock badges exist | Expiry date is editable in the medicine catalog, but the inspected stock view does not fetch it or display nearing-expiry alerts |
| Revenue | Existing reports query recorded billing data | Decide which simple daily totals are needed; no new report or accounting system agreed |
| Voice/WhatsApp | No recording/summarisation flow found in the inspected source; WhatsApp is already excluded from the build plan | Keep them separate from completion of the basic clinical flow |

## Confirmed decisions — 2026-10-10

- Upload the prescription design in the web app and print the whole
  populated document on blank paper.
- Refill-only sales happen at reception without a doctor consultation,
  without joining the doctor's queue, and without a consultation fee.
- Medicines charge by quantity supplied × unit price, not a fixed amount
  regardless of quantity. The previous flat-per-item formula is superseded
  for the rework; historical paid bills remain immutable.
- Reception confirms refill-only sales at saved unit prices without
  doctor approval. Only the doctor can discount; reception cannot edit
  prices or discounts. Consultation final pricing remains doctor-owned.

## Details needed before implementation

- Review the A4 layout proposal and create a visual mockup of the supplied
  references, including overflowing medicine rows and printer margins.
- Establish which existing prescription authorises a refill and how it
  is selected; no new prescription should be silently created by reception.
- Define the catalog billing/stock unit for each medicine (tablet, strip,
  bottle, etc.) and whether received quantities use the same unit.
  Existing catalog prices must not be reinterpreted as unit prices without
  validation; existing stock quantities and paid bills must be preserved.

## Recommended next work

Review the prescription layout and resolve refill prescription selection
and unit definitions. Inspect the existing app against one representative real
visit, then produce a small keep/simplify/defer plan before changing code.
Prioritise prescription entry, the physical print output, and patient
recall; include the confirmed quantity-billing and refill requirements.
Preserve working backend guarantees and historical records. Invoke
skills only as explicitly authorized under AGENTS.md.
