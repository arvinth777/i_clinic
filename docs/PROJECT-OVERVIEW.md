# i-clinic — What This Project Is, and How It Works

This is a plain-language walkthrough of the whole system: who it's for, what
it actually does today, and how the pieces fit together. It's written to be
read start to finish, not skimmed as a reference.

---

## 1. What this is, and why it exists

This is a purpose-built management system for a **two-person pain-relief and
palliative-care clinic** — one doctor, one receptionist, and a pharmacist who
works without ever touching a screen. It's being built for one real clinic in
Tamil Nadu, not as a generic multi-purpose "clinic software" product, and
almost every design decision in it follows from that: it exists to replace
one specific practice's paper process, not to serve every kind of clinic in
the abstract.

Today, that clinic runs entirely on paper, and the problem isn't the token
system — a physical token, first-come-first-served, works fine and isn't
being changed. The problem is that **nothing downstream of the token is
recorded anywhere**:

- Prescriptions are handwritten, so there's no record of what a patient was
  ever given, and reissuing "the same thing as last time" means the doctor
  either remembers or writes it out again from scratch.
- Medicine goes out to patients in paper covers with no stock tracking at
  all — nobody knows what's actually left on the shelf until someone
  physically counts it, by which point shortages or unexplained leakage have
  already happened.
- Most importantly: **there is no bill, for anything.** The doctor decides
  each patient's price case by case — full price, half price, free, whatever
  he judges the patient can afford that day — and that decision lives only
  in his head and whatever he happens to tell the receptionist verbally. She
  has no reliable way to know what to actually ask for at the desk, and
  there is no record afterward of what was charged, what was waived, or what
  was actually collected.

The system's job is to digitise the token queue, replace the handwritten
prescription, track stock as medicine actually leaves the shelf, and — for
the first time ever at this clinic — produce an actual, recorded bill for
every visit.

---

## 2. Who uses it

- **The doctor** — an anaesthetist practising pain relief and palliative
  care. He writes prescriptions, performs and prices procedures, and sets
  every patient's final payable amount, including any discount. His screen
  is the only one that decides money — this is a deliberate rule, not an
  accident (see §7).
- **The receptionist** — issues tokens, captures patient details, opens the
  bill and takes payment, and manages stock alongside the doctor. Her screen
  tells her exactly what to charge; she never has to interpret a price or
  ask the doctor what to collect.
- **The pharmacist** — works without a screen, full stop. Calls the next
  token number aloud, packs medicines into covers together with the doctor,
  carries them to reception, and explains dosage to the patient verbally.
  Nothing in this system requires the pharmacist to log in or click
  anything, ever.
- **Admin** — a configuration-only login: the drug list, procedure list and
  prices, suppliers, prescription templates, custom patient fields, and
  managing who else has a login. Deliberately **cannot see any patient's
  clinical record** — no complaints, no prescriptions, no visit history.
  It's a settings role, not a clinical one.
- **Pharma reps** — pharmaceutical company representatives who visit
  roughly 5–6 times a week hoping to meet the doctor. They're checked in
  like a patient would be, but always queue behind every actual patient,
  including ones who arrive after the rep did.

One real person can hold more than one of these roles at once — the doctor
at this clinic, for instance, also holds admin access, so he can both treat
patients and configure the system without a second login. Roles are held
per person, not baked into a single fixed identity, so this is just two rows
in a database rather than a special case anywhere in the code.

**Patients never log into anything.** They're the subject of the record, not
a user of the software.

---

## 3. The patient journey, start to finish

This is the single flow almost everything else in the system exists to
support:

1. **Patient arrives.** The receptionist issues the next token — strict
   first-come-first-served, regardless of whether the patient called ahead.
2. **Check-in.** She searches for the patient by name or phone before
   creating anything new (so the same person never ends up as two records).
   A match opens their existing history; no match opens a short form — name,
   age, gender, address/village, phone, presenting complaint, and (only when
   relevant) height/weight.
3. **The pharmacist calls the token number aloud**, and the patient goes in
   to see the doctor.
4. **The doctor's screen already has that patient's file open** — today's
   complaint, every past visit, every past prescription, every past
   procedure, and any comments the doctor left about this specific patient
   the last time they were in.
5. **The doctor consults**, writes the prescription, adds whatever
   procedures were performed during the visit, and sets the final amount
   payable for everything — full price, a discount, or free, entirely at
   his own judgement.
