-- Staff confirm the meaning of existing counts; no stock conversion occurs.
alter table public.medicines add column stock_unit text check (stock_unit is null or (length(btrim(stock_unit)) between 1 and 24)),
  add column unit_confirmed_at timestamptz;
revoke insert, update on public.medicines from authenticated;
grant insert (id, clinic_id, name, price_paise, drug_type, strength_options, low_stock_threshold, expiry_date),
  update (name, price_paise, drug_type, strength_options, low_stock_threshold, expiry_date) on public.medicines to authenticated;

create function public.set_medicine_unit_price(p_medicine_id uuid, p_stock_unit text, p_price_paise bigint)
returns void language plpgsql security definer set search_path = '' as $$
declare m public.medicines;
begin
  select * into m from public.medicines where id = p_medicine_id for update;
  if m.id is null or not (public.has_clinic_role(m.clinic_id, 'doctor') or public.has_clinic_role(m.clinic_id, 'receptionist')) then
    raise exception 'only clinic staff can set medicine units and prices';
  end if;
  if p_stock_unit is null or length(btrim(p_stock_unit)) not between 1 and 24 or p_price_paise is null or p_price_paise < 0 then
    raise exception 'a unit and non-negative unit price are required';
  end if;
  if m.unit_confirmed_at is not null and m.stock_unit <> btrim(p_stock_unit) then
    raise exception 'confirmed stock units cannot change; use a separate catalog medicine for different packaging';
  end if;
  update public.medicines set stock_unit = btrim(p_stock_unit), price_paise = p_price_paise,
    unit_confirmed_at = coalesce(unit_confirmed_at, now()), updated_at = now() where id = m.id;
end;
$$;
revoke execute on function public.set_medicine_unit_price(uuid, text, bigint) from public, anon, authenticated;
grant execute on function public.set_medicine_unit_price(uuid, text, bigint) to authenticated;
