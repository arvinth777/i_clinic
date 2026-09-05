-- Migration 002's `revoke ... from public` didn't close the gap it meant
-- to. Confirmed via a read-only query against
-- information_schema.routine_privileges before writing this: Supabase's
-- own default privileges on the public schema grant EXECUTE to anon,
-- authenticated, and service_role directly at CREATE FUNCTION time --
-- separate ACL entries from PUBLIC's, unaffected by revoking PUBLIC.
--
-- service_role is left alone (not flagged by the advisor, and it's a
-- trusted, non-client-exposed role -- this is only about anon and
-- authenticated).

revoke execute on function public.assign_token_number() from anon, authenticated;
revoke execute on function public.create_visit_pricing() from anon, authenticated;
revoke execute on function public.bump_pricing_revision() from anon, authenticated;

revoke execute on function public.has_clinic_role(uuid, text) from anon;
revoke execute on function public.has_any_clinic_role(uuid) from anon;
-- authenticated keeps EXECUTE on these two -- RLS policies on every other
-- table call them as the querying user.
