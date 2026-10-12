# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

`AGENTS.md` is the authoritative rule set (non-negotiables on money, RLS, offline, environments, skill routing) — read it first, then `docs/STATUS.md`, `docs/rework-brief.md` (current clinical scope; supersedes older pricing/refill assumptions) and `prd-clinic-management-system.md`. Don't duplicate those rules here.

## Commands

```bash
npm run dev        # Vite dev server
npm run build      # tsc -b && vite build
npm run lint       # oxlint (existing warnings are expected)
node scripts/<name>-test.mjs   # run a single regression script
node isolation-test.mjs        # tenant/role isolation check
```

- There is no unit-test framework. `scripts/*-test.mjs` are plain Node scripts that run **against live staging**, signing in as real test roles (secrets read from `.env.local` and `.env.test-users.local`, never printed). Pass/fail only. `scripts/prescription-draft-test.mjs` is the one that needs no database.
- Frontend env: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (see `.env.example`); `src/lib/supabase.ts` requires both.
- Schema changes: new immutable file in `supabase/migrations/` (timestamped), applied with the Supabase CLI to staging first. Never live-patch SQL; Supabase MCP is read-only verification only. See `docs/runbook.md` before any push/deploy/migration — `main` is the staging branch (feature PRs land here and deploy as a preview against staging), and `production` is the release branch (merging into it deploys). Confirm Vercel's production branch is `production` before pushing `main` (a `main` push once deployed as Production, 2026-10-10).

## Architecture

React 19 + Vite + Tailwind 4 PWA (`vite-plugin-pwa`) on Supabase (Postgres + RLS + Realtime + Edge Functions in `supabase/functions/`: `health`, `admin-create-login`, `backup-freshness`). Weekly encrypted DB backup runs from `.github/workflows/backup.yml` → `scripts/backup.sh`.

- **Role-driven shell** (`src/App.tsx`): `useSession` + `useUserRoles` decide which sections (`pages/Reception`, `Consultation`, `Stock`, `Reports`, `Admin`, …) a login sees. `locked` state (idle PIN lock, `lib/pinLock.ts`, `useIdleTimer`) lives in App because sibling `OfflineQueueBanner` must redact patient names while locked. Single clinic: `clinic_id` comes from the user's role row.
- **Server state** (`lib/queryClient.ts`, `persistQuery.ts`): TanStack Query, persisted to IndexedDB for offline reads. Realtime only invalidates queries; a 30s refetch interval and refetch-on-focus are the backstop.
- **Offline writes** (`lib/offlineQueue.ts`, `useOfflineQueue.ts`): a separate idb-keyval store (never expires) holding `insert|update|delete|rpc` mutations with a client-generated uuid that doubles as the row PK so replay is an idempotent upsert. UI must show "not saved yet" via `OfflineQueueBanner`. Prescription drafts have their own path (`lib/prescriptionDraft.ts`); printing is browser print of on-screen content (no server call).
- **Money** (`lib/money.ts`): integer paise only; `formatPaise` is display-only. Billing/stock/discount/correction logic is enforced in Postgres (RPCs, constraints, RLS) in the migrations, not just the UI — bill confirmation + stock deduction are one idempotent transaction, and paid bills are corrected via a new referencing row (`correct_bill`).
- **Visits flow**: Reception registers/tokens patients → Consultation (doctor sets final amount, prescription) → Billing/settle. Refill-only sales skip the doctor queue per `docs/rework-brief.md` (specified, not yet implemented — check STATUS before assuming).
- **Styling**: per-component `.css` beside each component plus tokens in `src/index.css`; new color/size/spacing/radius values must be tokens documented in `docs/design.md`.

## Gotchas

- Docs describe requirements and audit findings that are **not necessarily implemented**; `docs/codebase-audit.md` lists known unfixed defects (browser-supplied payment amounts, permissive bill insert policies, print output hidden, etc.). Verify against source and migrations.
- `docs/STATUS.md` is long and chronological; update it (done / checks / uncommitted / issues / next) before ending work.
- Production DB is currently empty and staging uses synthetic data only — never copy patient data into staging or logs.
