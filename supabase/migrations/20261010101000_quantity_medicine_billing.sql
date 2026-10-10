-- One explicit stock/billing unit and a price snapshot per supplied medicine.
alter table public.prescription_items add column unit_price_paise bigint check (unit_price_paise >= 0), add column stock_unit text;
alter table public.bill_line_items add column stock_unit text;

create function public.snapshot_prescription_price()
returns trigger language plpgsql security definer set search_path = '' as $$
declare m public.medicines;
begin
  select * into m from public.medicines where id = new.medicine_id for share;
  if m.clinic_id is distinct from new.clinic_id or not exists (
    select 1 from public.prescriptions p where p.id = new.prescription_id and p.clinic_id = new.clinic_id
  ) then raise exception 'prescription and medicine must belong to the same clinic'; end if;
  if new.quantity_dispensed is null or new.quantity_dispensed <= 0 then
    raise exception 'enter the quantity supplied in the confirmed stock unit';
  end if;
  if tg_op = 'INSERT' or new.medicine_id is distinct from old.medicine_id or old.unit_price_paise is null then
    if m.unit_confirmed_at is null then raise exception 'confirm the medicine unit and price under Stock first'; end if;
    new.unit_price_paise := m.price_paise;
    new.stock_unit := m.stock_unit;
  else
    new.unit_price_paise := old.unit_price_paise;
    new.stock_unit := old.stock_unit;
  end if;
  return new;
end;
$$;
revoke execute on function public.snapshot_prescription_price() from public, anon, authenticated;
create trigger trg_snapshot_prescription_price before insert or update on public.prescription_items
  for each row execute function public.snapshot_prescription_price();

