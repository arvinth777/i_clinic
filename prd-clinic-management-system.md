# Clinic Management System — v0 Plan

## Objective
A web app for a two-person pain-relief and palliative-care clinic (one doctor, one receptionist, plus a pharmacist who works without a screen). It digitises the token queue, replaces handwritten prescriptions, and — for the first time — produces an actual bill, so the receptionist knows exactly what to collect after the doctor has decided what that particular patient should pay.

## The Problem
The clinic runs on paper. A physical token is issued at reception, first come first serve, and that part works — but nothing downstream is recorded. Prescriptions are handwritten. Medicine goes out in covers with no stock tracking, so nobody knows what's actually on the shelf until someone counts it. Most importantly, **there is no bill at all today** — not for the consultation, not for procedures. The doctor decides each patient's price case by case (full price, half, or free, depending on what the patient can afford), and that decision currently lives only in his head and whatever he tells the receptionist. She has no reliable way to know what to ask for, and there's no record afterward of what was charged, waived, or collected.

## Who Uses This
- **Doctor** — an anaesthetist practising pain relief and palliative care. Writes prescriptions, performs and prices procedures, and sets each patient's final amount including any discount. His screen is the one that decides money.
- **Receptionist** — issues tokens, captures patient details, opens the bill and collects payment, and manages stock alongside the doctor. Her screen tells her what to charge.
- **Pharmacist** — works without a screen. Calls the next token number aloud, packs medicines into covers with the doctor, carries them to reception, and explains to the patient when to take what and why. Nothing in the system requires them to log in or click anything.
- **Admin** — configuration login (procedures and prices, drug list, suppliers, prescription templates, custom patient fields, logins).
- **Pharma reps** — around 5–6 visit weekly and wait to meet the doctor. The receptionist checks them in as a rep; they sit in the queue but always behind every waiting patient.

Patients never log into anything.

## High Level Flow
1. Patient arrives. Receptionist issues the next token — first come, first serve, regardless of whether they called ahead.
2. Receptionist captures or looks up the patient's details (and height/weight when relevant).
3. Pharmacist calls the next token number aloud; the patient goes in.
4. Doctor's screen already has that patient open: history, past prescriptions, and his own carried-forward comments about them.
5. Doctor consults, writes the prescription, adds any procedures performed, and sets the final amount — full price, discounted, or free.
6. Patient leaves the room and waits ~10 minutes. The visit moves to **Packing**, and the doctor starts the next patient immediately.
7. Doctor and pharmacist pack the medicines into covers during that window.
8. Pharmacist brings the covers to reception and explains the dosage to the patient.
9. Receptionist opens the bill — which moves the visit to **Ready at Reception** — sees exactly what to collect, takes payment (cash, UPI, or pay later), and hands over the printed prescription and receipt.
10. Billing automatically deducts the dispensed medicines from stock.
11. Reminders (refill, follow-up) go out afterwards on WhatsApp, without anyone doing anything.

---

## Features

### Token Queue
Digitises the existing first-come-first-serve token system rather than replacing it.

- Receptionist issues the next token number at check-in. Numbers climb continuously and never reset.
- Calling ahead doesn't earn a better position — arrival order is the only ordering rule, matching how it already works.
- The queue is visible on both the receptionist's and the doctor's screens, in token order.
- The pharmacist needs no screen: they call numbers in sequence.

### Patient Check-In
- Receptionist searches by phone number or name before creating anything new.
- A match opens the existing patient; no match opens a blank form: Name, Age, Gender, Address/Village, Phone, Complaint.
- Height and weight are optional fields, filled in when relevant rather than every visit.
- Submitting creates the visit in "Waiting" status and assigns the token.

### Pharma Rep Check-In
- Checked in with Name and Company only.
- Appears in the queue marked as a rep, always after every waiting patient — including patients who arrive later.
- No medical record, no prescription, no bill. Marking them done removes them from the queue.

### Doctor's Consultation Screen
- The queue on one side; the current patient's full record on the other.
- Opening a patient shows: today's complaint, past visits, past prescriptions, past procedures, and **carried-forward comments**.
- Everything the doctor needs to decide and record — prescription, procedures, price, discount, follow-up, comments — is on this one screen.

