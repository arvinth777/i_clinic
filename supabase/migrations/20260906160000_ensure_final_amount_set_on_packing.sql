-- Found via a live end-to-end flow test, not by inspection: a visit could
-- reach "packing" with visit_pricing.final_amount_set still false -- most
-- easily by confirming a prescription before ever touching the pricing
-- field (a client-side bug fixed alongside this migration: PrescriptionForm
-- used to move the visit to packing itself, independent of "Consultation
-- done"). Once a visit leaves with_doctor/waiting, no screen in the app
-- can touch visit_pricing again (PricingPanel is rendered only for the
-- doctor's current with_doctor patient) -- so an unset final amount became
-- permanent: reception is correctly blocked ("waiting for the doctor"), but
-- the doctor has no way back to unblock it either. Backstop, not a
-- workaround for the client bug above: any path that finishes a
-- consultation (not only "Consultation done") must leave a billable visit.
--
-- Confirms at whatever final_amount_paise already holds -- the calculated
-- total, if genuinely untouched -- never invents a number. This is exactly
-- what happens when the doctor manually clicks into the final-amount field
-- and clicks away without changing it (PricingPanel.tsx's commitFinalAmount):
-- a real UPDATE on visit_pricing, so trg_bump_pricing_revision flips
-- final_amount_set true the same way, and only bumps revision_number if the
-- value actually changed (it doesn't here), which is the correct outcome --
-- nothing to reconcile against a bill snapshot when nothing moved.

create or replace function public.ensure_final_amount_set_on_packing()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.stage = 'packing' and old.stage is distinct from 'packing' then
    update public.visit_pricing
    set final_amount_paise = final_amount_paise
    where visit_id = new.id
      and final_amount_set = false;
  end if;
  return new;
end;
$$;

create trigger trg_ensure_final_amount_set_on_packing
  after update on public.visits
  for each row execute function public.ensure_final_amount_set_on_packing();