6. **The patient leaves the consulting room** and waits roughly ten minutes
   while their medicine is packed; the visit moves to a **Packing** stage,
   and the doctor immediately starts the next patient rather than waiting
   idle.
7. **The doctor and pharmacist pack the medicine** into covers during that
   window.
8. **The pharmacist carries the covers to reception** and explains the
   dosage to the patient directly, out loud.
9. **The receptionist opens the bill** — this is what actually moves the
   visit into **Ready at Reception** — sees exactly what to collect (and
   nothing she has to calculate or interpret herself), takes payment by
   cash, UPI, or pay-later/credit, and hands over a printed prescription and
   a printed receipt.
10. **Confirming that payment automatically deducts the dispensed medicines
    from stock**, in the same instant, with no separate "mark as dispensed"
    step for anyone to remember.
11. Everything downstream of that (refill reminders, follow-up reminders)
    is specified to go out automatically afterward — see §6 for what's
    actually wired up today versus what's still on paper as a plan.

Every screen in this flow is built to keep working through a real internet
outage, because a clinic doesn't get to pause treating patients while the
network is down — see §7.

---

## 4. The features, area by area

### Token queue & patient check-in
Digitises the existing first-come-first-served system rather than replacing
its logic. Token numbers climb continuously and never reset. The queue is
visible, in token order, on both the receptionist's screen and the doctor's
screen at the same time — this is the one piece of real-time sync that
matters most in the whole system, because the receptionist physically
cannot do her job until the doctor's decision reaches her screen.

### Pharma rep check-in
A rep is checked in with just a name and company, appears in the queue
clearly marked as a rep, and always sits behind every waiting patient —
including patients who arrive after the rep did. There's no medical record,
no prescription, and no bill attached to a rep; marking them done simply
removes them from the queue.

### The consultation screen (the doctor's view)
Built around one idea: everything the doctor needs to decide and record for
this visit lives on one screen, organised into clear sections rather than
dumped together — an overview of the patient and today's complaint, the
prescription, procedures and pricing, and documents/follow-up. A jump-nav
lets the doctor move between those sections without losing his place, and a
running clock quietly times how long the consultation has taken (for
reference later, not shown to the patient).

- **Patient comments, carried forward.** Separate from any single visit's
  clinical notes, this is a running note the doctor keeps on a patient
  across every future visit — things like "recognises him by his son," or
  "always charge half." It's shown at the top of that patient's record
  every time they come back, and comments stack chronologically with dates
  rather than overwriting each other.
- **Prescription writing**, built to take under a minute per patient. Three
  ways in: search the drug list directly, quick-add from a saved template,
  or quick-add from the patient's own *usual combo* — the system looks at
  their last several prescriptions and, only once a real pattern exists
  (never from a single visit), suggests the combination of drugs that
  actually recurs, rather than blindly reissuing whatever they got last
  time. Per drug: type, strength, before/after food, dosage frequency
  (common presets like 1-0-1 or 1-1-1), duration in days, and an optional
  note. Any combination can be saved back as a new template for next time. A
  review screen shows the whole finished prescription before the doctor
  confirms it.
- **Procedures.** The doctor keeps his own procedure list with a default
  price on each one (common price points like ₹2500, ₹2000, ₹1500), and
  that default can be overridden for an individual patient. Procedures
  performed during the visit are added right from the consultation screen
  and flow straight onto the bill.
- **Pricing and discounts — the part that didn't exist on paper at all.**
  Consultation is a flat ₹250 charged on every visit. The bill is
  consultation + procedures performed + medicines dispensed. The doctor
  alone sets the *final payable amount* — the difference between that and
  the calculated total is recorded automatically as the discount given, with
  no justification required and no extra step: he just sets one number.
  Discounts are totalled over time so the doctor can actually see how much
  subsidised care he's provided.
- **Follow-up and long-term care.** The doctor can set a follow-up date for
  a visit, and separately flag a patient as long-term with a review
  interval. Long-term, chronic-care patients are the ones this clinic can
  least afford to lose track of, so a dedicated register (below) exists
  just for them.
- **Documents.** Medical certificates, sick-leave notes, and referral
  letters, each capturing just what that document needs (purpose; rest
  period and reason; who the patient is being referred to and why), printed
  with the doctor's name and registration number in a signature line. These
  are meant to be printed onto the clinic's own real letterhead stationery,
  so the app deliberately leaves the very top of the page blank rather than
  printing a competing header — the pre-printed paper already has ours.

