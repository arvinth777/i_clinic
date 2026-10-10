-- Existing prescription RLS permits doctor writes and clinic-scoped reads.
alter table public.prescriptions
  add column diagnosis text check (length(diagnosis) <= 10000),
  add column advice text check (length(advice) <= 10000);
-- Doctor-entered schedules must also support half doses and free-text instructions.
alter table public.prescription_items drop constraint prescription_items_dosage_frequency_check;
alter table public.prescription_items add constraint prescription_items_dosage_frequency_check
  check (dosage_frequency is null or length(btrim(dosage_frequency)) between 1 and 200);
drop function public.save_prescription(uuid, uuid, jsonb);
-- A replay must save the header and every instruction together, or neither.
create function public.save_prescription(p_prescription_id uuid, p_visit_id uuid, p_items jsonb, p_diagnosis text default null, p_advice text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_clinic_id uuid;
  v_stage text;
begin
  select clinic_id, stage into v_clinic_id, v_stage
  from public.visits where id = p_visit_id for update;
  if v_clinic_id is null or not public.has_clinic_role(v_clinic_id, 'doctor') then
    raise exception 'only the clinic doctor can save a prescription';
  end if;
  if exists (select 1 from public.prescriptions where id = p_prescription_id and visit_id = p_visit_id and clinic_id = v_clinic_id) then
    return p_prescription_id;
  end if;
  if v_stage not in ('waiting', 'with_doctor') then
    raise exception 'reopen the consultation before prescribing';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'prescription items are required';
  end if;
  if exists (
    select 1 from jsonb_to_recordset(p_items) as i(medicine_id uuid)
    left join public.medicines m on m.id = i.medicine_id and m.clinic_id = v_clinic_id
    where m.id is null
  ) then
    raise exception 'every medicine must belong to this clinic';
  end if;
  insert into public.prescriptions (id, clinic_id, visit_id, diagnosis, advice)
  values (p_prescription_id, v_clinic_id, p_visit_id, nullif(btrim(p_diagnosis), ''), nullif(btrim(p_advice), ''));
  insert into public.prescription_items (id, clinic_id, prescription_id, medicine_id, drug_type, strength,
    before_after_food, dosage_frequency, duration_days, quantity_dispensed, notes)
  select i.id, v_clinic_id, p_prescription_id, i.medicine_id, i.drug_type, i.strength,
    i.before_after_food, i.dosage_frequency, i.duration_days, i.quantity_dispensed, i.notes
  from jsonb_to_recordset(p_items) as i(id uuid, medicine_id uuid, drug_type text, strength text,
    before_after_food text, dosage_frequency text, duration_days int, quantity_dispensed int, notes text);
  return p_prescription_id;
end;
$$;
revoke execute on function public.save_prescription(uuid, uuid, jsonb, text, text) from public, anon, authenticated;
grant execute on function public.save_prescription(uuid, uuid, jsonb, text, text) to authenticated;
