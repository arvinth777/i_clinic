# Handoff: Claude Code to Codex

Living document. Claude Code appends to section 9 (change log) after every branch, merge, staging or production
action, and refreshes sections 1 and 6. Last updated: 2026-10-13 01:50 IST. Covers everything Claude Code did in
this repository, from the point it took over from Codex's last release (`production` at `87a6351`, PR #11 merged
2026-10-11) to now.

**Current branch of the Claude Code worktree: `fix/lock-and-event-feed`** (cut from `origin/main` `9936c20`; local, not pushed). It holds two fixes plus handoff edits: the lock-screen centring fix (`70ec7c0`) and the header event-feed fix (`1e9ead5`), merged together. The earlier local branches `fix/lock-screen-centering` and `docs/handoff-log` are superseded by it.
**Merges into `production`: one, PR #13 (`main` -> `production`), merge commit `e7e1820`, 2026-10-13 00:52 IST.**
**Merges into `main`: two.** (1) fast-forward `a220a14..e066578`, pushed by the user, ~00:30 IST; (2) PR #14 (`integrate/unsaved-local-notes` -> `main`), merge commit `9936c20`, 2026-10-13 01:08 IST. `main` is now 4 commits ahead of `production` (the no-show fix, the integrated notes/favicon, the handoff note, the merge) and `production` has 1 commit `main` lacks (`e7e1820`).
Read `AGENTS.md`, `docs/STATUS.md` and `docs/runbook.md` as well; this note does not replace them.

## 1. State right now (verify before acting)

