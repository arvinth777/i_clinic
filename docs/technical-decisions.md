# Technical decisions

## Reception brand billing and prescription issue date — staging revision, 2026-10-17

On `codex/prescription-print-workflow`, the doctor saves a molecule, strength,
dose and duration without selecting a manufacturer's price or confirming stock.
The clinical molecule is snapshotted on each prescription item so later catalog
renames cannot change issued instructions. Reception chooses an active catalog
product with the same molecule, strength and stock unit, confirms stock and
charges quantity supplied × current catalog unit price. The doctor controls a
separate consultation charge (₹250 first consultation / ₹200 after a completed
consultation by default, even when that earlier bill is still unpaid).
`confirm_reception_bill` validates the selection, stock, integer paise total and
role, then writes the immutable bill and stock movement transactionally; retries
return the same bill. Realtime still only invalidates queries. The new RPCs and
migrations are on staging only, pending review and release.

The doctor may enter an unpriced molecule with an explicit supply unit for an
unfamiliar form; familiar forms derive tablet, capsule, bottle, sachet, vial or
tube. Reception's billing RPC exposes only molecule, strength, quantity, unit and
amounts. Clinical dose, diagnosis and advice stay with the doctor's prescription
read and archive. This keeps billing access narrower than clinical access.

Browser prescription printing uses the saved IndexedDB prescribed time before
the consultation is finished and `consultation_ended_at` afterward; the server
Drive archive snapshots the finish time. Arrival time is retained only as a
fallback for older records. A clinical save and print remain available offline.

Moved from AGENTS.md on 2026-10-10; existing decisions are preserved.
Read the relevant section before changing search, schema, realtime, offline,
or messaging. WhatsApp remains deferred under `docs/rework-brief.md`; the
older messaging cost estimate below is historical, not a current quote.

Five decisions that are already made, with the reasoning, because each has a wrong-looking-right alternative.

### 1. Search — trigram, scoped correctly

Enable `pg_trgm`; GIN index on `patients.name`.

- **Name** — trigram similarity. This covers both substring ("Ramesh" finding "Rameshkumar") and the case that actually needs fuzzy matching: transliteration variance (Rajesh/Rajeesh, Krishnan/Krishnaan, Mohammed/Mohamed).
- **Phone** — exact prefix match, never fuzzy. Surfacing the wrong patient because a digit differs is worse than returning nothing.
- **One input**, matching name, phone, and token together. Not three separate boxes.
- **Rank recent patients higher.** A patient seen last month is far likelier than one from four years ago; recency beats typo-tolerance for real hit rate.
- No external search service. The dataset is thousands of patients, not millions — trigram on Postgres is instant at this size.

### 2. JSONB — only where the columns are unknown

The distinction: **JSONB solves "I don't know what the columns are." A normal table already solves "I don't know what the rows are."**

- **Custom patient fields → JSONB, hybrid.** Field *definitions* live in a real table (`key`, `label`, `type`, `display_order`); field *values* live in a JSONB column on the patient. Not pure JSONB — without definitions the Admin panel can't render consistently, can't validate that a pain score is numeric, and can't rename a field without rewriting every row.
- **Procedures → normal table.** Adding a procedure is an INSERT; it never needed a migration. Procedures are foreign-keyed from bill lines, need price history, and get aggregated in the monthly and GST reports. JSONB makes all three harder for zero gain.

### 3. Realtime — Supabase Realtime, but not trusted

- Subscribe to `visits` with a **row filter**, not the whole table, so the receptionist's browser isn't processing every change.
- **Turn RLS on before enabling Realtime.** Realtime respects RLS: misconfigured policies either leak rows or silently deliver no events. This is the most common debugging rabbit hole with this stack.
- **An event invalidates a query and triggers a refetch. It never patches state from the payload.** Sockets drop when a laptop sleeps or wifi flaps; a missed event then self-heals on the next fetch.
- Keep `refetchOnWindowFocus` on. Queue and cross-role event reads use a 30s safety poll while subscribed, and a 3s fallback when disconnected. On subscription/reconnection, invalidate and refetch. Subscribe to `queue_events` directly so the ten-second event message does not depend on polling. Rep arrivals require `pharma_rep_checkins` publication membership.
- Fallback worth knowing: at this scale — two browsers, a handful of rows — plain 2–3s polling would be entirely sufficient. If Realtime fights you, falling back to polling is not a downgrade.

### 4. Offline — optimistic UI is not an offline strategy

Optimistic UI solves *latency*. It does nothing for a twenty-minute power cut, which is the actual risk here. Both are needed; they are different tools.

- **Writes** — durable mutation queue in **IndexedDB** (`idb-keyval`), not localStorage. localStorage is synchronous (blocks the main thread), capped at ~5MB, strings only, no transactions. The queue must survive a refresh and a browser crash, and the UI must show an explicit "not saved yet" state.
- **Reads** — `persistQueryClient` with an IndexedDB persister, so today's queue and patient list are readable offline.
- **Not doing**: a local database with bidirectional sync (PowerSync, ElectricSQL, RxDB). It is the single biggest complexity multiplier available to this project and the outage profile doesn't justify it.
- **Printing must work at zero connectivity** — browser print of the current DOM, no server round trip. This is what guarantees a patient never leaves without dosage instructions during an outage.
- **Handle Supabase auth token refresh failing while offline.** Otherwise "offline" silently becomes "logged out," which is much worse than a failed save.

### 5. WhatsApp — direct Meta Cloud API, own the integration

