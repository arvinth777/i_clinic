# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Doctor** — an anaesthetist practising pain relief and palliative care, one of two staff. Writes prescriptions, performs and prices procedures, and is the sole person who sets each patient's final payable amount (full price, reduced, or free). Also checks the day's numbers remotely from home.
- **Receptionist** — issues tokens, captures patient details, opens the bill, collects payment, manages stock alongside the doctor. Her screen only ever displays the amount the doctor set; she cannot change it.
- **Pharmacist** — works entirely without a screen or login. Calls the next token number aloud, packs medicines with the doctor, and explains dosage to the patient at reception.
- **Admin** — configuration login (procedures/prices, drug list, suppliers, templates, custom fields, logins).
- **Pharma reps** (~5-6/week) — checked in by the receptionist, always queued behind every waiting patient regardless of arrival order.
- **Patients** never log into anything; their only touchpoints are a physical token, a printed prescription/receipt, and (when they have it) WhatsApp.

## Product Purpose

Digitises a two-person pain-relief and palliative-care clinic that currently runs entirely on paper: a token queue (the one part that already works), handwritten prescriptions, and medicine dispensed with no stock tracking. Most importantly, the clinic has **no bill at all today** — the doctor decides each patient's price case-by-case and that decision currently lives only in his head. Success is the receptionist never again having to ask the doctor what to charge, and the doctor being able to see, for the first time, how much subsidised/free care he actually gives out.

## Positioning

Not a generic clinic-management SaaS. Three things a neighboring product would not copy faithfully: the doctor stays sole arbiter of price and discount per patient (matching how a socially-adjusted palliative practice actually prices care, rather than fixed-price billing); it is built to keep working through India's variable connectivity — durable offline write queue, zero-connectivity browser printing, and instant doctor-to-receptionist sync are treated as core, not edge cases; and no patient ever has to use an app — token, print, and WhatsApp (PDF, never a link) are the only patient-facing channels.

## Operating Context

Runs on staff-owned browsers inside and outside the clinic (the doctor checks numbers from home). The single hardest technical requirement: when the doctor sets a patient's final amount, it must reach the receptionist's screen instantly, because she physically cannot collect payment until it does. A connectivity drop must not stop either screen from working locally (queue, prescriptions, printing, billing), syncing the moment it returns. The pharmacist participates with no screen at all, by voice and by hand.

## Capabilities and Constraints

- Money is stored as integer paise, never float, anywhere including tests.
- The doctor sets the final payable amount; the receptionist's price field is read-only. Discount = calculated total − final amount, recorded automatically, never justified or typed in separately.
- Paid bills are immutable; a correction writes a new row referencing the original.
- Stock deduction and bill confirmation happen atomically and idempotently (a double-clicked confirm never deducts twice); a deduction that would go below zero still applies and is flagged into that day's stock warnings rather than blocking a live patient.
- Row-level security is on for every table; this app is reachable from outside the clinic network.
- Realtime events invalidate a query and trigger a refetch — never a direct patch to state (sockets drop on sleep/wifi flap).
- The prescription must print with zero connectivity (browser print of what's on screen, no server round trip).
- Writes queue durably (IndexedDB, not localStorage) and survive a refresh, with an explicit "not saved yet" state.
- WhatsApp delivery (prescription/receipt as PDF, refill and follow-up reminders, pre-registration) goes through the Meta Cloud API directly, no BSP; pre-registration never grants queue priority — token order is still strictly by physical arrival.
- Deliberately out of v0: a pharmacist login, a second doctor's queue, patient-facing portal/app, SMS fallback, appointment booking, ambient AI scribing, ABDM integration, batch-level medicine expiry.
- Full detail lives in `AGENTS.md` (non-negotiables, technical decisions) and `prd-clinic-management-system.md` (complete spec, screens, forms, edge cases) — read both before proposing a feature.

## Brand Commitments

None confirmed. No named product brand or fixed clinic identity exists yet; the running app displays whichever clinic's own name is stored in its `clinics` row (currently synthetic staging data, "Clinic A"). Any visual identity work should not invent a brand name or logo.

## Evidence on Hand

No real patient data anywhere — synthetic/staging seed data only (patients, visits, procedures, bills all fictional). This is an internal single-clinic tool in v0, not sold or marketed externally, so no customer testimonials, pricing tiers, or usage benchmarks exist and none should be invented.

## Product Principles

1. Digitise the existing paper workflow faithfully; don't redesign clinic operations around the software.
2. The doctor's screen decides money; the receptionist's screen only ever displays what he decided.
3. Never block a live patient on a technical failure (stock going negative, a dropped sync, no connectivity) — flag it for later review instead.
4. Zero extra steps for anyone who can't or shouldn't be at a screen (the pharmacist, patients).
5. Correctness and continuity of care outrank visual ambition: financial accuracy, tenant isolation, and printing when offline are non-negotiable; the interface serves people mid-task, under time pressure, often with a patient in the room.

## Accessibility & Inclusion

No formal standard confirmed. The PRD requires the app to remain fully usable single-column on a mobile browser with all actions available; treat ordinary web accessibility practice (keyboard focus, labels, contrast) as the floor given the clinical and financial stakes of the content.
