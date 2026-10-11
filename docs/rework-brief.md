# Clinical app rework brief

Captured from the user's explanation on 2026-10-10. This records the
intended product and open questions; it is not an implementation spec or
authorization to delete existing features or records.

## Purpose

New UI direction: see `docs/ui-handoff-plan.md` and the preserved
`docs/references/clinic-app-handoff/` screenshots/prototypes. The user confirmed
on 2026-10-10 that the agreed clinic rules below remain in force while adopting
that UI. The subsequent user-approved `docs/ui-handoff-decisions.md` resolves
prescription filling and supersedes earlier queue ordering, price-snapshot timing
and partial-supply rules. Where that addendum is silent, this brief governs.

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

The existing integer-money, doctor-approved consultation pricing, immutable
paid bills, transactional/idempotent stock deduction, RLS, offline
printing, and durable queued-write requirements remain in force.
The only agreed consultation-fee exception is a refill-only sale.
Reception may confirm a refill total at saved unit prices without doctor
approval, entering supplied quantities at saved catalog prices. Both doctor
and receptionist can set catalog unit prices; reception cannot override a
bill line price or give discounts. Only the doctor can discount a refill.
The addendum allows reception to reduce supplied quantities without new approval,
using approval-time prices and the fixed doctor discount capped at subtotal.
Record shortfalls; only the doctor can approve quantities above the approved cap.
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

## Source inspection before the fix pass

This table records the original source inspection. Subsequent implemented
fixes and staging/browser evidence are recorded in docs/STATUS.md and
docs/codebase-audit.md; the scanned A4 layout remains unimplemented.

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
  doctor approval. Only the doctor can discount; both doctor and reception
  can set saved catalog prices, but reception cannot override bill prices. Consultation final pricing remains doctor-owned.

## Unit and refill decisions — 2026-10-10

Both staff roles set catalog unit prices. Existing counts and prices must be
confirmed against the selected unit before billing. Refills are visually
verified at reception and billed by name alone, without patient history.
Discounts remain doctor-only. Confirmed units stay fixed; use a separate catalog medicine for different
packaging. No automatic stock conversion or historical paid-bill rewriting.
Catalog price edits apply to new prescriptions/sales; prepared entries retain
their saved price. Staging implementation and evidence are in docs/STATUS.md.

## Future work: second doctor with shared reception — 2026-10-11

Requested for later planning, not current implementation. Support two doctors
working simultaneously with one reception page. The user will explain their
different workflows before requirements are finalised. Do not assume that
adding a second doctor login provides independent consultations.

Current constraints verified in source: accounts can hold the doctor role, but
the consultation screen selects a clinic-wide active visit and the queue RPC
allows only one called/with-doctor visit per clinic. Doctor name and registration
are clinic settings; the existing letterhead identifies the current doctor.

Proposed reception integration to evaluate:
- Keep one patient search/check-in flow, billing desk and inventory.
- Assign a consultation to a doctor; show each doctor's current patient,
  waiting count and availability together on the reception page.
- Label every called/sent-in event with doctor and token so reception knows
  which room to send the patient to. Each doctor's screen shows their own work.
- Preserve existing records and the single-doctor flow during the transition.

Problems and decisions to resolve before building:
- Routing: doctor selection, shared versus separate waiting lists, token
  numbering, reassignment, absent doctors and patients consulting both doctors.
- Concurrency: two doctors calling at once must not claim the same patient;
  active-consultation checks, realtime refetches, cache keys and offline replay
  must respect doctor assignment and handle stale/reassigned visits safely.
- Access: decide whether clinical history, private notes and Drive attachments
  are shared between doctors. Test backend permissions, not just UI filters.
- Clinical ownership: record the treating/prescribing/approving doctor and
  decide who may edit, hand over, approve quantities or discount another
  doctor's visit. Retain actor audits and approval snapshots.
- Printing: doctor profiles, registration numbers and letterheads must match
  the issued prescription; historical/offline snapshots retain the original
  identity. New layouts require physical-printer sign-off.
- Charges and reporting: confirm fees for each doctor and two-doctor visits,
  discount authority, receipts and doctor-level revenue attribution. Keep
  integer paise, immutable paid bills and atomic/idempotent stock deduction.

