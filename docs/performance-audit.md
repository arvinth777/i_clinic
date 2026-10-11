# Loading, unused code and sync audit — 2026-10-11

What this repo does: a clinic workspace for reception, consultations, prescriptions,
billing and stock, with pending writes stored locally and Supabase used for live
updates. This audit assumes the current one-doctor/one-reception workflow on two
computers; the second-doctor feature remains deferred.

Audited source: `daf1bfa`, plus the existing uncommitted future-doctor documentation.
At audit time no application code, dependency, migration or production deployment had been changed. The implementation checkpoint below is separate from that audit.

## Fresh evidence

| Check | Result |
|---|---|
| Production build | Pass, 711 modules; main JS 925.61 kB / 263.40 kB gzip; CSS 76.17 kB / 14.72 kB gzip |
| Service-worker precache | 25 entries, 2600.88 KiB |
| Source import graph | 99 TS/TSX/CSS files; only `SectionStepper.tsx` is unreachable from `main.tsx` |
| Repository reference checks | Three unused font packages; old stepper referenced only by historical documentation; public full-sheet scan not used by application code |
| Staging realtime membership | `visits`, `visit_pricing`, `bills`, `pharmacy_sales`; verified through read-only metadata query after confirming clinic-staging |
| Two-role realtime probe | One synthetic reception check-in INSERT reached doctor at 491 ms and reception at 492 ms from request start; doctor refetch took 227 ms |
| Probe cleanup | Removed synthetic visit, auto-created pricing and patient after correcting FK cleanup order |
| Browser inspection | Normal cached reload of hosted staging doctor screen; JS/CSS/fonts served by the service worker; observed recurring visits/event queries |
| Animation-only build experiment | Temporary build excluding Motion usage: main JS 804.47 kB / 224.21 kB gzip; source files unchanged |

The sync probe measures backend delivery and a refetch, not click-to-painted-row
latency on both actual clinic computers. It is one sample, not a percentile or
latency guarantee. Browser observations used an existing authenticated session,
warm caches and a profile with extensions; they are not a clean cold-load or
Core Web Vitals benchmark. No Lighthouse score, LCP, INP or CLS result is claimed.

## Should fix