### Billing and payment (the receptionist's view)
Opens automatically once the doctor and pharmacist finish packing. Shows
the itemised breakdown and, most prominently, the exact final amount to
collect — never anything she has to calculate herself. Payment methods:
cash, UPI (shown on screen as a scannable QR code straight to the clinic's
own UPI ID), or pay-later/credit for patients settling later. Confirming
payment is final — a paid bill is never edited afterward; any correction
writes a brand-new bill that references the original rather than changing
it in place, so the historical record is never rewritten.

Confirming payment prints two separate physical documents in the same
action, not one document trying to be both:

- **The prescription** — printed as an actual letterhead document: the
  clinic's name and, when the doctor has filled them in under Admin
  settings, his own name, registration number, clinic address and phone,
  framed with a coloured header/footer bar. This is the doctor's document —
  drug names and dosage only, nothing about money on it.
- **The receipt** — a plain, businesslike payment record: itemised amounts,
  discount, what was actually paid and how. Deliberately has no doctor
  credentials on it — a receipt is a transaction record issued by the
  clinic, not a medical document issued by the doctor.

Both come out of one click at the point of payment, so the patient still
walks away with both in hand together — they're just two properly distinct
pieces of paper instead of one page that reads like it can't decide what it
is.

### Stock management
Deliberately kept simple, on purpose, because nobody is standing at a
screen while medicines are actually being packed:

- Stock deducts automatically the moment a bill is confirmed — there is no
  separate "mark as dispensed" step for a human to remember or skip.
- **Multiple stock points** are supported (a dispensing counter and a
  storeroom today, with room for more later). Billing always deducts from
  the counter; moving stock between points is its own explicit transfer
  entry.
- **Monthly physical count.** Someone enters what they actually counted per
  medicine, and the system shows expected vs. counted vs. the gap directly
  — so leakage or unbilled dispensing becomes visible instead of quietly
  piling up unnoticed.
- **Manual adjustment** is always available for the edge cases that don't
  fit anywhere else — damaged stock, samples handed out, corrections — each
  with a short required reason.
- **Low-stock alerts** fire once a medicine drops below a threshold the
  clinic sets for it.
- Both the doctor and the receptionist can see and manage stock; this
  isn't gated to one role, since either of them might be the one restocking
  or noticing a shortage.

### Purchases and suppliers
Recording a purchase — supplier, date, invoice number, which drugs arrived
with what quantity and cost price, and which stock point they went into —
adds that quantity to that stock point immediately. Each supplier keeps its
own running record of name, phone, and full purchase history, so "what have
we bought from this supplier, and when" is always a click away rather than
a search through old invoices.

### Long-term patient register
Pain and palliative-care patients come back for months or years, so losing
track of one of them is the single failure this clinic can least afford.
Once the doctor flags a patient as long-term and sets a review interval, a
dedicated register lists every such patient with their last visit and next
review due date, sorted with the most overdue patients first — visible to
both the doctor and the receptionist, so either of them can be the one who
picks up the phone and calls someone who's overdue.

### Needs reconciliation
Handles a specific, real edge case of working offline: a bill gets
confirmed while a device is offline, against whatever price was on screen
at that moment — but if the doctor changed that patient's pricing before
the device came back online and synced, the bill that actually landed no
longer matches what should have been charged. Rather than silently letting
that slide, or silently overwriting the original paid bill (which non-
negotiable #3, below, forbids outright), the mismatch is flagged here so the
doctor can explicitly write a correction — a new bill, referencing the
original, at today's actual price. The original bill is never touched.

### Reports
- **Daily summary** — collections, patient count, discounts given that day,
  and stock warnings, meant to be checked at day's end.
- **Monthly trends** — collections, patient volume, and total subsidised
  care given, tracked month over month.
- **GST/tax report** — a tax-ready collections summary the clinic's
  accountant can actually use, exportable as CSV.

### Admin
The configuration surface: the drug list (with default price, type, and
low-stock threshold per drug), the procedure list and its default prices,
prescription templates, custom patient fields the clinic wants to track
that aren't part of the base form, and clinic settings (the doctor's name
and registration number, clinic address and phone for the printed
letterhead, the UPI ID shown at billing, and the flat consultation fee).

