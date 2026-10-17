-- The written molecule is a clinical snapshot. Catalog renames affect only future prescriptions.
alter table public.prescription_items add column molecule_name text;
-- The backfill is metadata-only. Existing price/quantity validation would reject
-- older rows, and the pricing statement trigger would revise historical bills.
-- DDL and backfill run in the same migration transaction under the table lock.
drop trigger trg_snapshot_prescription_price on public.prescription_items;
drop trigger trg_recompute_pricing_from_prescription_items_upd on public.prescription_items;
update public.prescription_items pi set molecule_name = coalesce(nullif(btrim(m.molecule_name), ''), m.name)
from public.medicines m where m.id = pi.medicine_id;
create trigger trg_snapshot_prescription_price before insert or update on public.prescription_items
for each row execute function public.snapshot_prescription_price();
create trigger trg_recompute_pricing_from_prescription_items_upd after update on public.prescription_items
referencing old table as old_rows new table as new_rows for each statement
execute function public.recompute_visit_pricing_from_prescription_items();
alter table public.prescription_items alter column molecule_name set not null;
alter table public.prescription_items add constraint prescription_molecule_name_check
  check (length(btrim(molecule_name)) between 1 and 200);

create function public.snapshot_prescribed_molecule()
returns trigger language plpgsql set search_path = '' as $$
begin
  select coalesce(nullif(btrim(m.molecule_name), ''), m.name) into new.molecule_name
  from public.medicines m where m.id = new.medicine_id and m.clinic_id = new.clinic_id;
  if new.molecule_name is null then raise exception 'medicine is not in this clinic'; end if;
  return new;
end;
$$;
revoke execute on function public.snapshot_prescribed_molecule() from public, anon, authenticated;
create trigger snapshot_prescribed_molecule before insert on public.prescription_items
for each row execute function public.snapshot_prescribed_molecule();

create or replace function public.get_reception_bill(p_visit_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v public.visits; items jsonb;
begin
  select * into v from public.visits where id = p_visit_id;
  if v.id is null then return null; end if;
  if not (public.has_clinic_role(v.clinic_id, 'receptionist') or public.has_clinic_role(v.clinic_id, 'doctor')) or v.stage not in ('ready_to_bill', 'paid') then
    raise exception 'reception handoff required';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'prescription_item_id', pi.id, 'medicine_id', pi.medicine_id,
    'molecule_name', pi.molecule_name,
    'strength', pi.strength, 'quantity', pi.quantity_dispensed,
    'stock_unit', pi.stock_unit, 'dosage_frequency', pi.dosage_frequency,
    'duration_days', pi.duration_days) order by pi.created_at, pi.id), '[]'::jsonb)
  into items from public.prescriptions p join public.prescription_items pi on pi.prescription_id = p.id
    join public.medicines m on m.id = pi.medicine_id where p.visit_id = v.id;
  return jsonb_build_object('consultation_charge_paise', v.consultation_charge_paise, 'medicines', items);
end;
$$;
revoke execute on function public.get_reception_bill(uuid) from public, anon, authenticated;
grant execute on function public.get_reception_bill(uuid) to authenticated;



create or replace function public.confirm_reception_bill(
  p_visit_id uuid, p_payment_method text, p_expected_total_paise bigint, p_items jsonb
) returns uuid language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v public.visits; existing uuid; result uuid; counter_id uuid;
  pi public.prescription_items; prescribed public.medicines; chosen public.medicines;
  item jsonb; supplied int; subtotal bigint; rx_count int; revision bigint;
