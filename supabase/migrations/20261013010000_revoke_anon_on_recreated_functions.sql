-- Migration 20261012010000 dropped/recreated get_daily_report (default grants returned,
-- including the direct anon grant that REVOKE FROM PUBLIC does not remove) and added the
-- guard_visit_identity trigger function without revoking execute. Restore the intended grants.
revoke all on function public.get_daily_report(date) from public, anon;
grant execute on function public.get_daily_report(date) to authenticated, service_role;

-- Trigger functions run as triggers without an EXECUTE check; nobody should call them via RPC.
revoke all on function public.guard_visit_identity() from public, anon, authenticated;
