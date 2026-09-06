# Runbook

Written for a stranger picking this up cold, with the maintainer unreachable
-- that is the actual failure mode this document exists for, not a
hypothetical. Credentials are referenced by name and location only; no
value ever belongs in this file or anywhere else in the repo.

## Account inventory (where each thing lives)

All infrastructure accounts are registered under the sole maintainer's
**personal** identity, not a clinic-owned one (docs/architecture-spec.md) --
clinic staff are never asked to hold credentials they wouldn't know what to
do with. A named trusted contact has time-delayed emergency access via the
password manager's own built-in feature (see "Continuity" below) -- that is
the actual handoff mechanism, not this document alone.

| What | Where | Notes |
|---|---|---|
| Source code | GitHub, `arvinth777/i_clinic` | `main` branch is default; `production` branch is the deploy trigger (see Deploying) |
| Frontend hosting | Vercel, Hobby tier | Static SPA build (`vite build`) -- the tier is a deliberate, temporary accommodation; upgrade trigger below |
| Database + Auth + Realtime + Edge Functions | Supabase, two projects, Free tier | `clinic-staging` (ref `cofnrcgsolluyhghutah`) and `clinic-prod` (ref `rmuhpgpvgvwchovlgxae`) -- Free's 2-project ceiling is fully spent, no third slot exists |
| Backup storage | Cloudflare R2 | Bucket holds weekly encrypted `pg_dump` snapshots (see Backups) |
| Backup encryption | `age` keypair | Public key committed at `backup/age-public-key.txt`; private key lives **only** in the password manager (see Backups -- this is the single most important line in this document) |
| CI/CD | GitHub Actions | Runs the weekly backup job (`.github/workflows/backup.yml`); Vercel handles frontend preview/production deploys itself, not Actions |
| Uptime/freshness monitoring | UptimeRobot (or equivalent) | **Not yet wired up** -- see "Monitoring: what's live vs. what's pending" below. Until it is, a failing health check or a stale backup is invisible to everyone |
| Domain registrar | (see password manager) | Set to auto-renew, 5+ year prepaid window, per architecture-spec.md -- expiry is a monitoring-surface item, not something to trust arriving by email |
| Password manager / emergency access | (the maintainer's own) | Holds every actual secret value: Supabase DB passwords, R2 API tokens, the age private key, domain registrar login. A named trusted contact gets automatic access after a waiting period if the maintainer doesn't respond -- configure this *before* it's needed, not after |
| WhatsApp / Meta | Not built | Out of scope for this build (see docs/build-plan.md's "Deliberately excluded") -- no account exists yet |

## Deploying

- `main` -> automatic preview deploy on Vercel, pointed at the **staging** Supabase project. Never production.
- Merging `main` -> `production` is the production deploy trigger, pointed at **clinic-prod**. Deliberate -- a push to `main` never auto-deploys to production.
- Promotes (merging into `production`) and migrations happen **before 10am or after 3pm only** -- the clinic runs 10am-3pm. A bad change during clinic hours is the one outage this timing rule exists to prevent.
- Migrations are applied **separately from deploys** (see "Applying a migration" below), and always run against staging first.
- The upgrade trigger for Vercel Hobby -> Pro (or a move to Cloudflare Pages) is recorded so it's never rediscovered via a suspension notice: **the day a second clinic starts using the system.** That is also the day there is revenue to cover the tier change. The build is a portable static SPA specifically so this move is a config change, not a migration.

## Applying a migration

Migrations are **immutable once applied** -- never edit a migration file that has already been run anywhere. If a schema decision was wrong, write a new migration that corrects it (see docs/STATUS.md's "Context a future session needs" for real examples of this happening).

1. Write the migration in `supabase/migrations/`, named `YYYYMMDDHHMMSS_description.sql`.
2. Link the CLI to **staging** if not already (`supabase link --project-ref cofnrcgsolluyhghutah`) and run `supabase db push`. Confirm it applies cleanly and run the relevant test script(s) in `scripts/` against staging.
3. Every `SECURITY DEFINER` function needs, without exception: `set search_path = ''`, fully-qualified references inside, and EXECUTE revoked from `public`/`anon`/`authenticated` then re-granted only to the specific role(s) that need it. **Supabase grants EXECUTE to `anon` and `authenticated` directly at `CREATE FUNCTION` time, as separate ACL entries from `PUBLIC`'s** -- revoking from `public` alone does not close this (this is a recurring gotcha in this project's history; confirm via `information_schema.routine_privileges` after every such migration, not just by reading the migration text).
4. Changing an existing function's argument list (adding a required or extra parameter) creates a **second overload** if done via a bare `CREATE OR REPLACE` -- this breaks every existing caller with "function is not unique". Always `DROP FUNCTION` the old signature first, then `CREATE`, then redo every grant (grants never carry across a signature change).
5. Only once staging is verified: link the CLI to **production** (`supabase link --project-ref rmuhpgpvgvwchovlgxae`) and `supabase db push`, during the 10am-before/3pm-after window.
6. Never use the Supabase MCP tools to change anything, on either project -- they are read-only verification only (`get_advisors`, `execute_sql` for `SELECT`s, `list_tables`). Every schema or data change is a migration file, applied via the CLI, committed. A database fixed by direct SQL and a migration file that doesn't contain that fix is how staging and production silently diverge.

## Backups

The weekly `pg_dump` **is** the primary backup, not a supplement to Supabase's own tier -- Free's retention is short and not something this project controls or can reliably restore from at will (docs/architecture-spec.md). Treat a failed or silently-stopped backup job as a real incident.

**How it runs**: `.github/workflows/backup.yml`, GitHub Actions, weekly (Sunday 20:00 UTC), never Vercel cron (Hobby cron is once-daily and can't shell out to `pg_dump`/`age`/`aws` anyway). The job (`scripts/backup.sh`) connects as `backup_reader` -- a dedicated, read-only Postgres role (migration `20260907020000_backup_reader_role.sql`), never `service_role`, never the `postgres` superuser -- dumps the `public` schema only (not `auth.users`; see below), gzips, encrypts with `age` using the **public** key committed at `backup/age-public-key.txt`, and uploads to the R2 bucket via its S3-compatible API.

**Why `auth.users` is out of scope**: a full disaster-recovery restore does not attempt to replay Supabase's own auth tables bit-for-bit. Logins are recreated via the existing `admin-create-login` Edge Function (the normal way any login is created in this app) after a restore, not by restoring `auth.*` directly. This is a real, accepted limitation -- a restore gets every patient, visit, bill, and stock record back, but every staff login must be re-created by an admin afterward.

**Restoring from a backup, step by step:**

1. Find the object you want in the R2 bucket (named `clinic-backup-<UTC timestamp>.sql.gz.age`) -- the R2 dashboard or `aws s3 ls --endpoint-url https://<account id>.r2.cloudflarestorage.com s3://<bucket>` (credentials from the password manager) lists them. Download it.
2. Decrypt: `age -d -i <path to the age private key, from the password manager> -o clinic-backup.sql.gz clinic-backup-<timestamp>.sql.gz.age`
3. Decompress: `gunzip clinic-backup.sql.gz` -- you now have a plain-text `.sql` file, restorable with a standard `psql`, not a special tool.
4. Restore into the **target** database (a fresh Supabase project for a full disaster recovery, or a local Postgres instance to inspect/verify first -- never restore directly on top of a database still serving traffic without a very good reason): `psql "<target connection string>" -f clinic-backup.sql`
5. Re-create staff logins via the Admin > Logins screen (or the `admin-create-login` Edge Function directly) -- these are not in the dump (see above).
6. Re-apply anything from "Applying a migration" that was written after this particular backup's timestamp, in order, if restoring into a project that started from this snapshot.
7. **Sanity-check before trusting it**: row counts on `patients`/`visits`/`bills` roughly match expectations for the backup's date; a known patient/visit from around that time is actually present; `bills_needing_reconciliation` and stock levels look plausible, not zeroed out.

**One restore drill should happen before this is trusted with real patients** (docs/architecture-spec.md: "an untested backup is a hope, not a backup") -- steps 1-4 above have been dry-run against staging with a synthetic payload during this build (encryption round-trip verified byte-for-byte), but the actual `backup_reader` credential path, the real R2 upload, and a real `psql` restore have **not** been exercised end-to-end yet, because they need real credentials that don't exist until the pending setup steps below are done. Do that drill as the very first real run of this pipeline, not the first time it's actually needed.

## Monitoring: what's live vs. what's pending

Two public, credential-free endpoints exist and answer correctly today, verified live against staging:
- **Keep-alive** -- `https://<project ref>.supabase.co/functions/v1/health` -- performs a real database read (via `public.health_ping()`, a narrow function granted to `anon` alone -- see its own migration/function comments for why it isn't a direct table read) and returns exactly `{"ok":true}` (200) or `{"ok":false}` (500), nothing else. Exists so a week of the clinic being closed doesn't let Supabase Free auto-pause the project.
- **Backup freshness** -- `https://<project ref>.supabase.co/functions/v1/backup-freshness` -- lists the R2 bucket and returns `{"ok":true}` (200) if the newest object is under 8 days old, `{"ok":false}` (500) otherwise (including "can't reach R2 at all" -- fails closed). **Currently always returns 500**, because the R2 secrets it needs (`R2_ACCOUNT_ID`/`R2_ACCESS_KEY_ID`/`R2_SECRET_ACCESS_KEY`/`R2_BUCKET` as Supabase Edge Function secrets) aren't set yet -- see "Pending setup" below.

**Both endpoints existing and returning green is not the same as being monitored.** Neither is wired to an actual external uptime monitor yet. Until that's done:
- A dormant/paused Supabase project would go unnoticed until someone happens to open the app.
- A silently broken or never-run backup job would go unnoticed indefinitely -- there would be no visible symptom at all until an actual restore was needed and failed.

This is a real, currently-open gap, not a hypothetical -- treat it as the top of the pending-setup list below, not an afterthought.

## Pending setup (human-only steps -- nothing here can be done by an agent)

These block the backup job and monitoring from being real, not just built:

1. **Generate the `age` keypair's home in a password manager.** A keypair was generated during this build; the public half is committed (`backup/age-public-key.txt`). The private half was handed off out-of-band (not pasted into any chat log or file this repo tracks) -- move it into the password manager immediately if that hasn't happened yet, and confirm no local copy remains anywhere. Without this, a restore is impossible regardless of how well the backup job runs.
2. **Set `backup_reader`'s password.** The role exists (migration `20260907020000`) but has no password -- a migration file is permanent, world-readable git history, so the password was deliberately never written into one. Set it via the Supabase Dashboard (Database -> Roles -> `backup_reader`) or the SQL editor (`alter role backup_reader with password '...'`), on **both** staging and production (production needs the same migration applied first -- see "Applying a migration"). Assemble the resulting connection string and store it as the GitHub Actions secret `BACKUP_DB_URL`. If the direct connection (port 5432) isn't reachable from GitHub's runners, use the Session-mode pooler connection string instead (same role/password) -- Supabase's own docs cover this; transaction-mode pooling does not support `pg_dump` reliably.
3. **Create the Cloudflare R2 bucket and its API tokens.** Two separate, least-privilege tokens are recommended, not one: a write-only token for the backup job (GitHub secrets `R2_ACCOUNT_ID`/`R2_ACCESS_KEY_ID`/`R2_SECRET_ACCESS_KEY`/`R2_BUCKET`) and a read-only token for the freshness check (Supabase Edge Function secrets of the same names, `supabase secrets set --project-ref <ref> R2_ACCOUNT_ID=... R2_ACCESS_KEY_ID=... R2_SECRET_ACCESS_KEY=... R2_BUCKET=...`).
4. **Wire both public endpoints to an external uptime monitor** (UptimeRobot or equivalent) -- ping both `.../functions/v1/health` and `.../functions/v1/backup-freshness` on the monitor's own schedule, alerting on non-200. This must be an *external* monitor, not a GitHub Actions cron -- a dormant repository must never be able to silence its own monitoring.
5. **Run the restore drill** (see Backups above) once steps 1-3 are done, before this is trusted for real patients.

## "It's not loading" at 11am

The clinic is mid-day; something's broken. Work through this in order -- most outages are one of the first three:

1. **Is it everyone, or one device?** One device: check its own network/browser first (a service-worker-cached stale build, a local network drop). Everyone: continue below.
2. **Check the two public health signals first** -- they need no login: `.../functions/v1/health` should return `{"ok":true}`. If it returns `{"ok":false}` or times out, the database itself is the problem (see step 4), not the frontend.
3. **Check Vercel's own status** (dashboard or status page) -- a bad deploy or a Vercel-side incident shows here. If a recent deploy is the cause, redeploying the previous working commit (Vercel's dashboard supports instant rollback to any prior deployment) is faster than debugging forward.
4. **Check whether the Supabase project itself is paused or degraded** -- Free-tier projects pause after 7 days with no database activity (the keep-alive endpoint exists specifically to prevent this, but check anyway: a monitoring gap per "what's pending" above means this could go unnoticed). The Supabase dashboard shows project status directly; an unpause is one click.
5. **Check the domain** -- expired registration or a DNS change would present as "not loading" with no application-level symptom at all. Confirm the domain resolves and the registrar shows it active.
6. **If nothing above explains it**, check Vercel's function/build logs and the browser console for the actual error -- at this point it's a real debugging session, not a checklist. This project's own `diagnosing-bugs` skill (systematic, not guess-and-check) is the right process from here.

## Known gotchas

Distilled from docs/STATUS.md's full build history -- read that file for the complete record and the reasoning behind each; this is the operationally-relevant summary.

- **Migrations are immutable once applied.** Never edit an applied migration file -- write a new one, even for a one-line fix. Every instance of this project fixing its own mistake did it this way (e.g. Phase F's `confirm_bill` regression, fixed by a follow-up migration restoring the correct body, never by editing the buggy one).
- **The two-Supabase-privilege-grant gotcha keeps recurring.** `revoke ... from public` alone never closes `anon`/`authenticated`'s own separate default-privilege grants. Confirm via `information_schema.routine_privileges` after every new or changed `SECURITY DEFINER` function, every time, no exceptions.
- **RLS-denied writes can look like success.** An `UPDATE` a caller isn't permitted to make returns `{ data: [], error: null }` -- zero rows, no error -- not a thrown error. Any code path that checks only for `error` on an `UPDATE`/`DELETE` and assumes success will be silently wrong the moment permissions deny it; check `data.length` too (the offline mutation queue, `src/lib/offlineQueue.ts`, was fixed for exactly this).
- **A user can legitimately hold more than one role at one clinic** (the doctor holds `{doctor, admin}`). Any query assuming "at most one row" for a role check (`.maybeSingle()` without `.limit(1)` first) will break the moment it runs as someone holding both.
- **`auth.users` is not reachable from a plain client query** -- it's outside the schema PostgREST exposes. Anything needing a login's email needs a `SECURITY DEFINER` RPC or an Edge Function with the service role, never a direct query.
- **Creating a login needs the service role** -- `supabase/functions/admin-create-login` is the pattern: check authorization with a caller-JWT-bound client first, then switch to a service-role client for the actual privileged write, rolling back the auth account if the follow-up role-assignment insert fails.
- **Removing a login's role does not delete the underlying account** -- deliberate (an identity may hold a role at a second clinic once one exists). There is currently no in-app way to hard-delete a login entirely; that needs the Supabase Dashboard.
- **Every reports function derives `clinic_id` from `auth.uid()`, never accepts it as a parameter** -- this is the one invariant keeping the admin reports from becoming a cross-clinic read for any authenticated caller. Grep any future report-style function for `p_clinic_id` before it ships; there should be none.
- **`networkMode: 'always'` is mandatory on any `useMutation` wrapped in the offline queue's `attemptOrQueue`.** React Query's default (`'online'`) silently pauses a mutation before it ever runs while offline -- no error, the button just looks like it's doing nothing.
- **A client-generated UUID is the entire idempotency mechanism for offline-queued inserts** (`upsert(row, { onConflict: 'id', ignoreDuplicates: true })`) -- no separate idempotency-key column exists or is needed. A future offline-queued insert should follow this, not invent a new mechanism.
- **`confirm_bill` takes 4 args now** (`p_visit_id, p_payment_method, p_snapshot_final_amount_paise, p_snapshot_revision_number`), the last two optional/null-default for the offline money-conflict design. Any future change to this function must extend it the same drop-then-create way (see "Applying a migration" above), or every existing 2-arg caller breaks with "function is not unique".
- **A device only works offline for a query it already fetched while online.** The persisted-reads cache makes an already-successful query durable across a reload; it doesn't invent offline access to one that never ran.
- **Staging is shared, ever-growing synthetic data, never a real patient.** Test scripts assert *deltas* around known fixtures, not absolute totals, for exactly this reason -- an absolute assertion (`daily collections == X`) will eventually break as staging accumulates more fixture data, and that's expected, not a regression.

## What a new developer needs

1. Read, in order: this file, `AGENTS.md` (non-negotiables and stack), `docs/design.md` (design system pointer), `docs/architecture-spec.md` (the cross-cutting decisions -- offline conflict resolution, auth/roles, printing, backup, hosting), `docs/STATUS.md` (the full build log, phase by phase), `docs/build-plan.md` (what's left, if anything).
2. `.env.example` names the two `VITE_`-prefixed variables needed for local dev (both safe to be public -- they ship in the browser bundle regardless). Point them at **staging**, never production, for any local work.
3. Test convention: plain Node scripts in `scripts/` (and `isolation-test.mjs` at the repo root) run against live staging, not a mocked test framework -- read a couple of them (`scripts/phase-f-test.mjs` is a good recent example) before writing a new one, and follow the existing `loadEnv()`/sign-in pattern. Browser-level flows use a throwaway Playwright script, deleted after use, driving the **production build** (`npm run build && npx vite preview`) whenever the service worker/offline behavior matters -- `npm run dev` disables it.
4. This project follows the skills named in `AGENTS.md`'s "Skill orchestration" section -- `tdd` before touching pricing/stock/discount logic, `docs/security-review.md` plus the Supabase security advisor before anything touching money/auth/RLS/patient data, `code-review` before merging anything non-trivial, `ponytail` as the standing discipline on file size and scope.
5. Never disable RLS "temporarily" to debug, never store money as anything but bigint paise (including in a test fixture), never touch pricing/discount/stock logic without a test, never invent a feature not in the PRD (`prd-clinic-management-system.md`) without proposing it first.