### Patient Comments (carried forward)
A running note on the patient's file, separate from any single visit's clinical notes.

- The doctor writes a short comment he'll want next time ("recognises him by his son", "very anxious about needles", "always charge half").
- It appears at the top of that patient's record on every future visit.
- Comments are editable and stack chronologically with dates.

### Prescription Writing
Built to take under a minute.

- Three ways in: pick a saved template, reissue this patient's last prescription in one click, or search the drug list.
- A drug not yet in the list can be added on the spot.
- Per drug: Type, Strength, Before/After food, Dosage frequency (presets like 1-0-1, 1-1-1, 0-0-1, 1-0-0, SOS), Duration in days, optional note.
- Any combination can be saved as a template.
- A review screen shows the finished prescription before the doctor confirms.

### Bilingual Prescription Printing
**Cut from v0 — English only.** The prescription prints in English; the pharmacist already explains dosage verbally at reception, which covers the patients who can't read it. Tamil dosage instructions remain a worthwhile later addition (the phrases are a fixed set and translate once), but they're not blocking launch.

### Procedures
Central to this practice, not incidental.

- The doctor maintains his own procedure list, adding new ones whenever he wants.
- Each procedure has a default price he sets (common price points being 2500, 2000, 1500, 1000, 750), and that price can be overridden on any individual patient.
- Procedures performed are added to the visit from the consultation screen and flow straight onto the bill.

### Pricing and Discounts
The heart of the system, because this is the part that doesn't exist on paper today.

- Consultation is a flat ₹250, charged every visit.
- Bill = ₹250 consultation + procedures performed + medicines dispensed.
- The doctor sets the **final amount payable** on the consultation screen — full price, any reduced amount, or zero.
- The difference between the calculated total and the final amount is recorded as the discount given. No justification is required and no extra typing is involved: he sets one number.
- The receptionist's screen shows only the final amount to collect. She never has to interpret or ask.
- Discounts are totalled monthly, so the doctor can see how much subsidised care he's actually provided.

### Billing and Payment
- Receptionist opens the bill when the patient arrives at the desk with their medicines — this automatically moves the visit to "Ready at Reception."
- The bill shows the itemised breakdown and, prominently, the final amount to collect.
- Payment method: Cash, UPI (QR code shown on screen), or Pay Later/Credit.
- Confirming payment closes the visit, prints the receipt with the prescription, and deducts the dispensed medicines from stock.

### Stock Management
Deliberately simple, because nobody is standing at a screen while medicines are packed.

- Stock deducts automatically when a bill is confirmed — there is no separate "mark dispensed" step for anyone to do.
- **Multiple stock points** are supported (dispensing counter and storeroom today, more later). Billing deducts from the counter; stock is moved between points with a transfer entry.
- **Monthly physical count**: someone enters the real counted quantity per medicine. The system shows expected vs counted vs the gap, so leakage or unbilled dispensing becomes visible instead of silently accumulating.
- **Manual adjustment** is always available for edge cases — damaged stock, samples, corrections — with a short reason.
- Low-stock alerts fire when a medicine drops below its threshold.
- Both the doctor and the receptionist can see and manage stock.

### Purchases and Suppliers
- Record a purchase: supplier, date, invoice number, drugs received with quantity and cost price, and which stock point it goes into.
- Recording a purchase adds that quantity to that stock point.
- Each supplier keeps a record with name, phone, and purchase history.

### Clinic Documents
Printed on clinic letterhead from the consultation screen, alongside the prescription.

- **Medical/fitness certificate** — patient name, age, purpose, doctor's name and registration number, date.
- **Sick leave note** — patient name, rest period from/to, reason, doctor's details, date.
- **Referral letter** — patient name, referred to, reason, brief case summary carried from the visit, doctor's details, date.

### WhatsApp Messaging
The WhatsApp Business API — accessed directly through Meta's Cloud API, no BSP — carries everything the patient receives after they leave. **There is no SMS in v0.** A printed copy is handed to every patient at reception regardless of channel, so print, not SMS, is the universal path; WhatsApp is the addition on top for the majority who have it.

