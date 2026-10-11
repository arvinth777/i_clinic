-- Security review finding: 20260906130000_billing_confirm.sql's `revoke
-- execute ... from public` on its three new functions closed the PUBLIC
-- grant, but missed a second, separate one -- Supabase's own default
-- privileges on the public schema grant EXECUTE to anon, authenticated,
-- and service_role directly at CREATE FUNCTION time (documented in
-- 20260905184543_fix_default_privileges.sql, which fixed the same gap for
-- the phase-1 functions; this migration didn't repeat that step for the
-- three functions this feature added). Confirmed via
-- has_function_privilege() before this migration: anon_exec=true on all
-- three, including confirm_bill and get_visit_billing_detail -- an
-- unauthenticated caller could invoke either over the REST API, even
-- though both would no-op/reject via their own has_clinic_role checks
-- (auth.uid() is null for anon, so every role check fails closed) --
-- fixed here as defense in depth, not because a live exploit path existed.
--
-- service_role is left alone, same reasoning as before: trusted,
-- non-client-exposed.

revoke execute on function public.confirm_bill(uuid, text) from anon, authenticated;
grant execute on function public.confirm_bill(uuid, text) to authenticated;

revoke execute on function public.get_visit_billing_detail(uuid) from anon, authenticated;
grant execute on function public.get_visit_billing_detail(uuid) to authenticated;

-- Trigger function, never called directly -- no client role needs EXECUTE
-- at all, same posture as bump_pricing_revision.
revoke execute on function public.set_bill_needs_reconciliation() from anon, authenticated;
