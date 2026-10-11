# Clinic app — build brief

Build a web app for a small pain and palliative-care clinic. Two users share it all day: one doctor and one receptionist, on two computers on the clinic Wi-Fi. The designs in this folder are the source of truth for layout, copy and behaviour.

## What's in this folder

- `screenshots/` — one full-page PNG per screen. Match these visually.
- `design-source/*.dc.html` — interactive prototypes, one file per screen. Use them as a reference for markup, inline styles, copy, sample data and interaction logic. Do not ship them as-is.
- `assets/letterhead-a4.png` — the clinic's A4 letterhead (1055 × 1491). Prescriptions print on top of it.

### Reading the `.dc.html` files

Each file has HTML inside `<x-dc>` and one `class Component` script at the bottom.
- `{{name}}` reads a value returned by `renderVals()`.
- `<sc-if value="{{flag}}">` renders only when the flag is true.
- `<sc-for list="{{items}}" as="item">` repeats.
- `onClick="{{fn}}"` binds a handler from `renderVals()`.
- `<dc-import name="Nav" …>` mounts `Nav.dc.html` with those attributes as props.
- `<a href="X.dc.html">` is navigation between screens. Map each one to a route.

Treat each file as a React component: `state` and `setState` behave the same, and `renderVals()` is the derived view model.

## Screens and routes

| File | Screen | Route |
|---|---|---|
| SignIn | Pick user, 4-digit PIN | `/sign-in` |
| Lock | Screen lock (auto after 5 min idle) | `/lock` |
| Nav | Shared top bar on every screen | component |
| Reception | Today's queue, find/register/check-in, token slip | `/reception` |
| Doctor | Current patient, history, waiting list, call next | `/doctor` |
| Minimal | Prescription editor + live letterhead preview + charges approval | `/visit/:token/prescription` |
| Billing | Bill from approved prescription, Cash/UPI, receipt | `/billing/:billId` |
| Refill | Refill-only sale (no token, no fee) | `/refill` |
| Patient | Patient list + record (timeline, Rx, bills, notes, docs) | `/patients/:id` |
| Inventory | Stock, purchases, transfers, adjustments, physical count | `/inventory` |
| Suppliers | Suppliers and purchase invoices | `/suppliers/:id` |
| Reports | Collections, payment split, activity, close the day | `/reports` |
| Settings | Clinic info, staff & access, medicines, procedures, templates, print, backup | `/settings/:section` |
| More | Unpaid bills, bill corrections, follow-ups, documents, duplicate patients, rep visits | `/tools/:tool` |
| States | Loading, empty, error, offline, saving, save-failed, back-online | reference only |
| Map | Walkthrough index | reference only |

## Main flow