Patients without WhatsApp therefore receive the printed prescription and receipt but no automated reminders. They get the same treatment as a patient with no phone at all: the doctor or receptionist tells them verbally before they leave, and the system surfaces the reminder to reception as a to-do on the due date. Adding SMS would mean a second gateway, a second integration, and separate DLT registration with TRAI, to serve a minority who already walk out holding paper — revisit in v1 with real data on how many patients actually lack WhatsApp.

- **Prescription** — sent as a **PDF attachment**, not a link. It stays on the patient's phone, opens without data, survives a phone change, and can be shown to another doctor or a family member without a live URL.
- **Payment receipt** — sent as a PDF the same way, on payment confirmation.
- **Refill reminders** — two per prescription, calculated from the course duration: one 2 days before it ends, one on the last day.
- **Follow-up reminder** — one, 1 day before the date the doctor set.
- **No clinical detail in the message body.** Message text appears in lock-screen notifications; anything clinical goes inside the attached PDF.

Every one of these is a **pre-approved template message**, because patients rarely message the clinic first and template approval is required outside a 24-hour window since their last inbound message. Templates needed: prescription delivery, payment receipt, refill reminder, follow-up reminder, pre-registration acknowledgement. Body text is fixed with variable slots only; changing wording later requires re-approval.

### WhatsApp Pre-Registration
Patients can message the clinic's WhatsApp ahead of arriving. This is **pre-registration, not booking** — no time is offered, promised, or implied.

- The patient sends their name and complaint; the system creates a **pending patient record**.
- Pending records appear on the receptionist's screen, so when that patient walks in she finds them already entered rather than typing from scratch.
- **The token is still issued on physical arrival, in strict arrival order.** Pre-registering confers no queue priority whatsoever — the clinic runs first-come-first-serve and this does not change that.
- An existing patient who pre-registers is matched to their existing record by phone number rather than creating a duplicate.
- A pending record that never arrives expires at end of day.
- Side benefit: an inbound patient message opens a 24-hour service window, so messages sent to that patient later the same day cost less than a template send.

This requires **inbound message handling** — a webhook receiving patient messages and replying — which is a meaningfully different integration from outbound-only sending. See AGENTS.md for the BSP implication.

### Long-Term Patient Register
Pain and palliative patients come back for months or years, so losing track of them is the failure that matters most.

- Doctor flags a patient as long-term and sets a review interval.
- A register lists every such patient with last visit and next review due, sorted most overdue first.
- Both the doctor and receptionist can see it, so anyone can call an overdue patient.

### Reports
- **Daily summary** — collections, patient count, discounts given, stock warnings. Delivered automatically at day's end.
- **Monthly trends** — collections, patient volume, and total subsidised care, month over month.
- **GST/tax report** — a tax-ready collections summary, exportable for the accountant.

### Access and Sync
- Changes appear on the other screen instantly — when the doctor sets the final amount, the receptionist sees it without refreshing. This is the single most important technical requirement in the whole system, because the receptionist physically cannot do her job until that number reaches her.
- Reachable from outside the clinic, so the doctor can check records or the day's numbers from home.
- If the connection drops, each screen keeps working locally — queue, prescriptions, printing, billing — and syncs the moment it's back. Nothing blocks mid-visit.

### Built to Add More Clinics Later
v0 runs one clinic with one doctor. Nothing in the data model assumes that's permanent: clinics, doctors, and stock points are all records, not hard-coded assumptions, so a second clinic can be added later without a rebuild.

---

## Screens

### Reception (receptionist's main screen)
**Purpose:** Issue tokens, capture patients, and see the live queue.

**What the user sees:**
- The live queue in token order, each row showing token number, patient name, and current stage (Waiting / With Doctor / Packing / Ready at Reception).
- A search bar (phone or name).
- Buttons: "New patient", "Check in pharma rep".

