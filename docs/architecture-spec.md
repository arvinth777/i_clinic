# Architecture Spec: Cross-Cutting System Design (v0)

Synthesizes five grilling rounds covering seven architectural areas left open by `prd-clinic-management-system.md` and `AGENTS.md`: offline money-conflict resolution, the auth model, the multi-clinic data model, printing, backup and recovery, hosting/deploys/continuity, and WhatsApp integration. Nothing here reopens a feature, screen, or workflow already settled in the PRD — this spec answers *how* the settled product gets built safely, not *what* gets built.

## Problem Statement

The PRD describes a complete v0 feature set, but several cross-cutting architectural questions were either silently defaulted or genuinely unresolved:

- The PRD states offline conflicts resolve "last write wins" — which is not survivable for money: a patient's bill can be paid against a stale amount while the doctor is mid-revision, and naive last-write-wins would silently overwrite one of the two events instead of surfacing the mismatch.
- "Shared role logins" were assumed early in the project, but RLS keys off identity and paid bills need an audit trail — a design that was never actually checked against how many real humans touch the system (it's more than two).
- The data model needs to support future clinics, but nothing had decided whether that means one shared schema or one Supabase project per clinic.
- Printing hardware, the offline power-cut scenario, and whether printing requires a click were all unstated assumptions.
- Backup, hosting, and "who fixes this when the sole maintainer is unavailable" had no answer at all.
- The WhatsApp integration's cost model, vendor choice, and channel fallback (SMS) were unpriced and unbuilt assumptions.

Left unresolved, any of these would either get built on a wrong default (last-write-wins on money, shared credentials undermining the audit trail) or discovered late, during an actual incident, when it's most expensive to fix.

## Solution

Five rounds of structured interrogation produced a settled, concrete decision for each of the seven areas. This spec is the written record of those decisions, so implementation can proceed without re-deriving them and without silently defaulting to the unsafe version of any of them.

## User Stories

1. As the receptionist, I want the system to never silently apply a stale price when I confirm payment offline, so that I never over- or under-collect from a patient.
2. As the doctor, I want to revise a patient's final amount after finishing consultation without corrupting the record if the receptionist is also working offline, so that a legitimate price correction never turns into an unresolvable conflict.
3. As the clinic, I want any money mismatch caused by an offline conflict to be flagged for a human to resolve, never silently auto-resolved, so that cash discrepancies are always visible and correctable via the same correction mechanism already used for other bill corrections.
4. As the doctor or receptionist, I want the app's daily summary to show any flagged payment mismatch, so that I don't have to go looking for a problem I don't know exists.
5. As the sole maintainer, I want every human who touches the system to have their own login, so that the audit trail on bills, corrections, and stock movements reflects who actually acted, not just which role acted.
6. As the doctor, I want to hold both the doctor and admin roles under one identity, so that I don't need two separate logins to both treat patients and manage settings.
7. As the sole maintainer, I want my own account restricted to the admin role only, so that I can never sign a prescription or set a patient's price.
8. As the receptionist, I want to work all day without re-entering my password, so that logging in doesn't become a source of friction that tempts anyone to share credentials.
9. As the receptionist, I want my screen to lock behind a quick local PIN after a couple of minutes of inactivity, so that a screen I've stepped away from in a walk-through space isn't left exposed.
10. As the doctor, I want a longer idle-lock window on my console than the receptionist's, so that a short timer doesn't fire and lock me out mid-examination.
11. As any staff member, I want a manual one-click lock, so that I can secure the screen the moment I step away, without waiting for the idle timer.
12. As any staff member, I want the lock screen to show nothing — no patient name, queue, token, or amount — so that a locked screen reveals no clinical or financial information to a passerby.
13. As the doctor, I want unlocking to return me to the exact draft I was working on, so that locking never costs me in-progress work.
14. As the doctor, I want my patient comments and clinical notes to be invisible to the receptionist's account, so that private working notes about a patient stay private.
15. As the receptionist, I want to see procedures, medicines, quantities, prices, and the complaint the patient gave me at check-in, so that I can do my job without needing clinical access I don't need.
16. As the sole maintainer, I want my admin account to have no access to patient clinical data, so that holding the admin role never doubles as a backdoor into clinical records.
17. As the clinic, I want a locum or covering doctor to get their own account rather than share the primary doctor's login, so that the audit trail and role model never collapse under real staffing variation.
18. As the clinic owner, I want the data model to support a second clinic without a schema rebuild, so that scaling to more clinics later is a config change, not a rebuild.
19. As the clinic owner, I want a second clinic's data to be provably unreachable from the first clinic's account, so that tenant isolation is verified before it's ever trusted with real patient data.
20. As the receptionist or doctor, I want every clinic document to print from one shared A4 printer without ever choosing which printer to use, so that printing never becomes a 40-times-a-day error opportunity.
21. As the receptionist or doctor, I want prescriptions to keep printing during a real power cut via a low-power fallback printer, so that a patient never leaves without their dosage instructions during exactly the outage this system is built to survive.
22. As the sole maintainer, I want the clinic's data backed up somewhere I control independently of Supabase's own tier, so that account-level loss (not just corruption) doesn't mean total data loss.
23. As the sole maintainer, I want the backup job's success to be monitored by freshness at its destination, not by whether its trigger fired, so that a silently dormant scheduler is caught the same way a silently broken script would be.
24. As the sole maintainer, I want a keep-alive that performs a real database read on an independent schedule, so that the project never pauses itself into an outage over a quiet holiday.
25. As the clinic, I want a documented, versioned deploy pipeline that never pushes straight to production, so that a bad change doesn't take down live billing mid-clinic-day.
26. As the sole maintainer, I want database migrations run and tested against a staging project before touching production, so that a destructive schema change is never a live-and-only attempt.
27. As the sole maintainer, I want a written continuity plan and a time-delayed credential-recovery mechanism, so that the clinic isn't permanently stuck if I'm unreachable for an extended period.
28. As the clinic, I want the domain, hosting, and backup accounts monitored for renewal and billing failure, so that the system doesn't go dark for a reason nobody at the clinic can diagnose.
29. As a patient with WhatsApp, I want my prescription and receipt delivered as a single combined PDF message, so that I get one notification instead of two for something I'll want to keep.
30. As a patient without WhatsApp, I want to still receive a printed prescription and receipt and to be told about my follow-up verbally, so that lacking WhatsApp never means lacking care information.
31. As the clinic, I want WhatsApp messaging billed per-message directly through Meta with no reseller markup, so that the ongoing cost of patient messaging stays as low as the feature justifies.
32. As the sole maintainer, I want the inbound pre-registration webhook to run inside the existing Supabase stack, so that supporting it doesn't require standing up and maintaining a separate backend service.
33. As a patient pre-registering by WhatsApp, I want my message to only pre-fill my check-in, never to move me ahead of patients already waiting, so that first-come-first-serve is never quietly broken by a digital shortcut.
34. As the clinic, I want to be alerted if Meta's quality rating on the clinic's number drops, so that a messaging-tier restriction is caught before it silently stops reminders from sending.
35. As the sole maintainer, I want staging environments seeded with synthetic data only, so that a lower-security environment never becomes a second, unguarded store of real patient records.
36. As a developer debugging an issue that only reproduces against realistic data shapes, I want a pre-built anonymised-extract tool, so that I'm never tempted to copy real patient data into staging under time pressure.

## Implementation Decisions

### Offline money-conflict resolution
- The real race is causal, not concurrent-write: the receptionist's screen is already read-only for price (non-negotiable #2), so the actual hazard is the doctor revising the final amount while offline while the receptionist, also offline, confirms payment against a stale cached amount.
- The visit's pricing record carries a monotonically increasing `revision_number`, bumped on every doctor edit to the final amount, never reused.
- The payment-confirmation mutation snapshots `(final_amount, revision_number, timestamp, confirmed_by)` at the moment of the click. This snapshot is both the conflict-detection mechanism and the audit record — no separate audit log is needed.
- On reconnect, if a payment was confirmed against a revision that is not the latest, this is never auto-resolved (the cash has already moved or hasn't — software cannot undo that). It is flagged for manual reconciliation using the existing correction-row mechanism (non-negotiable #3: a new row referencing the original, never an in-place update).
- Flagged mismatches surface on the daily summary report, in the same place as stock warnings — a surface both staff already check, not a table nobody opens.

### Auth: identity and roles
- No shared credentials. One Supabase Auth account per real human.
- Roles are modelled as a set via a `user_roles` join table, not a single enum column on the user — this supports one human holding more than one role without duplicating identities. RLS policies check "does `auth.uid()` hold role X," not "does this row belong to `auth.uid()`."
- Roster at launch: the doctor holds `{doctor, admin}`; the receptionist holds `{receptionist}`; the sole maintainer holds `{admin}` only — never `doctor`.
- `recorded_by = auth.uid()` is stamped on every bill, correction, and stock movement. This is explicitly an audit trail of system actions (who entered it), not of physical custody — the pharmacist and other informal dispensing help have no login, by design, and this limitation should never be represented as proof of who physically handled medicine.
- A locum or covering doctor gets their own account tagged `role = doctor`. No special-case login path exists for covering staff.

### Auth: session and idle-lock policy
- The underlying Supabase session is long-lived and persists across days — this is what makes per-human accounts viable without reviving the friction shared logins existed to avoid.
- A short local PIN, distinct from the account password, is layered on top. Its hash is cached locally and verified offline — an idle-lock that requires connectivity to unlock is worse than no lock, since the concern is protecting a screen during exactly the kind of outage this system defends against elsewhere.
- Idle-lock timeout is per-station, not global: the reception desk (a walk-through space, unattended repeatedly through the day) locks after 2–3 minutes; the doctor's console (a controlled consultation room) locks after 15 minutes — a short timer there would get disabled by the person it's meant to protect.
- A manual, one-click lock is available regardless of the idle timer — the case that most needs protecting is a deliberate step-away, not an idle timeout.
- The lock screen renders no application state: no patient name, queue, token, or amount.
- Locking must never discard in-progress work — unlocking must return to the exact draft in progress. The existing offline mutation queue already provides this; the lock UI must not unmount the underlying form.
- Clearing local browser storage wipes the cached PIN hash. This is correct behaviour; the recovery path is a full password login to re-establish a new PIN on that device.

### Auth: role-based visibility within one clinic
- `clinic_id`-scoped RLS handles tenant isolation only; it does not address who, within one clinic, can read what.
- `patient_comments` and any clinical/diagnostic notes are readable only by accounts holding `role = doctor`, enforced at the RLS layer — not left as an accident of which screen happens to query which columns.
- Everything the receptionist's job requires — procedures performed, medicines and quantities dispensed, prices, and the complaint she herself records at check-in — remains exactly as visible as the PRD already specifies. The dividing line is authorship: she can read what she typed; the doctor's own clinical writing is not hers to read.
- The admin role is explicitly excluded from clinical-data reads. Configuration access (procedures, drug list, suppliers, templates, custom fields, consultation fee, logins) is not clinical access, and this exclusion applies to the sole maintainer's own admin-only account as much as to anyone else's.
- No break-glass/emergency read path for clinical data exists or is planned. The two scenarios that might seem to need one are already covered: a locum gets their own doctor-role account (above), and the doctor's permanent unavailability is a continuity/handover event (see Hosting & Continuity), not a live-permissions feature.
- Debugging against realistic data never requires a production clinical read: synthetic seed data and the anonymised-extract tool (see Staging and Synthetic Data, below) cover it.

### Multi-clinic data model
- Shared schema. `clinic_id` is present on every clinic-scoped table, including storage buckets and any generated documents, and RLS is scoped to it from v0 — even though exactly one row exists in `clinics` at launch.
- Rejected: a separate Supabase project per clinic. That trade buys hard tenant isolation at the cost of N deployments, N auth pools, no cross-clinic reporting, and N separate bills — a cost this project's stated growth path (the same owner licensing the system to other clinics) doesn't justify paying up front.
- Before launch, a second clinic is seeded with synthetic test data and the isolation boundary is tested adversarially, not just visually: an authenticated session scoped to clinic A must fail to reach clinic B's rows via direct PostgREST queries, Realtime subscriptions, storage objects, and Edge Functions — not merely fail to see them in the UI.

### Printing
- A4, one network-connected colour laser printer for every document (prescription, receipt, certificates). No printer-selection step is built — browsers cannot choose a printer programmatically, and a second printer means a human choosing correctly dozens of times a day.
- Printing requires one click (the browser's native print dialog). No kiosk-mode / silent-print configuration is built — it would pin the clinic to specific, managed devices running a specific browser flag, which is a fragility this project isn't taking on for the friction of one click.
- The print path stays DOM-based per non-negotiable #7 (zero connectivity, no server round trip).
- Bilingual (Tamil/English) prescription printing is deferred; v0 prints English only (see PRD).
- Power-cut resilience: a laser printer's fuser draws a large momentary surge (600–1000W+) and must never be put on a small consumer UPS. The plan is (1) verify the clinic's existing solar UPS's real capacity for the laser printer; (2) if insufficient, the clinic's existing dot-matrix printer (a much lower, ~30–50W draw) becomes the designated outage fallback printer, accepted as slower and lower-quality for that exception path only; (3) failing both, the gap is accepted explicitly — reverting to the handwritten pad, the same fallback the clinic already has today.

### Backup and recovery
- Supabase's **Free tier** is the current plan (not Pro) — Pro is revisited as a calendar item the week before real patients go live. Free includes some backup capability (short-retention snapshots) but not one this project controls or can reliably restore from at will.
- A weekly scheduled job (GitHub Actions) runs an encrypted (`age`/`gpg`, key held apart from the job's own upload credentials) `pg_dump`, uploaded via a dedicated **read-only** database role (never the `service_role` key) to object storage (Cloudflare R2 or Backblaze B2). Because Free's own retention is not reliable, this export **is** the primary backup, not a supplement to one — its own monitoring is treated accordingly (below).
- One restore drill happens before launch — an untested backup is a hope, not a backup.
- Two independent monitored signals, deliberately not sharing a single point of failure:
  - **Keep-alive**: Supabase Free projects pause after 7 days without a database request (the clinic closes for holidays). A tiny Edge Function performs a real database read and is pinged on the *external* uptime monitor's own internal schedule — not via a GitHub Actions cron — so that a dormant repository can never silence it.
  - **Backup freshness**: monitored by checking that the newest object in the R2/B2 bucket is under ~8 days old, via a small endpoint (an Edge Function inspecting the bucket, returning 200 when fresh / 500 when stale) that the same external monitor pings. This is deliberately an outcome check, not a trigger-success check — a dormant GitHub Actions workflow, a dead credential, and a silently broken script are all invisible to "did the last run report success," but all show up identically as a stale bucket.

### Hosting, deploys, and continuity
- Frontend on **Vercel**, on the **Hobby tier** for now — its terms restrict it to non-commercial use, accepted deliberately for a single, revenue-less clinic. The explicit upgrade trigger, recorded so it's never rediscovered via a suspension notice: the day a second clinic starts using the system, it is unambiguously commercial and needs Vercel Pro or a move to Cloudflare Pages — which is also the day there would be revenue to cover either. The build stays a portable static SPA specifically so that move is a configuration change, not a migration.
- Supabase is the backend, on the Free tier per above; two active projects (Free's ceiling) are fully spent on production and staging, with no third slot for a separate development environment.
- Every branch/PR gets an automatic preview deployment, pointed at the **staging** Supabase project — never production, so a preview build can never write to live patient data.
- Production is promoted **manually**; it is never auto-deployed on merge to `main`.
- Database migrations are the real deploy risk, not frontend pushes (a bad frontend push rolls back in seconds; a bad schema change against live data does not). Migrations are applied as a separate, deliberate step, are additive-first (add column → backfill → switch reads → drop later — never destructive against live data in one step), and are run and verified against the staging project before ever touching production.
- Deploys and migrations happen outside clinic hours (before 10am or after 3pm; the clinic runs 10am–3pm).
- All infrastructure accounts — Supabase, hosting, domain, WhatsApp/Meta, object storage — are registered under the sole maintainer's **personal** account, not a clinic-owned identity, so that non-technical clinic staff are never asked to hold or manage credentials they wouldn't know what to do with.
- The resulting single point of failure (the maintainer becoming unreachable) is mitigated by a **time-delayed emergency-access mechanism** (a password manager's built-in feature): a named trusted contact is granted automatic access after a waiting period if the maintainer doesn't respond, rather than handing over live credentials today.
- The domain is set to auto-renew with a long (5+ year) prepaid registration period, and its expiry date is added to the monitoring surface as a dated check rather than trusted to arrive by email.
- A single versioned continuity document lives in the repository: account inventory, redeploy steps, restore steps, known gotchas, and what to hand a new developer. Credentials never live in this document or the repository — only in the emergency-access-enabled password manager.
- One consolidated monitoring surface covers: uptime, frontend error tracking (with PII scrubbing configured *before* go-live, since default error-tracking payloads would otherwise leak patient names, complaints, and prescription content to a third party — the same restriction applies to any local development environment, which never receives production data either), a "business heartbeat" (no visits recorded by a set time on a working day), the Supabase keep-alive, backup freshness, domain expiry, and the two Meta-specific signals below.

### WhatsApp integration
- **Direct Meta Cloud API, no reseller.** Meta hosts the API directly; the integration authenticates with a permanent System User token generated in Meta Business Manager. Cost is Meta's per-message rate only (~₹0.115 at the utility category), with no reseller subscription floor.
- This means the clinic's own backend — not a vendor — owns the entire integration surface: the inbound webhook for pre-registration, send retries and queueing, delivery-status handling, and media upload to Meta's endpoints. There is no vendor support path; the integration must log every send and be built defensively.
- Business Verification (with clinic documents, in Meta Business Manager) is a prerequisite for higher messaging tiers and takes days, not minutes — it starts early, independent of the rest of the build.
- The inbound webhook is implemented as a **Supabase Edge Function**, not a separate backend service, keeping the integration inside the existing stack. It matches an inbound sender to an existing patient by phone number (never creating a duplicate) and writes a pending patient record that expires at end of day if the patient never arrives. Pre-registration only pre-fills the check-in form; it never grants queue priority — the token is still issued strictly on physical arrival order.
- Prescription and receipt are sent together as a **single combined PDF** message per visit, not two separate sends.
- The PDF is generated **client-side, from the same DOM the browser already prints** for non-negotiable #7 — not server-side. A Supabase Edge Function cannot run headless Chrome (it runs on Deno), so a server-side PDF would necessarily be built from scratch via a library like `pdf-lib`, recreating the exact rendering drift (a second, independently-maintained layout, diverging from the printed version over time) that generating from one canonical DOM template avoids. The generated PDF is queued in IndexedDB alongside other pending writes if the visit closes offline, and uploaded/sent once connectivity returns — the WhatsApp send itself requires connectivity regardless, so there is no offline-architecture cost to this choice.
- No clinical detail appears in any message body (message text renders in lock-screen notifications); clinical content lives only inside the attached PDF.
- All outbound messages are pre-approved templates: prescription delivery, payment receipt, refill reminder, follow-up reminder, and pre-registration acknowledgement. Body text carries fixed copy with variable slots only; wording changes require re-approval.
- Two Meta-specific failure modes are added to the monitoring surface: a declined card or spending cap on the linked payment method (which silently stops every outbound send, including reminders), and a drop in Meta's per-number quality rating (driven by recipient block/spam-report behaviour — a live risk, not a theoretical one, for a clinic messaging rural patients from an unfamiliar number). Mitigations for the latter: only ever message numbers the clinic itself collected, and keep every message unmistakably clinic-related and transactional.
- **SMS is out of scope for v0** (see PRD and Out of Scope, below) — going direct to Meta means WhatsApp-only; adding SMS would require a wholly separate gateway, integration, and DLT registration with TRAI, to reach a minority of patients who already receive a printed copy regardless.
- Pre-build gating checks, each with no fallback if it fails late: confirm the document-header template type actually delivers a PDF as expected (prescription delivery depends on this entirely); confirm Business Verification's document requirements for this specific clinic; confirm the System User permanent-token flow (the default token expires in 24 hours, historically the most common setup failure).

### Staging and synthetic data
- Staging (and the second-clinic isolation test, above) is seeded with **synthetic data only** — never a snapshot of production. Real patient records in a lower-security, less-monitored environment is a real problem for this app's data regardless of internal-hygiene arguments, and it is unnecessary risk under India's DPDP Act, which treats health data as sensitive personal data wherever it's stored, not only in the system of record.
- A pre-built **anonymised-extract** tool (never written under incident pressure) is the sanctioned escape hatch for "a bug only reproduces against real data shapes": it produces real structure, volume, and date distributions, with names replaced by fake ones, phone numbers rewritten into invalid ranges, and free-text notes replaced with generic strings.
- Synthetic seed data is deliberately adversarial, not a set of happy-path rows. It must include at minimum: a ₹0 (100% discount) bill and a partially discounted one; a visit where the doctor revised the final amount after the receptionist had the bill open; a visit closed offline and synced later, including one with a stale-amount mismatch; negative stock on a dispensed item; a patient with no phone number; two patients with near-identical names (the exact case trigram search exists to handle); a pre-registered patient who never arrived, past end-of-day expiry; a pharma rep seated behind later-arriving patients; an overdue long-term patient; and a correction row against an already-paid bill.

## Testing Decisions

This is a greenfield codebase — no code exists yet, so there is no prior in-repo test pattern to follow, and there are no existing seams to prefer over new ones. The seams below are proposed as the ones test coverage should be built against as implementation proceeds, following AGENTS.md's own standing rule ("never touch pricing, discount, or stock logic without tests") and this project's stated `tdd` skill for logic, `webapp-testing` for browser flows.

A good test here exercises external behaviour — the outcome a human or another system would observe — not the internal shape of a query or component. Concretely:

- **Money/conflict logic** (revision counter, payment snapshot, mismatch detection): unit-testable at the mutation-handler level, independent of UI — given a sequence of (revision, confirm) events in either order, assert the correct mismatch is or isn't flagged, and that no auto-resolution ever occurs.
- **RLS/visibility policies** (clinic isolation, role-based clinical-data access): integration tests against a real (test) Supabase instance, authenticated as each role in turn, asserting both what's readable and what's rejected — including the adversarial cross-clinic paths named above (PostgREST, Realtime, storage, Edge Functions), not just UI-level checks.
- **Offline queue and sync** (IndexedDB mutation queue, reconnect replay, PDF generation queued offline): testable via a headless IndexedDB/service-worker harness that simulates disconnect → queued writes → reconnect, asserting the queue drains correctly and in the right order.
- **Idle-lock**: component-level test asserting the lock renders no patient/financial state, and that unlocking restores in-progress form state unchanged.
- **Backup/keep-alive endpoints**: the two small Edge Functions (bucket-freshness check, DB-read health check) are simple enough to test directly — assert they return 200/500 correctly against a fresh/stale bucket and a reachable/unreachable database.
- **Stock, pricing, and discount arithmetic**: per AGENTS.md's own non-negotiable, these are never touched without tests, following the project's `tdd` skill.
- **Browser-level flows** (check-in → consult → bill → payment, including the offline variant): covered by the project's `webapp-testing` skill, not unit tests — this is explicitly a different layer per AGENTS.md's own stated rule, not a duplicate of the logic tests above.

## Out of Scope

- Any feature, screen, or workflow already specified in `prd-clinic-management-system.md` — this spec is architecture underneath the settled product, not a revision of it.
- SMS as a delivery channel (dropped from v0; revisit in v1 with real usage data on WhatsApp coverage).
- Bilingual (Tamil/English) prescription printing (deferred to a later addition).
- Supabase Pro/PITR (revisited as a calendar item before real patients go live, not decided now).
- Vercel Pro or a Cloudflare Pages migration (deferred until the explicit trigger — a second clinic going live — occurs).
- A break-glass/emergency read path for clinical data (explicitly declined; see Auth: role-based visibility).
- Any actual implementation code, migration, or configuration file — this is a decision record, not a build.

## Further Notes

- Every decision here was checked against AGENTS.md's stack (React, TypeScript, Supabase, React Query) and non-negotiables; none forced a substitution. The one genuinely new technical need this raised — the inbound WhatsApp webhook — is absorbed by a Supabase Edge Function, staying inside the existing stack rather than reaching outside it.
- This spec should be read alongside AGENTS.md §5 (WhatsApp — direct Meta Cloud API, own the integration), which already carries a condensed version of the WhatsApp decisions above; this document is the fuller record all seven areas were drawn from.
- Three corrections to earlier assumptions surfaced during the grill and are worth flagging for anyone picking this up later: the backup plan runs on Supabase Free, not Pro; Vercel is currently on the Hobby tier under an explicit, temporary ToS accommodation; and SMS was cut from v0 entirely rather than simply reprioritised.
