-- Billing screen backend: the receptionist's side of the money loop, and
-- fixes to two money-correctness gaps found while building it.
--
-- Gap 1 (already-shipped bug): recompute_visit_pricing's clamp
-- (`least(final_amount_paise, v_total)`) only ever holds an untouched
-- final_amount steady or pulls it down -- it never raises it. Since a
-- fresh visit_pricing row starts with final_amount_paise equal to the
-- initial total, adding a procedure or medicine before the doctor ever
-- touched final_amount raised the total but left final_amount behind,
-- fabricating a discount nobody set. Fixed below by tracking whether the
-- doctor has ever actually set it (final_amount_set) and only clamping
-- once that's true; until then, final_amount tracks the total exactly, as
-- the PRD's "defaults to the calculated total" promises.
--
-- Gap 2: the billing screen must show "waiting for the doctor" and refuse
-- payment until the doctor has engaged with pricing at all -- not merely
-- "final_amount happens to equal the total", which is indistinguishable
-- from "untouched". revision_number can't serve this (it bumps on a
-- recompute too, not only a doctor edit). final_amount_set is the new,
-- explicit signal for it.
--
-- final_amount_set is flipped true by bump_pricing_revision whenever an
-- UPDATE on visit_pricing did NOT originate from recompute_visit_pricing
-- (flagged via a transaction-local GUC, since a plain column diff can't
-- tell "the doctor set it to the same value" apart from "recompute left
-- it unchanged"). This is safe specifically because visit_pricing's own
-- RLS grants UPDATE to role=doctor only -- recompute_visit_pricing is the
-- only other writer, and it's SECURITY DEFINER (bypasses RLS). If a
-- future migration adds another writer to this table, this reasoning
-- must be revisited.

alter table public.visit_pricing
  add column final_amount_set boolean not null default false;

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

  select coalesce(sum(m.price_paise), 0) into v_medicines_total
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

create or replace function public.bump_pricing_revision()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if coalesce(current_setting('app.pricing_recompute', true), '') <> 'true' then
    new.final_amount_set := true;
  end if;

  if new.final_amount_paise is distinct from old.final_amount_paise
     or new.calculated_total_paise is distinct from old.calculated_total_paise then
    new.revision_number := old.revision_number + 1;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

-- ============================================================
-- bills.needs_reconciliation
--
-- Set once, at insert, by comparing the snapshot revision the app is
-- confirming against to the row's live revision_number at that instant.
-- Never patched afterwards -- bills are immutable by omission (no
-- update/delete policy), and this trigger doesn't create one. This
-- catches the "doctor's revision synced in before the payment did"
-- ordering. It does NOT catch the other ordering (a bill synced first,
-- matching at insert, and a contradicting revision arrives moments
-- later) -- bills_needing_reconciliation (phase 1) already exists for
-- that, comparing live at query time, and is left untouched; the two
-- serve different moments and neither replaces the other.
-- ============================================================

alter table public.bills
  add column needs_reconciliation boolean not null default false;

create or replace function public.set_bill_needs_reconciliation()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_current_revision bigint;
begin
  select revision_number into v_current_revision
  from public.visit_pricing
  where visit_id = new.visit_id;

  new.needs_reconciliation := (v_current_revision is distinct from new.pricing_revision_at_confirm);
  return new;
end;
$$;

revoke execute on function public.set_bill_needs_reconciliation() from public;

create trigger trg_set_bill_needs_reconciliation
  before insert on public.bills
  for each row execute function public.set_bill_needs_reconciliation();

-- ============================================================
-- confirm_bill
--
-- The one atomic, idempotent path from "ready at reception" to "paid":
-- snapshots pricing, writes the frozen bill_line_items breakdown (read
-- from visit_procedures/prescription_items, both doctor-only tables --
-- SECURITY DEFINER on the receptionist's behalf, same footing as
-- recompute_visit_pricing), closes the visit, and hands back the bill id.
--
-- Idempotent: a repeat call after the visit is already paid returns the
-- existing bill id instead of raising or inserting a second row. `select
-- ... for update` on the visit row serializes concurrent calls so a
-- genuine double-click can't create two bills.
--
-- Blocks payment server-side (not only in the UI) when the doctor hasn't
-- engaged with pricing at all yet (final_amount_set = false) -- the
-- "waiting for the doctor" gate from the PRD's edge-case table.
--
-- payment_method is validated by the bills table's own check constraint
-- (the insert below), not re-checked here -- no need to duplicate it.
-- ============================================================

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

  update public.visits
  set stage = 'paid', closed_at = now()
  where id = p_visit_id;

  return v_bill_id;
end;
$$;

revoke execute on function public.confirm_bill(uuid, text) from public;
grant execute on function public.confirm_bill(uuid, text) to authenticated;

-- ============================================================
-- get_visit_billing_detail
--
-- Reception's only path to procedure/medicine detail before a bill
-- exists (visit_procedures and prescription_items are doctor-only reads
-- -- SECURITY DEFINER on her behalf, scoped to one visit, not a blanket
-- RLS relaxation). Serves two consumers: the on-screen itemised
-- breakdown (needs description + price) and the printed prescription
-- (needs the full dosage detail) -- one function, so the print view can
-- never drift from what billing actually showed.
--
-- Gated on the visit's stage, not just the caller's role: reception can
-- pull this for a visit at ready_at_reception (billing) or paid
-- (reprint), never with_doctor, waiting, or packing -- she has no reason
-- to browse a prescription's clinical detail before it's actually reached
-- her desk. The doctor can always read it, any stage, same as
-- visit_procedures/prescription_items directly.
-- ============================================================

create or replace function public.get_visit_billing_detail(p_visit_id uuid)
returns table (
  kind text,
  description text,
  unit_price_paise bigint,
  drug_type text,
  strength text,
  before_after_food text,
  dosage_frequency text,
  duration_days int,
  notes text
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
         null::text, null::text, null::text, null::text, null::int, null::text
  union all
  select 'procedure'::text, p.name, vp.price_paise,
         null::text, null::text, null::text, null::text, null::int, null::text
  from public.visit_procedures vp
  join public.procedures p on p.id = vp.procedure_id
  where vp.visit_id = p_visit_id
  union all
  select 'medicine'::text, m.name, m.price_paise,
         pi.drug_type, pi.strength, pi.before_after_food, pi.dosage_frequency, pi.duration_days, pi.notes
  from public.prescription_items pi
  join public.prescriptions pr on pr.id = pi.prescription_id
  join public.medicines m on m.id = pi.medicine_id
  where pr.visit_id = p_visit_id;
end;
$$;

revoke execute on function public.get_visit_billing_detail(uuid) from public;
grant execute on function public.get_visit_billing_detail(uuid) to authenticated;