begin
  select * into v from public.visits where id = p_visit_id for update;
  if v.id is null or not public.has_clinic_role(v.clinic_id, 'receptionist') then raise exception 'reception required'; end if;
  select id into existing from public.bills where visit_id = v.id and corrects_bill_id is null order by confirmed_at desc limit 1;
  if existing is not null then return existing; end if;
  if v.stage <> 'ready_to_bill' then raise exception 'visit not ready to bill'; end if;
  if p_payment_method not in ('cash', 'upi', 'pay_later') or p_payment_method is null then raise exception 'invalid payment method'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then raise exception 'supply every prescribed item'; end if;
  select count(*) into rx_count from public.prescription_items pi
    join public.prescriptions p on p.id = pi.prescription_id where p.visit_id = v.id;
  if rx_count = 0 or jsonb_array_length(p_items) <> rx_count or
     (select count(distinct x->>'prescription_item_id') from jsonb_array_elements(p_items) x) <> rx_count then
    raise exception 'supply every prescribed item exactly once';
  end if;
  select id into counter_id from public.stock_points where clinic_id = v.clinic_id and name = 'Counter';
  if counter_id is null then raise exception 'Counter stock point required'; end if;
  -- Price changes lock the same catalog rows. Stock movement triggers enforce
  -- non-negative stock, and the visit lock makes retries return one bill.
  perform 1 from public.medicines m where m.id in (
    select (x->>'medicine_id')::uuid from jsonb_array_elements(p_items) x
  ) order by m.id for share;
  perform 1 from public.medicine_stock s where s.stock_point_id = counter_id and s.medicine_id in (
    select (x->>'medicine_id')::uuid from jsonb_array_elements(p_items) x
  ) order by s.medicine_id for update;
  select coalesce(sum(vp.price_paise), 0) into subtotal from public.visit_procedures vp where vp.visit_id = v.id;
  subtotal := subtotal + v.consultation_charge_paise;
  for pi in select pi.* from public.prescription_items pi
      join public.prescriptions p on p.id = pi.prescription_id where p.visit_id = v.id order by pi.id loop
    select x into item from jsonb_array_elements(p_items) x where x->>'prescription_item_id' = pi.id::text;
    if item is null then raise exception 'missing prescribed item'; end if;
    if item->>'quantity' !~ '^[0-9]+$' then raise exception 'supply whole stock units'; end if;
    supplied := (item->>'quantity')::int;
    if supplied > pi.quantity_dispensed then raise exception 'cannot supply more than prescribed'; end if;
    select * into prescribed from public.medicines where id = pi.medicine_id;
    select * into chosen from public.medicines where id = (item->>'medicine_id')::uuid and clinic_id = v.clinic_id;
    if chosen.id is null or not chosen.is_active or chosen.unit_confirmed_at is null then raise exception 'choose an active medicine with a confirmed unit and price'; end if;
    if lower(btrim(pi.molecule_name)) <>
       lower(btrim(coalesce(nullif(chosen.molecule_name, ''), chosen.name))) or
       (chosen.id <> prescribed.id and (pi.strength is null or not exists (
         select 1 from unnest(chosen.strength_options) s where lower(btrim(s)) = lower(btrim(pi.strength))
       ))) or
       (chosen.id = prescribed.id and cardinality(chosen.strength_options) > 0 and
         not exists (select 1 from unnest(chosen.strength_options) s where lower(btrim(s)) = lower(btrim(pi.strength))))
    then raise exception 'brand must match prescribed molecule and strength'; end if;
    if (item->>'unit_price_paise')::bigint is distinct from chosen.price_paise or
       item->>'stock_unit' is distinct from chosen.stock_unit or
       pi.stock_unit is distinct from chosen.stock_unit then
      raise exception 'catalog price or unit changed; refresh the bill';
    end if;
    subtotal := subtotal + supplied::bigint * chosen.price_paise;
  end loop;
  if p_expected_total_paise is distinct from subtotal then raise exception 'bill changed; refresh before payment'; end if;
  select revision_number into revision from public.visit_pricing where visit_id = v.id;
  insert into public.bills(clinic_id, visit_id, final_amount_paise, pricing_revision_at_confirm, payment_method, confirmed_by, approved_discount_paise)
  values(v.clinic_id, v.id, subtotal, revision, p_payment_method, auth.uid(), 0) returning id into result;
  insert into public.bill_line_items(clinic_id,bill_id,kind,description,quantity,unit_price_paise)
  values(v.clinic_id,result,'consultation','Consultation',1,v.consultation_charge_paise);
  insert into public.bill_line_items(clinic_id,bill_id,kind,procedure_id,description,quantity,unit_price_paise)
  select v.clinic_id,result,'procedure',vp.procedure_id,p.name,1,vp.price_paise
  from public.visit_procedures vp join public.procedures p on p.id = vp.procedure_id where vp.visit_id = v.id;
  for pi in select pi.* from public.prescription_items pi
      join public.prescriptions p on p.id = pi.prescription_id where p.visit_id = v.id order by pi.id loop
    select x into item from jsonb_array_elements(p_items) x where x->>'prescription_item_id' = pi.id::text;
    supplied := (item->>'quantity')::int;
    select * into chosen from public.medicines where id = (item->>'medicine_id')::uuid;
    insert into public.bill_line_items(clinic_id,bill_id,kind,medicine_id,description,quantity,unit_price_paise,stock_unit,prescription_item_id,approved_quantity)
    values(v.clinic_id,result,'medicine',chosen.id,chosen.name,supplied,chosen.price_paise,chosen.stock_unit,pi.id,pi.quantity_dispensed);
    if supplied > 0 then
      insert into public.stock_movements(clinic_id,medicine_id,stock_point_id,quantity_delta,reason,reference_id,created_by)
      values(v.clinic_id,chosen.id,counter_id,-supplied,'dispensed',pi.id,auth.uid());
    end if;
  end loop;
  update public.visits set stage = 'paid', closed_at = now() where id = v.id;
  return result;
