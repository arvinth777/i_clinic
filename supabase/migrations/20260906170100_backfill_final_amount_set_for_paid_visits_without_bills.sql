-- Second pass on the same cleanup as 20260906170000: that migration only
-- matched visits with an existing bill to backfill final_amount_paise
-- from. 15 more turned out to be stage='paid' with NO bill row at all --
-- also seed data predating confirm_bill, created by setting stage='paid'
-- directly and never inserting into bills.
--
-- Fabricating a bill record for these would invent financial history that
-- never happened -- deliberately not done here. This only flips
-- final_amount_set true at whatever final_amount_paise already holds (the
-- untouched calculated total, for every one of these simple fixtures),
-- which is exactly what stops the "waiting for the doctor" display bug on
-- an already-closed visit, without inventing anything.

do $$
begin
  perform set_config('app.pricing_recompute', 'true', true);

  update public.visit_pricing vp
  set final_amount_set = true
  from public.visits v
  where vp.visit_id = v.id
    and v.stage = 'paid'
    and vp.final_amount_set = false;

  perform set_config('app.pricing_recompute', 'false', true);
end $$;