**What the user can do:**
- Search for a patient; click a result to open them.
- Create a new patient and issue a token.
- Check in a pharma rep.
- Click a patient at "Packing" to open their bill (which moves them to "Ready at Reception").

**Empty state:** "No patients yet today."
**Error state:** "Something went wrong — try again," with entered data preserved.

### Doctor's Consultation
**Purpose:** Everything the doctor does, on one screen.

**What the user sees:**
- The queue in token order, with waiting reps listed below all patients.
- The open patient's record: carried-forward comments at the top, then today's complaint, height/weight if recorded, past visits, past prescriptions, past procedures.
- The prescription area, procedure selector, and the pricing block (calculated total and an editable final amount).

**What the user can do:**
- Open the next patient (or a rep, to mark that meeting done).
- Write a prescription, reissue the last one, or apply a template.
- Add procedures performed, overriding the price if needed.
- Set the final amount payable — including zero.
- Add a comment to the patient's file.
- Set a follow-up date; flag the patient as long-term with a review interval.
- Issue a certificate, sick leave note, or referral letter.
- Finish the consultation, which moves the visit to "Packing" and clears his screen for the next patient.

**Empty state:** "Your queue is empty."
**Error state:** "Couldn't save — try again," with every field left as-is.

### Billing
**Purpose:** Show the receptionist what to collect, and take payment.

**What the user sees:**
- The patient's name and token at the top.
- The itemised breakdown: consultation ₹250, each procedure, each medicine with quantity and price.
- The calculated total, the discount applied, and — largest on the screen — the **final amount to collect**.
- Payment method options: Cash, UPI, Pay Later/Credit.
- A UPI QR code, shown only when UPI is selected.

**What the user can do:**
- Select a payment method and confirm payment (closes the visit, prints prescription and receipt, deducts stock).
- Mark as Pay Later/Credit.

**Empty state:** Not applicable — opens only for a visit that has finished consultation.
**Error state:** "Couldn't print — try again," without blocking the visit from closing.

### Stock
**Purpose:** Keep stock honest with minimal daily effort. Visible to both doctor and receptionist.

**What the user sees:**
- Every medicine with its quantity per stock point (counter, storeroom), and low-stock rows visibly flagged.
- Buttons: "Record purchase", "Transfer between stock points", "Monthly count", "Manual adjustment".

**What the user can do:**
- Record a purchase (adds stock).
- Transfer quantity from one stock point to another.
- Run a monthly count: enter counted quantities and see expected vs counted vs gap per medicine.
- Make a manual adjustment with a short reason.

**Empty state:** "No medicines added yet — add your first medicine to get started."
**Error state:** "Couldn't update stock — try again," without double-applying on retry.

### Long-Term Patient Register
**Purpose:** See which long-term patients are due or overdue.

**What the user sees:** Name, condition flag, last visit date, next review due — sorted most overdue first, overdue rows marked.
**What the user can do:** Open a patient's record; filter by overdue only.
**Empty state:** "No long-term patients flagged yet."
**Error state:** "Couldn't load the register — try again."

### Reports
**Purpose:** Daily, monthly, and tax views.

**What the user sees:** Daily (collections, patients, discounts given, stock warnings), Monthly (collections, patient volume, subsidised care), GST/tax (tax-ready summary with export).
**What the user can do:** Switch views; export the tax summary.
**Empty state:** Shows real numbers even when zero.
**Error state:** "Couldn't load report — try again."

### Admin / Settings
**Purpose:** Everything configurable without a developer.

**What the user sees:**
- Procedure list with default prices.
- Drug list (name, type, strength options, price, low-stock threshold, expiry date).
- Suppliers and stock points.
- Prescription templates.
- Custom patient fields (e.g. pain score) — added, renamed, or removed.
- Consultation fee amount.
- WhatsApp opt-in QR code.
- Logins (doctor, receptionist, admin).

**What the user can do:** Add, edit, or remove any of the above; merge two duplicate patient records.
**Empty state:** New setup shows empty lists with "Add your first…" prompts.
**Error state:** "Couldn't save changes — try again."

---

## Forms

### New Patient (Reception)