Future acceptance checks: simultaneous consultations on two doctor screens
and one reception screen; concurrent calls, reassignment, reconnect/offline
retries, cross-doctor permission denials, correct print identity and unchanged
single-doctor/refill/billing/stock behaviour. No workflow choice above is final
until the user supplies the second doctor's process.

## Far-future realtime scaling — 2026-10-11

User requested a long-term evaluation of dedicated WebSockets or server-sent
events (SSE) as usage grows; the current version retains Supabase Realtime.
Supabase already delivers notifications over WebSockets. SSE is an alternative
server-to-browser transport with ordinary HTTP writes, not a requirement to
operate both transports or a committed migration choice.

Revisit when concurrent staff/clinic growth, measured cross-role delays,
reconnect failures or service limits justify it. Compare private Supabase
Broadcast first with a dedicated WebSocket or SSE service. Measure click to
committed save to visible update across doctor/reception clients under expected
load, including concurrent actions and reconnects; agree latency and capacity
targets before choosing a replacement. Preserve database authority, authorised
clinic/doctor channels, invalidation/refetch, durable IndexedDB writes, explicit
pending status, replay idempotency and fallback recovery. Transport changes do
not solve the separate multi-doctor workflow constraints above.

No new realtime infrastructure is approved for this version. Existing checks
support the current small-clinic scope; they do not prove unlimited capacity or
guarantee instant communication during internet outages.

## Alert backlog — 2026-10-11 side-conversation decision

User-requested order for this follow-up work:
1. Configure the supplied Google OAuth JSON credentials securely on staging
   and test the clinic Google Drive connection. The user reports creating the
   account/client and saving the staging callback after downloading the JSON;
   this is not evidence of a working connection.
   Setup context supplied by the user: created a clinic Google account and
   Google Cloud project, enabled Google Drive API, created the web OAuth client
   in Google Cloud Console, and downloaded its credentials JSON to
   `/Users/arvinthcinmayankirupakaran/Downloads/client_secret_841094055048-6dstgq429ll0t31mapbl7ls04bsapl3t.apps.googleusercontent.com.json`.
   After downloading, added the authorized redirect URI on the same client:
   `https://iclinic-1jplfzbwe-arvinth777s-projects.vercel.app/?drive_callback=1`.
   The downloaded JSON may therefore contain an older redirect list; this does
   not invalidate its client ID/secret. Google uses the saved Console redirect
   configuration and requires the app's redirect to match exactly.
   The file has not been opened or imported in this side conversation. Keep
   its contents outside Git and the frontend. Remaining: verify the current
   staging target/callback and Console test-user/scope setup, securely configure
   backend credentials and token encryption, then test consent, upload, preview,
   download and reconnect. No production Google setup or live connection has
   been verified here.
2. Add a gentle reception chime when the doctor calls a patient, with explicit
   sound enablement and mute. Deduplicate events across refetch/reconnect so a
   call does not repeatedly sound.
3. Add actionable in-app alerts: clicking opens the permitted destination and
   highlights the relevant token, bill, medicine or stock batch. Cover patient
   called/sent in, ready to bill, discount review, low stock and nearing expiry.
   Navigation does not confirm a queue action, payment or stock change. Preserve
   backend role boundaries and refetch current data before showing an item that
   may have changed. Browser/OS push is a separate, unapproved feature.

Additional user-approved backlog items (recorded, not implemented):
- Automatically archive finalised prescriptions and confirmed-payment receipts
  as PDFs in Google Drive, linked to the patient's profile and source visit/
  prescription/bill. Current structured prescription/bill history remains the
  source of truth; no automatic Drive PDF archive exists yet. Use the issued
  snapshot and same print layout, durable offline retries, visible archive
  status, and stable source/version identifiers to prevent duplicate uploads.
  Drive failure must not block consultation, payment or offline printing.
  Reception-triggered receipt archiving needs a narrowly authorised backend
  path; it must not grant reception access to clinical documents or Google
  tokens. Paid-bill corrections produce separate linked archives. Name-only
  pharmacy sales remain name-only: do not invent a patient profile for them.
- Failed/pending sync alerts with pending-change details and retry controls.
- Persistent unread/recent notifications, with read/dismiss and quiet/mute controls.
- No-show review reminders using the existing configured threshold; removal
  from the queue remains an explicit reception action.
- Failed Drive upload and reconnect alerts linked to Documents.
- Called-patient reminder if reception has not marked Sent in after a
  configurable delay; choose the delay before implementation.
