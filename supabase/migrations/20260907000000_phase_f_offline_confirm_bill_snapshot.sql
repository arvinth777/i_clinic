-- Phase F (docs/build-plan.md): offline. This migration carries the one
-- schema-level change offline support needs -- everything else (queue,
-- service worker, persisted reads) is client-side.
--
-- docs/architecture-spec.md's offline money-conflict design: "the
-- payment-confirmation mutation snapshots (final_amount, revision_number,
-- timestamp, confirmed_by) at the moment of the click." Online, confirm_bill
-- reads visit_pricing live and there's no meaningful gap between click and
-- RPC call. Offline, the receptionist's click and the RPC's eventual replay
-- (once the mutation queue drains on reconnect) can be minutes or hours
-- apart -- if the doctor revises the price in that window (their own device
-- syncing in first), a live read at replay time would silently bill the
-- *new* figure, not what reception actually saw and told the patient. That
-- is exactly the silent auto-resolution the spec forbids.
--
-- Fix: two new optional parameters carrying the client's snapshot. When
-- provided (the offline queue's replay path), the bill is inserted at the
-- snapshotted amount/revision, not a live re-read -- so
-- trg_set_bill_needs_reconciliation (unmodified, already compares the
-- inserted pricing_revision_at_confirm against the live revision_number at
-- insert time) correctly flags the mismatch when the doctor's revision
-- landed first. When omitted (every existing caller: Billing.tsx's online
-- path, every prior test script), behaviour is byte-for-byte unchanged --
-- still a live read, same as before this migration.
--
-- Function identity in Postgres includes argument types, so CREATE OR
-- REPLACE with two extra parameters would create a *second* overload
-- alongside the existing 2-arg one, making every existing 2-arg call
-- ambiguous. Drop the old signature first.
drop function public.confirm_bill(uuid, text);

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

  -- Idempotent on visit_id: a visit can only ever be billed once (a
  -- correction is a new row referencing this one, never a second original),
  -- so replaying the same queued confirm_bill call after it already
  -- succeeded is a no-op -- it returns the existing bill, no re-insert, no
  -- second stock deduction. This is what requirement 2's "replay twice,
  -- stock moves once" test exercises; nothing below this check re-runs.
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

  -- Offline replay: bill exactly what reception's screen showed and she
  -- clicked confirm against -- cash may already have changed hands on that
  -- number -- never the live figure. trg_set_bill_needs_reconciliation
  -- compares this snapshot's revision against the live one at insert and
  -- flags the mismatch; nothing here resolves it.
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

  update public.visits
  set stage = 'paid', closed_at = now()
  where id = p_visit_id;

  return v_bill_id;
end;
$$;

-- Grants do not carry across a signature change (the two-Supabase-
-- privilege-grant gotcha, per docs/STATUS.md -- check every time, no
-- exceptions): the DROP above removed the old function's grants along with
-- it, so both lines below are load-bearing, not belt-and-braces.
revoke execute on function public.confirm_bill(uuid, text, bigint, bigint) from public;
grant execute on function public.confirm_bill(uuid, text, bigint, bigint) to authenticated;