| Field | Type | Required | Notes / Validation |
|-------|------|----------|--------------------|
| Name | Text | Yes | — |
| Age | Number | Yes | — |
| Gender | Dropdown | Yes | Male, Female, Other |
| Address / Village | Text | No | — |
| Phone number | Text | No | If entered, must be 10 digits |
| Complaint | Text | Yes | Reason for today's visit |
| Height | Number | No | cm — filled only when relevant |
| Weight | Number | No | kg — filled only when relevant |
| [Custom fields] | As configured | No | Any fields added in Admin appear here |

**On submit:** Creates (or reuses) the patient record, creates a visit with status "Waiting," assigns the next token number.
**Validation errors:** Inline red text under each missing required field. Form does not submit.

### Pharma Rep Check-In

| Field | Type | Required | Notes / Validation |
|-------|------|----------|--------------------|
| Rep name | Text | Yes | — |
| Company | Text | Yes | — |

**On submit:** Adds the rep to the queue, marked "Pharma rep," positioned after every waiting patient.

### Prescription (Doctor)

| Field | Type | Required | Notes / Validation |
|-------|------|----------|--------------------|
| Template / Repeat last / Drug | Search/select | Yes (at least one drug) | Template, one-click repeat, drug search, or add new drug |
| Drug type | Dropdown | Yes, per drug | Tablet, Syrup, Capsule, Powder, Injection, Other |
| Strength | Dropdown/Text | Yes, per drug | Options depend on the drug |
| Before/After food | Dropdown | Yes, per drug | Before food, After food, Either |
| Dosage frequency | Dropdown | Yes, per drug | 1-0-1, 1-1-1, 0-0-1, 1-0-0, SOS, Other |
| Duration | Number | Yes, per drug | Days — also drives the refill reminders |
| Notes | Textarea | No | Free text, per drug |

**On submit:** Review screen, then confirm. Finalises the prescription and schedules the two refill reminders.
**Validation errors:** "Add at least one medicine before saving"; inline errors on missing per-drug fields.

### Visit Pricing (Doctor)

| Field | Type | Required | Notes / Validation |
|-------|------|----------|--------------------|
| Consultation | Auto | — | Always ₹250, not editable per visit (changed in Admin only) |
| Procedures | Multi-select + price | No | Each pulls its default price; price editable for this visit |
| Medicines | Auto | — | Pulled from the prescription at their listed prices |
| Calculated total | Auto | — | Consultation + procedures + medicines |
| Final amount payable | Number | Yes | Defaults to the calculated total; the doctor can set any lower amount, including 0 |

**On submit:** The final amount is what reaches the receptionist's billing screen. The gap between calculated total and final amount is recorded as the discount.
**Validation errors:** "Final amount can't be more than the calculated total" if a higher figure is entered.

### Monthly Stock Count

| Field | Type | Required | Notes / Validation |
|-------|------|----------|--------------------|
| Stock point | Dropdown | Yes | Counter, Storeroom |
| Counted quantity | Number | Yes, per medicine | Entered per medicine in the list |

**On submit:** Shows expected vs counted vs gap per medicine, then sets stock to the counted figure on confirmation. The gap is saved so it can be reviewed later.

### Record Purchase

| Field | Type | Required | Notes / Validation |
|-------|------|----------|--------------------|
| Supplier | Dropdown | Yes | New suppliers can be added inline |
| Invoice number | Text | Yes | — |
| Date | Date | Yes | Defaults to today |
| Stock point | Dropdown | Yes | Where the stock is going |
| Drugs received | Repeating rows | Yes (at least one) | Drug, quantity, cost price per unit |

**On submit:** Adds each quantity to the chosen stock point and saves the purchase against the supplier.

### New Procedure (Admin or Doctor)

| Field | Type | Required | Notes / Validation |
|-------|------|----------|--------------------|
| Procedure name | Text | Yes | — |
| Default price | Number | Yes | Typically 2500 / 2000 / 1500 / 1000 / 750, but any amount is allowed |

**On submit:** Available immediately on the consultation screen.

---

## Logic and Rules

