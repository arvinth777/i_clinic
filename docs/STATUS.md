# Status — production branch

## Workflow and environment update — 2026-10-10

This branch contains planning documents and agent skills only. It has no
application, package.json, or migrations. Do not treat it as a working release.

- Copied approved workflow, selected project skills, clinical rework requirements,
  A4 references/layout proposal, and technical decisions from main's `a220a14`.
  Included design/security references required by that guidance.
- Updated the runbook with authenticated environment observations and copied
  `docs/hosting-options.md`, an unaccepted student-benefit/backend recommendation.
- Supabase staging and production were restored with user approval; both now
  report ACTIVE_HEALTHY. Staging has all 40 local migrations and three Edge
  Functions. Production has no migration history, public tables, or functions.
- Staging security advisor reports 0 errors and 23 warnings; function grants
  and role/clinic checks still require review. No schema or patient-data change.
- Vercel auto-setup created/linked i_clinic and uses main as production. Main
  push built automatically, READY, but frontend variables are absent. This
  does not establish a functioning clinic deployment. Latest backup runs failed.
- The 117 historical main commits were not promoted. Only documentation,
  reference images, selected skills, and ignore rules changed on this branch.
- Verification: staged whitespace/scope checks; required guidance paths exist.
  Main application build/lint passed earlier with existing warnings. They do
  not validate an application on this planning-only branch.

## Next

Choose backend/ongoing budget, reconcile hosting branch and variable scopes,
review security warnings, repair/test backups, then prepare a separate reviewed
application/database release. Resolve stock/billing units and refill source
prescription selection before implementing the rework. No provider switch is agreed.
