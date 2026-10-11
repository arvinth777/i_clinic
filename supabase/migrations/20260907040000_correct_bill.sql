-- Phase G fix pass (docs/STATUS.md, Critical finding #1): the offline
-- money-conflict design (docs/architecture-spec.md's "Offline money-
-- conflict resolution") only had its detection half built --
-- bills_needing_reconciliation correctly flags a stale-revision bill, and
-- it surfaces on the Daily Report -- but nothing let a doctor actually
-- write the correction row non-negotiable #3 requires. RLS was already
-- ready for this (bills_insert_doctor already permits an insert with
-- corrects_bill_id set -- see 20260905193029_visit_and_bill_authorship.sql)
-- but there was no RPC or screen that ever exercised it outside the
-- synthetic seed migration's own raw insert.
--
-- correct_bill re-snapshots whatever visit_pricing says *right now* --
-- the doctor's own most recent, authoritative revision -- rather than
-- accepting a typed-in amount, so there's no new way to get the corrected
-- figure wrong. This is still "never auto-resolved" per the architecture
-- decision: nothing happens until a doctor explicitly reviews the flagged
-- bill and clicks to correct it -- the RPC just removes the chance of
-- transcribing the current total incorrectly.
--
-- bills_needing_reconciliation is extended (CREATE OR REPLACE VIEW can
-- only append columns, never reorder/remove -- this only adds new ones
-- after the existing b.* set) with exactly what a doctor needs to
-- recognise and act on a flagged bill: patient_name, token_number,
-- arrived_at (same join unpaid_bills already uses), and the live pricing
-- the doctor is about to correct against.

create or replace view public.bills_needing_reconciliation
  with (security_invoker = true)
  as
  select
    b.*,
    v.token_number,
    v.arrived_at,
    p.name as patient_name,
    vp.final_amount_paise as live_final_amount_paise,
    vp.revision_number as live_revision_number
  from public.bills b
  join public.visit_pricing vp on vp.visit_id = b.visit_id
  join public.visits v on v.id = b.visit_id
  join public.patients p on p.id = v.patient_id
  where b.pricing_revision_at_confirm <> vp.revision_number
    and not exists (
      select 1 from public.bills c where c.corrects_bill_id = b.id
    );

create function public.correct_bill(p_bill_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_clinic_id uuid;
  v_visit_id uuid;
  v_payment_method text;
  v_final_amount bigint;
  v_revision bigint;
  v_new_bill_id uuid;
begin
  select clinic_id, visit_id, payment_method into v_clinic_id, v_visit_id, v_payment_method
  from public.bills where id = p_bill_id;

  if v_clinic_id is null then
    raise exception 'unknown bill %', p_bill_id;
  end if;

  if not public.has_clinic_role(v_clinic_id, 'doctor') then
    raise exception 'only a doctor can correct a bill';
  end if;

  if exists (select 1 from public.bills where corrects_bill_id = p_bill_id) then
    raise exception 'bill % has already been corrected', p_bill_id;
  end if;

  select final_amount_paise, revision_number into v_final_amount, v_revision
  from public.visit_pricing where visit_id = v_visit_id;

  insert into public.bills (clinic_id, visit_id, final_amount_paise, pricing_revision_at_confirm, payment_method, confirmed_by, corrects_bill_id)
  values (v_clinic_id, v_visit_id, v_final_amount, v_revision, v_payment_method, auth.uid(), p_bill_id)
  returning id into v_new_bill_id;

  return v_new_bill_id;
end;
$$;

revoke execute on function public.correct_bill(uuid) from public, anon, authenticated;
grant execute on function public.correct_bill(uuid) to authenticated;
