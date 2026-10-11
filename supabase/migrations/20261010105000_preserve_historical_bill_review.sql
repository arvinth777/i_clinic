-- Keep historical paid-bill corrections available without rewriting old prescription snapshots.
create or replace function public.bump_pricing_revision()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if coalesce(current_setting('app.pricing_recompute', true), '') <> 'true' then
    if exists (select 1 from public.prescription_items pi join public.prescriptions p on p.id = pi.prescription_id
      join public.visits v on v.id = p.visit_id where v.stage <> 'paid' and p.visit_id = new.visit_id and (pi.unit_price_paise is null or pi.stock_unit is null or pi.quantity_dispensed is null)) then
      raise exception 'confirm medicine units and supplied quantities before approving the bill';
    end if;
    new.final_amount_set := true;
  end if;

  if new.final_amount_paise is distinct from old.final_amount_paise
     or new.calculated_total_paise is distinct from old.calculated_total_paise then
    new.revision_number := old.revision_number + 1;
  end if;
  new.updated_at := now();
  return new;
end;
$$;