| Thing | State |
|---|---|
| `production` branch | `e7e1820` (merge of PR #13). Vercel Production = deployment `dpl_H6n94JYJpdwdXN3TocHyCAh9Kq75`, READY, built from it. Previous Production deployment `dpl_B1mwLof6iE577ErK73Ct4A8tMrDH` (`87a6351`) is the rollback target. |
| `main` branch | `9936c20` (PR #14 merge). Contains everything in `production` except the PR #13 merge commit, plus the no-show layout fix, the integrated notes and the "i" favicon. Vercel built it as a **Preview** (target empty), not Production. |
| Production database (`rmuhpgpvgvwchovlgxae`, clinic-prod) | **Migrations applied 2026-10-13 ~00:55 IST** (by the user running the CLI): now has all 7 (`production_bootstrap`, `patient_drive_files`, `rep_queue_realtime` + the four in section 3). Security advisor unchanged (2 anon, 31 authenticated, nothing new). The user says it holds no useful data. |
| Staging database (`cofnrcgsolluyhghutah`, clinic-staging) | Has the three production migrations **plus four new ones** (section 3). Staging may be changed freely (user decision, 2026-10-13). |
| PR #12 | Closed without merging (its content is already in `main`). |
| Claude Code worktree | `.claude/worktrees/initial-setup-7b40e6`, branch `fix/lock-and-event-feed`. Root `supabase/` linked to **staging**; `deploy/production/` linked to **production**, with 7 symlinks (the 4 new ones are still uncommitted). |
| Main project folder | `/Users/arvinthcinmayankirupakaran/Desktop/i_clinic`: branch `main` @ `9936c20`, clean, pulled after PR #14. Backups of its old unsaved work: branches `backup/unsaved-20261013`, `backup/local-main-20261013`, and `~/Desktop/i_clinic-unsaved-backup-20261013/`. |
| Untracked, uncommitted | `BACKLOG-AUDIT.md`, `CHANGE-REPORT.md`, this file. |
| Production promotion | **Done** (database 00:55 IST, code 00:52-00:53 IST). Live checks passed: page 200, title `iClinic`, manifest and icons served, bundle references only the production Supabase ref. No browser sign-in or console check of the live app yet (needs the user's login). |

## 2. What the user asked for, in order
1. `/init` (create `CLAUDE.md`), then a UI audit. The first audit used an old design; the user corrected that, and the audit was redone on the latest merged state.
2. A full test of every reception and doctor flow (browser plus staging scripts), listing gaps and mistakes.
3. "Fix those and the old ones" from a pasted report, then "fix the decision items" (idle lock without a PIN, prescription defaults, finishing items).
4. Code reviews (`ponytail-review`, three cuts applied), a change report, a backlog audit against `docs/rework-brief.md`.
5. A finishing pass (title, icons, stage labels), branch-flow clean-up, bring `main` up to date, and now: bring production up to date without breaking anything.

## 3. What changed

### Migrations (immutable, applied to **staging only**)
- `20261012010000_queue_identity_search_and_ist_reports.sql`: triggers that clamp future `arrived_at` and make `token_number`/`arrived_at`/`clinic_id` immutable for signed-in users; follow-up date window (today to +5 years, IST); `patients_age_range` check (0-120, `NOT VALID`); new `search_patients`; daily/GST/monthly reports use the Asia/Kolkata day.
- `20261012020000_search_patients_typos_and_country_code.sql`: word-level trigram match and `+91` handling (separate file because the first was already applied).
- `20261012030000_queue_finish_procedures_and_noop_moves.sql`: `queue_visit_action` allows Finish with a procedure and no medicine (medicines present still need dose and duration); a move with no neighbour writes no note or event.
- `20261013010000_revoke_anon_on_recreated_functions.sql`: fixes a regression found by the security advisor. Migration 1 dropped and recreated `get_daily_report` (default grants, including `anon`, came back) and added `guard_visit_identity` without revoking execute. Staging's advisor output now equals production's (2 anon, 31 authenticated findings).

### Frontend
- PIN lock: salted PBKDF2, persisted lock flag, attempt throttling (`lib/pinLock.ts`, `LockScreen.tsx`); idle lock always armed, with "Sign in again" when no PIN exists.
- Offline queue: queues as the stored user when the token has expired; drains on load when online.
- Reception: search shows "no match" only once settled; warning when the patient is already in today's queue; no-show needs a confirm click; reason box cleared after each action; phone and age validated and normalised.
- Prescription: no prefilled dose, drug type from stock unit, strength required for tablet/capsule, quick-add skips duplicates and unconfirmed-unit drugs, inline "Confirm unit" (`ConfirmUnitRow.tsx`), real error message on Confirm.
- Billing names the drug, approved quantity and Counter stock when supply fails. Follow-up date bounded. Header shows the clinic name from settings.
- Finish accepts procedures (`Consultation.tsx`, shared `lib/useVisitProcedures.ts`).
- Finishing pass: tab title "<section> · iClinic"; PNG and maskable install icons; manifest `iClinic` with colours from the `blue`/`bg` tokens; shared `lib/stageLabels.ts`. The ℞ mark is a **placeholder** (no clinic brand is confirmed in `PRODUCT.md`).
- Shared helper `setMedicineUnitPrice` in `lib/offlineQueue.ts`.

### Tests (plain Node scripts against live staging)
New: `scripts/pin-lock-test.mjs`, `queue-integrity-test.mjs`, `queue-finish-test.mjs`. Updated: `prescription-draft-test.mjs`, `phase-d-test.mjs`. Passing after the last database change: queue-integrity, queue-workflow, phase-d (38/38), phase-e (24/24), prescription-draft, plus the earlier suites (prescription-handoff, approval-snapshot, partial-dispensing).

### Docs
`CLAUDE.md` (new), `docs/STATUS.md` sections "Flow-test fixes" and the finishing pass, `docs/design.md` note on install icons, and `AGENTS.md`/`CLAUDE.md`/`docs/runbook.md` now describe the branch flow (section 5). Reports for the user: `CHANGE-REPORT.md`, `BACKLOG-AUDIT.md`.

## 4. Verified vs not verified
- Verified in a browser earlier: PIN persistence/throttle/recovery, search, duplicate warning, move-reason clear, expired-login offline queue and replay, billing stock message, alert to bill, template skip note.
- **Browser-verified 2026-10-13 ~01:00 IST** on the local app (`localhost:5173`, staging database, signed in as `doctor.a` by the user): tab title per section (Reception/Doctor/Billing/Refills/Patients/Inventory/Reports all `<section> · iClinic`; **"More" shows plain `iClinic`**, a small polish gap); idle lock with **no PIN** (locks, shows only "Locked / Sign in again", flag persisted and survives a reload, no patient names); inline **Confirm unit** (shows unit + prefilled price, enables on unit, then the drug reads "· tablet" and is selectable); **Pricing panel** after the shared-hook refactor (procedure added live, total 250 -> 300, Bill approved); **Finish with a procedure and no medicine** (button disabled before, enabled after, finish succeeded, "seen today" 3 -> 4).
- **No-show confirm (reception, user signed in as `reception.a`):** found a **layout bug** in my earlier change: the confirm sentence and buttons were inside the auto-sized last grid column of the queue row and squeezed the patient name to one character per line. Fixed (confirm now a full-width `.queue-confirm` row under the patient, existing `--space-sm` token) and re-verified: confirm opens, Cancel closes it with no change, Confirm closes the visit (#2988, synthetic) with no error. **This bug is in production** (it shipped in #13); the fix is committed on `feat/finishing-pass` only and needs a release through `main` -> `production`. Cosmetic, no data impact.
- **Still not browser-tested:** the PWA install prompt, the live production app after sign-in (production has no `*.staging.test` accounts).
- Vercel did not build the `main` push (no deployment exists for `e066578`); cause unknown and harmless. Previews use the staging database; only Production uses clinic-prod (checked in Vercel's environment settings). **Production branch = `production`** (checked in Vercel Settings, Environments).
- Not checked at all: physical A4 print calibration, phone/Safari, full offline cold start, backup restore, Drive on staging.

## 5. Branch flow (changed on purpose)
Your releases (#6, #8-#11) went `codex/` branch straight into `production`; `main` sat at `a220a14`. The user then chose: **feature branch -> `main` (staging, Vercel preview against the staging database) -> `production`** (the only production deploy trigger). `main` was reconciled with `production` for this. Keep `main` a descendant of `production`. GitHub's default branch is still `main`; consider the repo setting.

## 6. Production promotion: DONE (kept as the procedure that was used)
The permission classifier blocked Claude Code from the production steps, so the user ran them in his own terminal with Claude Code checking each output. Order (runbook): database first, then code.
1. Window: before 10:00 or after 15:00 IST.
2. Add four symlinks in `deploy/production/supabase/migrations/` pointing at `../../../../supabase/migrations/<file>` for the four migrations in section 3.
3. `supabase --workdir deploy/production link --project-ref rmuhpgpvgvwchovlgxae`, then `supabase --workdir deploy/production migration list --linked`, `... db push --dry-run`, `... db push`. Never `db push` from the repo root toward production: its `supabase/migrations` holds about 60 historical files that production's squashed history does not have. After that, re-link the root workdir to staging (`supabase link --project-ref cofnrcgsolluyhghutah`).
4. Check production's migration list and security advisor (read-only; MCP is never used to change anything).
5. Open a PR `main` -> `production` and merge it (this deploys; Vercel Production tracks `production`). The previous Production deployment `dpl_B1mwLof6iE577ErK73Ct4A8tMrDH` (`87a6351`) is a rollback candidate.
6. Smoke test the production URL (page loads, title "iClinic", no console errors). Staging test scripts refuse to run against production by design.

## 7. Gotchas learned
- Test scripts assert the staging host and need the test-user passwords from `.env.test-users.local`. `queue-workflow-test` cannot run in the first ~41 minutes after midnight IST; tests that leave visits `called` or `with_doctor` block the next run until finished.
- `DROP` then `CREATE` of a function resets its grants; `REVOKE ... FROM PUBLIC` does not remove Supabase's direct `anon` grant. Revoke from `anon` explicitly (runbook step 3).
- `supabase link` changes the target for later `db push` in that workdir. Re-check `supabase/.temp/project-ref` before any push.
- GitHub's combined status shows "pending" when a commit has no statuses; it does not mean a build is queued.
- `vercel api` is not a subcommand in CLI 48; avoid it (it tried to deploy). Use the Vercel connector or dashboard.
- The permission classifier blocked: pushing `main`, reading production tables, and creating production migration symlinks. The user pushed `main` themselves.
- macOS: no `timeout`; use `perl -e 'alarm N; exec @ARGV'`. zsh errors on unmatched globs.

## 8. Open work (details in `BACKLOG-AUDIT.md`)
Missing: duplicate-patient detection with review, unified patient timeline, Drive PDF archive of prescriptions and receipts, replace 11 browser `confirm()` calls with an accessible dialog, height/weight fields (Admin custom fields, or dedicated). Partial, needing a user decision: called-patient reminder delay (hard-coded 5 min), closing time (hard-coded 16:00 IST), notification mute. Quality: seven legacy suites fail (billing, pricing, packing, stock, phase-f, phase-g, isolation), no CI runs tests, staging has stale fixtures (token 104 stuck `with_doctor`).

## 9. Change log (append new entries at the bottom; times IST, 2026-10-12/13)

### Branches, commits and merges
1. Work started on branch `fix/audit-flow-findings`, cut from `origin/production` `87a6351` in this worktree.
2. `ac4327c` "Fix queue, search, PIN lock and prescription flow findings" (28 files) committed there and pushed.
3. **PR #12** opened (`fix/audit-flow-findings` -> `main`): GitHub said CONFLICTING. `main` was an older, diverged history (118 commits not in `production`, 22 `production` commits not in `main`; only 4 stale files existed solely on `main`). Retargeted to `production` (MERGEABLE), then **closed without merging** once its content reached `main` another way. Nothing was merged into `production`.
4. Branch `feat/finishing-pass` cut from `ac4327c`: `208f3b7` finishing pass (title, icons, stage labels), `15e9095` docs (first version: "main is legacy"), `cbf6c4b` docs (final: feature -> `main` staging -> `production`), `5766eb9` migration 4 (revoke anon), `6ad388e` STATUS update.
5. Local branch `main-reconcile`: `e0483d0` = `git merge -s ours origin/main` on top of `feat/finishing-pass` (keeps production's content, records old `main` history as a parent), then `feat/finishing-pass` merged in again after commits 5766eb9 and 6ad388e, giving `e066578` "Merge branch 'feat/finishing-pass' into main-reconcile".
6. **Push to `main`: `a220a14..e066578`, fast-forward, no force.** The classifier blocked Claude Code from pushing, so the **user ran** `git push origin main-reconcile:main` himself. The 40 files that differ between `production` and `main` are all this session's work.
7. Vercel did not create a deployment for the `main` push. Production deployments still end at `87a6351`. Vercel settings checked in the dashboard: Production tracks `production`; Preview = all other branches; previews use the staging database.

### Staging (database `cofnrcgsolluyhghutah`, allowed to change freely)
- Applied with `supabase db push`: `20261012010000`, `20261012020000`, `20261012030000`, then `20261013010000` (about 00:35 IST). Security advisor before the fourth: 2 extra anon-callable functions; after: identical to production's.
- Synthetic data created by tests and browser runs (patients named `AUDIT...`, `Finish AUDIT...`, visits, prescriptions, bills). Manual clean-up by Claude Code: restored a visit token I had set to 999999 then parked it with a reception `not_here`; relabelled one patient "AUDITPROBE synthetic patient (original name lost...)"; finished leftover `called`/`with_doctor` test visits (latest token 2971). Untouched: token 104 (`with_doctor` fixture), about 219 stale alerts, 359 old open visits.
- Test runs after the final migration: queue-integrity, phase-d (38/38), phase-e (24/24), queue-workflow (passes after 00:42 IST) all PASS.
- No staging schema or data change has been made since `20261013010000`.

### Production (database `rmuhpgpvgvwchovlgxae` and Vercel Production)
- **No changes.** Production database still has `production_bootstrap`, `patient_drive_files`, `rep_queue_realtime`. Read-only checks only: migration list, security advisor, function signatures (one `search_patients`, one `get_daily_report`, no overloads), Vercel project/deployment/environment settings.
- 00:4x IST: Claude Code briefly ran `supabase link` to production from the repo **root** (a mistake: a `db push` there would try to apply ~60 historical files) and immediately re-linked the root to staging; verified `supabase/.temp/project-ref` = staging.
- User confirmed production has no useful data. The classifier blocked Claude Code from reading production tables and from creating the four `deploy/production` symlinks, so the **user ran the commands in his own terminal**, with Claude Code checking each output:
  - 00:50 IST branch/time check; created the 4 symlinks (7 resolve); `supabase --workdir deploy/production link --project-ref rmuhpgpvgvwchovlgxae`; `migration list --linked` (3 applied, 4 pending); `db push --dry-run` (exactly the 4 migrations).
  - ~00:55 IST `supabase --workdir deploy/production db push`, answered Y: all four applied cleanly (only expected "does not exist, skipping" notices).
  - Verified read-only afterwards: production `list_migrations` shows all 7; security advisor identical to before the push.
- **Not yet done:** PR `main` -> `production` and its merge (the code deploy). The previous Production deployment `87a6351` stays the rollback target.

### Local-only artefacts
`BACKLOG-AUDIT.md`, `CHANGE-REPORT.md` and this file are uncommitted in the worktree.

### 2026-10-13 00:52-01:00 IST: production release
- 00:52 PR #13 (`main` -> `production`, 40 files, +1032/-143) created from the user's terminal (`gh pr create`) and **merged by the user at 00:52:20 IST** with `gh pr merge main --merge` in his own terminal (step 10). Claude Code saw the PR already MERGED before the terminal output reached it; it was a single merge, not two. Merge commit `e7e1820` on `production`. Checks on the PR: GitGuardian pass, Supabase Preview skipped.
- Vercel built Production `dpl_H6n94JYJpdwdXN3TocHyCAh9Kq75` (branch `production`, `e7e1820`), READY. The four migrations were already on production, so the database was never behind the code.
- Smoke test from the shell: `https://iclinic-theta.vercel.app` 200, `<title>iClinic</title>`, `theme-color #1A4FB5`, manifest and `icon-192.png` 200, JS bundle contains the production Supabase ref (`rmuhpgpv...`) and no staging ref.
- `supabase --workdir deploy/production migration list --linked`: local and remote match on all 7.

### Open follow-ups after the release
1. Merge `production` into `main` (keeps `main` a descendant of `production`) and commit the four new `deploy/production/supabase/migrations/` symlinks, in one small PR into `main`, then `main` -> `production` later like any other change.
2. Check the live app in a browser after signing in (tab title per section, install prompt, finish with a procedure, search, queue).
3. Still unrun anywhere: no-show confirm button, inline Confirm unit, no-PIN idle lock, Pricing panel and Finish after the refactor.
4. Then the backlog in `BACKLOG-AUDIT.md`.

### 2026-10-13 ~00:57-01:03 IST: browser verification on staging (no schema change, no branch change)
- Local dev server (`i-clinic-dev`, port 5173) started in the app's browser pane; it uses the **staging** database. Claude Code does not type passwords into login forms (including test accounts); the user signed in as `doctor.a@staging.test` himself.
- Staging data created: patient/visit "UIVUDJ synthetic ui check" token 3002 (finished, now billable), one synthetic procedure on it (approved bill 300), medicine "UIVUDJ unconfirmed unit drug" whose unit was confirmed as `tablet` price 10 through the new inline control. A temporary script used for set-up was deleted.
- The live production site was opened (signed-out sign-in page only, title `iClinic`, no console errors). Signing in there failed for `reception.a@staging.test` with "Invalid login credentials": expected, those accounts exist only in staging.
- Current branch unchanged: `feat/finishing-pass`. Nothing was committed or pushed in this step except this file (still uncommitted).

### 2026-10-13 ~01:03-01:05 IST: reception check on staging, no-show layout fix
- User signed in as `reception.a@staging.test` in the local app (staging). #3002 (finished as doctor) showed as "Ready to bill" on reception: doctor -> reception handoff works.
- Staging data: synthetic stale visit token 2988 ("Follow-up Test Patient") closed as no-show through the UI.
- **Branch `feat/finishing-pass`: new commit** "Fix no-show confirmation layout..." (`src/components/TokenList.tsx`, `src/components/Worklist.css`). Not pushed. `origin/main` and `origin/production` do not have it yet.
- Open follow-up (replaces item 1 above): push this fix to `main` (PR from `feat/finishing-pass` or via the small sync PR), then release `main` -> `production` in the next window, together with merging `production` back into `main` and committing the four `deploy/production` symlinks.

### 2026-10-13 ~01:06-01:08 IST: the main project folder (`/Users/arvinthcinmayankirupakaran/Desktop/i_clinic`) brought up to date
- That folder was a **separate git worktree** on the old branch `codex/clinic-drive-integration` (`daf1bfa`, 6 commits behind) with **uncommitted work** (STATUS.md +121, rework-brief.md +225, design.md +4, `public/favicon.svg`, untracked `docs/performance-audit.md`) and a local `main` carrying **2 unpushed commits** (`2986888`, `36455a9`). Claude Code's changes live in its own worktree, so they were not in that folder.
- Line-by-line check against `origin/main`: both local-only commits are **fully present** on `origin/main` (0 lines missing). Uncommitted work **not** on `main`: 103 STATUS lines (Oct 11-12 notes), 48 rework-brief lines ("Consolidated remaining work - 2026-10-11"), 3 design.md lines (the favicon note), and the favicon itself (white lowercase "i" on clinic blue). `docs/performance-audit.md` on `main` is the newer version (kept).
- **Safety copies:** files copied to `~/Desktop/i_clinic-unsaved-backup-20261013/` (plus `all-unsaved-changes.patch`); the unsaved work committed to local branch `backup/unsaved-20261013` (`840644e`); the old local `main` kept as `backup/local-main-20261013` (`2986888`). Nothing was deleted.
- Main folder now: branch `main` = `origin/main` `e066578`, clean tree. It does **not** yet have the no-show fix or the integration commit until they are merged to `main`.
- **Integrated** (branch `integrate/unsaved-local-notes`, commit `2f399e6`, via 3-way patch; conflicts in STATUS.md resolved by keeping both blocks, newest first; rework-brief conflict resolved by keeping the added section): all of the above, and **your "i" favicon replaces Claude Code's placeholder R-slash mark**; the 192/512/maskable/apple PNG icons were regenerated from the same geometry; `docs/design.md` install-icon note updated to match. The handoff note itself is now committed on this branch.
- Chain on this branch, oldest first: `f3dd1af` no-show layout fix, `2f399e6` integration. Merge it into `main`, then `git pull` in the main folder, then `main` -> `production` for release.

### 2026-10-13 ~01:08-01:10 IST: PR #14 merged into `main`
- PR #14 (`integrate/unsaved-local-notes` -> `main`: no-show layout fix `f3dd1af`, integration `2f399e6`, handoff-note commit) was **merged by Claude Code at the user's instruction** (`gh pr merge 14 --merge`), merge commit `9936c20`. Not production; no migrations.
- **Vercel built `main` `9936c20` as a Preview** (deployment `dpl_ETY5coFbxahKLGasJD87s5QRn2VP`, target empty), and a Preview for the branch push. Newest Production deployment is still `e7e1820`. This confirms that a `main` push produces a Preview, never Production.
- Main project folder updated with `git pull --ff-only` to `9936c20` (clean).
- Still true: the "i" icon, the no-show layout fix and the integrated notes are **not yet in production**. They go out with the next `main` -> `production` release (production currently shows the placeholder R-slash icon and the squeezed no-show layout; both cosmetic).
- New branch `docs/handoff-log` (local) for further handoff-note edits; batch them into a PR into `main`.

### 2026-10-13 ~01:15-01:20 IST: lock screen not centred (user screenshot) - fix on `fix/lock-screen-centering`
- User showed the "Locked / Sign in again" screen looking off-centre. Reproduced on staging: the overlay is `position: fixed; inset: 0` and correctly centres its form, but the **tall app behind the lock still showed its page scrollbar** (innerWidth 781 vs clientWidth 770), so the overlay was centred in the area minus the scrollbar (about 5 css px left) and the scrollbar thumb leaked the page behind the lock.
- Fix (`70ec7c0`, `src/components/LockScreen.tsx`): an effect sets `document.documentElement.style.overflow = 'hidden'` while locked and restores it on unlock. Verified: scrollbar 0 px, form centre (391, 432) vs window centre (390.5, 431.5); after reload/unlock the page scrolls again. tsc clean, lint unchanged (8 existing warnings).
- **Not reproduced:** in the user's screenshot the content also sat roughly 28 css px below vertical centre. Cause unknown (possibly a different window size/browser or a mobile browser toolbar); asked the user which browser/window.
- Not pushed and not in `main` or `production` yet. The lock behaviour itself (no PIN -> "Sign in again", flag persisted) is unchanged.

### 2026-10-13 ~01:25-01:35 IST: read-only pass on the LIVE production app (user signed in as the real doctor) and a pre-existing bug
- The user signed in to production (`iclinic-theta.vercel.app`, database `rmuhpgpvgvwchovlgxae`) as a doctor; Claude Code only navigated and observed, created nothing. Production header shows the real clinic name from settings (**"Salem Pain & Palliative Care Clinic"**, so the header-name fix works), no Staging banner, empty queue (0 waiting, 0 seen today), no PIN set in that browser.
- All 8 sections load; tab titles `<section> · iClinic` (**More** is plain `iClinic`); all static assets and lazy chunks return 200; no error text on screen.
- **Found: repeated `400` from `GET /rest/v1/queue_events?select=id,...`** (3-5 per round of navigation). Root cause: the header event feed in `AppShell.tsx` selects an `id` column, but `queue_events` has **`request_id` as its key and no `id`** (verified on staging: `column queue_events.id does not exist`). So the "Doctor called / Reception sent in / Ready to bill / Discount review requested" header banner **and the reception call chime never work** (the chime consumes the same feed). It came in with Codex's alerts and chime commit `edf3d64` (PR #10) and has been in `production` since `d3d7150`; it is **not** caused by Claude Code's changes. Earlier statuses that called the chime/banner "built" or "verified" were wrong for the released build.
- Fix (`1e9ead5`, `src/components/AppShell.tsx`): `select('id:request_id,visit_id,action,created_at,visits(token_number)')`. Verified on staging: before the fix a doctor call produced no banner and the in-page query returned 400; after, reception showed **"Doctor called #3005"** within seconds. The audible chime was not heard (needs the sound toggle and speakers), but it uses the same feed, which is now valid.
- New check **`scripts/query-schema-smoke-test.mjs`** (replaces a narrower one-query test): parses every `.from('table')` chain in `src` (83 read queries; select strings plus every column used in `eq/neq/gt/gte/lt/lte/in/is/like/ilike/not/order`) and runs each against **staging** with `.limit(0)` as doctor, falling back to reception on permission errors. It fails on unknown column, table or relationship (codes 42703, 42P01, PGRST200/201/204/100) and ignores permission/type errors. **Red on the code as released to production (`e7e1820`): exactly one failure, `AppShell.tsx:167 queue_events: column queue_events.id does not exist`; green on the fix.** A deliberately broken column is also caught. Not covered: `.rpc()` calls (35; calling them would execute functions), select strings built with `${}`, and chains that insert/update before `.select()`. Run it after changing any query: `node scripts/query-schema-smoke-test.mjs`.
- Staging data created: synthetic visits tokens 3003, 3004, 3005 ("CALL... synthetic call check"), all parked with reception `not_here`. The temporary helper script was deleted.
- **This bug is live in production.** The fix is only on the local branch above; it needs a PR into `main`, then `main` -> `production`, together with the no-show layout fix, the "i" icon and the lock-screen centring fix. No migrations in that release.