end;
$$;
revoke execute on function public.confirm_reception_bill(uuid,text,bigint,jsonb) from public, anon, authenticated;
grant execute on function public.confirm_reception_bill(uuid,text,bigint,jsonb) to authenticated;


drop function public.get_visit_billing_detail(uuid);
create function public.get_visit_billing_detail(p_visit_id uuid)
returns table (
  kind text,
  description text,
  unit_price_paise bigint,
  drug_type text,
  strength text,
  before_after_food text,
  dosage_frequency text,
  duration_days int,
  notes text,
  quantity int,
  stock_unit text,
  line_total_paise bigint,
  diagnosis text,
  advice text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_clinic_id uuid;
  v_stage text;
  v_fee bigint;
begin
  select clinic_id, stage into v_clinic_id, v_stage
  from public.visits
  where id = p_visit_id;

  if v_clinic_id is null then
    return;
  end if;

  if not (
    public.has_clinic_role(v_clinic_id, 'doctor')
    or (public.has_clinic_role(v_clinic_id, 'receptionist') and v_stage in ('ready_to_bill', 'paid'))
  ) then
    return;
  end if;

  select consultation_charge_paise into v_fee from public.visits where id = p_visit_id;

  return query
  select 'consultation'::text, 'Consultation'::text, v_fee,
         null::text, null::text, null::text, null::text, null::int, null::text, 1, null::text, v_fee, null::text, null::text
  union all
  select 'procedure'::text, p.name, vp.price_paise,
         null::text, null::text, null::text, null::text, null::int, null::text, 1, null::text, vp.price_paise, null::text, null::text
  from public.visit_procedures vp
  join public.procedures p on p.id = vp.procedure_id
  where vp.visit_id = p_visit_id
  union all
  select 'medicine'::text, pi.molecule_name, pi.unit_price_paise,
         pi.drug_type, pi.strength, pi.before_after_food, pi.dosage_frequency, pi.duration_days, pi.notes, pi.quantity_dispensed, pi.stock_unit, pi.unit_price_paise * pi.quantity_dispensed, pr.diagnosis, pr.advice
  from public.prescription_items pi
  join public.prescriptions pr on pr.id = pi.prescription_id
  join public.medicines m on m.id = pi.medicine_id
  where pr.visit_id = p_visit_id;
end;
$$;

revoke execute on function public.get_visit_billing_detail(uuid) from public, anon, authenticated;
grant execute on function public.get_visit_billing_detail(uuid) to authenticated;

create or replace function public.enqueue_prescription_archive()
returns trigger language plpgsql security definer set search_path = '' as $$
declare medicines jsonb; version bigint;
begin
  if new.stage = 'ready_to_bill' and old.stage is distinct from new.stage then
    select coalesce(jsonb_agg(jsonb_build_object(
      'kind', 'medicine', 'description', pi.molecule_name,
      'strength', pi.strength, 'drug_type', pi.drug_type,
      'before_after_food', pi.before_after_food, 'dosage_frequency', pi.dosage_frequency,
      'duration_days', pi.duration_days, 'notes', pi.notes,
      'quantity', pi.quantity_dispensed, 'stock_unit', pi.stock_unit,
      'unit_price_paise', 0) order by pi.created_at, pi.id), '[]'::jsonb),
      (select revision_number from public.visit_pricing where visit_id = new.id)
    into medicines, version
    from public.prescriptions p join public.prescription_items pi on pi.prescription_id = p.id
    join public.medicines m on m.id = pi.medicine_id where p.visit_id = new.id;
    if jsonb_array_length(medicines) = 0 then raise exception 'prescription required for archive'; end if;
    insert into public.document_archives(clinic_id, visit_id, kind, source_id, source_version, snapshot)
    values(new.clinic_id, new.id, 'prescription', new.id, version,
      jsonb_build_object('kind', 'prescription', 'clinic', public.archive_clinic_snapshot(new.clinic_id),
        'visit', public.archive_visit_snapshot(new.id, true), 'medicines', medicines))
    on conflict(kind, source_id, source_version) do nothing;
  end if;
  return new;
end;
$$;
revoke execute on function public.enqueue_prescription_archive() from public, anon, authenticated;