- Outstanding-bill alerts at closing time, linked to individual bills; confirm
  the closing-time setting before implementation.
- Doctor notice of partial medicine supply, linked to visit history.
- Duplicate same-day check-in warning before another token is issued; check
  existing duplicate protections before adding a new flow.
- Connection lost/restored indication based on real connection/fresh-data state.
- End-of-day checklist of unresolved visits, unpaid bills, pending saves and
  failed uploads.
- Group repeated stock alerts by medicine/batch to avoid notification noise.

Smart-feature priorities clarified by the user:
- Add possible duplicate patient detection with staff review and an option to
  merge after review. Reuse and verify the existing merge flow and its role
  permissions; matching phone/name is a warning, never automatic merging.
  Preserve visit, billing and document associations without changing paid bills.
- Add a unified patient document timeline for prescriptions, receipts and
  uploaded reports, respecting existing role access. Existing visit dates are
  already tagged; this is a presentation/integration improvement. Date and time
  are important throughout: distinguish visit/event time, prescription issue,
  payment, document upload and report/examination date where available. Display
  timestamps consistently in clinic time and do not invent times for date-only
  historical reports.
- Stock-aware billing/earliest-expiry batch suggestions are nice-to-have, lower
  priority because shortages are rare. Reuse current stock/dispensing checks.
- Follow-up contact/booking worklist: far-future version, not current priority.
- Repeat-last-prescription change review was declined. Prescription version/
  change-history enhancements are deferred; leave current behaviour intact.
- Partial-supply follow-through (tracking and later supplying a remaining
  quantity) was explained but is not approved. Existing partial dispensing and
  shortfall history remain in scope; do not add an owed-medicine workflow yet.
- Last-visit summary was proposed but not explicitly approved in this reply.

User-approved finishing pass (queued after the already ordered follow-up work):
- Replace the generic browser title `app` with iClinic and the current section.
- Make installed-app naming consistent and add appropriate raster home-screen/
  install icons and launch colours using existing clinic branding tokens.
  The new vector favicon is already a local change, not a verified deployment.
- Use readable, consistently capitalised status labels rather than displaying
  raw database stage names; leave stored statuses unchanged.
- Replace browser-default confirmation prompts with accessible app dialogs
  matching the design, preserving consequence descriptions and draft protection.
- Show relevant dates and times in history; coordinate with the document
  timeline item above to avoid duplicate work.
- Check downloaded document filenames, clinic identity on receipts, keyboard
  focus, and empty/error states; fix confirmed gaps in the affected flows.
  These last checks are audit targets, not confirmed defects.

Automatic clearing means removing a resolved issue from active alerts, while
retaining it in recent history: e.g. an unpaid-bill alert clears after payment
is confirmed. The user approved this behaviour: retain resolved alerts in
recent history and clear them from the active list after confirmed resolution.
The user declined the proposed additional lock-screen alert-redaction rule;
this backlog does not change existing application locking or role permissions.
Prefer actionable exceptions over routine alerts. This backlog does not replace
ongoing performance work.

## Details needed before implementation

- Review the A4 layout proposal and create a visual mockup of the supplied
  references, including overflowing medicine rows and printer margins.
- Refill selection and medicine units are resolved above. Staff verification
  is required for existing prices/counts; preserve historical paid bills.

## Recommended next work

Implement and verify quantity billing and name-only pharmacy sales against
the confirmed unit/price decisions. Review the prescription layout separately. Inspect the existing app against one representative real
visit, then produce a small keep/simplify/defer plan before changing code.
Prioritise prescription entry, the physical print output, and patient
recall; include the confirmed quantity-billing and refill requirements.
Preserve working backend guarantees and historical records. Invoke
skills according to the current routing rules in AGENTS.md.

## Patient document attachments — 2026-10-10 side-conversation decision

The user requested ordinary scans, photos and documents in patient profiles,
stored in a clinic Google Drive account they will create later. Implement
PDF/JPG/PNG uploads with category, date and note; retain Supabase for patient
metadata and authorization. Preserve doctor-only clinical access. No DICOM
viewer, public sharing, reception access or Drive migration was requested.
Google Cloud OAuth setup is required in addition to creating the account.
See `patient-documents-setup.md` for implementation, setup and release gates.