Admin is also where logins themselves are managed: creating a brand-new
login for a new staff member, and — the newest piece of this — **granting
an existing login an additional role**. That's what lets the doctor's own
account also hold admin access without needing a second, separate identity:
pick the existing login, pick a role it doesn't already have, confirm. A
role can also be individually revoked from someone without touching any
other role they hold at the clinic.

---

## 5. What's specified for later, but not built yet

The product plan for this clinic goes further than what's running today,
and it's worth being explicit about the difference so nothing here reads as
a claim about capability that doesn't exist yet:

- **WhatsApp messaging** — sending the prescription and receipt as a PDF
  over WhatsApp, automated refill and follow-up reminders, and letting a
  patient pre-register by messaging the clinic ahead of arriving. This is
  fully specified (direct Meta Cloud API, no reseller, pre-approved message
  templates only, pre-registration never grants queue priority) but not yet
  built. Every patient already gets a printed prescription and receipt
  regardless, so nothing about today's actual visit depends on this landing
  — it's the automatic follow-up-afterward layer that's still to come.
- **Bilingual (Tamil) prescription printing** — deliberately cut from this
  first version. The prescription prints in English only; the pharmacist
  already explains dosage verbally, which covers patients who wouldn't be
  able to read an English printout anyway.
- **A second clinic** — nothing in the underlying data model assumes there
  will only ever be one clinic (clinics, doctors, and stock points are all
  just records, not hard-coded assumptions), but today exactly one clinic
  actually exists and is configured.

---

## 6. How it's actually built (for anyone curious under the hood)

- **React + TypeScript on Vite**, talking to **Supabase** for the database
  (Postgres), authentication, realtime updates, and row-level security. Data
  fetching and caching go through **React Query**.
- **Multi-tenant from day one**, even though only one clinic exists so far:
  every table is scoped by clinic, and Postgres's own row-level security
  (RLS) — not application code — is what actually enforces that a login can
  only ever see its own clinic's data, and only the data its role permits
  (a receptionist can't read clinical notes; admin can't read any patient
  record at all).
- **Realtime, but not trusted blindly.** When the doctor sets a price, the
  receptionist's screen updates instantly — but a realtime event only ever
  tells the app "something changed, go re-fetch," never hands over the new
  data directly. Sockets drop when a laptop sleeps or wifi flickers, and a
  patched-in-place value from a dropped socket is a silent, hard-to-catch
  bug; a plain refetch always converges back to what's actually true.
- **Offline is a first-class concern, not an afterthought.** Every write a
  receptionist or doctor makes queues durably (in IndexedDB, not the much
  more fragile localStorage) and survives a refresh or even a crash, with
  an explicit "not saved yet" indicator rather than pretending the save
  already succeeded. Printing works from whatever's already on screen, with
  zero server round-trip, specifically so a patient never leaves without
  their dosage instructions during exactly the kind of power or internet
  outage this whole design exists to survive.
- **Money is never a float.** Every rupee amount is stored as an integer
  number of paise, end to end, because floating-point currency math is a
  well-known way to silently lose or gain fractions of a rupee at scale.
- **A paid bill is never edited in place.** Any correction is a new row
  that references the original — the original stays exactly as it was
  confirmed, permanently.
- **Stock deduction and bill confirmation happen as one atomic, idempotent
  operation** — a double-clicked "confirm" can never deduct the same
  medicine twice.

---

## 7. The rules that don't get relitigated

A handful of decisions in this project are treated as settled, specifically
because each one has an alternative that looks reasonable on the surface but
is actually wrong for this clinic:

1. Money is always an integer (paise), never a float.
2. The doctor alone sets the final payable amount; the receptionist's
   screen is read-only for price.
3. A paid bill is immutable — corrections are new rows, never in-place
   edits.
4. Stock deduction and bill confirmation are one atomic, idempotent
   transaction.
5. Row-level security is on for every table, from the very first migration
   — this system is reachable from outside the clinic's own walls.
6. A realtime event triggers a refetch; it never patches state directly.
7. The prescription must be printable with zero connectivity.
8. Every write queues durably in IndexedDB and survives a refresh, with an
   explicit "not saved yet" state shown to whoever made it.

Everything else in the system is negotiable and has changed shape multiple
times already as the clinic's actual needs became clearer. These eight
haven't, and aren't expected to.