**Visit Stages**
- "Waiting" when the token is issued.
- "With Doctor" when the doctor opens that patient.
- "Packing" automatically when the doctor finishes the consultation — this frees his screen for the next patient while medicines are packed.
- "Ready at Reception" automatically when the receptionist opens that patient's bill.
- "Paid" when payment is confirmed. The visit is then closed.
- Only the doctor can reopen a closed visit. The receptionist cannot, and neither can the admin-only account — the doctor holds `{doctor, admin}` and a locum holds `role = doctor`, so nothing is lost by excluding admin.

**Queue Order**
- Strict first-come-first-serve by token number. Calling ahead confers no priority.
- Pharma reps always sit behind every waiting patient, including later arrivals.
- Token numbers never reset.

**Pricing**
- Calculated total = ₹250 + sum of procedure prices for this visit + sum of medicine prices from the prescription.
- Final amount payable = whatever the doctor sets, from the calculated total down to 0.
- Discount recorded = calculated total − final amount payable.
- The receptionist's billing screen shows the final amount only; she cannot change it.

**Stock**
- Confirming a bill deducts each medicine on it from the counter stock point.
- If the patient bought medicine outside, the doctor removes those medicines from the visit before finishing; nothing is deducted and nothing is billed for them.
- If a deduction would take stock below zero, it still applies (never blocks a live patient) and the item is flagged into that day's stock warnings.
- Purchases add stock to a chosen stock point; transfers move it between points.
- The monthly count sets stock to the counted figure and records the gap.
- Manual adjustments require a short reason.

**Delivery Channel**
- Every patient → print the prescription and receipt at reception. This always happens, for everyone.
- Patient has WhatsApp → additionally send the combined PDF via Meta's Cloud API, and schedule their reminders.
- No WhatsApp, or no phone number at all → print only. No reminders are scheduled; the follow-up surfaces to reception as a to-do instead, and staff tell the patient verbally before they leave. Nothing blocks.

**Reminder Scheduling**
- Prescription with duration N days → refill reminders on day N−2 and day N.
- Follow-up date set → reminder 1 day before.
- Reminders queued while offline send once the connection returns.

**Long-Term Register**
- Patient flagged long-term with interval N days → next review = last visit + N days.
- A new visit resets the next review date automatically.
- Sorted most overdue first.

**Sync**
- Any change on one screen appears on the other immediately, without a refresh — specifically the doctor's final amount reaching the receptionist's billing screen.
- When offline, each screen works from local data and syncs on reconnect. Last write wins on conflict.

---

## Edge Cases

| Situation | What the app does |
|-----------|-------------------|
| Form submitted with a required field missing | Inline error under the empty field. Form does not submit. |
| Patient search returns no results | "No matching patient found" with a button to create a new patient. |
| Internet drops mid-consultation | Each screen keeps working locally (queue, prescription, printing, billing) and syncs on reconnect. Queued reminders send then too. |
| Doctor sets the final amount while the receptionist has the bill open | The receptionist's screen updates in place, showing the new amount. |
| Receptionist opens a bill before the doctor has set the final amount | Bill shows "Waiting for the doctor to confirm the amount" instead of a payable figure. Payment cannot be taken yet. |
| Doctor sets the final amount to 0 | Bill shows ₹0; the receptionist confirms it as paid without collecting anything; the full amount is recorded as a discount. |
| Stock would go below zero on billing | Deduction applies anyway; item is flagged into that day's stock warnings. |
| Monthly count shows a large gap | The gap is shown and saved for review; stock is set to the counted figure. |
| Pharma rep checked in while patients are waiting | Rep placed behind all waiting patients; later-arriving patients still go ahead of them. |
| Two screens edit the same visit at once | Last write wins. |
| Patient has no WhatsApp, or no phone at all | WhatsApp send skipped, printed copy still produced, no reminders scheduled, follow-up surfaces to reception as a to-do, nothing blocked. |
| App opened on a mobile browser | Single-column layout; all actions still available. |

---

## Admin and Settings
Covered under **Screens → Admin / Settings**: procedures and prices, drug list, suppliers and stock points, prescription templates, custom patient fields, consultation fee, WhatsApp opt-in QR code, logins, and duplicate-record merge.

