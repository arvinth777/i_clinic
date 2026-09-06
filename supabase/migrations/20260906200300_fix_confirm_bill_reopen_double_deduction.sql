-- Phase B security-review checkpoint caught this: a doctor can reopen a
-- closed visit (security-review.md's own "only doctor can reopen a
-- closed visit" -- visits_update_doctor has no stage guard), and
-- confirm_bill's early-return only fires when the visit's CURRENT stage
-- is 'paid'. Once reopened, re-confirming runs the whole body again --
-- including the new stock-deduction insert -- against the exact same
-- prescription_items, deducting the same physical dispensing twice.
-- Reproduced live: reopening a paid test visit and re-billing it doubled
-- its stock_movements 'dispensed' rows for the same medicine (-4 twice).
--
-- Fix: the dispensed movement is now keyed to the prescription_item
-- itself (reference_id = prescription_items.id), not the bill, and only
-- inserted when that specific item has no prior dispensed movement. A
-- rebill of unchanged items is now a no-op for stock; a medicine the
-- doctor adds after reopening (a genuinely new dispensing) still
-- deducts, since it has no prior movement of its own.

create or replace function public.confirm_bill(p_visit_id uuid, p_payment_method text)
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

revoke execute on function public.confirm_bill(uuid, text) from public, anon, authenticated;
grant execute on function public.confirm_bill(uuid, text) to authenticated;