create or replace function public.recompute_visit_pricing(p_visit_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_clinic_id uuid;
  v_fee bigint;
  v_procedures_total bigint;
  v_medicines_total bigint;
  v_total bigint;
begin
  select clinic_id into v_clinic_id from public.visits where id = p_visit_id;
  if v_clinic_id is null then
    return;
  end if;

  select consultation_fee_paise into v_fee from public.clinics where id = v_clinic_id;

  select coalesce(sum(price_paise), 0) into v_procedures_total
  from public.visit_procedures
  where visit_id = p_visit_id;

  select coalesce(sum(pi.unit_price_paise * pi.quantity_dispensed), 0) into v_medicines_total
  from public.prescription_items pi
  join public.prescriptions pr on pr.id = pi.prescription_id
  join public.medicines m on m.id = pi.medicine_id
  where pr.visit_id = p_visit_id;

  v_total := v_fee + v_procedures_total + v_medicines_total;

  perform set_config('app.pricing_recompute', 'true', true);

  update public.visit_pricing
  set calculated_total_paise = v_total,
      final_amount_paise = case
        when final_amount_set then least(final_amount_paise, v_total)
        else v_total
      end
  where visit_id = p_visit_id;

  perform set_config('app.pricing_recompute', 'false', true);
end;
$$;

revoke execute on function public.recompute_visit_pricing(uuid) from public, anon, authenticated;

-- Old flat-price approvals are not valid authorisations for corrected quantity totals.
select set_config('app.pricing_recompute', 'true', true);
update public.visit_pricing vp set final_amount_set = false
where exists (select 1 from public.visits v join public.prescriptions p on p.visit_id = v.id where v.id = vp.visit_id and v.stage <> 'paid');
select set_config('app.pricing_recompute', 'false', true);
delete from public.pricing_approvals a where exists (
  select 1 from public.visits v join public.prescriptions p on p.visit_id = v.id where v.id = a.visit_id and v.stage <> 'paid'
);

create function public.confirm_legacy_prescription_units()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.unit_confirmed_at is null and new.unit_confirmed_at is not null then
    update public.prescription_items pi set unit_price_paise = new.price_paise, stock_unit = new.stock_unit
    where pi.medicine_id = new.id and pi.unit_price_paise is null and pi.quantity_dispensed is not null
      and exists (select 1 from public.prescriptions p join public.visits v on v.id = p.visit_id
        where p.id = pi.prescription_id and v.stage <> 'paid');
  end if;
  return new;
end;
$$;
revoke execute on function public.confirm_legacy_prescription_units() from public, anon, authenticated;
create trigger trg_confirm_legacy_prescription_units after update of unit_confirmed_at on public.medicines
  for each row execute function public.confirm_legacy_prescription_units();
update public.prescription_items pi set unit_price_paise = m.price_paise, stock_unit = m.stock_unit
from public.medicines m where m.id = pi.medicine_id and m.unit_confirmed_at is not null and pi.quantity_dispensed is not null
  and exists (select 1 from public.prescriptions p join public.visits v on v.id = p.visit_id where p.id = pi.prescription_id and v.stage <> 'paid');

create or replace function public.confirm_bill(
  p_visit_id uuid,
  p_payment_method text,
  p_snapshot_final_amount_paise bigint default null,
  p_snapshot_revision_number bigint default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_clinic_id uuid;
  v_stage text;
  v_existing_bill_id uuid;
  v_bill_id uuid;
  v_final_amount bigint;
  v_revision bigint;
  v_final_amount_set boolean;
  v_fee bigint;
  v_counter_id uuid;
begin
  select clinic_id, stage into v_clinic_id, v_stage
  from public.visits
  where id = p_visit_id
  for update;

  if v_clinic_id is null then
    raise exception 'unknown visit %', p_visit_id;
  end if;

  if not public.has_clinic_role(v_clinic_id, 'receptionist') then
    raise exception 'only reception can confirm a bill';
  end if;

  if v_stage = 'paid' then
    select id into v_existing_bill_id
    from public.bills
    where visit_id = p_visit_id and corrects_bill_id is null
    order by confirmed_at desc
    limit 1;
    return v_existing_bill_id;
  end if;

  if v_stage <> 'ready_at_reception' then
    raise exception 'visit % is not ready for billing (stage=%)', p_visit_id, v_stage;
  end if;

  select final_amount_paise, revision_number, final_amount_set
  into v_final_amount, v_revision, v_final_amount_set
  from public.visit_pricing
  where visit_id = p_visit_id
  for update;

  if not v_final_amount_set then
    raise exception 'doctor has not set the final amount yet for visit %', p_visit_id;
  end if;

  if (p_snapshot_revision_number is null) <> (p_snapshot_final_amount_paise is null) then
    raise exception 'snapshot amount and revision must be supplied together';
  end if;
  if p_snapshot_revision_number is not null then
    if not exists (
      select 1 from public.pricing_approvals a
      where a.visit_id = p_visit_id and a.clinic_id = v_clinic_id
        and a.revision_number = p_snapshot_revision_number
        and a.final_amount_paise = p_snapshot_final_amount_paise
    ) then
      raise exception 'pricing snapshot is not an approved amount; ask the doctor to review';
    end if;
    v_final_amount := p_snapshot_final_amount_paise;
    v_revision := p_snapshot_revision_number;
  end if;

  if exists (select 1 from public.prescription_items pi join public.prescriptions p on p.id = pi.prescription_id
    where p.visit_id = p_visit_id and (pi.unit_price_paise is null or pi.stock_unit is null or pi.quantity_dispensed is null)) then
    raise exception 'confirm medicine units and ask the doctor to review supplied quantities before payment';
  end if;
  insert into public.bills (clinic_id, visit_id, final_amount_paise, pricing_revision_at_confirm, payment_method, confirmed_by)
  values (v_clinic_id, p_visit_id, v_final_amount, v_revision, p_payment_method, auth.uid())
  returning id into v_bill_id;

  select consultation_fee_paise into v_fee from public.clinics where id = v_clinic_id;

  insert into public.bill_line_items (clinic_id, bill_id, kind, description, unit_price_paise)
  values (v_clinic_id, v_bill_id, 'consultation', 'Consultation', v_fee);

  insert into public.bill_line_items (clinic_id, bill_id, kind, procedure_id, description, unit_price_paise)
  select v_clinic_id, v_bill_id, 'procedure', vp.procedure_id, p.name, vp.price_paise
  from public.visit_procedures vp
  join public.procedures p on p.id = vp.procedure_id
  where vp.visit_id = p_visit_id;

  insert into public.bill_line_items (clinic_id, bill_id, kind, medicine_id, description, quantity, unit_price_paise, stock_unit)
  select v_clinic_id, v_bill_id, 'medicine', pi.medicine_id, m.name, pi.quantity_dispensed, pi.unit_price_paise, pi.stock_unit
  from public.prescription_items pi
  join public.prescriptions pr on pr.id = pi.prescription_id
  join public.medicines m on m.id = pi.medicine_id
  where pr.visit_id = p_visit_id;

  select id into v_counter_id from public.stock_points where clinic_id = v_clinic_id and name = 'Counter';

  if v_counter_id is null and exists (select 1 from public.prescriptions p join public.prescription_items pi on pi.prescription_id = p.id where p.visit_id = p_visit_id) then
    raise exception 'configure a Counter stock point before confirming payment';
  end if;
  if v_counter_id is not null then
    insert into public.stock_movements (clinic_id, medicine_id, stock_point_id, quantity_delta, reason, reference_id, created_by)
    select v_clinic_id, pi.medicine_id, v_counter_id, -pi.quantity_dispensed, 'dispensed', pi.id, auth.uid()
    from public.prescription_items pi
    join public.prescriptions pr on pr.id = pi.prescription_id
    where pr.visit_id = p_visit_id
      and not exists (
        select 1 from public.stock_movements sm
        where sm.reason = 'dispensed' and sm.reference_id = pi.id
      );
  end if;

  update public.visits
  set stage = 'paid', closed_at = now()
  where id = p_visit_id;

  return v_bill_id;
end;
$$;

revoke execute on function public.confirm_bill(uuid, text, bigint, bigint) from public, anon, authenticated;
grant execute on function public.confirm_bill(uuid, text, bigint, bigint) to authenticated;

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
  line_total_paise bigint
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
    or (public.has_clinic_role(v_clinic_id, 'receptionist') and v_stage in ('ready_at_reception', 'paid'))
  ) then
    return;
  end if;

  select consultation_fee_paise into v_fee from public.clinics where id = v_clinic_id;

  return query
  select 'consultation'::text, 'Consultation'::text, v_fee,
         null::text, null::text, null::text, null::text, null::int, null::text, 1, null::text, v_fee
  union all
  select 'procedure'::text, p.name, vp.price_paise,
         null::text, null::text, null::text, null::text, null::int, null::text, 1, null::text, vp.price_paise
  from public.visit_procedures vp
  join public.procedures p on p.id = vp.procedure_id
  where vp.visit_id = p_visit_id
  union all
  select 'medicine'::text, m.name, pi.unit_price_paise,
         pi.drug_type, pi.strength, pi.before_after_food, pi.dosage_frequency, pi.duration_days, pi.notes, pi.quantity_dispensed, pi.stock_unit, pi.unit_price_paise * pi.quantity_dispensed
  from public.prescription_items pi
  join public.prescriptions pr on pr.id = pi.prescription_id
  join public.medicines m on m.id = pi.medicine_id
  where pr.visit_id = p_visit_id;
end;
$$;

revoke execute on function public.get_visit_billing_detail(uuid) from public, anon, authenticated;
grant execute on function public.get_visit_billing_detail(uuid) to authenticated;
