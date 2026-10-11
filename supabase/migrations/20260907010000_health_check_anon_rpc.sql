-- Phase G (docs/build-plan.md): the health endpoint must use the anon key,
-- not service_role -- a publicly-callable Edge Function holding
-- service_role is a liability with no upside once the anon key can prove
-- the same thing.
--
-- It cannot just switch supabase/functions/health/index.ts to the anon key
-- against `clinics` directly, though: clinics_select's RLS policy calls
-- has_any_clinic_role(id), and 20260905184543_fix_default_privileges.sql
-- deliberately revoked EXECUTE on that function from anon (confirmed via
-- information_schema.routine_privileges before writing this) -- anon
-- hitting it fails closed with "permission denied for function
-- has_any_clinic_role" (a real Postgres error, not a clean empty result).
-- That revoke was a correct, deliberate hardening decision (this project's
-- security-review.md: "no table is reachable by anon") and re-granting it
-- to make this one endpoint's response cleaner would reopen exactly the
-- surface that migration closed, for every other RLS-gated table in the
-- schema, not just this one.
--
-- Instead: a narrow, single-purpose SECURITY DEFINER function that does
-- nothing but confirm `clinics` is queryable, returns a bare boolean (never
-- row content), and is granted to anon alone -- the same idiom this project
-- already uses for every other narrow cross-privilege read (list_clinic_logins,
-- admin_set_clinic_upi_vpa, etc.), just with anon instead of authenticated
-- as the one caller who needs it.

create function public.health_ping()
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (select 1 from public.clinics);
$$;

-- Supabase's own default privileges grant EXECUTE to anon/authenticated
-- directly at CREATE FUNCTION time, as separate ACL entries from PUBLIC's
-- (the exact gotcha 20260905184543_fix_default_privileges.sql exists to
-- document) -- revoking from public alone would not actually close this.
revoke execute on function public.health_ping() from public, anon, authenticated;
grant execute on function public.health_ping() to anon;