---

## FAQs

**How does the receptionist know what to charge?**
The doctor sets the final amount on his screen during or right after the consultation. It appears on her billing screen instantly. She never has to ask or guess — which is the single biggest change from how the clinic runs today.

**What if the doctor wants to see the patient for free?**
He sets the final amount to 0. The bill shows ₹0, the receptionist confirms it without collecting, and the full waived amount is recorded so the monthly discount total stays accurate.

**Who marks medicines as dispensed?**
Nobody. Stock deducts automatically when the bill is confirmed, because the pharmacist is packing covers by hand and has no screen. The monthly physical count is what keeps the numbers honest.

**What if the physical count doesn't match the system?**
The count screen shows expected, counted, and the gap for every medicine. Stock is set to the counted figure and the gap is saved, so a pattern of leakage or unbilled dispensing becomes visible over a few months.

**What if the internet goes down mid-clinic?**
Each screen keeps working on its own data — queue, prescriptions, printing, billing — and syncs the moment the connection returns.

**What if a pharma rep arrives before a patient?**
They still wait until every patient in the queue has been seen, including patients who arrive after them.

**Can the doctor check the day's numbers from home?**
Yes. The system is reachable from outside the clinic, not just on the clinic's network.

---

## What v0 Does NOT Include
- **Vaccination tracking and immunisation reminders** — cut deliberately: this is a pain-relief and palliative practice, not a paediatric one, so vaccination schedules don't fit the patients this clinic actually sees. Easy to add later if that changes.
- **A screen or login for the pharmacist** — they work by hand and by voice; giving them a screen would add a step to a flow that currently works.
- **A second doctor's queue** — v0 is one doctor's clinic. The data model supports more doctors and more clinics being added, but building and testing for one is what gets this live fastest.
- **Online/self-service appointment booking** — patients walk in; tokens are issued at reception, first come first serve. That already works and doesn't need software.
- **Ambient AI scribing** — the template/dropdown prescription screen is already under a minute without it.
- **ABDM/ABHA government health-record integration** — a real future direction, but it adds compliance work that isn't the immediate problem.
- **Lab test orders and results** — not part of how the clinic runs today.
- **Batch-level medicine expiry tracking** — one stock quantity and one expiry per medicine per stock point, not multiple batches of the same drug with different expiry dates.
- **Digitising the existing paper archive** — history builds from day one.
- **A patient-facing portal or app** — every patient touch stays token, print, or WhatsApp.
- **SMS as a fallback channel** — cut in v0: it needs a second gateway, a second integration, and its own DLT registration with TRAI, to reach a minority of patients who already leave holding a printed copy. Revisit in v1 with real data on WhatsApp coverage.

---

## How You'll Know It's Working
- The receptionist stops asking the doctor what to charge — the number is already on her screen when the patient reaches the desk.
- At month end, the doctor can see exactly how much care he gave away, which he currently has no way to know.
- A prescription takes under a minute to write and print, not longer than handwriting it.
- The monthly stock count gap shrinks over the first few months, because billing is capturing what actually goes out.
- Long-term pain and palliative patients stop quietly disappearing — the register surfaces them before anyone notices they've been missing.

---

## Suggested Build Order
Each phase is independently useful the day it ships:

1. **The money loop** — token queue, patient check-in, consultation screen, prescription writing (English), procedures, final-amount-and-discount, billing, payment, printed receipt. This is what the clinic doesn't have at all today, and it works end to end on its own.
2. **Stock** — automatic deduction at billing, stock points, purchases and suppliers, monthly count with variance, low-stock alerts.
3. **The long tail** — WhatsApp delivery, refill and follow-up reminders, long-term register, documents (certificates, sick leave, referrals), monthly and GST reports, custom fields.

Two things can't be phased and must be built in from the start: **instant sync between the doctor's and receptionist's screens** (the core of phase 1 — the receptionist literally cannot work without it) and **offline-capable local behaviour** (retrofitting local-first onto a cloud-only app later is significantly harder than building it in).
