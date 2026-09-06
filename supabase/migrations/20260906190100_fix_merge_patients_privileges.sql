-- The recurring gotcha this project keeps hitting, caught proactively
-- this time instead of after the fact: CREATE FUNCTION grants EXECUTE to
-- PUBLIC by default, and Supabase's schema-level default privileges
-- separately grant EXECUTE to anon/authenticated directly -- two ACL
-- entries. 20260906190000's `revoke ... from public` did not close the
-- anon grant. Checked directly via information_schema.routine_privileges,
-- not assumed: anon still had EXECUTE. merge_patients already checks
-- has_clinic_role(..., 'admin') internally and would reject an anon
-- caller regardless, but there's no reason for anon to reach it at all.
revoke execute on function public.merge_patients(uuid, uuid) from anon;
