-- Phase B security-review checkpoint: checked every SECURITY DEFINER
-- function's grants directly (information_schema.routine_privileges),
-- same discipline as every prior phase. Found two trigger functions
-- (returns trigger) still carrying the implicit PUBLIC:EXECUTE grant
-- every CREATE FUNCTION gets by default:
--
-- - apply_stock_movement (this phase) -- only revoked from anon/
--   authenticated at creation, never from PUBLIC itself. REVOKE ... FROM
--   anon does not touch a separate PUBLIC grant; a privilege check
--   passes via either path, so PUBLIC left it open regardless.
-- - ensure_final_amount_set_on_packing (an earlier phase) -- never had
--   any revoke at all; still had PUBLIC, anon, and authenticated grants.
--
-- Not a live exploit: Postgres refuses to invoke a RETURNS TRIGGER
-- function outside real trigger context, at the executor level,
-- regardless of EXECUTE grants -- there is no RPC/SQL path that reaches
-- either function directly. Fixed anyway for consistency with every
-- other function in this project (assign_token_number,
-- bump_pricing_revision, set_bill_needs_reconciliation all show zero
-- anon/authenticated/PUBLIC grants -- that's the reference shape these
-- two now match).

revoke execute on function public.apply_stock_movement() from public, anon, authenticated;
revoke execute on function public.ensure_final_amount_set_on_packing() from public, anon, authenticated;
