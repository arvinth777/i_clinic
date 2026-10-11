-- Security hardening (migration 002): closes the three findings from
-- Supabase's security advisor, surfaced immediately after
-- phase1_core_schema.sql applied to staging.

-- ============================================================
-- Unrevoked PUBLIC execute grants
--
-- Postgres grants EXECUTE to PUBLIC by default at CREATE FUNCTION time;
-- phase1_core_schema.sql never revoked it on any function. Applied
-- uniformly here across every function that shouldn't be directly
-- callable, not just the ones the advisor happened to flag -- the point
-- is establishing the right default before more functions get written
-- that copy the wrong one.
--
-- Trigger functions (assign_token_number, create_visit_pricing,
-- bump_pricing_revision) get no grant back at all: trigger invocation
-- happens inside the executor and isn't gated by the invoking session's
-- EXECUTE privilege on the function, so revoking PUBLIC doesn't stop the
-- triggers from firing -- it only stops the functions from being called
-- directly. (assign_token_number and create_visit_pricing are also
-- RETURNS TRIGGER, so Postgres already refuses to invoke them outside a
-- trigger context regardless -- this closes the grant anyway rather than
-- relying on that.)
--
-- has_clinic_role/has_any_clinic_role need `authenticated` specifically,
-- since RLS policies on every other table call them as the querying user
-- -- revoked from PUBLIC, re-granted explicitly to authenticated only.
-- anon gets nothing: an unauthenticated caller has no role to check
-- (auth.uid() is null, so the function would always return false anyway,
-- but there's no reason to leave the grant in place for it).
-- ============================================================

revoke execute on function public.assign_token_number() from public;
revoke execute on function public.create_visit_pricing() from public;
revoke execute on function public.bump_pricing_revision() from public;

revoke execute on function public.has_clinic_role(uuid, text) from public;
revoke execute on function public.has_any_clinic_role(uuid) from public;
grant execute on function public.has_clinic_role(uuid, text) to authenticated;
grant execute on function public.has_any_clinic_role(uuid) to authenticated;

-- public.rls_auto_enable() is left untouched -- a pre-existing platform
-- function, not written by this project.

-- ============================================================
-- pg_trgm relocated out of the public schema
--
-- Supabase's own convention is a dedicated `extensions` schema.
-- patients_name_trgm_idx (phase1_core_schema.sql) already depends on the
-- gin_trgm_ops operator class pg_trgm provides -- ALTER EXTENSION ... SET
-- SCHEMA relocates the extension's member objects by OID, not by
-- re-resolving a schema-qualified name, so the existing index is expected
-- to keep working without being dropped and recreated.
-- ============================================================

create schema if not exists extensions;
alter extension pg_trgm set schema extensions;