1. Reception checks the patient in and issues the next token number (e.g. #21).
2. The doctor clicks **Call next**. Reception sees a blue banner, "Doctor called #15 — please send in", and taps **Sent in**. The doctor's screen updates to "Reception sent #15 in".
3. The doctor writes the prescription. Patient details from reception are pre-filled.
4. On **Finish**, a checklist asks for anything missing: complaints, diagnosis, at least one valid medicine, review date. The doctor approves the consultation fee and any discount, then sends.
5. The bill appears in reception's Billing list. Reception sets the quantity supplied, collects Cash or UPI and prints the receipt and prescription.
6. The visit, prescription, bill and payment are added to the patient's record. Stock is deducted on payment.

Doctor and reception screens must update in real time: queue status, called and sent-in events, approved bills. Use WebSockets or Server-Sent Events.

## Business rules

- **Queue statuses:** `waiting → called → with_doctor → ready_to_bill → paid`, plus `away` ("Not here") and `draft` (skipped by the doctor).
- **Drafts:** a skipped patient is held as a draft and can be reopened later. Finished and draft patients never reappear in "next".
- **Consultation fee:** ₹400 for new patients, ₹300 for follow-ups. These are configurable in Settings → Procedures & fees.
- **Medicine charge:** quantity supplied × saved unit price. Quantity supplied can't exceed the prescribed quantity or the stock on hand.
- **Only the doctor can change prices or give discounts:**
  - Discount options: round off, 10%, waive consultation.
  - Reception cannot edit prices or discounts; it can only "Ask doctor to change".
  - Enforce this on the server, not just in the UI.
- **Paid bills are never edited.** A correction is a credit or extra charge that the doctor approves.
- **Pay later** moves the bill to Unpaid bills.
- **Refill-only sale:**
  - Only medicines on a prescription under 90 days old.
  - Up to 30 days' supply.
  - No consultation fee and no queue entry.
- **Prescription checks:**
  - Allergy check: NSAID versus a patient with an NSAID allergy.
  - Duplicate drug class, e.g. two gabapentinoids.
  - Interaction pairs, e.g. tramadol with duloxetine or amitriptyline.
  - Each warning needs **Remove** or **Keep** before sending. Low stock is a notice only and doesn't block sending.
  - The sample interaction list is a placeholder. Use a real drug-interaction source in production.
- **Duplicate patient detection:** the same phone number when registering. Merging keeps all visits and bills.
- **Audit:** every bill, stock adjustment and correction records who made it and when.

## Prescription editor specifics (most important screen)

- One search box finds both medicines and saved sets.
  - Matches that start with the typed text come first; medicines already on the prescription go last and are tagged "On Rx".
  - ↑↓ chooses, Enter adds, Esc clears, a second Esc leaves the box.
  - If nothing matches, offer to add the medicine as typed.
- Each medicine is one line: name + strength · dose pattern (e.g. 1-0-1) · food · days.
  - Click a line to edit: strength, preset dose (1-0-1 / 1-1-1 / 1-0-0 / 0-0-1 / SOS / Custom), food, days and a note.
  - Under Custom, Morning/Noon/Night buttons cycle 1 → ½ → 0.
- Validation: no dose or no duration blocks sending, with quick-fix buttons in the checklist.
- **Live preview:** text overlays on the letterhead PNG, positioned in percentages so it scales.
  - Ref no. at top 23.6%, left 11.5%. Date at top 23.5%, left 79.5%.
  - Body area: top 28%, bottom 9.6%, left and right 6%.
- **Long prescriptions:** warn when the content may run past one page.

## Offline (required)

The app works on the local network if the internet drops.
- Store data locally first and sync to the cloud: IndexedDB/SQLite plus a sync queue.
- The top bar shows "All saved", "Saving…" or "Offline · N changes waiting".
- Today's prescriptions stay printable offline.
- UPI can't be confirmed offline: record the reference and mark it unverified.

## Data model (minimum)

`Patient`, `Visit` (token, status, timestamps), `Prescription` + `PrescriptionItem`, `Bill` + `BillLine` + `Payment` (method: cash | upi, ref), `Medicine` (price, reorder level, flags: nsaid, class), `StockBatch` (batch, expiry, quantity, location), `StockMovement` (sale | purchase | transfer | adjustment | count, reason, user), `Supplier` + `PurchaseInvoice`, `User` (role: doctor | reception, PIN hash), `Note`, `Document`, `RepVisit`, `FollowUp`.

## Visual system

- Font: Hanken Grotesk. Use tabular figures for numbers.
- Colours:
  - Ink #141C2B; muted text #5B6575 and #7A8494; hairlines #EEF0F3.
  - Panels #F6F7F9.
  - Accent #1A4FB5 (tint #EAF0FC for selected chips).
  - Warning #93520A; error #B42318; success #1F7A4D.
- Minimal style: no cards, underline-only text fields, text-style toggle buttons, one primary blue button per screen. Hit targets of at least 32–44px.

## Suggested stack

React + TypeScript, Vite or Next.js, Tailwind, and Postgres (or SQLite for a single clinic) behind a small API with real-time events. Print with CSS `@page` for A4 and 80 mm receipts.

Build in this order: data model and auth → reception queue + real-time → prescription editor → billing → patient record → inventory → the rest.
