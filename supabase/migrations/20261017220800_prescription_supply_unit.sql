-- Pass the doctor's explicit quantity unit for an unfamiliar medicine form.
create or replace function public.save_prescription(p_prescription_id uuid, p_visit_id uuid, p_items jsonb, p_diagnosis text default null, p_advice text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_clinic_id uuid; v_stage text;
begin
  select clinic_id, stage into v_clinic_id, v_stage from public.visits where id = p_visit_id for update;
  if v_clinic_id is null or not public.has_clinic_role(v_clinic_id, 'doctor') then raise exception 'only the clinic doctor can save a prescription'; end if;
  if exists (select 1 from public.prescriptions where id = p_prescription_id and visit_id = p_visit_id and clinic_id = v_clinic_id) then return p_prescription_id; end if;
  if v_stage not in ('waiting', 'with_doctor') then raise exception 'reopen the consultation before prescribing'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'prescription items are required'; end if;
  if exists (
    select 1 from jsonb_to_recordset(p_items) as i(medicine_id uuid)
    left join public.medicines m on m.id = i.medicine_id and m.clinic_id = v_clinic_id where m.id is null
  ) then raise exception 'every medicine must belong to this clinic'; end if;
  insert into public.prescriptions (id, clinic_id, visit_id, diagnosis, advice)
  values (p_prescription_id, v_clinic_id, p_visit_id, nullif(btrim(p_diagnosis), ''), nullif(btrim(p_advice), ''));
  insert into public.prescription_items (id, clinic_id, prescription_id, medicine_id, drug_type, strength,
    before_after_food, dosage_frequency, duration_days, quantity_dispensed, notes, stock_unit)
  select i.id, v_clinic_id, p_prescription_id, i.medicine_id, i.drug_type, i.strength,
    i.before_after_food, i.dosage_frequency, i.duration_days, i.quantity_dispensed, i.notes, i.stock_unit
  from jsonb_to_recordset(p_items) as i(id uuid, medicine_id uuid, drug_type text, strength text,
    before_after_food text, dosage_frequency text, duration_days int, quantity_dispensed int, notes text, stock_unit text);
  return p_prescription_id;
end;
$$;
revoke execute on function public.save_prescription(uuid, uuid, jsonb, text, text) from public, anon, authenticated;
grant execute on function public.save_prescription(uuid, uuid, jsonb, text, text) to authenticated;

create or replace function public.snapshot_prescription_price()
returns trigger language plpgsql security definer set search_path = '' as $$
declare m public.medicines;
begin
  select * into m from public.medicines where id = new.medicine_id for share;
  if m.clinic_id is distinct from new.clinic_id or not exists (
    select 1 from public.prescriptions p where p.id = new.prescription_id and p.clinic_id = new.clinic_id
  ) then raise exception 'prescription and medicine must belong to the same clinic'; end if;
  if new.quantity_dispensed is null or new.quantity_dispensed <= 0 then raise exception 'enter a positive quantity in the prescribed unit'; end if;
  if tg_op = 'INSERT' and nullif(btrim(new.strength), '') is null then raise exception 'medicine strength is required for a new prescription'; end if;
  if tg_op = 'UPDATE' and new.strength is distinct from old.strength and nullif(btrim(new.strength), '') is null then raise exception 'medicine strength is required for a new prescription'; end if;
  if tg_op = 'INSERT' or new.medicine_id is distinct from old.medicine_id or old.unit_price_paise is null then
    if m.unit_confirmed_at is null then
      new.unit_price_paise := 0;
      new.stock_unit := case new.drug_type
        when 'Tablet' then 'tablet' when 'Capsule' then 'capsule'
        when 'Syrup' then 'bottle' when 'Powder' then 'sachet'
        when 'Injection' then 'vial' when 'Topical' then 'tube'
        when 'Other' then nullif(lower(btrim(new.stock_unit)), '')
        else null end;
      if new.stock_unit is null or length(new.stock_unit) > 24 then raise exception 'supply unit is required for this drug type'; end if;
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
