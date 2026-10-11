-- A browser snapshot is evidence of what was displayed, not permission to set a price.
create table public.pricing_approvals (
  clinic_id uuid not null references public.clinics(id),
  visit_id uuid not null references public.visits(id),
  revision_number bigint not null,
  final_amount_paise bigint not null check (final_amount_paise >= 0),
  approved_at timestamptz not null default now(),
  primary key (visit_id, revision_number)
);
alter table public.pricing_approvals enable row level security;
create policy pricing_approvals_select on public.pricing_approvals for select
  using (public.has_clinic_role(clinic_id, 'doctor') or public.has_clinic_role(clinic_id, 'receptionist'));
revoke all on public.pricing_approvals from anon, authenticated;
grant select on public.pricing_approvals to authenticated;

create function public.record_pricing_approval()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.final_amount_set then
    insert into public.pricing_approvals (clinic_id, visit_id, revision_number, final_amount_paise)
    values (new.clinic_id, new.visit_id, new.revision_number, new.final_amount_paise)
    on conflict (visit_id, revision_number) do nothing;
  end if;
  return new;
end;
$$;
revoke execute on function public.record_pricing_approval() from public, anon, authenticated;
create trigger trg_record_pricing_approval after insert or update on public.visit_pricing
  for each row execute function public.record_pricing_approval();

-- Older unrecorded revisions cannot be reconstructed safely; leave those queued
-- confirmations pending for a doctor instead of accepting an invented amount.
insert into public.pricing_approvals (clinic_id, visit_id, revision_number, final_amount_paise)
select clinic_id, visit_id, revision_number, final_amount_paise
from public.visit_pricing where final_amount_set;

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

  insert into public.bill_line_items (clinic_id, bill_id, kind, medicine_id, description, unit_price_paise)
  select v_clinic_id, v_bill_id, 'medicine', pi.medicine_id, m.name, m.price_paise
  from public.prescription_items pi
  join public.prescriptions pr on pr.id = pi.prescription_id
  join public.medicines m on m.id = pi.medicine_id
  where pr.visit_id = p_visit_id;

  select id into v_counter_id from public.stock_points where clinic_id = v_clinic_id and name = 'Counter';

  if v_counter_id is not null then
    insert into public.stock_movements (clinic_id, medicine_id, stock_point_id, quantity_delta, reason, reference_id, created_by)
    select v_clinic_id, pi.medicine_id, v_counter_id, -coalesce(pi.quantity_dispensed, 1), 'dispensed', pi.id, auth.uid()
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
