-- A legacy total cannot be approved before its missing units/quantities are reviewed.
create or replace function public.bump_pricing_revision()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if coalesce(current_setting('app.pricing_recompute', true), '') <> 'true' then
    if exists (select 1 from public.prescription_items pi join public.prescriptions p on p.id = pi.prescription_id
      where p.visit_id = new.visit_id and (pi.unit_price_paise is null or pi.stock_unit is null or pi.quantity_dispensed is null)) then
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


create or replace function public.confirm_legacy_prescription_units()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.unit_confirmed_at is null and new.unit_confirmed_at is not null then
    perform set_config('app.pricing_recompute', 'true', true);
    update public.visit_pricing vp set final_amount_set = false where exists (
      select 1 from public.prescription_items pi join public.prescriptions p on p.id = pi.prescription_id
      join public.visits v on v.id = p.visit_id where p.visit_id = vp.visit_id and v.stage <> 'paid'
        and pi.medicine_id = new.id and pi.unit_price_paise is null);
    perform set_config('app.pricing_recompute', 'false', true);
    delete from public.pricing_approvals a where exists (
      select 1 from public.prescription_items pi join public.prescriptions p on p.id = pi.prescription_id
      join public.visits v on v.id = p.visit_id where p.visit_id = a.visit_id and v.stage <> 'paid'
        and pi.medicine_id = new.id and pi.unit_price_paise is null);
    update public.prescription_items pi set unit_price_paise = new.price_paise, stock_unit = new.stock_unit
    where pi.medicine_id = new.id and pi.unit_price_paise is null and pi.quantity_dispensed is not null
      and exists (select 1 from public.prescriptions p join public.visits v on v.id = p.visit_id
        where p.id = pi.prescription_id and v.stage <> 'paid');
  end if;
  return new;
end;
$$;
revoke execute on function public.confirm_legacy_prescription_units() from public, anon, authenticated;
