-- The previous migration's `revoke ... from anon, authenticated` still
-- left these three executable by anon/authenticated -- verified via
-- pg_proc.proacl, not assumed: it showed `{=X/postgres, postgres=X/postgres,
-- service_role=X/postgres}`, i.e. a bare `=X` entry granting EXECUTE to
-- PUBLIC (Postgres's own default at CREATE FUNCTION time, separate from
-- and prior to Supabase's own anon/authenticated grants). Since every role
-- is implicitly a member of PUBLIC, that alone was enough for anon and
-- authenticated to execute these regardless of the previous revoke.
-- assign_token_number/create_visit_pricing don't have this problem because
-- whatever closed their gap also stripped PUBLIC; this migration does the
-- same for the three added here.

revoke execute on function public.recompute_visit_pricing(uuid) from public;
revoke execute on function public.recompute_visit_pricing_from_procedures() from public;
revoke execute on function public.recompute_visit_pricing_from_prescription_items() from public;