1. **Every screen loads with the first screen** (`src/App.tsx:6–18`).
   - What this is: all page modules are imported eagerly, including reports,
     settings, reconciliation and stock, even before sign-in.
   - Problem: the first JS bundle is 925.61 kB and includes code the current role
     or screen may never use.
   - Fix: load secondary pages on demand with React lazy/Suspense, keeping the
     core reception/doctor path readily available. Preserve offline access by
     precaching required chunks; splitting code alone does not reduce the total
     service-worker download. Test chunk failures, updates and offline navigation.
   - If skipped: first-time startup keeps paying for the whole application.
     Exact savings depend on the split and must be measured after implementation.
     [React lazy](https://react.dev/reference/react/lazy),
     [code splitting guidance](https://web.dev/articles/code-splitting-suspense).

2. **An obsolete full-page image is still downloaded for offline storage**
   (`public/letterhead-a4.png`, `vite.config.ts:25`).
   - What this is: the original scan is 1,165,570 bytes; the current print component
     instead uses live SVG text plus separate logo/watermark images.
   - Problem: the PNG glob still precaches this unused public copy. It accounts
     for about 44% of the measured precache bytes.
   - Fix: remove the obsolete public copy; retain the reference image under docs.
     The image fixture uses the docs copy, and the print test explicitly rejects
     using the full-page scan. Keep the actual print fonts/artwork cached.
   - If skipped: a new installation/update transfers roughly 1.17 MB unnecessarily.
     This is background installation traffic, not a measured 1.17 MB rendering delay.

3. **A full animation library serves six button press effects**
   (`Reception.tsx`, `Billing.tsx`, `NewPatientForm.tsx`, `PrescriptionForm.tsx`).
   - What this is: all Motion usages are `motion.button` with scale/rotation on press.
   - Problem: a temporary production-build experiment without these usages reduced
     JS by 121.14 kB raw / 39.19 kB gzip, around 15% of current compressed JS.
   - Fix: reproduce the same approved press feedback with CSS and reduced-motion
     support, then remove Motion. Check keyboard, disabled and pointer behaviour.
   - If skipped: every initial load carries this library for small visual effects.
     The experiment proves bundle impact; it did not verify a replacement UI.

4. **Fast polling continues even when realtime is healthy**
   (`src/components/AppShell.tsx:133,150`, `src/pages/Consultation.tsx:83`).
   - What this is: header queue and latest-event queries run every three seconds;
     the doctor queue also runs every three seconds.
   - Problem: those intervals alone schedule about 100 requests/minute across a
     foreground doctor/reception pair, before other queries and event refetches.
     These are configured rates, not a sustained measured clinic traffic total.
   - Fix: keep immediate event invalidation/refetch; use a slower healthy-socket
     backstop and fast recovery while disconnected, with reconnect/focus refetch.
     Subscription state must be correct before reducing polling.
   - If skipped: avoidable database/network work continues throughout the day.
     Do not remove polling entirely: it repairs missed updates.

5. **Showing 50 queue rows does not limit the database download**
   (`src/components/TokenList.tsx:83–89`, `src/pages/Consultation.tsx:90–97`).
   - What this is: both queues fetch older open records, then limit visible rows
     in the browser. Reception's `stage.neq.paid` also fetches historical no-shows
     that its Earlier filter subsequently hides.
   - Problem: payload and sorting/persistence work grow with old records; eventually
     an API row cap can truncate results. Staging currently displays 335 earlier
     open visits, demonstrating that the older-work path is active.
   - Fix: keep today's operational queue focused; page Earlier open visits on the
     server, exclude closed historical no-shows, and preserve unpaid-bill access.
     Add a regression with more old rows than the API cap and today's patients.
   - If skipped: accumulated history makes live queue refresh heavier and risks
     incomplete lists. Do not solve this by deleting visits or hiding unpaid work.

6. **Rep-arrival subscription cannot receive database changes**
   (`src/components/RepQueueRows.tsx:33–41`).
   - What this is: the doctor subscribes to `pharma_rep_checkins`.
   - Problem: the table is absent from staging's actual realtime publication and
     from the production bootstrap's publication list. The 30-second default poll
     currently supplies updates instead.
   - Fix: add publication membership through an immutable staging-first migration,
     retaining RLS, then test actual reception-to-doctor event delivery.
   - If skipped: this specific queue can appear delayed despite a connected socket.
     Patient visits and pricing are already enabled; they are not affected by this
     missing membership. [Supabase replication setup](https://supabase.com/docs/guides/realtime/postgres-changes).

## Nice to have

7. **Confirmed obsolete source and font dependencies remain**
   (`src/components/SectionStepper.tsx`, `package.json:13–16`).
   - What this is: the old 72-line stepper and Geist Sans, Geist Mono and Inter
     packages remain after the Hanken Grotesk redesign.
   - Problem: no application, test, fixture or config imports them. Historical docs
     mention the old stepper; they are not executable callers.
   - Fix: delete the component and remove those three packages with lockfile updates.
     Preserve Hanken Grotesk and the letterhead's distinct print fonts.
   - If skipped: unnecessary source/dependencies remain to maintain. They are already
     excluded from the runtime bundle, so this is cleanup, not a claimed speed win.

## Verdict and next pass

The app does not need another rewrite. Fix initial-bundle weight and the unused
precache image first; then tighten queue fetching and polling without weakening
realtime/offline recovery. Preserve money/stock transactions, RLS, historical
migrations, printer calibration, test scripts and design references: these are not
unused runtime features just because they do not appear on the home screen.

Lean: at least 72 obsolete source lines and 3 dependencies can be removed; one
additional dependency can be replaced after preserving its button behaviour.
An unused 1.17 MB public asset can also be removed.

Not checked: real clinic-network latency, cold mobile performance, complete
click-to-render doctor/reception timing, disconnect/sleep recovery, fresh browser
offline reload, every CSS selector/export or SQL function, and a full security/
money/stock audit. No source-mapped build was deployed; experiments stay in /tmp.

## Implementation and verification — production baseline f01a36b

The performance branch excludes pending Google Drive changes. Deleted only the
unused public full-sheet image, old stepper, three font packages and Motion.
Secondary routes use lazy loading; every JS/CSS/font/print asset remains precached.
Named CSS press tokens retain disabled and reduced-motion behaviour.

Same-base builds: eager JavaScript 259.25→205.15 kB gzip (index plus shared utils,
about 21% lower); PWA precache 2584.98→1337.34 KiB (about 48% lower). Browser
measurements are not a cold-load benchmark or a clinic-network latency guarantee.

One shell subscription now invalidates both queues and event messages, groups
bursts within 100 ms, and refetches on reconnect. Polling is 30s when subscribed
and 3s when disconnected. The immutable staging migration adds rep arrivals and
queue events to publication; both retain existing RLS and role/clinic policies.
Today's queries exclude older rows. Earlier open visits and discount requests
page at 50; saved earlier pages and yesterday's queue survive an offline date
rollover. Pending writes keep the existing IndexedDB/replay boundary.

Fresh checks: build/lint (seven existing warnings), cache rollover/burst/fallback,
legacy patient/billing cache, draft, offline replay ownership, print readiness
and billing print snapshot tests pass. Staging partial-dispensing tests pass.
The staging scaling test paged all 1,005 synthetic older visits and kept today's
patient accessible; all its fixtures were removed. Doctor-channel delivery was
842 ms for the patient/rep and 1,498 ms for the queue event, measured from the
start of the check-in request (sequential operations, one sample).

Browser: independent doctor/reception sessions on the production build against
staging showed a reception check-in in both queues; earlier pages grew 50→100.
Inventory and Patients opened lazily; the chunk-error recovery message and Reload
worked when a local rebuild removed old chunks. Both staff layouts have no
horizontal page overflow at 390px; Hanken Grotesk and 15px body remain.

Actual browser offline reload remains unverified: earlier network emulation was
rejected by automatic approval review; no alternate mechanism was attempted.
The staging security advisor reports zero errors/34 existing warnings (plus two
Drive-related information notices). Four existing dependency advisories remain;
this performance change does not clear the full security backlog.