Three jobs: PDF delivery (prescription + receipt), scheduled reminders (refill ×2, follow-up ×1), and inbound pre-registration.

- **Direct Meta Cloud API, no BSP.** Meta hosts the API; call the Graph API directly with a permanent System User token generated in Business Manager. Cost is per-message only (~₹0.115 utility category), no reseller base fee.
- **We own the integration surface**: the inbound webhook for pre-registration, send retries and queueing, delivery-status handling, and media upload to Meta's media endpoints. There is no vendor support path — build defensively and log every send.
- **Business Verification with clinic documents is a prerequisite for higher messaging tiers.** Start it early in Business Manager; it takes days, not minutes.
- **One combined message per visit, not two** — prescription and receipt go out together (one PDF, or the receipt appended to the prescription), not as separate sends.
- **PDFs, not links** — generated client-side from the same DOM the browser prints (non-negotiable #7), so there is one canonical rendering, not two drifting apart. Queued in IndexedDB alongside other pending writes if the visit closes offline; sent once connectivity returns.
- **No clinical detail in the message body** — it renders in lock-screen notifications. Clinical content lives only inside the attached PDF.
- **Every outbound message is a pre-approved template**: prescription delivery, payment receipt, refill reminder, follow-up reminder, pre-registration acknowledgement. Fixed body text with variable slots; changing wording later requires re-approval.
- **Inbound webhook → a Supabase Edge Function**, not a separate backend service. Matches the sender to an existing patient by phone number (never creates a duplicate) and writes a pending patient record that expires at end of day if the patient never arrives.
- **Pre-registration never grants queue priority.** It only pre-fills the check-in form; the token is still issued on physical arrival, strict arrival order.
- **No BSP means no subscription floor, but also no safety net.** Meta bills usage directly to a linked payment method on the WhatsApp Business Account — a declined card or spending cap silently stops every send. Add a payment-method health check to the same monitoring surface as uptime and error tracking.

### Print asset readiness — 2026-10-11

Hidden DOM print areas do not start loading block-display letterhead fonts.
All print entry points use `usePrintDocument` to load the existing self-hosted
font faces before opening browser print. React Query uses `networkMode: always`
so cached assets work without connectivity. Missing assets surface an inline
error; request identity and unmount cleanup cancel stale print requests.
Document reprints reuse the issued record and never insert another document.

## Private patient attachments — 2026-10-10

Files live in clinic-owned Google Drive; Supabase stores doctor-only metadata
and encrypted server-only refresh credentials. A single authenticated Edge
Function validates clinic/doctor/patient on each request and proxies uploads
and downloads. OAuth uses drive.file and one-use user/clinic-bound state.
A dedicated IndexedDB queue stores bytes before upload and shares the global
pending count without blocking the clinical queue. Client IDs plus reserved
Drive IDs make retries idempotent; MIME/signature/size/checksum validation
protect the file boundary. The browser PDF renderer requires an unsandboxed
PDF iframe; HTML/SVG are rejected and responses are forced to the stored
allowlisted MIME. Signature validation is not an antivirus scan.
Setup and known operational limits: `patient-documents-setup.md`.

## Actionable alerts and call sound — 2026-10-11

Alerts derive from scoped database reads; realtime invalidates their query.
Open refetches and verifies the visit's latest stage before choosing its
permitted destination. No reminder automatically calls, pays or marks no-show.
Called-but-not-sent reminder is 5 minutes; closing review starts at 16:00
Asia/Kolkata. Read/dismiss/resolved history is IndexedDB account/clinic/device
state, with all current alerts retained and resolved history capped at 500.
Failed/offline reads preserve unresolved history.

Reception enables Web Audio through an explicit gesture each session. Only
call events newer than enablement and less than 10 seconds old qualify; an
atomic IndexedDB event ledger prevents refetch/reload/cross-tab duplicates.
Sound is supplemental: browser audio restrictions and client clock skew may
suppress it, and the real queue remains authoritative.

Drive status verifies the saved Google refresh grant server-side. Alert checks
run only for doctors while Alerts is open, every five minutes; revoked grants
produce a reconnect alert, transient outages produce a retry notice. A global
Documents connection view avoids needing a patient record just to connect.

## Issued PDF archives — 2026-10-17

Finalisation snapshots the approved prescription; paid-bill insertion and pay-later settlement create receipt snapshots after immutable bill lines exist. Jobs and snapshots persist in Postgres with source/version uniqueness. Patient links derive through visits so merges retain history; name-only pharmacy receipts have no patient/visit. New events only: no bulk historical backfill.

An unlocked clinical app processes pending jobs in batches: lazily renders the existing print components to A4 PDFs, stores the bytes in account/clinic-scoped IndexedDB, then uploads through the private Drive endpoint. Rendering uses bundled fonts/artwork, repeated letterheads and row-level continuation pages; receipt summary rows stay together. Oversized single paragraphs/rows or PDFs above25MiB surface a pending error without truncating or blocking other jobs. Source snapshots remain unchanged.

The server authorises each job, leases uploads, reserves a stable Drive ID and checks the canonical checksum. A lost completion response recovers the original file rather than replacing it with newly rendered bytes. Reception can process/download receipts only; manual clinical attachments and Google connection management remain doctor-only. Tokens stay server-side. Lock/unmount generations cancel late downloads.

Jobs survive device closure, but processing requires a signed-in, unlocked app with connectivity; no unattended server PDF renderer was added. Existing IndexedDB clinical writes create their archive job when they sync. Drive failure never blocks printing or clinical/payment saves. New PDF dependencies load outside the initial application bundle; PWA precaches them for local availability.
