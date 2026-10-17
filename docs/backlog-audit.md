# Backlog audit and corrected "what's lacking" list

> **Status refresh 2026-10-17.** The body below is the 2026-10-13 audit and is kept as written. Since then: height/weight, possible-duplicate detection and the in-app confirm dialog are built and **released to production**; the unified patient timeline is built and **merged to `main`** (production release pending); the browser titles/icons finishing items shipped earlier. Codex then delivered (PRs #35 to #40, released 2026-10-17): the Drive PDF auto-archive, configurable reminder timing / closing checklist / notification mute, the repaired legacy suites plus a CI workflow, and the read-only issued-prescription view; printer and Safari checks were approved by the user. Still open: backups (R2, needs the user), hosted CI (GitHub billing lock), a live look at the Timeline, backup restore. The current state and procedure are in `docs/handoff-claude-code-to-codex.md` ("START HERE"). Earlier "Missing" rows for those items are stale.

Date: 2026-10-13. Checked against branch `fix/audit-flow-findings` (descends from `production` `87a6351`).
Source of the items: the backlog sections of `docs/rework-brief.md` (Alert backlog, Additional user-approved
backlog items, Smart-feature priorities, finishing pass, Future work), plus the baseline requirements and my own
findings from testing.

**How to read the status column.** This was a read-only code check, not a live test.
- **Built** = the code for it exists. I did not run it in a browser, so "built" is not "verified".
- **Partial** = some of it exists; the gap is named.
- **Missing** = no code found.
- **Not approved / deferred** = the brief says not to build it yet.

---

## 1. Alert backlog (ordered list in the brief)

| # | Item | Status | Evidence / gap |
|---|---|---|---|
| 1 | Google Drive connection, staging then test | **Partial** | Drive code and the `patient-documents` function are built and released to production (PRs #8, #10; production consent recorded as verified in STATUS). Staging storage is not configured, so upload/preview/download/reconnect were never exercised on staging. |
| 2 | Reception chime when the doctor calls | **Built** | `lib/callSound.ts`, `components/CallSound.tsx`: explicit enable/mute toggle, fresh-event check (< 10 s) and a seen-id list so refetch/reconnect doesn't replay it. |
| 3 | Actionable in-app alerts that open the right place | **Built** | `lib/clinicAlerts.ts` builds alerts for called, sent in, ready to bill, discount review, low stock, negative stock, near expiry. Each carries a target (section, visit, patient or medicine). |

## 2. Additional approved backlog items

| Item | Status | Evidence / gap |
|---|---|---|
| Auto-archive prescriptions and receipts as PDFs to Drive | **Missing** | The function only handles manual uploads (PDF/JPEG/PNG signature check). No code generates or uploads an issued prescription or receipt PDF. |
| Failed/pending sync alerts with retry | **Partial** | `ClinicAlerts.tsx` lists each pending change ("Change not saved yet · description") and a halted save, with a Retry button (`drainQueue`). The halted alert says "review the pending-save banner" and doesn't carry the failure reason itself. |
| Persistent unread/recent notifications, read/dismiss, mute | **Partial** | Read, dismiss, recent history and auto-clear on resolution are built (`reconcileAlerts`, saved per account per device). There is no mute/quiet setting for notifications. The only mute is the call chime. |
| No-show review reminders using the configured threshold | **Built** | `no-show` alert fires after `no_show_minutes`; removal stays an explicit reception action. |
| Failed Drive upload and reconnect alerts linked to Documents | **Built** | `upload:` and `drive-connection` alerts, doctor only, link to the patient's Documents tab. |
| Called-patient reminder if not sent in | **Partial** | Built (`sent-reminder`) but the delay is hard-coded to 5 minutes. The brief says the delay must be configurable and chosen before implementation. |
| Outstanding-bill alerts at closing time, per bill | **Partial** | A single "End-of-day review" alert appears after 16:00 IST (hard-coded). It is not per bill, and the closing time is not a setting (the brief says to confirm the setting first). |
| Doctor notice of partial supply, linked to visit history | **Built** | `shortfall:` alert for doctors. |
| Duplicate same-day check-in warning | **Built twice** | An alert already existed ("Possible duplicate check-in") but only after two tokens were issued. I added a warning at selection time (before issuing). The brief said to check existing protections first; I didn't. Both now exist; they complement each other. |
| Connection lost/restored indication | **Built** | `connection` alert from `navigator.onLine` plus realtime connected state, and the offline banner. |
| End-of-day checklist of unresolved visits, unpaid bills, pending saves, failed uploads | **Partial** | One summary alert exists; I did not find a checklist view covering all four. |
| Group repeated stock alerts by medicine/batch | **Built (per medicine)** | One alert per medicine merges low stock and expiry. Batch grouping does not exist because the data model has one expiry per medicine. |

## 3. Smart-feature priorities

| Item | Status | Evidence / gap |
|---|---|---|
| Duplicate patient detection with staff review, then merge | **Missing** | `MergePatients.tsx` is a manual "pick record A and B" screen. Nothing suggests likely duplicates (same phone or name). The same-day alert is about tokens, not duplicate patients. |
| Unified patient document timeline | **Missing** | The patient screen has separate Visits, Notes and Documents tabs. No combined, time-ordered view of prescriptions, receipts and uploads. |
| Stock-aware billing / earliest-expiry suggestion (low priority) | **Not found** | Not built; lowest priority per the brief. |
| Follow-up contact/booking worklist | **Deferred** | Far-future per the brief. (There is an existing follow-up to-do list; not the same thing.) |
| Repeat-last-prescription change review; prescription version history | **Declined / deferred** | Do not build. |
| Partial-supply follow-through (owed medicine) | **Not approved** | Do not build. |
| Last-visit summary | **Not approved** | Proposed, not explicitly approved. |

## 4. Finishing pass (approved, queued)

| Item | Status | Evidence / gap |
|---|---|---|
| Browser title `app` replaced with iClinic + section | **Missing** | `index.html:7` is still `<title>app</title>`. |
| Consistent install naming; raster icons and launch colours | **Missing** | The PWA manifest (`vite.config.ts`) names it "i Clinic" and has a single SVG icon. No PNG home-screen icons exist in `public/`. |
| Readable status labels instead of raw stage names | **Partial** | `TokenList.tsx` has a label map. My new reception duplicate warning shows the raw stage with underscores replaced (needs to reuse the map). Other screens not fully checked. |
| App dialogs instead of browser `confirm()` | **Missing** | 11 `window.confirm`/`confirm` calls remain: Drawer discard, Drive disconnect, remove pending upload, remove custom field, remove login access, remove procedure, remove drug, remove template, merge patients, reconciliation correction. (My no-show confirm is an inline panel, not a browser prompt.) |
| Dates and times in history | **Partial** | Patient visits use `formatDate` / `formatDateOnly`. Not checked on every screen; depends on the timeline item. |
| Download filenames, clinic identity on receipts, keyboard focus, empty/error states | **Audit targets, not checked** | Download name comes from the document title with a `.pdf`/image extension. The brief calls these targets, not confirmed defects. |

## 5. Baseline and future items worth recording

| Item | Status | Evidence / gap |
|---|---|---|
| Height and weight at registration (baseline requirement 1) | **Missing** | No dedicated field. It relies on Admin custom fields, which nobody has configured. I previously treated this as optional config; it is a stated baseline requirement. |
| A4 letterhead print | **Built, unverified physically** | `PrescriptionLetterhead.tsx` exists. Physical printer calibration is still marked unchecked. The artwork has a fixed doctor name. |
| Second doctor sharing one reception | **Future** | Single clinic-wide "active" consultation, one called/with-doctor visit per clinic. Needs the second doctor's process first. |
| Realtime scaling (WebSocket/SSE review) | **Future** | No change approved. |
| WhatsApp, consultation recording | **Out of scope** | Explicitly excluded. |

---

## 6. Corrected "what's lacking", in order

This replaces my earlier list, which was not built from the backlog.

**A. Do before anything ships**
1. Choose the PR target. `main` is a separate, older history; retarget #12 to `production`.
2. Browser-check the four screens I never ran: no-show confirm, inline Confirm unit, idle lock without a PIN, and the Pricing panel and Finish button after the refactor.
3. Run the repo `code-review` gate (required by AGENTS.md before merge) and the staging security advisor.
4. Apply the three migrations to production in a quiet window, then merge.

**B. Small things I left behind**
5. Make my reception duplicate warning use the existing stage label map.
6. Add height/weight (custom fields on each environment, or a dedicated field).

**C. Approved backlog still missing (highest value first)**
7. Duplicate patient detection with review, reusing the merge flow.
8. Unified patient document timeline, with consistent clinic-time stamps.
9. Finishing pass: page title, install icons and launch colours, replace the 11 `confirm()` calls, readable status labels.
10. Auto-archive prescription and receipt PDFs to Drive (largest item; needs offline-safe retries and a narrowly authorised receipt path).

**D. Approved but partial: needs a decision from you, not just code**
11. Called-patient reminder delay, closing time, and an end-of-day checklist: the brief says to choose these settings before building.
12. Notification mute/quiet setting.
13. Halted-save alert should carry the failure reason.

**E. Quality and risk (from testing, not the backlog)**
14. Fix or delete the seven broken legacy suites; there is no CI running tests, only GitGuardian.
15. Unproven for real use: physical A4 printing, phone/Safari, full offline cold start, backup restore, Drive on staging.
16. Staging clutter: old open visits, about 219 alerts, token 104 stuck "with doctor".

**Deliberately not built:** repeat-last-prescription review, prescription version history, partial-supply follow-through, last-visit summary (not approved), second doctor, WhatsApp/recording, realtime replacement.
