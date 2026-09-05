# Runbook

## Deploying

- `main` → automatic preview deploy on Vercel, pointed at the **staging** Supabase project. Never production.
- Merging `main` → `production` is the production deploy trigger, pointed at **clinic-prod** (the `rmuhpgpvgvwchovlgxae` Supabase project). Deliberate — every push to `main` does not auto-deploy to production.
- Promotes (merging into `production`) and migrations happen **before 10am or after 3pm only** — the clinic runs 10am–3pm.
- Migrations are applied **separately from deploys**, and run against **staging first**, never bundled into the same step as a frontend deploy.
