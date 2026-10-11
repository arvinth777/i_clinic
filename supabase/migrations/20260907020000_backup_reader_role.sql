-- Phase G (docs/build-plan.md item 8, docs/architecture-spec.md's "Backup
-- and recovery"): the weekly pg_dump backup job must run as a dedicated
-- read-only database role -- never service_role (a PostgREST/API concept,
-- not usable for a direct pg_dump connection anyway) and never the
-- postgres superuser (pg_dump only ever needs to read; a role that could
-- also write or alter schema is a liability the backup job doesn't need).
--
-- No password is set here, deliberately -- a password embedded in a
-- migration file is a secret permanently committed to git history, which
-- this project's docs/security-review.md rules out ("no service_role key
-- anywhere in the repo... every VITE_ variable is safe to be public" --
-- the same principle: nothing that grants access belongs in a committed
-- file). The role is created with LOGIN but no password, so it cannot
-- authenticate at all until a human sets one directly (Supabase Dashboard
-- -> Database -> Roles, or the SQL editor: `alter role backup_reader with
-- password '...'`) -- see docs/runbook.md's backup section for this as an
-- explicit human-only step, alongside generating the connection string
-- for the GitHub Actions secret.
--
-- Postgres tables are owned by `postgres` in this project (confirmed via
-- pg_tables.tableowner before writing this) -- the ALTER DEFAULT
-- PRIVILEGES clause is scoped `for role postgres` so a future migration's
-- new table is automatically readable by this role without needing its
-- own grant statement; otherwise every future table would silently be
-- missing from the backup until someone remembered to add one.

create role backup_reader with login nosuperuser nocreatedb nocreaterole noinherit;

grant usage on schema public to backup_reader;
grant select on all tables in schema public to backup_reader;
grant select on all sequences in schema public to backup_reader;

alter default privileges for role postgres in schema public
  grant select on tables to backup_reader;
alter default privileges for role postgres in schema public
  grant select on sequences to backup_reader;

comment on role backup_reader is
  'Read-only role for the weekly pg_dump backup job (GitHub Actions). No write privileges anywhere. Password is set out-of-band, never in a migration -- see docs/runbook.md.';
