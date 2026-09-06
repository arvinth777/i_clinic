-- Self-inflicted bug, caught by this phase's own test (phase-f-test.mjs
-- Section 3, "stock moved exactly once" -- failed, not skipped, after the
-- previous migration). 20260907000000 based its new 4-arg confirm_bill body
-- on the ORIGINAL Phase C text (20260906130000_billing_confirm.sql), which
-- predates Phase B's stock deduction and the later reopen/double-deduction
-- fix (20260906200300) -- both got silently dropped along with the old
-- 2-arg signature. Migrations are immutable once applied (AGENTS.md): this
-- corrects it with a new migration rather than editing the previous one.
--
-- Restores the full 20260906200300 body verbatim (stock deduction keyed to
-- prescription_items.id, guarded against re-dispensing on a reopen/rebill)
-- and keeps this phase's own snapshot parameters on top.
drop function public.confirm_bill(uuid, text, bigint, bigint);

create function public.confirm_bill(
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
  where visit_id = p_visit_id;

  if not v_final_amount_set then
    raise exception 'doctor has not set the final amount yet for visit %', p_visit_id;
  end if;

  if p_snapshot_revision_number is not null then
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
