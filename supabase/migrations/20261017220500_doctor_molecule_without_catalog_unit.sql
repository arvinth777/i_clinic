-- A doctor may prescribe a new molecule before reception configures its sale price.
-- The clinical drug type supplies the quantity unit; reception must still bill a
-- confirmed stocked product in that same unit, molecule and strength.
create or replace function public.snapshot_prescription_price()
returns trigger language plpgsql security definer set search_path = '' as $$
declare m public.medicines;
begin
  select * into m from public.medicines where id = new.medicine_id for share;
  if m.clinic_id is distinct from new.clinic_id or not exists (
    select 1 from public.prescriptions p where p.id = new.prescription_id and p.clinic_id = new.clinic_id
  ) then raise exception 'prescription and medicine must belong to the same clinic'; end if;
  if new.quantity_dispensed is null or new.quantity_dispensed <= 0 then
    raise exception 'enter a positive quantity in the prescribed unit';
  end if;
  if tg_op = 'INSERT' and nullif(btrim(new.strength), '') is null then
    raise exception 'medicine strength is required for a new prescription';
  end if;
  if tg_op = 'UPDATE' and new.strength is distinct from old.strength
     and nullif(btrim(new.strength), '') is null then
    raise exception 'medicine strength is required for a new prescription';
  end if;
  if tg_op = 'INSERT' or new.medicine_id is distinct from old.medicine_id or old.unit_price_paise is null then
    if m.unit_confirmed_at is null then
      new.unit_price_paise := 0;
      new.stock_unit := case new.drug_type
        when 'Tablet' then 'tablet'
        when 'Capsule' then 'capsule'
        when 'Syrup' then 'bottle'
        when 'Powder' then 'sachet'
        when 'Injection' then 'vial'
        else 'unit'
      end;
    else
      new.unit_price_paise := m.price_paise;
      new.stock_unit := m.stock_unit;
    end if;
  else
    new.unit_price_paise := old.unit_price_paise;
    new.stock_unit := old.stock_unit;
  end if;
  return new;
end;
$$;
revoke execute on function public.snapshot_prescription_price() from public, anon, authenticated;
