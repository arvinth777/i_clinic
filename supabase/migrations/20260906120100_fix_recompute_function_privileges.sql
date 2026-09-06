-- Same gap fix_default_privileges.sql closed for assign_token_number and
-- create_visit_pricing, hit again: revoking EXECUTE on the three new
-- recompute functions inside the same migration that created them
-- (20260906120000_recompute_visit_pricing.sql) did not stick -- confirmed
-- via a read-only has_function_privilege() query showing anon and
-- authenticated could still execute all three right after that migration
-- ran. Whatever grants EXECUTE to anon/authenticated at CREATE FUNCTION
-- time evidently isn't finished acting within that same transaction; a
-- standalone follow-up migration, same shape as fix_default_privileges.sql,
-- closes it -- and this one was re-verified afterward, not assumed.

revoke execute on function public.recompute_visit_pricing(uuid) from anon, authenticated;
revoke execute on function public.recompute_visit_pricing_from_procedures() from anon, authenticated;
revoke execute on function public.recompute_visit_pricing_from_prescription_items() from anon, authenticated;
