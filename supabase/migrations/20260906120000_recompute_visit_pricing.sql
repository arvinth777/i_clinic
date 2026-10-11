-- calculated_total_paise auto-recompute.
--
-- Phase 1's own header deferred this: "the PRD does not specify how a
-- prescription's dosage/duration maps to a billable medicine quantity or
-- price... calculated_total_paise is therefore set by the app until that
-- formula is defined." That formula is now defined: calculated_total_paise
-- = the clinic's flat consultation fee + SUM(visit_procedures.price_paise
-- for this visit) + SUM(medicines.price_paise, one unit per
-- prescription_item, for this visit's prescriptions).
--
-- Medicine pricing is read live from the medicines catalog at recompute
-- time, not snapshotted per prescription_item (unlike visit_procedures,
-- which already snapshots price_paise per visit). Deliberate: adding that
-- snapshot column is out of scope here. Consequence, named rather than
-- silently shipped: editing a medicine's catalog price does NOT recompute
-- any visit's total (no trigger on medicines), so an in-progress visit's
-- total only drifts from a live catalog price via its own
-- visit_procedures/prescription_items changes, never from someone editing
-- the catalog out from under it. That also means a stale total only heals
-- when the visit itself changes -- not a general answer, just the one that
-- avoids retroactively rewriting pricing (and revision_number, and
-- bills_needing_reconciliation) on every visit sharing a catalog item the
-- moment its price changes.
--
-- final_amount_paise clamp: calculated_total_paise can only ever fall when
-- a procedure or prescribed medicine is *removed* (adding one only ever
-- raises it, which can never violate final_amount_not_over_total). If a
-- removal drops the total below the doctor's already-set final_amount, this
-- recompute clamps final_amount_paise down to the new total in the same
-- statement -- confirmed with the user rather than assumed: the
-- alternative (reject the removal until the doctor re-prices) was also
-- viable, but silently editing the number only when it would otherwise
-- violate the constraint, and never on an increase, was the chosen
-- semantics. bump_pricing_revision already fires whenever
-- calculated_total_paise or final_amount_paise changes, so this recompute
-- correctly bumps revision_number on its own -- no separate logic needed
-- here.
--
-- security definer + set search_path = '', matching assign_token_number
-- and create_visit_pricing above: the calling role (doctor, via
-- visit_procedures/prescription_items RLS) already has UPDATE rights on
-- visit_pricing today, but the recompute's correctness shouldn't depend on
-- that continuing to be true for every future caller -- an "on behalf of"
-- write, same reasoning as create_visit_pricing's.

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

  select consultation_fee_paise into v_fee
  from public.clinics where id = v_clinic_id;

  select coalesce(sum(price_paise), 0) into v_procedures_total
  from public.visit_procedures where visit_id = p_visit_id;

  select coalesce(sum(m.price_paise), 0) into v_medicines_total
  from public.prescription_items pi
  join public.prescriptions pr on pr.id = pi.prescription_id
  join public.medicines m on m.id = pi.medicine_id
  where pr.visit_id = p_visit_id;

  v_total := v_fee + v_procedures_total + v_medicines_total;

  update public.visit_pricing
  set calculated_total_paise = v_total,
      final_amount_paise = least(final_amount_paise, v_total)
  where visit_id = p_visit_id;
end;
$$;

-- Statement-level triggers with transition tables, not FOR EACH ROW: the
-- doctor's prescription-confirm flow inserts every prescription_item for a
-- visit in one multi-row insert. A row-level trigger would recompute (and
-- bump revision_number) once per row instead of once per operation.
--
-- Postgres rejects a single combined insert/update/delete trigger that
-- declares both transition tables ("transition tables cannot be specified
-- for triggers with more than one event") -- so this is three trigger
-- declarations per table, one per event, each referencing only the
-- transition table that event actually has (new_rows for insert, old_rows
-- for delete, both for update), sharing one function that branches on
-- TG_OP. plpgsql only plans a query the first time its specific branch
-- executes, so the branch not taken never touches a transition table name
-- this firing didn't bind.

create or replace function public.recompute_visit_pricing_from_procedures()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_visit_id uuid;
begin
  if TG_OP = 'INSERT' then
    for v_visit_id in select distinct visit_id from new_rows loop
      perform public.recompute_visit_pricing(v_visit_id);
    end loop;
  elsif TG_OP = 'DELETE' then
    for v_visit_id in select distinct visit_id from old_rows loop
      perform public.recompute_visit_pricing(v_visit_id);
    end loop;
  else
    for v_visit_id in
      select distinct visit_id from new_rows
      union
      select distinct visit_id from old_rows
    loop
      perform public.recompute_visit_pricing(v_visit_id);
    end loop;
  end if;
  return null;
end;
$$;

create trigger trg_recompute_pricing_from_procedures_ins
  after insert on public.visit_procedures
  referencing new table as new_rows
  for each statement execute function public.recompute_visit_pricing_from_procedures();

create trigger trg_recompute_pricing_from_procedures_upd
  after update on public.visit_procedures
  referencing old table as old_rows new table as new_rows
  for each statement execute function public.recompute_visit_pricing_from_procedures();

create trigger trg_recompute_pricing_from_procedures_del
  after delete on public.visit_procedures
  referencing old table as old_rows
  for each statement execute function public.recompute_visit_pricing_from_procedures();

create or replace function public.recompute_visit_pricing_from_prescription_items()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_visit_id uuid;
begin
  if TG_OP = 'INSERT' then
    for v_visit_id in
      select distinct pr.visit_id
      from public.prescriptions pr
      where pr.id in (select prescription_id from new_rows)
    loop
      perform public.recompute_visit_pricing(v_visit_id);
    end loop;
  elsif TG_OP = 'DELETE' then
    for v_visit_id in
      select distinct pr.visit_id
      from public.prescriptions pr
      where pr.id in (select prescription_id from old_rows)
    loop
      perform public.recompute_visit_pricing(v_visit_id);
    end loop;
  else
    for v_visit_id in
      select distinct pr.visit_id
      from public.prescriptions pr
      where pr.id in (
        select prescription_id from new_rows
        union
        select prescription_id from old_rows
      )
    loop
      perform public.recompute_visit_pricing(v_visit_id);
    end loop;
  end if;
  return null;
end;
$$;

create trigger trg_recompute_pricing_from_prescription_items_ins
  after insert on public.prescription_items
  referencing new table as new_rows
  for each statement execute function public.recompute_visit_pricing_from_prescription_items();

create trigger trg_recompute_pricing_from_prescription_items_upd
  after update on public.prescription_items
  referencing old table as old_rows new table as new_rows
  for each statement execute function public.recompute_visit_pricing_from_prescription_items();

create trigger trg_recompute_pricing_from_prescription_items_del
  after delete on public.prescription_items
  referencing old table as old_rows
  for each statement execute function public.recompute_visit_pricing_from_prescription_items();

-- Same gap fix_default_privileges.sql closed for assign_token_number and
-- create_visit_pricing: Supabase's own default privileges grant EXECUTE to
-- anon/authenticated at CREATE FUNCTION time, separate from anything this
-- migration does. None of these three are meant to be called directly (only
-- ever fired by the triggers above), so close that gap here too.
revoke execute on function public.recompute_visit_pricing(uuid) from anon, authenticated;
revoke execute on function public.recompute_visit_pricing_from_procedures() from anon, authenticated;
revoke execute on function public.recompute_visit_pricing_from_prescription_items() from anon, authenticated;
